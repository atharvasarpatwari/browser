/**
 * Real-pipeline coverage for the "downloads write real files" fix —
 * DownloadManager used to accumulate fetched bytes purely for progress
 * tracking and never persist them anywhere on desktop. No mocks: a real
 * local HTTP server, a real DownloadManager, a real temp directory, real
 * fs checks on the result.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DownloadManager } from '../src/browser/downloads/download-manager';

let server: http.Server;
let baseUrl: string;
const BODY = 'x'.repeat(5000);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // fetch() enforces Same-Origin Policy even in the test environment (real
    // browser/Electron behavior, not a test-only quirk) — a bare local server
    // response is cross-origin from the test's synthetic page origin.
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(BODY);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitFor(dm: DownloadManager, kind: 'downloadCompleted' | 'downloadFailed'): Promise<void> {
  return new Promise((resolve) => {
    dm.on(kind, () => resolve());
  });
}

describe('DownloadManager — real disk writes (real pipeline, no mocks)', () => {
  it('writes the fetched bytes to a real file on disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-'));
    const dm = new DownloadManager(tmpDir);
    const done = waitFor(dm, 'downloadCompleted');

    const item = await dm.download(`${baseUrl}/file.bin`);
    await done;

    expect(fs.existsSync(item.path)).toBe(true);
    expect(fs.readFileSync(item.path, 'utf-8')).toBe(BODY);
    expect(dm.getItem(item.id)?.state).toBe('completed');
  });

  it('resolves the default path under the real base directory, sanitized against traversal', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-'));
    const dm = new DownloadManager(tmpDir);
    const done = waitFor(dm, 'downloadCompleted');

    const item = await dm.download(`${baseUrl}/../../etc/passwd.bin`);
    await done;

    expect(path.dirname(item.path)).toBe(tmpDir);
    expect(fs.existsSync(item.path)).toBe(true);
  });

  it('transitions to failed (not a false "completed") when the write itself fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-'));
    // A regular file where a directory is expected makes mkdirSync(..., {recursive:true}) throw ENOTDIR.
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const dm = new DownloadManager(tmpDir);
    const done = waitFor(dm, 'downloadFailed');

    const item = await dm.download(`${baseUrl}/file.bin`, { path: path.join(blocker, 'nested', 'file.bin') });
    await done;

    expect(dm.getItem(item.id)?.state).toBe('failed');
    expect(fs.existsSync(item.path)).toBe(false);
  });

  it('retry() restarts cleanly after a real failure and can succeed once the problem is fixed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-'));
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const dm = new DownloadManager(tmpDir);
    const failed = waitFor(dm, 'downloadFailed');

    const item = await dm.download(`${baseUrl}/file.bin`, { path: path.join(blocker, 'nested', 'file.bin') });
    await failed;
    expect(dm.getItem(item.id)?.state).toBe('failed');

    // Fix the real problem the first attempt hit, then retry the same item.
    fs.rmSync(blocker);
    const completed = waitFor(dm, 'downloadCompleted');
    const ok = await dm.retry(item.id);
    await completed;

    expect(ok).toBe(true);
    expect(dm.getItem(item.id)?.state).toBe('completed');
    expect(dm.getItem(item.id)?.error).toBeNull();
    expect(fs.existsSync(item.path)).toBe(true);
    expect(fs.readFileSync(item.path, 'utf-8')).toBe(BODY);
  });

  it('retry() only acts on a failed download', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dl-'));
    const dm = new DownloadManager(tmpDir);
    const done = waitFor(dm, 'downloadCompleted');
    const item = await dm.download(`${baseUrl}/file.bin`);
    await done;

    expect(await dm.retry(item.id)).toBe(false);
  });
});
