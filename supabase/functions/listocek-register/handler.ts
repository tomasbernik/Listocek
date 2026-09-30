type Settings = { supabaseUrl: string; serviceKey: string; from: string; origins: string[] }
export type RegistrationEmail = { from: string; to: string; subject: string; text: string }
export type MailSender = (email: RegistrationEmail) => Promise<void>

// Kept independent of Deno so the complete HTTP flow can be tested without credentials.
export function registrationHandler(settings: Settings, deliver: MailSender | null, send: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? ''
    const allowed = settings.origins.includes(origin)
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers })
    if (!allowed) return reply(403, { error: 'Nepovolená adresa aplikácie.' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, { error: 'Nepovolená požiadavka.' })
    if (!settings.supabaseUrl || !settings.serviceKey || !deliver || !settings.from) {
      return reply(503, { error: 'Registrácia ešte nie je nastavená. Skúste to neskôr.' })
    }
    let email: string
    try {
      const raw = await request.text()
      if (raw.length > 2048) return reply(413, { error: 'Príliš veľká požiadavka.' })
      const body = JSON.parse(raw)
      email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply(400, { error: 'Zadajte platnú e-mailovú adresu.' })
      }
    } catch { return reply(400, { error: 'Zadajte platnú e-mailovú adresu.' }) }
    let stage = 'rate_limit'
    let upstreamStatus: number | undefined
    try {
      const authHeaders = { apikey: settings.serviceKey, Authorization: `Bearer ${settings.serviceKey}`, 'Content-Type': 'application/json' }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
      const emailHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      // Persistent, atomic limits: generating links through the admin API bypasses normal send limits.
      const limit = await send(`${settings.supabaseUrl}/rest/v1/rpc/listocek_reserve_registration_email`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ email_hash: emailHash }), signal: AbortSignal.timeout(10000),
      })
      if (!limit.ok) { upstreamStatus = limit.status; throw new Error('rate_limit_unavailable') }
      if (await limit.json() !== true) return reply(429, { error: 'Počkajte chvíľu pred poslaním ďalšieho kódu. Pri viacerých pokusoch skúste registráciu neskôr.' })
      stage = 'generate_code'
      const generated = await send(`${settings.supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ type: 'magiclink', email }), signal: AbortSignal.timeout(10000),
      })
      if (!generated.ok) { upstreamStatus = generated.status; throw new Error('generation_failed') }
      const { email_otp: code } = await generated.json()
      if (typeof code !== 'string' || !/^\d{6,10}$/.test(code)) throw new Error('missing_code')
      stage = 'smtp_delivery'
      await deliver({
        from: settings.from, to: email, subject: 'Váš overovací kód do Lístočka',
        text: `Váš jednorazový overovací kód do Lístočka je:\n\n${code}\n\nZadajte ho v aplikácii, v ktorej ste požiadali o registráciu. Kód nikomu neposielajte. Ak vyprší, požiadajte v aplikácii o nový.\n\nAk ste o kód nežiadali, tento e-mail môžete ignorovať.`,
      })
      // Never return or log the OTP, generated link, user record or service credentials.
      return reply(200, { sent: true })
    } catch (cause) {
      // Log only allowlisted diagnostics, never provider messages, credentials or recipients.
      const error = cause as { code?: unknown; responseCode?: unknown }
      const smtpCode = typeof error?.code === 'string' && ['EAUTH', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'ETLS', 'EENVELOPE', 'EMESSAGE'].includes(error.code) ? error.code : undefined
      const smtpStatus = typeof error?.responseCode === 'number' && error.responseCode >= 400 && error.responseCode <= 599 ? error.responseCode : undefined
      console.error(JSON.stringify({ event: 'listocek_registration_failed', stage, upstreamStatus, smtpCode, smtpStatus }))
      return reply(503, { error: 'Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.' })
    }
  }
}
