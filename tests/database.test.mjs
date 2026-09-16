import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

let db
const father = randomUUID(), mother = randomUUID(), daughter = randomUUID(), outsider = randomUUID()
let home, otherHome

async function asUser(id) { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]) }
async function apply(operation) { await db.query('select public.apply_shopping_operation($1::jsonb)', [JSON.stringify(operation)]) }
async function rows(sql, parameters = []) { return (await db.query(sql, parameters)).rows }

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
  `)
  for (const filename of ['202609120001_initial_schema.sql', '202609140001_product_history_quantity.sql', '202609140002_household_collaboration.sql', '202609160001_reliable_sync_and_households.sql']) {
    const sql = (await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '')
    // gen_random_uuid is built into PostgreSQL; PGlite does not bundle pgcrypto.
    await db.exec(sql)
  }
  for (const id of [father, mother, daughter, outsider]) await db.query('insert into auth.users values ($1, $2)', [id, `${id}@example.test`])
  await asUser(father)
  home = (await rows("select * from public.create_household('U ocina', 'Oco')"))[0]
  await asUser(mother)
  await db.query('select public.join_household($1, $2)', [home.invite_code, 'Mama'])
  await asUser(daughter)
  await db.query('select public.join_household($1, $2)', [home.invite_code, 'Dcéra'])
  await asUser(outsider)
  otherHome = (await rows("select * from public.create_household('Iná rodina', 'Sused')"))[0]
})
after(async () => { await db?.close() })

test('three family members can join; another household cannot read or mutate their list', async () => {
  assert.equal((await rows('select * from household_members where household_id = $1', [home.id])).length, 3)
  await asUser(outsider)
  await assert.rejects(apply({ id: randomUUID(), type: 'remove', householdId: home.id, itemId: randomUUID() }), /Prístup zamietnutý/)
  await assert.rejects(db.query('select public.rename_household($1, $2)', [home.id, 'Wrong']), /Prístup zamietnutý/)
  await db.exec('grant usage on schema public, auth to authenticated; grant select on public.households, public.shopping_items to authenticated; set role authenticated;')
  assert.equal((await rows('select * from households where id = $1', [home.id])).length, 0)
  await db.exec('reset role')
})

test('retrying after a lost response neither duplicates an item nor counts history twice', async () => {
  await asUser(father)
  const item = { id: randomUUID(), name: 'Želatína', quantity: '2 ks', checked: false, createdBy: father, createdAt: new Date().toISOString() }
  const operation = { id: randomUUID(), type: 'save', householdId: home.id, item, recordHistory: true }
  await apply(operation); await apply(operation)
  assert.equal((await rows('select * from shopping_items where id = $1', [item.id])).length, 1)
  assert.equal((await rows('select use_count from product_history where household_id = $1 and display_name = $2', [home.id, item.name]))[0].use_count, 1)

  await asUser(mother)
  await apply({ id: randomUUID(), type: 'toggle', householdId: home.id, itemId: item.id, checked: true, purchasedBy: outsider })
  await asUser(daughter)
  await apply({ id: randomUUID(), type: 'edit', householdId: home.id, itemId: item.id, name: 'Želatína', quantity: '3 ks' })
  const updated = (await rows('select * from shopping_items where id = $1', [item.id]))[0]
  assert.equal(updated.checked, true)
  assert.equal(updated.purchased_by, mother)
  assert.equal(updated.quantity, '3 ks')

  await apply({ id: randomUUID(), type: 'remove', householdId: home.id, itemId: item.id })
  await apply({ id: randomUUID(), type: 'edit', householdId: home.id, itemId: item.id, name: 'Stará úprava' })
  assert.equal((await rows('select * from shopping_items where id = $1', [item.id])).length, 0)
  await apply({ id: randomUUID(), type: 'save', householdId: home.id, item: { ...item, checked: true, purchasedBy: mother } })
  assert.equal((await rows('select created_at from shopping_items where id = $1', [item.id]))[0].created_at.toISOString(), item.createdAt)
  assert.equal((await rows('select purchased_by from shopping_items where id = $1', [item.id]))[0].purchased_by, mother)
})

test('a failed operation rolls back its receipt and can be retried', async () => {
  await asUser(father)
  const id = randomUUID(), itemId = randomUUID()
  const operation = { id, type: 'save', householdId: home.id, item: { id: itemId, name: '', checked: false } }
  await assert.rejects(apply(operation))
  assert.equal((await rows('select * from shopping_operation_receipts where operation_id = $1', [id])).length, 0)
  await apply({ ...operation, item: { ...operation.item, name: 'Chlieb' } })
  assert.equal((await rows('select * from shopping_items where id = $1', [itemId])).length, 1)
})

test('a member can rename, leave and join another household without deleting the original list', async () => {
  await asUser(daughter)
  await db.query('select public.rename_household($1, $2)', [home.id, 'Naša rodina'])
  assert.equal((await rows('select name from households where id = $1', [home.id]))[0].name, 'Naša rodina')
  await assert.rejects(db.query('select public.join_household($1, $2)', [otherHome.invite_code, 'Dcéra']), /Najprv opustite/)
  await assert.rejects(db.query("select public.create_household('Omyl', 'Dcéra')"), /Najprv opustite/)
  const count = (await rows('select * from shopping_items where household_id = $1', [home.id])).length
  await db.query('select public.leave_household($1)', [home.id])
  assert.equal((await rows('select * from household_members where household_id = $1', [home.id])).length, 2)
  assert.equal((await rows('select * from shopping_items where household_id = $1', [home.id])).length, count)
  await db.query('select public.join_household($1, $2)', [otherHome.invite_code, 'Dcéra'])
  await assert.rejects(apply({ id: randomUUID(), type: 'remove', householdId: home.id, itemId: randomUUID() }), /Prístup zamietnutý/)
})

test('invalid invitations retain the current membership and the last member can rejoin', async () => {
  await asUser(outsider)
  await assert.rejects(db.query('select public.join_household($1, $2)', ['00000000', 'Sused']), /Pozývací kód/)
  assert.equal((await rows('select * from household_members where user_id = $1', [outsider]))[0].household_id, otherHome.id)
  await asUser(father); await db.query('select public.leave_household($1)', [home.id])
  await asUser(mother); await db.query('select public.leave_household($1)', [home.id])
  assert.equal((await rows('select * from household_members where household_id = $1', [home.id])).length, 0)
  await db.query('select public.join_household($1, $2)', [home.invite_code, 'Mama'])
  assert.equal((await rows('select * from household_members where household_id = $1', [home.id])).length, 1)
})
