import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('registration email quotas are persistent, restricted and reset after expiry', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;')
    await db.exec(await readFile(new URL('../supabase/migrations/202609300001_registration_email_limits.sql', import.meta.url), 'utf8'))
    const reserve = async hash => (await db.query('select public.listocek_reserve_registration_email($1) as allowed', [hash])).rows[0].allowed
    const hash = 'a'.repeat(64)
    assert.equal(await reserve(hash), true)
    assert.equal(await reserve(hash), false)
    await db.exec("update public.listocek_registration_email_limits set last_sent_at = now() - interval '61 seconds'")
    assert.equal(await reserve(hash), true)
    await db.exec("update public.listocek_registration_email_limits set attempts = 5, last_sent_at = now() - interval '61 seconds' where key like 'email:%'")
    assert.equal(await reserve(hash), false)
    await db.exec("update public.listocek_registration_email_limits set window_started_at = now() - interval '61 minutes'")
    assert.equal(await reserve(hash), true)
    await db.exec("update public.listocek_registration_email_limits set attempts = 100, window_started_at = now() where key = 'global'")
    assert.equal(await reserve('b'.repeat(64)), false)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(reserve(hash), /permission denied/)
      await assert.rejects(db.query('select * from public.listocek_registration_email_limits'), /permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    assert.equal(await reserve(hash), false)
    await db.exec('reset role')
    await assert.rejects(reserve('bad'), /Invalid email hash/)
  } finally { await db.close() }
})
