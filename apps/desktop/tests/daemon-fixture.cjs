const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const exec = promisify(execFile);
async function fixture(binary = process.env.FIT_TEST_BINARY || path.resolve(__dirname, '../daemon', process.platform === 'win32' ? 'fit.exe' : 'fit')) {
  const root = await fs.mkdtemp(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'fit-'));
  const data = path.join(root, 'data');
  const config = path.join(root, 'config.yaml');
  await fs.writeFile(config, `data_dir: ${JSON.stringify(data)}\nsync:\n  server_url: ws://127.0.0.1:1\n  auto_sync: false\n`);
  const env = { ...process.env, FIT_DATA_DIR: data, FIT_SYNC_URL: 'ws://127.0.0.1:1' };
  const child = spawn(binary, ['-c', config, 'daemon'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  let spawnError; child.on('error', error => { spawnError = error; });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL'); await exited;
    }
    await fs.rm(root, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + 10000;
    let endpoint;
    while (!endpoint) {
      try { endpoint = await fs.readFile(path.join(data, 'daemon.endpoint'), 'utf8'); } catch {}
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error('Test daemon failed to start');
      if (!endpoint) await new Promise(resolve => setTimeout(resolve, 20));
    }
    const cli = async (...args) => (await exec(binary, ['-c', config, ...args], { env, timeout: 20000 })).stdout;
    await cli('init', '--new');
    await cli('group', 'create', 'Test');
    return { root, endpoint, cli, close, child };
  } catch (error) { await close(); throw error; }
}
module.exports = { fixture };
