import { test, expect } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const home = { id: '22222222-2222-4222-8222-222222222222', name: 'U ocina', invite_code: 'AB12CD34' }
const otherHome = { id: '33333333-3333-4333-8333-333333333333', name: 'Druhá rodina', invite_code: '1234ABCD' }
const milk = { id: '44444444-4444-4444-8444-444444444444', name: 'Mlieko', quantity: null, shop: null, checked: false, created_at: '2026-09-16T10:00:00Z', created_by: userId, purchased_by: null }
const session = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, token_type: 'bearer', user: { id: userId, email: 'oco@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: { listocek_password_set: true } } }

async function prepare(page, options = {}) {
  const state = { household: options.noHousehold ? null : { ...home }, items: [{ ...milk }], failReads: false, operations: [], beforeSend: null, otpRedirect: '' }
  await page.addInitScript(({ session, signedIn }) => {
    if (signedIn && !localStorage.getItem('sb-listocek-test-auth-token')) localStorage.setItem('sb-listocek-test-auth-token', JSON.stringify(session))
    window.testOnline = localStorage.getItem('test-offline') !== 'true'
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.testOnline })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.sharedInvitation = data } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedInvitation = text } } })
  }, { session: options.legacy ? { ...session, user: { ...session.user, user_metadata: {} } } : session, signedIn: !options.signedOut })
  await page.route('https://fonts.googleapis.com/**', route => route.abort())
  await page.routeWebSocket('wss://listocek-test.supabase.co/**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message))
      const response = event === 'phx_join' ? { postgres_changes: (payload.config?.postgres_changes ?? []).map((change, id) => ({ ...change, id })) } : {}
      socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]))
    })
  })
  await page.route('https://listocek-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const body = request.method() === 'POST' || request.method() === 'PATCH' || request.method() === 'PUT' ? request.postDataJSON() : null
    let data = null
    if (url.pathname.endsWith('/otp')) { state.otpRedirect = url.searchParams.get('redirect_to'); data = {} }
    else if (url.pathname.endsWith('/logout')) data = {}
    else if (url.pathname.endsWith('/recover')) { state.recoveryRedirect = url.searchParams.get('redirect_to'); data = {} }
    else if (url.pathname.endsWith('/token')) { state.login = body; data = session }
    else if (url.pathname.endsWith('/user')) { if (request.method() === 'PUT') state.userUpdate = body; data = { ...session.user, user_metadata: { ...session.user.user_metadata, ...body?.data } } }
    else if (url.pathname.endsWith('/rpc/apply_shopping_operation')) {
      const operation = body.operation
      state.operations.push(operation)
      if (state.beforeSend) await state.beforeSend(operation)
      if (operation.type === 'save') state.items.push({ id: operation.item.id, name: operation.item.name, quantity: operation.item.quantity ?? null, shop: operation.item.shop ?? null, checked: operation.item.checked, created_at: operation.item.createdAt, created_by: userId, purchased_by: null })
      else if (operation.type === 'edit') state.items = state.items.map(item => item.id === operation.itemId ? { ...item, name: operation.name, quantity: operation.quantity ?? null, shop: operation.shop ?? null } : item)
      else if (operation.type === 'toggle') state.items = state.items.map(item => item.id === operation.itemId ? { ...item, checked: operation.checked, purchased_by: operation.purchasedBy } : item)
      else state.items = state.items.filter(item => item.id !== operation.itemId)
    } else if (url.pathname.endsWith('/rpc/leave_household')) state.household = null
    else if (url.pathname.endsWith('/rpc/join_household')) { state.household = body.code === home.invite_code ? { ...home } : { ...otherHome }; state.items = []; data = state.household.id }
    else if (url.pathname.endsWith('/rpc/create_household')) { state.household = { ...home, name: body.household_name }; state.items = []; data = state.household }
    else if (url.pathname.endsWith('/rpc/rename_household')) state.household.name = body.household_name
    else if (url.pathname.endsWith('/household_members')) {
      data = url.searchParams.get('select') === 'household_id'
        ? (state.household ? [{ household_id: state.household.id }] : [])
        : [{ user_id: userId, display_name: 'Oco' }, { user_id: 'wife', display_name: 'Mama' }, { user_id: 'daughter', display_name: 'Dcéra' }]
    } else if (url.pathname.endsWith('/households')) data = state.household
    else if (url.pathname.endsWith('/shopping_items')) {
      if (state.failReads) return route.fulfill({ status: 503, json: { message: 'Testovací výpadok spojenia' } })
      data = state.items
    } else if (url.pathname.endsWith('/product_history')) data = [{ display_name: 'Želatína', use_count: 1, preferred_shop: null, preferred_quantity: null, last_used_at: '2026-09-16T10:00:00Z' }]
    else throw new Error(`Unexpected request ${url.pathname}`)
    await route.fulfill({ status: 200, json: data })
  })
  return state
}

