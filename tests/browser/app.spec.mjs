import { test, expect } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const home = { id: '22222222-2222-4222-8222-222222222222', name: 'U ocina', invite_code: 'AB12CD34' }
const otherHome = { id: '33333333-3333-4333-8333-333333333333', name: 'Druhá rodina', invite_code: '1234ABCD' }
const milk = { id: '44444444-4444-4444-8444-444444444444', name: 'Mlieko', quantity: null, shop: null, checked: false, created_at: '2026-09-16T10:00:00Z', created_by: userId, purchased_by: null }
const betterUser = { id: userId, email: 'oco@example.test', emailVerified: true, name: 'Oco', image: null, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' }
const betterSession = { id: 'session-1', userId, token: 'test-access-token', expiresAt: '2026-10-09T10:00:00Z', createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' }

async function prepare(page, options = {}) {
  const state = { signedIn: !options.signedOut, household: options.noHousehold ? null : { ...home }, items: [{ ...milk }], failReads: false, operations: [], beforeSend: null }
  await page.addInitScript(() => {
    window.testOnline = localStorage.getItem('test-offline') !== 'true'
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.testOnline })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.sharedInvitation = data } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedInvitation = text } } })
  })
  await page.route('https://fonts.googleapis.com/**', route => route.abort())
  await page.route('https://listocek-register.test/**', async route => {
    state.registration = route.request().postDataJSON()
    state.codeRequests = (state.codeRequests ?? 0) + 1
    await route.fulfill({ status: 200, json: { sent: true } })
  })
  await page.route(/https:\/\/listocek-test\.(?:neonauth|apirest)\.example\/.*/, async route => {
    const request = route.request(), url = new URL(request.url())
    const body = request.method() === 'POST' || request.method() === 'PATCH' || request.method() === 'PUT' ? request.postDataJSON() : null
    let data = null
    if (url.pathname.endsWith('/get-session')) data = state.signedIn ? { session: betterSession, user: betterUser } : null
    else if (url.pathname.endsWith('/sign-in/email-otp')) { state.verification = body; state.signedIn = true; data = { token: betterSession.token, user: betterUser } }
    else if (url.pathname.endsWith('/sign-out')) { state.signedIn = false; data = { success: true } }
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

test('registration code survives reload, signs in and preserves the household invitation', async ({ page }) => {
  const state = await prepare(page, { signedOut: true, noHousehold: true })
  await page.goto('?invite=AB12CD34')
  await page.getByLabel('E-mailová adresa').fill('oco@example.test')
  await page.getByRole('button', { name: 'Poslať prihlasovací kód' }).click()
  await expect(page.getByLabel('Overovací kód')).toBeVisible()
  await page.screenshot({ path: 'test-results/registration-code-mobile.png', fullPage: true })
  expect(state.registration).toEqual({ email: 'oco@example.test' })
  await page.reload()
  await page.getByLabel('Overovací kód').fill('123456')
  await page.getByRole('button', { name: 'Overiť kód', exact: true }).click()
  expect(state.verification).toEqual({ email: 'oco@example.test', otp: '123456' })
  await expect(page.getByLabel('Pozývací kód')).toHaveValue('AB12CD34')
  await page.getByLabel('Ako sa voláte?').fill('Oco')
  await page.getByRole('button', { name: 'Pripojiť sa', exact: true }).click()
  await expect(page.locator('.brand-title .eyebrow')).toHaveText('U ocina')
  expect(await page.evaluate(() => localStorage.getItem('listocek.pending-invite'))).toBeNull()
})

test('invalid code can be retried, resend is delayed and email can be corrected', async ({ page }) => {
  const state = await prepare(page, { signedOut: true })
  await page.goto('./')
  await page.getByLabel('E-mailová adresa').fill('new@example.test')
  await page.getByRole('button', { name: 'Poslať prihlasovací kód' }).click()
  await expect(page.getByRole('button', { name: /Poslať nový kód/ })).toBeDisabled()
  await page.route('**/sign-in/email-otp', route => route.fulfill({ status: 403, json: { code: 'otp_expired', message: 'Token has expired or is invalid' } }))
  await page.getByLabel('Overovací kód').fill('999999')
  await page.getByRole('button', { name: 'Overiť kód', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Kód je nesprávny alebo vypršal')
  await expect(page.getByLabel('Nové heslo', { exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    const pending = JSON.parse(sessionStorage.getItem('listocek.registration'))
    pending.resendAt = Date.now() - 1
    sessionStorage.setItem('listocek.registration', JSON.stringify(pending))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Poslať nový kód', exact: true }).click()
  await expect.poll(() => state.codeRequests).toBe(2)
  await expect(page.getByRole('button', { name: /Poslať nový kód/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Zmeniť e-mail' }).click()
  await expect(page.getByLabel('E-mailová adresa')).toHaveValue('new@example.test')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('listocek.registration'))).toBeNull()
})

test('failed code delivery stays on email entry and reports a useful error', async ({ page }) => {
  await prepare(page, { signedOut: true })
  await page.route('https://listocek-register.test/**', route => route.fulfill({ status: 503, json: { error: 'Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.' } }))
  await page.goto('./')
  await page.getByLabel('E-mailová adresa').fill('new@example.test')
  await page.getByRole('button', { name: 'Poslať prihlasovací kód' }).click()
  await expect(page.getByRole('alert')).toContainText('Kód sa nepodarilo odoslať')
  await expect(page.getByLabel('Overovací kód')).toHaveCount(0)
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
  // The Data API client retries 503 reads with exponential backoff before reporting failure.
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
