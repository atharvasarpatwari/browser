import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(root, 'dist');
const dest = join(root, 'android', 'app', 'src', 'main', 'assets');
const bridgeSrc = join(root, 'android', 'bridge', 'nova-bridge.js');
const bridgeDest = join(dest, 'nova-bridge.js');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(dist, dest, { recursive: true });
cpSync(bridgeSrc, bridgeDest);

const indexPath = join(dest, 'index.html');
const indexHtml = readFileSync(indexPath, 'utf-8');
const bridgeTag = '<script src="./nova-bridge.js"></script>';
if (indexHtml.includes(bridgeTag)) {
  console.log('Bridge already injected; assets copied to ' + dest);
} else {
  const injected = indexHtml.replace(/<script type="module"/, bridgeTag + '\n  <script type="module"');
  writeFileSync(indexPath, injected);
  console.log('Bridge injected; assets copied to ' + dest);
}
