import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as Automerge from '@automerge/automerge'

const dishId = '00000000-0000-4000-8000-000000000001'

interface Fixture {
  [id: string]: unknown
  _text: string
  after_upgrade?: Automerge.ImmutableString
}

for (const [filename, quantity, tags] of [
  ['rust-0.7.2.automerge', 2.5, 1],
  ['js-3.2.1.automerge', 3.5, 2],
  ['rust-0.12.0.automerge', 2.5, 1],
  ['js-3.5.0.automerge', 3.5, 2],
] as const) {
  test(`loads and edits ${filename} while preserving scalar types, heads and history`, () => {
    const bytes = readFileSync(new URL(`../../../todu-fit-core/tests/fixtures/${filename}`, import.meta.url))
    let doc = Automerge.load<Fixture>(bytes)
    const heads = Automerge.getHeads(doc)
    const changes = Automerge.getAllChanges(doc)
    const dish = doc[dishId] as {
      name: Automerge.ImmutableString
      ingredients: { quantity: number }[]
      tags: Automerge.ImmutableString[]
    }

    assert(dish.name instanceof Automerge.ImmutableString)
    assert.equal(String(dish.name), 'Café 🥗')
    assert.equal(dish.ingredients[0].quantity, quantity)
    assert.equal(dish.tags.length, tags)
    assert.equal(doc._text, 'Hello 🌍')
    assert(dish.tags.every(tag => tag instanceof Automerge.ImmutableString))

    const reopened = Automerge.load<Fixture>(Automerge.save(doc))
    assert.deepEqual(Automerge.getHeads(reopened), heads)
    assert.deepEqual(Automerge.toJS(reopened), Automerge.toJS(doc))
    assert.deepEqual(Automerge.getAllChanges(reopened), changes)

    doc = Automerge.change(doc, draft => {
      draft.after_upgrade = new Automerge.ImmutableString('new edit')
    })
    const edited = Automerge.load<Fixture>(Automerge.save(doc))
    assert.equal(String(edited.after_upgrade), 'new edit')
    assert(Automerge.hasHeads(edited, heads))
  })
}
