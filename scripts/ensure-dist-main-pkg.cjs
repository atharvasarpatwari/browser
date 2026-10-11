// Writes dist-main/package.json so Node treats tsc's CommonJS output under
// dist-main/ as CommonJS, overriding the project root's "type": "module"
// (which would otherwise make Node load these .js files as ES modules and
// silently produce empty exports).
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'dist-main');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