test('invitation survives email login and joins the invited household', async ({ page }) => {
  const state = await prepare(page, { signedOut: true, noHousehold: true })
  await page.goto('?invite=AB12CD34')
  await page.getByLabel('E-mailová adresa').fill('oco@example.test')
  await page.getByRole('button', { name: 'Ešte nemám heslo' }).click()
  await page.getByRole('button', { name: 'Poslať overovací odkaz' }).click()
  await expect(page.getByText('Skontrolujte e-mail')).toBeVisible()
  expect(state.otpRedirect).toContain('invite=AB12CD34')
  await page.evaluate(session => localStorage.setItem('sb-listocek-test-auth-token', JSON.stringify(session)), session)
  await page.goto('/Listocek/?auth=password')
  await page.getByLabel('Nové heslo', { exact: true }).fill('test-password-123')
  await page.getByLabel('Zopakujte heslo').fill('test-password-123')
  await page.getByRole('button', { name: 'Uložiť heslo a pokračovať' }).click()
  expect(state.userUpdate.password).toBe('test-password-123')
  await expect(page.getByLabel('Pozývací kód')).toHaveValue('AB12CD34')
  await page.getByLabel('Ako sa voláte?').fill('Oco')
  await page.getByRole('button', { name: 'Pripojiť sa', exact: true }).click()
  await expect(page.locator('.brand-title .eyebrow')).toHaveText('U ocina')
  expect(await page.evaluate(() => localStorage.getItem('listocek.pending-invite'))).toBeNull()
})

test('share menu, copy and email prepare the same invitation without sending a message', async ({ page }) => {
  await prepare(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'Členovia zoznamu' }).click()
  await page.getByRole('button', { name: 'Zdieľať pozvanie' }).click()
  expect((await page.evaluate(() => window.sharedInvitation)).url).toBe('http://127.0.0.1:4175/Listocek/?invite=AB12CD34')
  await page.getByRole('button', { name: 'Kopírovať odkaz' }).click()
  expect(await page.evaluate(() => window.copiedInvitation)).toContain('invite=AB12CD34')
  expect(decodeURIComponent(await page.getByRole('link', { name: 'Poslať e-mailom' }).getAttribute('href'))).toContain('invite=AB12CD34')
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }))
  await page.getByRole('button', { name: 'Zdieľať pozvanie' }).click()
  await expect(page.getByRole('status')).toContainText('Vyberte e-mail')
  await page.screenshot({ path: 'test-results/members-mobile.png', fullPage: true })
})

test('password login opens the saved household without sending an email', async ({ page }) => {
  const state = await prepare(page, { signedOut: true })
  await page.goto('./')
  await page.getByLabel('E-mailová adresa').fill('oco@example.test')
  await page.getByLabel('Heslo', { exact: true }).fill('existing-password')
  await page.getByRole('button', { name: 'Prihlásiť sa', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
  expect(state.login).toMatchObject({ email: 'oco@example.test', password: 'existing-password' })
  expect(state.otpRedirect).toBe('')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
})

test('wrong password remains on login and does not send email', async ({ page }) => {
  const state = await prepare(page, { signedOut: true })
  await page.route('**/auth/v1/token?**', route => route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } }))
  await page.goto('./')
  await page.getByLabel('E-mailová adresa').fill('oco@example.test')
  await page.getByLabel('Heslo', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Prihlásiť sa', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Nesprávny e-mail alebo heslo')
  expect(state.otpRedirect).toBe('')
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toHaveCount(0)
})

test('legacy session sets a password without another email and handles server rejection', async ({ page }) => {
  const state = await prepare(page, { legacy: true })
  await page.goto('./')
  await page.getByLabel('Nové heslo', { exact: true }).fill('new-password')
  await page.getByLabel('Zopakujte heslo').fill('new-password')
  await page.route('**/auth/v1/user', async route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await route.fulfill({ status: 422, json: { code: 'weak_password', msg: 'Heslo je príliš slabé.' } })
  })
  await page.getByRole('button', { name: 'Uložiť heslo a pokračovať' }).click()
  await expect(page.getByRole('alert')).toContainText('Heslo je príliš slabé')
  await expect(page.getByLabel('Nové heslo', { exact: true })).toBeVisible()
  await page.unroute('**/auth/v1/user')
  await page.getByRole('button', { name: 'Uložiť heslo a pokračovať' }).click()
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
  expect(state.otpRedirect).toBe('')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
})

