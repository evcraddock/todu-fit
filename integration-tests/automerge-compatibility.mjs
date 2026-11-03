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
