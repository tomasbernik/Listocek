import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registrationHandler } from '../supabase/functions/listocek-register/handler.ts'

const config = { supabaseUrl: 'https://test.supabase.co', serviceKey: 'server-only', from: 'Lístoček <test@example.test>', origins: ['https://app.example.test'] }
const request = (body = { email: ' USER@example.test ' }, origin = config.origins[0]) => new Request('https://test/register', { method: 'POST', headers: { origin }, body: JSON.stringify(body) })

test('code goes only to the mailbox; admin tokens and links never reach the browser', async () => {
  const calls = []
  const emails = []
  const handler = registrationHandler(config, async email => { emails.push(email) }, async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) })
    if (url.includes('/rpc/')) return Response.json(true)
    if (url.includes('generate_link')) return Response.json({ email_otp: '12345678', action_link: 'secret-link', hashed_token: 'secret-hash' })
    throw new Error('Unexpected HTTP request')
  })
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { sent: true })
  assert.equal(calls.length, 2)
  assert.match(calls[0].body.email_hash, /^[a-f0-9]{64}$/)
  assert.deepEqual(calls[1].body, { type: 'magiclink', email: 'user@example.test' })
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'user@example.test')
  assert.equal(emails[0].from, config.from)
  assert.match(emails[0].text, /12345678/)
  assert.doesNotMatch(JSON.stringify(emails[0]), /secret-link|secret-hash|server-only/)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('invalid input and foreign origins never reach the admin API', async () => {
  const handler = registrationHandler(config, async () => { assert.fail('must not send mail') }, async () => { assert.fail('must not call Auth') })
  assert.equal((await handler(request({}, 'https://other.example.test'))).status, 403)
  assert.equal((await handler(request({ email: 'invalid' }))).status, 400)
  assert.equal((await handler(new Request('https://test/register', { headers: { origin: config.origins[0] } }))).status, 405)
  assert.equal((await handler(new Request('https://test/register', { method: 'OPTIONS', headers: { origin: config.origins[0] } }))).status, 204)
})

test('rate limiting and database failure prevent generation and email sending', async () => {
  for (const [result, status] of [[Response.json(false), 429], [Response.json({}, { status: 500 }), 503]]) {
    let calls = 0
    const handler = registrationHandler(config, async () => { assert.fail('must not send mail') }, async () => { calls++; return result })
    assert.equal((await handler(request())).status, status)
    assert.equal(calls, 1)
  }
})

test('missing configuration and failed mail delivery never claim success', async () => {
  const missing = registrationHandler(config, null, async () => { assert.fail('must not call') })
  assert.equal((await missing(request())).status, 503)
  const handler = registrationHandler(config, async () => { throw new Error('smtp-secret-detail') }, async url => {
    if (url.includes('/rpc/')) return Response.json(true)
    if (url.includes('generate_link')) return Response.json({ email_otp: '123456' })
    throw new Error('Unexpected HTTP request')
  })
  const response = await handler(request())
  assert.equal(response.status, 503)
  assert.doesNotMatch(await response.text(), /smtp-secret-detail|123456/)
})
