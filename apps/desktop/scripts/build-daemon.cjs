const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync, renameSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
execFileSync('cargo', ['build', '--locked', '--release', '-p', 'todu-fit-cli'], { cwd: root, stdio: 'inherit' });
const binary = process.platform === 'win32' ? 'fit.exe' : 'fit';
mkdirSync(path.resolve(__dirname, '../daemon'), { recursive: true });
// Replace the inode instead of overwriting a potentially running signed executable.
const destination = path.resolve(__dirname, '../daemon', binary);
const staged = `${destination}.${process.pid}.tmp`;
copyFileSync(path.join(root, 'target/release', binary), staged);
renameSync(staged, destination);
