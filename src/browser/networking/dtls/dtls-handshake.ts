/**
 * @file src/browser/networking/dtls/dtls-handshake.ts
 *
 * DTLS 1.2 client + server handshake state machines (RFC 6347) for the
 * single cipher suite this phase targets: `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256`
 * (0xC02B), with mutual certificate exchange (both peers always present a
 * self-signed cert and verify `CertificateVerify` — the WebRTC/RFC 8827
 * norm, since trust comes from the SDP `a=fingerprint` line, not a CA).
 *
 * ponytail: no message fragmentation/reassembly (RFC 6347 §4.2.3) and no
 * retransmission timers — every message is assumed to fit one record and
 * the transport (in-memory duplex today, real loopback UDP in the 2.1 gate
 * test) is assumed reliable and ordered. Real-browser interop (phase 2.4,
 * over an actual lossy/reordering-capable path) is the upgrade trigger for
 * both.
 */

import { concatBytes, readUInt16BE, writeUInt16BE, toArrayBuffer } from '../byte-codecs';
import {
  DtlsContentType,
  buildPlaintextRecord,
  decryptRecordGcm,
  encryptRecordGcm,
  parseRecordHeader,
  splitRecords,
} from './dtls-record';
import {
  derEcdsaSigToRaw,
  rawEcdsaSigToDer,
  extractSpkiEcPoint,
  certFingerprintSha256,
  type SelfSignedCert,
} from './x509-der';
import {
  generateEcdhKeyPair,
  exportEcdhRawPublicKey,
  ecdhSharedSecret,
  deriveMasterSecret,
  deriveGcmKeyBlock,
  computeFinishedVerifyData,
  sha256,
  type GcmKeyBlock,
} from './dtls-crypto';

export const CIPHER_SUITE_ECDHE_ECDSA_AES128_GCM_SHA256 = 0xc02b;
const NAMED_CURVE_SECP256R1 = 23;
const EC_POINT_FORMAT_UNCOMPRESSED = 0;
const SIG_HASH_SHA256_ECDSA = new Uint8Array([4, 3]); // (HashAlgorithm.sha256, SignatureAlgorithm.ecdsa)
const CLIENT_CERT_TYPE_ECDSA_SIGN = 64;

const HandshakeType = {
  hello_request: 0,
  client_hello: 1,
  server_hello: 2,
  hello_verify_request: 3,
  certificate: 11,
  server_key_exchange: 12,
  certificate_request: 13,
  server_hello_done: 14,
  certificate_verify: 15,
  client_key_exchange: 16,
  finished: 20,
} as const;

/* -------------------------------------------------------------------------- */
/*  Small local byte helpers (uint16/uint24 big-endian — not shared elsewhere) */
/* -------------------------------------------------------------------------- */

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  writeUInt16BE(out, n, 0);
  return out;
}

function writeUInt24(out: Uint8Array, value: number, offset: number): void {
  out[offset] = (value >>> 16) & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = value & 0xff;
}

function readUInt24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!;
}

