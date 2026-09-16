import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPending, Outbox, SnapshotGuard } from '../src/sync.ts'

const item = { id: 'milk', name: 'Mlieko', checked: false, createdAt: '2026-09-16T10:00:00Z' }
const save = { id: 'add', type: 'save', householdId: 'home', item }
const edit = { id: 'edit', type: 'edit', householdId: 'home', itemId: item.id, name: 'Mlieko', quantity: '2 l' }
const toggle = { id: 'check', type: 'toggle', householdId: 'home', itemId: item.id, checked: true, purchasedBy: 'wife' }
const remove = { id: 'delete', type: 'remove', householdId: 'home', itemId: item.id }

test('a server refresh preserves pending additions, edits, checkmarks and deletions', () => {
  assert.deepEqual(applyPending([], [save, edit, toggle], 'home'), [{ ...item, quantity: '2 l', shop: undefined, checked: true, purchasedBy: 'wife' }])
  assert.deepEqual(applyPending([item], [remove], 'home'), [])
  assert.deepEqual(applyPending([], [save], 'other-home'), [])
})

test('editing details preserves another member’s purchase and cannot resurrect a deleted item', () => {
  assert.equal(applyPending([{ ...item, checked: true, purchasedBy: 'wife' }], [edit], 'home')[0].checked, true)
  assert.equal(applyPending([{ ...item, checked: true, purchasedBy: 'wife' }], [edit], 'home')[0].purchasedBy, 'wife')
  assert.deepEqual(applyPending([], [edit, toggle], 'home'), [])
})

test('undo restores a deleted item and retains its original date', () => {
  assert.deepEqual(applyPending([item], [remove, { ...save, id: 'restore' }], 'home'), [item])
})

test('an edit queued during an in-flight save is sent separately and survives acknowledgement', async () => {
  const persisted = []
  const outbox = new Outbox([save], value => persisted.push(structuredClone(value)))
  const sent = []
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const sending = outbox.drain('home', async operation => { sent.push(operation); if (operation.id === 'add') await barrier }, () => {})
  outbox.enqueue([edit, toggle])
  assert.equal(outbox.drain('home', async () => assert.fail('concurrent drain'), () => {}), sending)
  release()
  await sending
  assert.deepEqual(sent.map(value => value.id), ['add', 'edit', 'check'])
  assert.equal(sent[0].item.quantity, undefined)
  assert.deepEqual(outbox.getSnapshot(), [])
  assert.deepEqual(persisted.at(-1), [])
})

test('a network failure retains the failed operation and later changes for retry after reload', async () => {
  let disk = [save, edit, toggle]
  const outbox = new Outbox(disk, value => { disk = structuredClone(value) })
  await assert.rejects(outbox.drain('home', async operation => { if (operation.id === 'edit') throw new Error('offline') }, () => {}), /offline/)
  assert.deepEqual(disk.map(value => value.id), ['edit', 'check'])
  const reloaded = new Outbox(disk, value => { disk = value })
  const sent = []
  await reloaded.drain('home', async operation => { sent.push(operation.id) }, () => {})
  assert.deepEqual(sent, ['edit', 'check'])
  assert.deepEqual(disk, [])
})

test('a full local storage rejects a new edit instead of silently losing it', () => {
  const outbox = new Outbox([save], () => { throw new Error('storage full') })
  assert.throws(() => outbox.enqueue([edit]), /storage full/)
  assert.deepEqual(outbox.getSnapshot(), [save])
})

test('snapshot guard rejects out-of-order responses and reads started before a write or household change', () => {
  const guard = new SnapshotGuard()
  const oldRead = guard.begin()
  const newRead = guard.begin()
  assert.equal(guard.isCurrent(oldRead), false)
  assert.equal(guard.isCurrent(newRead), true)
  guard.invalidate()
  assert.equal(guard.isCurrent(newRead), false)
})
