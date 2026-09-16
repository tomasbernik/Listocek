import test from 'node:test'
import assert from 'node:assert/strict'
import { captureInvite, clearInvite, invitationUrl, normalizeInvite } from '../src/invites.ts'

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

test('an invitation survives an email login redirect without query parameters', () => {
  const local = storage()
  assert.equal(captureInvite('https://example.test/Listocek/?invite=ab12cd34', local), 'AB12CD34')
  assert.equal(captureInvite('https://example.test/Listocek/#access_token=test', local), 'AB12CD34')
  clearInvite(local)
  assert.equal(captureInvite('https://example.test/Listocek/', local), '')
})

test('a newer invitation replaces an older pending invitation; invalid codes are ignored', () => {
  const local = storage()
  captureInvite('https://example.test/?invite=AB12CD34', local)
  assert.equal(captureInvite('https://example.test/?invite=1234ABCD', local), '1234ABCD')
  assert.equal(captureInvite('https://example.test/?invite=invalid', local), '1234ABCD')
  assert.equal(normalizeInvite('  ab12cd34 '), 'AB12CD34')
})

test('the share URL preserves the deployment path and contains no authentication tokens', () => {
  const url = invitationUrl('https://example.test/Listocek/?code=secret#access_token=secret', 'ab12cd34')
  assert.equal(url, 'https://example.test/Listocek/?invite=AB12CD34')
})
