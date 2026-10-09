/**
 * @file tests/dtls-handshake.test.ts
 *
 * Gate for WebRTC Phase 2.1 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`):
 * a self-to-self DTLS 1.2 handshake (RFC 6347) — ClientHello/HelloVerifyRequest
 * cookie round trip, mutual ECDSA P-256 self-signed certs, ECDHE key exchange,
 * CertificateVerify, and Finished — first over an in-memory duplex (fast,
 * deterministic), then over a real loopback UDP socket pair (the actual
 * transport shape `IceAgent` will hand this seam in 2.3).
 */
import { describe, it, expect } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { DtlsEndpoint, type DtlsHandshakeResult } from '../src/browser/networking/dtls/dtls-handshake';
import { generateSelfSignedP256Cert } from '../src/browser/networking/dtls/x509-der';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function assertHandshakeResultsMatch(client: DtlsHandshakeResult, server: DtlsHandshakeResult): void {
  expect(Array.from(client.masterSecret)).toEqual(Array.from(server.masterSecret));
  expect(Array.from(client.keys.clientWriteKey)).toEqual(Array.from(server.keys.clientWriteKey));
  expect(Array.from(client.keys.serverWriteKey)).toEqual(Array.from(server.keys.serverWriteKey));
  // Each side's view of the peer must match what the peer actually presented.
  expect(client.peerFingerprintSha256).toBe(server.localCert.fingerprintSha256);
  expect(server.peerFingerprintSha256).toBe(client.localCert.fingerprintSha256);
}

describe('DTLS 1.2 handshake — in-memory duplex', () => {
  it('completes a full mutual-cert ECDHE handshake and derives identical keys on both sides', async () => {
    const clientCert = await generateSelfSignedP256Cert();
    const serverCert = await generateSelfSignedP256Cert();

    let server!: DtlsEndpoint;
    const client = new DtlsEndpoint({ role: 'client', cert: clientCert, send: (bytes) => server.onReceive(bytes) });
    server = new DtlsEndpoint({ role: 'server', cert: serverCert, send: (bytes) => client.onReceive(bytes) });

    const [clientResult, serverResult] = await withTimeout(
      Promise.all([client.handshakeDone, server.handshakeDone]),
      5000,
      'in-memory DTLS handshake',
    );

    assertHandshakeResultsMatch(clientResult, serverResult);
  });

  it('rejects when a peer presents a certificate not matching what it signed with (tampered cert)', async () => {
    // A CertificateVerify signed by one key but a Certificate message carrying a different
    // key's cert must fail verification — proves the signature check is load-bearing, not a
    // pass-through. We simulate this by handing the client a cert whose public key does not
    // match the private key it will sign CertificateVerify with.
    const clientCert = await generateSelfSignedP256Cert();
    const mismatchedCert = await generateSelfSignedP256Cert();
    const impostorClientCert = { ...clientCert, der: mismatchedCert.der };
    const serverCert = await generateSelfSignedP256Cert();

    let server!: DtlsEndpoint;
    const client = new DtlsEndpoint({ role: 'client', cert: impostorClientCert, send: (bytes) => server.onReceive(bytes) });
    server = new DtlsEndpoint({ role: 'server', cert: serverCert, send: (bytes) => client.onReceive(bytes) });

    await expect(withTimeout(server.handshakeDone, 5000, 'tampered-cert handshake')).rejects.toThrow(
      /CertificateVerify signature invalid/,
    );
  });
});

describe('DTLS 1.2 handshake — real loopback UDP', () => {
  it('completes the same handshake over two real UDP sockets on 127.0.0.1', async () => {
    const clientCert = await generateSelfSignedP256Cert();
    const serverCert = await generateSelfSignedP256Cert();

    const clientSocket = dgram.createSocket('udp4');
    const serverSocket = dgram.createSocket('udp4');

    await new Promise<void>((resolve) => clientSocket.bind(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => serverSocket.bind(0, '127.0.0.1', resolve));

    const clientPort = (clientSocket.address() as AddressInfo).port;
    const serverPort = (serverSocket.address() as AddressInfo).port;

    let client!: DtlsEndpoint;
    let server!: DtlsEndpoint;

    clientSocket.on('message', (msg) => client.onReceive(new Uint8Array(msg)));
    serverSocket.on('message', (msg) => server.onReceive(new Uint8Array(msg)));

    client = new DtlsEndpoint({
      role: 'client',
      cert: clientCert,
      send: (bytes) => clientSocket.send(bytes, serverPort, '127.0.0.1'),
    });
    server = new DtlsEndpoint({
      role: 'server',
      cert: serverCert,
      send: (bytes) => serverSocket.send(bytes, clientPort, '127.0.0.1'),
    });

    try {
      const [clientResult, serverResult] = await withTimeout(
        Promise.all([client.handshakeDone, server.handshakeDone]),
        8000,
        'loopback UDP DTLS handshake',
      );
      assertHandshakeResultsMatch(clientResult, serverResult);
    } finally {
      clientSocket.close();
      serverSocket.close();
    }
  });
});
