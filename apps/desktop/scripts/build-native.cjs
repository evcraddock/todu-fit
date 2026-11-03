const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
execFileSync('cargo', ['build', '--locked', '--release', '-p', 'todu-fit-desktop'], { cwd: root, stdio: 'inherit' });
const lib = process.platform === 'win32' ? 'todu_fit_desktop.dll' :
  process.platform === 'darwin' ? 'libtodu_fit_desktop.dylib' : 'libtodu_fit_desktop.so';
mkdirSync(path.resolve(__dirname, '../native'), { recursive: true });
copyFileSync(path.join(root, 'target/release', lib), path.resolve(__dirname, '../native/core.node'));