function u24(n: number): Uint8Array {
  const out = new Uint8Array(3);
  writeUInt24(out, n, 0);
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Handshake message framing (RFC 6347 §4.2.2)                              */
/* -------------------------------------------------------------------------- */

const HANDSHAKE_HEADER_LEN = 12;

interface HandshakeMessage {
  msgType: number;
  body: Uint8Array;
  seq: number;
  /** Header + body, as framed on the wire — what gets hashed into the transcript. */
  raw: Uint8Array;
}

function buildHandshakeMessage(msgType: number, seq: number, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(HANDSHAKE_HEADER_LEN);
  header[0] = msgType;
  writeUInt24(header, body.length, 1);
  writeUInt16BE(header, seq, 4);
  writeUInt24(header, 0, 6); // fragment_offset — always 0 (no fragmentation)
  writeUInt24(header, body.length, 9); // fragment_length === length
  return concatBytes([header, body]);
}

function parseHandshakeMessage(bytes: Uint8Array): HandshakeMessage {
  if (bytes.length < HANDSHAKE_HEADER_LEN) throw new Error('parseHandshakeMessage: truncated header');
  const msgType = bytes[0]!;
  const length = readUInt24(bytes, 1);
  const seq = readUInt16BE(bytes, 4);
  const fragOffset = readUInt24(bytes, 6);
  const fragLength = readUInt24(bytes, 9);
  if (fragOffset !== 0 || fragLength !== length) {
    throw new Error('parseHandshakeMessage: fragmented handshake messages are not supported in this phase');
  }
  const body = bytes.subarray(HANDSHAKE_HEADER_LEN, HANDSHAKE_HEADER_LEN + length);
  return { msgType, body, seq, raw: bytes.subarray(0, HANDSHAKE_HEADER_LEN + length) };
}

/* -------------------------------------------------------------------------- */
/*  Message body builders / parsers                                          */
/* -------------------------------------------------------------------------- */

function buildExtension(type: number, data: Uint8Array): Uint8Array {
  return concatBytes([u16(type), u16(data.length), data]);
}

function buildClientExtensions(): Uint8Array {
  const supportedGroups = buildExtension(10, concatBytes([u16(2), u16(NAMED_CURVE_SECP256R1)]));
  const ecPointFormats = buildExtension(11, concatBytes([new Uint8Array([1]), new Uint8Array([EC_POINT_FORMAT_UNCOMPRESSED])]));
  const signatureAlgorithms = buildExtension(13, concatBytes([u16(2), SIG_HASH_SHA256_ECDSA]));
  return concatBytes([supportedGroups, ecPointFormats, signatureAlgorithms]);
}

function buildClientHello(random: Uint8Array, cookie: Uint8Array): Uint8Array {
  const sessionId = new Uint8Array([0]);
  const cookieField = concatBytes([new Uint8Array([cookie.length]), cookie]);
  const cipherSuites = concatBytes([u16(2), u16(CIPHER_SUITE_ECDHE_ECDSA_AES128_GCM_SHA256)]);
  const compressionMethods = new Uint8Array([1, 0]);
  const extensions = buildClientExtensions();
  return concatBytes([
    new Uint8Array([0xfe, 0xfd]),
    random,
    sessionId,
    cookieField,
    cipherSuites,
    compressionMethods,
    u16(extensions.length),
    extensions,
  ]);
}

/** Cookie length is the only field the server needs out of an (otherwise unvalidated) ClientHello extension set. */
function clientHelloCookieLen(body: Uint8Array): number {
  let p = 2 + 32;
  const sessionIdLen = body[p]!;
  p += 1 + sessionIdLen;
  return body[p]!;
}

function parseClientHello(body: Uint8Array): { random: Uint8Array; cookie: Uint8Array } {
  let p = 2;
  const random = body.subarray(p, p + 32);
  p += 32;
  const sessionIdLen = body[p]!;
  p += 1 + sessionIdLen;
  const cookieLen = body[p]!;
  p += 1;
  const cookie = body.subarray(p, p + cookieLen);
  return { random, cookie };
}

function buildHelloVerifyRequest(cookie: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0xfe, 0xfd]), new Uint8Array([cookie.length]), cookie]);
}

function parseHelloVerifyRequest(body: Uint8Array): Uint8Array {
  const cookieLen = body[2]!;
  return body.subarray(3, 3 + cookieLen);
}

function buildServerHello(random: Uint8Array): Uint8Array {
  const sessionId = new Uint8Array([0]);
  return concatBytes([
    new Uint8Array([0xfe, 0xfd]),
    random,
    sessionId,
    u16(CIPHER_SUITE_ECDHE_ECDSA_AES128_GCM_SHA256),
    new Uint8Array([0]), // compression_method = null
    u16(0), // extensions — none needed for this profile
  ]);
}

function parseServerHello(body: Uint8Array): { random: Uint8Array } {
  let p = 2;
  const random = body.subarray(p, p + 32);
  p += 32;
  const sessionIdLen = body[p]!;
  p += 1 + sessionIdLen;
  // cipher_suite(2) + compression_method(1) + extensions — not needed, single fixed suite.
  return { random };
}

function buildCertificateMessage(certDer: Uint8Array): Uint8Array {
  const entry = concatBytes([u24(certDer.length), certDer]);
  return concatBytes([u24(entry.length), entry]);
}

function parseCertificateMessage(body: Uint8Array): Uint8Array {
  const certLen = readUInt24(body, 3);
  return body.subarray(6, 6 + certLen);
}

function buildServerEcdhParams(publicKeyRaw: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([3]), u16(NAMED_CURVE_SECP256R1), new Uint8Array([publicKeyRaw.length]), publicKeyRaw]);
}

