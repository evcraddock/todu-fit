// Isolated CLI <-> JavaScript Repo check. Does not use the managed dev environment.
// Run: make build && node integration-tests/automerge-compatibility.mjs target/release/fit
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const { Repo, ImmutableString } = await import(require.resolve('@automerge/automerge-repo'))
const { WebSocketServerAdapter } = await import(require.resolve('@automerge/automerge-repo-network-websocket'))
const { WebSocketServer } = require('ws')
const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../', import.meta.url))
const binary = resolve(repository, process.argv[2] ?? 'target/debug/fit')
const directory = await mkdtemp(join(tmpdir(), 'fit-automerge-compatibility-'))
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
let repo

try {
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}`
  repo = new Repo({
    network: [new WebSocketServerAdapter(server)],
    isEphemeral: false,
    sharePolicy: async () => true,
  })
  const config = join(directory, 'config.yaml')
  const data = join(directory, 'data')
  await writeFile(config, `data_dir: ${JSON.stringify(data)}\ncreated_by: compatibility-fixture\nsync:\n  server_url: ${JSON.stringify(url)}\n  auto_sync: false\n`)
  const fit = async (...args) => {
    const result = await exec(binary, ['-c', config, ...args], {
      env: { ...process.env, FIT_DATA_DIR: data, FIT_SYNC_URL: url },
      timeout: 60_000,
    })
    return result.stdout
  }
  const find = async id => repo.find(`automerge:${String(id)}`, { signal: AbortSignal.timeout(10_000) })
  const metadata = handle => {
    const value = handle.doc().data
    return typeof value === 'string' || value instanceof ImmutableString
      ? JSON.parse(String(value))
      : value
  }

  await fit('init', '--new')
  await fit('group', 'create', 'Compatibility fixtures')
  await fit('dish', 'create', 'CLI Café 🥗', '--nutrients', '{"calories": 200, "protein": 10}')
  await fit('sync')
  const rootId = (await readFile(join(data, 'root_doc_id'), 'utf8')).trim()
  const identity = metadata(await find(rootId))
  const group = metadata(await find(identity.groups[0].doc_id))
  const dishes = await find(group.dishes_doc_id)
  const [dishId, dish] = Object.entries(dishes.doc()).find(([, value]) => String(value.name) === 'CLI Café 🥗') ?? []
  assert(dishId, 'CLI-created dish reaches the JavaScript Repo')
  assert(dish.name instanceof ImmutableString, 'CLI scalar string remains an ImmutableString')
  assert.equal(dish.nutrients.length, 2)
  console.log('PASS actual Rust CLI -> Repo WebSocket/CBOR -> JS dish, scalar and nutrients')

  dishes.change(doc => { doc[dishId].name = new ImmutableString('Updated by JavaScript') })
  await fit('sync')
  assert.match(await fit('dish', 'show', dishId), /Updated by JavaScript/)
  console.log('PASS JS update -> reconnect -> actual Rust CLI reads persisted changes')

  const jsDishId = randomUUID()
  const timestamp = new Date().toISOString()
  dishes.change(doc => {
    doc[jsDishId] = {
      name: new ImmutableString('Created by JavaScript'),
      ingredients: [{ name: new ImmutableString('Chickpeas'), quantity: 3.5, unit: new ImmutableString('cups') }],
      instructions: new ImmutableString('Mix, then serve.'),
      tags: [new ImmutableString('test')],
      created_by: new ImmutableString('compatibility-fixture'),
      created_at: new ImmutableString(timestamp),
      updated_at: new ImmutableString(timestamp),
    }
  })
  await fit('sync')
  assert.match(await fit('dish', 'show', jsDishId), /Created by JavaScript/)
  assert.match(await fit('dish', 'show', jsDishId), /3\.5 cups Chickpeas/)
  console.log('PASS JS-created nested dish -> actual Rust CLI')

  await fit('dish', 'update', jsDishId, '--instructions', 'Changed after reconnect')
  await fit('sync')
  assert.equal(String(dishes.doc()[jsDishId].instructions), 'Changed after reconnect')
  assert.equal((await readFile(join(data, 'root_doc_id'), 'utf8')).trim(), rootId)
  console.log('PASS Rust update after reconnect -> JS, preserving the identity ID')

  await fit('mealplan', 'create', '--date', '2026-11-01', '--type', 'dinner',
    '--title', 'CLI Dinner', '--dish', jsDishId, '--leftovers')
  await fit('sync')
  const plans = await find(group.mealplans_doc_id)
  const [planId, plan] = Object.entries(plans.doc()).find(([, value]) => String(value.title) === 'CLI Dinner') ?? []
  assert(planId)
  assert.equal(String(plan.dish_ids[0]), jsDishId)
  assert.equal(plan.uses_leftovers, true)
  plans.change(doc => { doc[planId].title = new ImmutableString('JS Dinner') })
  await fit('sync')
  assert.equal(JSON.parse(await fit('mealplan', 'show', planId, '-f', 'json')).title, 'JS Dinner')

  await fit('meal', 'log', planId, '--notes', 'CLI planned log')
  await fit('sync')
  const logs = await find(identity.meallogs_doc_id)
  const [logId, log] = Object.entries(logs.doc()).find(([, value]) => String(value.mealplan_id) === planId) ?? []
  assert(logId)
  assert.equal(String(log.dishes[0].id), jsDishId)
  assert.equal(String(log.notes), 'CLI planned log')
  console.log('PASS CLI meal plans/logs -> JS and JS plan update -> CLI')

  const jsPlanId = randomUUID()
  const jsLogId = randomUUID()
  plans.change(doc => {
    doc[jsPlanId] = {
      date: new ImmutableString('2026-11-02'), meal_type: new ImmutableString('lunch'),
      title: new ImmutableString('JS Plan'), cook: new ImmutableString('Guest'),
      dish_ids: [new ImmutableString(dishId)],
      created_by: new ImmutableString('compatibility-fixture'),
      created_at: new ImmutableString(timestamp), updated_at: new ImmutableString(timestamp),
    }
  })
  logs.change(doc => {
    doc[jsLogId] = {
      date: new ImmutableString('2026-11-02'), meal_type: new ImmutableString('lunch'),
      created_by: new ImmutableString('compatibility-fixture'), created_at: new ImmutableString(timestamp),
      dishes: [new ImmutableString(dishId)], dish_portions: { [dishId]: 0.5 },
      notes: new ImmutableString('JS reference log'),
    }
  })
  await fit('sync')
  assert.equal(JSON.parse(await fit('mealplan', 'show', jsPlanId, '-f', 'json')).uses_leftovers, false)
  const history = JSON.parse(await fit('meal', 'history', '--from', '2026-11-02', '--to', '2026-11-02', '-f', 'json'))
  const referenceLog = history.find(entry => entry.id === jsLogId)
  assert(referenceLog)
  assert.equal(referenceLog.dishes[0].name, 'Updated by JavaScript')
  assert.equal(referenceLog.dish_portions[dishId], 0.5)
  assert(referenceLog.dishes[0].nutrients.some(nutrient => nutrient.name === 'calories' && nutrient.amount === 200))
  await fit('mealplan', 'update', jsPlanId, '--leftovers')
  await fit('sync')
  assert.equal(plans.doc()[jsPlanId].uses_leftovers, true)
  console.log('PASS JS meal plans/reference logs -> CLI with defaults, hydration and portions')

  await fit('meal', 'delete', jsLogId, '--yes')
  await fit('mealplan', 'delete', jsPlanId, '--force')
  await fit('sync')
  assert.equal(logs.doc()[jsLogId], undefined)
  assert.equal(plans.doc()[jsPlanId], undefined)
  plans.change(doc => { delete doc[planId] })
  logs.change(doc => { delete doc[logId] })
  await fit('sync')
  assert.equal(await fit('mealplan', 'list', '--from', '2026-11-01', '--to', '2026-11-02'), 'No meal plans found\n')
  assert.equal(await fit('meal', 'history', '--from', '2026-11-01', '--to', '2026-11-02'), 'No meal history found for 2026-11-01 to 2026-11-02\n')
  assert.equal((await readFile(join(data, 'root_doc_id'), 'utf8')).trim(), rootId)
  console.log('PASS meal plan/log deletions both directions with unchanged identity')

  await fit('dish', 'delete', jsDishId, '--force')
  await fit('sync')
  assert.equal(dishes.doc()[jsDishId], undefined)
  dishes.change(doc => { delete doc[dishId] })
  await fit('sync')
  assert.equal(await fit('dish', 'list', '--format', 'json'), 'No dishes found\n')
  console.log('PASS CLI and JS dish deletions converge in both directions')
} finally {
  if (repo) await repo.shutdown()
  for (const client of server.clients) client.terminate()
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  await rm(directory, { recursive: true, force: true })
}
