import { describe, it, expect } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { createCryptoObject } from '../src/browser/js/crypto-api';
import { createTypedArrayConstructors } from '../src/browser/js/typed-arrays';

function createTestEnv() {
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const env = (interp as any).globalEnv as Environment;
  for (const [name, ctor] of Object.entries(createTypedArrayConstructors())) {
    env.setLocal(name, ctor);
  }
  env.setLocal('crypto', createCryptoObject(eventLoop));
  return { interp, env, eventLoop };
}

async function flushAll(el: EventLoop) {
  // generateKey/encrypt/etc. go through Node's real async crypto (thread
  // pool), which can take a few real milliseconds — a single 0ms tick per
  // loop isn't always enough, so wait a little longer and require several
  // consecutive empty checks before concluding everything has settled.
  let consecutiveEmpty = 0;
  for (let i = 0; i < 100 && consecutiveEmpty < 5; i++) {
    await new Promise<void>(r => setTimeout(r, 5));
    el.drainMicrotasks();
    consecutiveEmpty = el.microtaskCount === 0 ? consecutiveEmpty + 1 : 0;
  }
}

async function run(source: string) {
  const { interp, env, eventLoop } = createTestEnv();
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  interp.run(program);
  await flushAll(eventLoop);
  return { env, eventLoop };
}

// Bytes <-> hex/string helpers expressed in real Nova JS (Nova's engine has
// no TextEncoder yet — a separate gap — so plain charCodeAt does the job).
const HELPERS = `
  function toHex(buf) {
    var bytes = new Uint8Array(buf);
    var digits = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      out += digits[(b >> 4) & 15] + digits[b & 15];
    }
    return out;
  }
  function strToBytes(str) {
    var arr = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    return arr;
  }
`;

describe('Web Crypto API (crypto.*, delegating to node:crypto webcrypto)', () => {
  it('getRandomValues fills a typed array in place with non-trivial randomness', async () => {
    const { env } = await run(`
      var arr = new Uint8Array(16);
      var returned = crypto.getRandomValues(arr);
      var sameRef = returned === arr;
      var allZero = arr.every(function (b) { return b === 0; });
    `);
    expect(env.get('sameRef')).toBe(true);
    expect(env.get('allZero')).toBe(false);
  });

  it('randomUUID returns a real v4-shaped UUID', async () => {
    const { env } = await run(`var id = crypto.randomUUID();`);
    const id = env.get('id') as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('subtle.digest("SHA-256", "abc") matches the known NIST test vector', async () => {
    const { env } = await run(`
      ${HELPERS}
      var data = strToBytes('abc');
      var hashHex = '';
      var done = false;
      crypto.subtle.digest('SHA-256', data).then(function (buf) {
        hashHex = toHex(buf);
        done = true;
      });
    `);
    expect(env.get('done')).toBe(true);
    expect(env.get('hashHex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('AES-GCM generateKey + encrypt + decrypt round-trips the original plaintext', async () => {
    const { env } = await run(`
      var plainHex = '';
      var decryptedHex = '';
      var ciphertextDiffers = false;
      ${HELPERS}
      var plaintext = strToBytes('nova browser secret');
      plainHex = toHex(plaintext);
      crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
        .then(function (key) {
          var iv = crypto.getRandomValues(new Uint8Array(12));
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext)
            .then(function (ciphertext) {
              ciphertextDiffers = toHex(ciphertext) !== plainHex;
              return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
            });
        })
        .then(function (decrypted) {
          decryptedHex = toHex(decrypted);
        })
        .catch(function (err) { plainHex = 'ERROR:' + String(err); });
    `);
    expect(env.get('ciphertextDiffers')).toBe(true);
    expect(env.get('decryptedHex')).toBe(env.get('plainHex'));
  });

  it('HMAC sign/verify round-trips true for the real message and false for a tampered one', async () => {
    const { env } = await run(`
      ${HELPERS}
      var validForOriginal = null;
      var validForTampered = null;
      crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
        .then(function (key) {
          var msg = strToBytes('integrity check');
          return crypto.subtle.sign('HMAC', key, msg).then(function (sig) {
            var tampered = strToBytes('integrity chuck');
            return crypto.subtle.verify('HMAC', key, sig, msg)
              .then(function (ok) { validForOriginal = ok; return crypto.subtle.verify('HMAC', key, sig, tampered); })
              .then(function (ok) { validForTampered = ok; });
          });
        });
    `);
    expect(env.get('validForOriginal')).toBe(true);
    expect(env.get('validForTampered')).toBe(false);
  });

  it('rejects the returned promise with an OperationError-shaped reason on bad input', async () => {
    const { env } = await run(`
      var caught = null;
      crypto.subtle.digest('NOT-A-REAL-ALGORITHM', new Uint8Array(1)).catch(function (err) {
        caught = String(err);
      });
    `);
    expect(env.get('caught')).toMatch(/OperationError/);
  });
});