function parseServerEcdhParams(body: Uint8Array): { point: Uint8Array; end: number } {
  const pointLen = body[3]!;
  return { point: body.subarray(4, 4 + pointLen), end: 4 + pointLen };
}

async function signEcdsa(privateKey: CryptoKey, preimage: Uint8Array): Promise<Uint8Array> {
  const sigRaw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, toArrayBuffer(preimage)),
  );
  return rawEcdsaSigToDer(sigRaw);
}

async function verifyEcdsa(publicKey: CryptoKey, sigDer: Uint8Array, preimage: Uint8Array): Promise<boolean> {
  const sigRaw = derEcdsaSigToRaw(sigDer);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, toArrayBuffer(sigRaw), toArrayBuffer(preimage));
}

async function importEcdsaVerifyKey(rawPoint: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(rawPoint), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

async function buildServerKeyExchange(
  clientRandom: Uint8Array,
  serverRandom: Uint8Array,
  serverEcdhPub: Uint8Array,
  signingKey: CryptoKey,
): Promise<Uint8Array> {
  const params = buildServerEcdhParams(serverEcdhPub);
  const preimage = concatBytes([clientRandom, serverRandom, params]);
  const sigDer = await signEcdsa(signingKey, preimage);
  const signed = concatBytes([SIG_HASH_SHA256_ECDSA, u16(sigDer.length), sigDer]);
  return concatBytes([params, signed]);
}

async function parseAndVerifyServerKeyExchange(
  body: Uint8Array,
  clientRandom: Uint8Array,
  serverRandom: Uint8Array,
  verifyKey: CryptoKey,
): Promise<Uint8Array> {
  const { point, end } = parseServerEcdhParams(body);
  const params = body.subarray(0, end);
  const sigLen = readUInt16BE(body, end + 2);
  const sigDer = body.subarray(end + 4, end + 4 + sigLen);
  const preimage = concatBytes([clientRandom, serverRandom, params]);
  const ok = await verifyEcdsa(verifyKey, sigDer, preimage);
  if (!ok) throw new Error('ServerKeyExchange: signature verification failed');
  return point;
}

function buildCertificateRequest(): Uint8Array {
  const certificateTypes = new Uint8Array([1, CLIENT_CERT_TYPE_ECDSA_SIGN]);
  const sigAlgs = concatBytes([u16(2), SIG_HASH_SHA256_ECDSA]);
  const certificateAuthorities = u16(0); // no CA list — fingerprint trust only
  return concatBytes([certificateTypes, sigAlgs, certificateAuthorities]);
}

function buildClientKeyExchange(clientEcdhPub: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([clientEcdhPub.length]), clientEcdhPub]);
}

function parseClientKeyExchange(body: Uint8Array): Uint8Array {
  const len = body[0]!;
  return body.subarray(1, 1 + len);
}

async function buildCertificateVerify(privateKey: CryptoKey, transcript: Uint8Array): Promise<Uint8Array> {
  const sigDer = await signEcdsa(privateKey, transcript);
  return concatBytes([SIG_HASH_SHA256_ECDSA, u16(sigDer.length), sigDer]);
}

async function verifyCertificateVerify(body: Uint8Array, transcript: Uint8Array, verifyKey: CryptoKey): Promise<boolean> {
  const sigLen = readUInt16BE(body, 2);
  const sigDer = body.subarray(4, 4 + sigLen);
  return verifyEcdsa(verifyKey, sigDer, transcript);
}

/* -------------------------------------------------------------------------- */
/*  Async message queue — bridges `onReceive` pushes to the state machine's   */
/*  sequential `await expect(type)` driving style.                           */
/* -------------------------------------------------------------------------- */

class HandshakeMessageQueue {
  private queue: HandshakeMessage[] = [];
  private waiters: Array<(m: HandshakeMessage) => void> = [];

  push(message: HandshakeMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.queue.push(message);
  }

