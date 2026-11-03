// Exercises the actual packaged executable, React form, preload, IPC and shared daemon.
// Fresh temporary userData for both launches; no network or existing nutrition data.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./daemon-fixture.cjs');

async function main() {
  const base = path.resolve(__dirname, '..');
  const executablePath = process.env.TODU_PACKAGED_EXECUTABLE || (process.platform === 'darwin'
    ? path.join(base, 'out', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Todu Fit Proof.app/Contents/MacOS/Todu Fit Proof')
    : path.join(base, 'out/win-unpacked/Todu Fit Proof.exe'));
  const f = await fixture();
  const root = path.join(f.root, 'desktop');
  const results = path.join(base, 'test-results');
  fs.mkdirSync(results, { recursive: true });
  const launch = () => electron.launch({ executablePath, env: { ...process.env, TODU_FIT_PROOF_DATA: root, FIT_DAEMON_ENDPOINT: f.endpoint }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByLabel('Dish name', { exact: true }).fill('Packaged lentil soup');
    await page.getByRole('button', { name: 'Save dish' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Packaged lentil soup' });
    await row.waitFor();
    const id = await row.getAttribute('data-dish-id');
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.fit).sort()), ['createDish', 'listDishes', 'status']);
    const invalid = await page.evaluate(() => window.fit.createDish({ bad: true }));
    assert.equal(invalid.error.code, 'INVALID_INPUT');
    await page.screenshot({ path: path.join(results, 'created.png') });
    await app.close();
    app = undefined;
    assert.match(await f.cli('dish', 'show', id), /Packaged lentil soup/);
    await f.cli('dish', 'create', 'CLI while desktop closed');
    app = await launch();
    page = await app.firstWindow();
    const reopened = page.getByRole('listitem').filter({ hasText: 'Packaged lentil soup' });
    await reopened.waitFor();
    assert.equal(await reopened.getAttribute('data-dish-id'), id);
    assert.equal(await page.getByRole('listitem').count(), 2);
    await page.screenshot({ path: path.join(results, 'reopened.png') });
    const versions = await app.evaluate(() => process.versions);
    await app.close();
    app = undefined;
    const evidence = { passed: true, platform: process.platform, arch: process.arch, executablePath, dishId: id, versions, checkedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(results, 'packaged.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (app) await app.close();
    await f.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