test('recovery preserves invitation and requires matching passwords', async ({ page }) => {
  const state = await prepare(page, { signedOut: true })
  await page.goto('?invite=AB12CD34')
  await page.getByRole('button', { name: 'Zabudnuté heslo', exact: true }).click()
  await page.getByLabel('E-mailová adresa').fill('oco@example.test')
  await page.getByRole('button', { name: 'Poslať odkaz na obnovu hesla' }).click()
  await expect(page.getByRole('status')).toContainText('Ak účet existuje')
  expect(state.recoveryRedirect).toContain('auth=password')
  expect(state.recoveryRedirect).toContain('invite=AB12CD34')
  await page.evaluate(session => localStorage.setItem('sb-listocek-test-auth-token', JSON.stringify(session)), session)
  await page.goto('?auth=password')
  await page.reload()
  await page.getByLabel('Nové heslo', { exact: true }).fill('new-password')
  await page.getByLabel('Zopakujte heslo').fill('different-password')
  await page.getByRole('button', { name: 'Uložiť heslo a pokračovať' }).click()
  await expect(page.getByRole('alert')).toContainText('Heslá sa nezhodujú')
  expect(state.userUpdate).toBeUndefined()
  await page.getByLabel('Zopakujte heslo').fill('new-password')
  await page.getByRole('button', { name: 'Uložiť heslo a pokračovať' }).click()
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
  expect(state.userUpdate.password).toBe('new-password')
  expect(new URL(page.url()).searchParams.has('auth')).toBe(false)
})

test('a pending invitation remains available after leaving the old household', async ({ page }) => {
  await prepare(page)
  await page.goto('?invite=1234ABCD')
  await expect(page.getByText('Máte pozvanie do inej domácnosti.')).toBeVisible()
  await expect(page.locator('footer')).toContainText('Zoznam je synchronizovaný')
  await page.getByRole('button', { name: 'Zmeniť domácnosť' }).click()
  await page.getByRole('button', { name: 'Opustiť domácnosť', exact: true }).click()
  await expect(page.getByLabel('Pozývací kód')).toHaveValue('1234ABCD')
  await expect(page.getByLabel('Ako sa voláte?')).toHaveValue('Oco')
  await page.getByRole('button', { name: 'Pripojiť sa', exact: true }).click()
  await expect(page.locator('.brand-title .eyebrow')).toHaveText('Druhá rodina')
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toHaveCount(0)
})

test('failed reads keep existing items and retry works even without pending writes', async ({ page }) => {
  const state = await prepare(page)
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
  state.failReads = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // The Supabase client retries 503 reads with exponential backoff before reporting failure.
  await expect(page.locator('.sync-error')).toContainText('Testovací výpadok', { timeout: 12000 })
  await expect(page.getByRole('button', { name: 'Upraviť Mlieko' })).toBeVisible()
  state.failReads = false
  await page.locator('.sync-error').click()
  await expect(page.locator('footer')).toContainText('Zoznam je synchronizovaný')
})

test('offline edits survive reload and are sent on reconnect; leaving is blocked while pending', async ({ page }) => {
  const state = await prepare(page)
  await page.goto('./')
  await expect(page.locator('footer')).toContainText('Zoznam je synchronizovaný')
  await page.evaluate(() => { window.testOnline = false; localStorage.setItem('test-offline', 'true'); window.dispatchEvent(new Event('offline')) })
  await page.getByRole('textbox', { name: 'Názov položky' }).fill('Chlieb')
  await page.getByRole('button', { name: 'Pridať', exact: true }).click()
  await page.getByRole('button', { name: 'Členovia zoznamu' }).click()
  await page.getByRole('button', { name: 'Opustiť domácnosť', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Opustiť domácnosť', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Upraviť Chlieb' })).toBeVisible()
  expect(state.operations).toHaveLength(0)
  await page.evaluate(() => { window.testOnline = true; localStorage.removeItem('test-offline'); window.dispatchEvent(new Event('online')) })
  await expect(page.locator('footer')).toContainText('Zoznam je synchronizovaný')
  expect(state.operations).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Upraviť Chlieb' })).toBeVisible()
})

test('editing an item while its add request is in flight sends both changes', async ({ page }) => {
  const state = await prepare(page)
  let release
  const barrier = new Promise(resolve => { release = resolve })
  state.beforeSend = operation => operation.type === 'save' ? barrier : Promise.resolve()
  await page.goto('./')
  await page.getByRole('textbox', { name: 'Názov položky' }).fill('Chlieb')
  await page.getByRole('button', { name: 'Pridať', exact: true }).click()
  await expect.poll(() => state.operations.length).toBe(1)
  await page.getByRole('button', { name: 'Upraviť Chlieb' }).click()
  await page.getByLabel('Množstvo', { exact: true }).fill('2 ks')
  await page.getByRole('button', { name: 'Uložiť zmeny' }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: 'Upraviť Chlieb' })).toContainText('2 ks')
  release()
  await expect(page.locator('footer')).toContainText('Zoznam je synchronizovaný')
  expect(state.operations.map(operation => operation.type)).toEqual(['save', 'edit'])
  expect(state.items.find(item => item.name === 'Chlieb').quantity).toBe('2 ks')
})