  next(): Promise<HandshakeMessage> {
    const message = this.queue.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/* -------------------------------------------------------------------------- */
/*  Endpoint                                                                  */
/* -------------------------------------------------------------------------- */

export type DtlsRole = 'client' | 'server';

export interface DtlsHandshakeResult {
  masterSecret: Uint8Array;
  keys: GcmKeyBlock;
  peerCertDer: Uint8Array;
  peerFingerprintSha256: string;
  localCert: SelfSignedCert;
}

export interface DtlsEndpointOptions {
  role: DtlsRole;
  cert: SelfSignedCert;
  /** Called with each outgoing UDP datagram (one DTLS record per call in this phase). */
  send: (bytes: Uint8Array) => void;
}

export class DtlsEndpoint {
  private readonly role: DtlsRole;
  private readonly cert: SelfSignedCert;
  private readonly sendBytes: (bytes: Uint8Array) => void;

  private readonly queue = new HandshakeMessageQueue();
  /** Ordered log of every handshake message this endpoint has sent or received, from the point the transcript starts (RFC 6347 §4.2.6 excludes the stateless-cookie round). */
  private readonly hsMessages: Uint8Array[] = [];
  private transcriptActive = false;

  private nextSendSeq = 0;
  private writeEpoch = 0;
  private writeSeq = 0;
  private gcmKeys: GcmKeyBlock | null = null;
  private serverCookie: Uint8Array | null = null;

  readonly handshakeDone: Promise<DtlsHandshakeResult>;
  private resolveDone!: (result: DtlsHandshakeResult) => void;
  private rejectDone!: (error: unknown) => void;

  /** Fires with the decrypted payload of each post-handshake `ApplicationData` record (e.g. SCTP packets in 2.3). */
  onApplicationData?: (bytes: Uint8Array) => void;

  constructor(options: DtlsEndpointOptions) {
    this.role = options.role;
    this.cert = options.cert;
    this.sendBytes = options.send;
    this.handshakeDone = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    void (this.role === 'client' ? this.runClient() : this.runServer()).catch((error) => this.rejectDone(error));
  }

  /** Feed one received UDP datagram (may carry several coalesced DTLS records). */
  onReceive(datagram: Uint8Array): void {
    for (const record of splitRecords(datagram)) {
      void this.handleRecord(record).catch((error) => this.rejectDone(error));
    }
  }

  private async handleRecord(record: Uint8Array): Promise<void> {
    const header = parseRecordHeader(record, 0);
    if (header.contentType === DtlsContentType.ChangeCipherSpec) return; // epoch bump is tracked per-record via header.epoch on decrypt, nothing else to do

    let plaintext: Uint8Array;
    if (header.epoch === 0) {
      plaintext = record.subarray(13, 13 + header.length);
    } else {
      if (!this.gcmKeys) throw new Error('DtlsEndpoint: received an encrypted record before keys were derived');
      const readKey = this.role === 'client' ? this.gcmKeys.serverWriteKey : this.gcmKeys.clientWriteKey;
      const readSalt = this.role === 'client' ? this.gcmKeys.serverWriteIv : this.gcmKeys.clientWriteIv;
      plaintext = (await decryptRecordGcm(readKey, readSalt, record)).plaintext;
    }
    if (header.contentType === DtlsContentType.ApplicationData) {
      this.onApplicationData?.(plaintext);
      return;
    }
    if (header.contentType !== DtlsContentType.Handshake) return;

    let offset = 0;
    while (offset < plaintext.length) {
      const message = parseHandshakeMessage(plaintext.subarray(offset));
      offset += message.raw.length;

      if (message.msgType === HandshakeType.hello_verify_request) {
        // Never part of the transcript (RFC 6347 §4.2.6).
      } else if (message.msgType === HandshakeType.client_hello) {
        if (clientHelloCookieLen(message.body) > 0) {
          this.transcriptActive = true;
          this.hsMessages.push(message.raw);
        }
        // A cookie-less first ClientHello is never recorded.
      } else if (this.transcriptActive) {
        this.hsMessages.push(message.raw);
      }
      this.queue.push(message);
    }
  }

  private async expect(msgType: number): Promise<HandshakeMessage> {
    const message = await this.queue.next();
    if (message.msgType !== msgType) {
      throw new Error(`DtlsEndpoint: expected handshake msgType ${msgType}, got ${message.msgType}`);
    }
    return message;
  }

  private async buildOutgoingRecord(contentType: DtlsContentType, body: Uint8Array): Promise<Uint8Array> {
    if (this.writeEpoch === 0) {
      return buildPlaintextRecord(contentType, this.writeEpoch, this.writeSeq++, body);
    }
    if (!this.gcmKeys) throw new Error('DtlsEndpoint: cannot send an encrypted record before keys are derived');
    const key = this.role === 'client' ? this.gcmKeys.clientWriteKey : this.gcmKeys.serverWriteKey;
    const salt = this.role === 'client' ? this.gcmKeys.clientWriteIv : this.gcmKeys.serverWriteIv;
    return encryptRecordGcm(key, salt, this.writeEpoch, this.writeSeq++, contentType, body);
  }

  /** Encrypt and send one post-handshake `ApplicationData` record. Only valid once `handshakeDone` has resolved. */
  async sendApplicationData(bytes: Uint8Array): Promise<void> {
    this.sendBytes(await this.buildOutgoingRecord(DtlsContentType.ApplicationData, bytes));
  }

  private async sendHandshake(msgType: number, body: Uint8Array): Promise<void> {
    const framed = buildHandshakeMessage(msgType, this.nextSendSeq++, body);
    if (this.transcriptActive) this.hsMessages.push(framed);
    this.sendBytes(await this.buildOutgoingRecord(DtlsContentType.Handshake, framed));
  }

  private async sendChangeCipherSpec(): Promise<void> {
    this.sendBytes(buildPlaintextRecord(DtlsContentType.ChangeCipherSpec, this.writeEpoch, this.writeSeq++, new Uint8Array([1])));
    this.writeEpoch++;
    this.writeSeq = 0;
  }

  private transcript(): Uint8Array {
    return concatBytes(this.hsMessages);
  }

  private transcriptExcludingLast(): Uint8Array {
    return concatBytes(this.hsMessages.slice(0, -1));
  }

  /* ---- Client flow ------------------------------------------------------- */

  private async runClient(): Promise<void> {
    const clientRandom = new Uint8Array(32);
    crypto.getRandomValues(clientRandom);

    await this.sendHandshake(HandshakeType.client_hello, buildClientHello(clientRandom, new Uint8Array(0)));
    const hvr = await this.expect(HandshakeType.hello_verify_request);
    const cookie = parseHelloVerifyRequest(hvr.body);

    this.transcriptActive = true;
    await this.sendHandshake(HandshakeType.client_hello, buildClientHello(clientRandom, cookie));

    const serverHelloMsg = await this.expect(HandshakeType.server_hello);
    const { random: serverRandom } = parseServerHello(serverHelloMsg.body);

    const serverCertMsg = await this.expect(HandshakeType.certificate);
    const serverCertDer = parseCertificateMessage(serverCertMsg.body);
    const serverVerifyKey = await importEcdsaVerifyKey(extractSpkiEcPoint(serverCertDer));

    const skeMsg = await this.expect(HandshakeType.server_key_exchange);
    const serverEcdhPoint = await parseAndVerifyServerKeyExchange(skeMsg.body, clientRandom, serverRandom, serverVerifyKey);

    await this.expect(HandshakeType.certificate_request);
    await this.expect(HandshakeType.server_hello_done);

    await this.sendHandshake(HandshakeType.certificate, buildCertificateMessage(this.cert.der));

    const ecdhKeyPair = await generateEcdhKeyPair();
    const clientEcdhPub = await exportEcdhRawPublicKey(ecdhKeyPair.publicKey);
    await this.sendHandshake(HandshakeType.client_key_exchange, buildClientKeyExchange(clientEcdhPub));

    const preMasterSecret = await ecdhSharedSecret(ecdhKeyPair.privateKey, serverEcdhPoint);
    const masterSecret = await deriveMasterSecret(preMasterSecret, clientRandom, serverRandom);
    this.gcmKeys = await deriveGcmKeyBlock(masterSecret, clientRandom, serverRandom);

    await this.sendHandshake(HandshakeType.certificate_verify, await buildCertificateVerify(this.cert.privateKey, this.transcript()));

    const clientFinishedHash = await sha256(this.transcript());
    const clientVerifyData = await computeFinishedVerifyData(masterSecret, 'client finished', clientFinishedHash);
    await this.sendChangeCipherSpec();
    await this.sendHandshake(HandshakeType.finished, clientVerifyData);

    const serverFinishedMsg = await this.expect(HandshakeType.finished);
    const serverFinishedHash = await sha256(this.transcriptExcludingLast());
    const expectedServerVerifyData = await computeFinishedVerifyData(masterSecret, 'server finished', serverFinishedHash);
    if (!bytesEqualConstTime(serverFinishedMsg.body, expectedServerVerifyData)) {
      throw new Error('DtlsEndpoint: server Finished verify_data mismatch');
    }

    this.resolveDone({
      masterSecret,
      keys: this.gcmKeys,
      peerCertDer: serverCertDer,
      peerFingerprintSha256: await certFingerprintSha256(serverCertDer),
      localCert: this.cert,
    });
  }

  /* ---- Server flow --------------------------------------------------------*/

  private async runServer(): Promise<void> {
    await this.expect(HandshakeType.client_hello); // first, cookie-less — discarded by design

    this.serverCookie = new Uint8Array(16);
    crypto.getRandomValues(this.serverCookie);
    await this.sendHandshake(HandshakeType.hello_verify_request, buildHelloVerifyRequest(this.serverCookie));

    const clientHello2 = await this.expect(HandshakeType.client_hello);
    const { random: clientRandom, cookie } = parseClientHello(clientHello2.body);
    if (!bytesEqualConstTime(cookie, this.serverCookie)) throw new Error('DtlsEndpoint: cookie mismatch on retried ClientHello');

    const serverRandom = new Uint8Array(32);
    crypto.getRandomValues(serverRandom);
    await this.sendHandshake(HandshakeType.server_hello, buildServerHello(serverRandom));
    await this.sendHandshake(HandshakeType.certificate, buildCertificateMessage(this.cert.der));

    const ecdhKeyPair = await generateEcdhKeyPair();
    const serverEcdhPub = await exportEcdhRawPublicKey(ecdhKeyPair.publicKey);
    await this.sendHandshake(
      HandshakeType.server_key_exchange,
      await buildServerKeyExchange(clientRandom, serverRandom, serverEcdhPub, this.cert.privateKey),
    );
    await this.sendHandshake(HandshakeType.certificate_request, buildCertificateRequest());
    await this.sendHandshake(HandshakeType.server_hello_done, new Uint8Array(0));

    const clientCertMsg = await this.expect(HandshakeType.certificate);
    const clientCertDer = parseCertificateMessage(clientCertMsg.body);
    const clientVerifyKey = await importEcdsaVerifyKey(extractSpkiEcPoint(clientCertDer));

    const ckeMsg = await this.expect(HandshakeType.client_key_exchange);
    const clientEcdhPoint = parseClientKeyExchange(ckeMsg.body);

    const preMasterSecret = await ecdhSharedSecret(ecdhKeyPair.privateKey, clientEcdhPoint);
    const masterSecret = await deriveMasterSecret(preMasterSecret, clientRandom, serverRandom);
    this.gcmKeys = await deriveGcmKeyBlock(masterSecret, clientRandom, serverRandom);

    const certVerifyMsg = await this.expect(HandshakeType.certificate_verify);
    const certVerifyOk = await verifyCertificateVerify(certVerifyMsg.body, this.transcriptExcludingLast(), clientVerifyKey);
    if (!certVerifyOk) throw new Error('DtlsEndpoint: client CertificateVerify signature invalid');

    const clientFinishedMsg = await this.expect(HandshakeType.finished);
    const clientFinishedHash = await sha256(this.transcriptExcludingLast());
    const expectedClientVerifyData = await computeFinishedVerifyData(masterSecret, 'client finished', clientFinishedHash);
    if (!bytesEqualConstTime(clientFinishedMsg.body, expectedClientVerifyData)) {
      throw new Error('DtlsEndpoint: client Finished verify_data mismatch');
    }

    const serverFinishedHash = await sha256(this.transcript());
    const serverVerifyData = await computeFinishedVerifyData(masterSecret, 'server finished', serverFinishedHash);
    await this.sendChangeCipherSpec();
    await this.sendHandshake(HandshakeType.finished, serverVerifyData);

    this.resolveDone({
      masterSecret,
      keys: this.gcmKeys,
      peerCertDer: clientCertDer,
      peerFingerprintSha256: await certFingerprintSha256(clientCertDer),
      localCert: this.cert,
    });
  }
}

/** Not constant-time against a timing side-channel, but these compare locally-derived handshake values, not externally-guessable secrets one byte at a time. */
function bytesEqualConstTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
