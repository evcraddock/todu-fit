const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
execFileSync('cargo', ['build', '--locked', '--release', '-p', 'todu-fit-cli'], { cwd: root, stdio: 'inherit' });
const binary = process.platform === 'win32' ? 'fit.exe' : 'fit';
mkdirSync(path.resolve(__dirname, '../daemon'), { recursive: true });
copyFileSync(path.join(root, 'target/release', binary), path.resolve(__dirname, '../daemon', binary));
