type Settings = { authBaseUrl: string; origins: string[] }
export type ReserveEmail = (emailHash: string) => Promise<boolean>

export function registrationHandler(settings: Settings, reserveEmail: ReserveEmail | null, send: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? ''
    const allowed = settings.origins.includes(origin)
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers })
    if (!allowed) return reply(403, { error: 'Nepovolená adresa aplikácie.' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, { error: 'Nepovolená požiadavka.' })
    if (!settings.authBaseUrl || !reserveEmail) {
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
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
      const emailHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (!await reserveEmail(emailHash)) {
        return reply(429, { error: 'Počkajte chvíľu pred poslaním ďalšieho kódu. Pri viacerých pokusoch skúste registráciu neskôr.' })
      }
      stage = 'send_code'
      const response = await send(`${settings.authBaseUrl.replace(/\/$/, '')}/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: 'sign-in' }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) { upstreamStatus = response.status; throw new Error('auth_delivery_failed') }
      return reply(200, { sent: true })
    } catch {
      console.error(JSON.stringify({ event: 'listocek_registration_failed', stage, upstreamStatus }))
      return reply(503, { error: 'Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.' })
    }
  }
}
