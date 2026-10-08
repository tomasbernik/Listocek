import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registrationHandler } from '../neon/functions/listocekregister/handler.ts'

const config = { authBaseUrl: 'https://test.neonauth.example/auth', origins: ['https://app.example.test'] }
const request = (body = { email: ' USER@example.test ' }, origin = config.origins[0]) => new Request('https://test/register', { method: 'POST', headers: { origin }, body: JSON.stringify(body) })

test('code goes only to the mailbox; admin tokens and links never reach the browser', async () => {
  const calls = []
  const hashes = []
  const handler = registrationHandler(config, async hash => { hashes.push(hash); return true }, async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) })
    return Response.json({ success: true })
  })
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { sent: true })
  assert.equal(calls.length, 1)
  assert.match(hashes[0], /^[a-f0-9]{64}$/)
  assert.match(calls[0].url, /email-otp\/send-verification-otp$/)
  assert.deepEqual(calls[0].body, { email: 'user@example.test', type: 'sign-in' })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('invalid input and foreign origins never reach the admin API', async () => {
  const handler = registrationHandler(config, async () => { assert.fail('must not reserve') }, async () => { assert.fail('must not call Auth') })
  assert.equal((await handler(request({}, 'https://other.example.test'))).status, 403)
  assert.equal((await handler(request({ email: 'invalid' }))).status, 400)
  assert.equal((await handler(new Request('https://test/register', { headers: { origin: config.origins[0] } }))).status, 405)
  assert.equal((await handler(new Request('https://test/register', { method: 'OPTIONS', headers: { origin: config.origins[0] } }))).status, 204)
})

test('rate limiting and database failure prevent generation and email sending', async () => {
  for (const [reserve, status] of [[async () => false, 429], [async () => { throw new Error('db') }, 503]]) {
    let calls = 0
    const handler = registrationHandler(config, reserve, async () => { calls++; return Response.json({}) })
    assert.equal((await handler(request())).status, status)
    assert.equal(calls, 0)
  }
})

test('missing configuration and failed mail delivery never claim success', async () => {
  const missing = registrationHandler(config, null, async () => { assert.fail('must not call') })
  assert.equal((await missing(request())).status, 503)
  const handler = registrationHandler(config, async () => true, async () => Response.json({}, { status: 500 }))
  const response = await handler(request())
  assert.equal(response.status, 503)
  assert.doesNotMatch(await response.text(), /auth_delivery_failed|500/)
})
