export type PendingRegistration = { email: string; resendAt: number }
const key = 'listocek.registration'
export function readRegistration(): PendingRegistration | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return value && typeof value.email === 'string' && Number.isFinite(value.resendAt) ? value : null
  } catch { return null }
}
export function storeRegistration(value: PendingRegistration | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch { /* The flow still works in memory when storage is unavailable. */ }
}
export async function sendRegistrationCode(email: string) {
  const url = import.meta.env.VITE_NEON_REGISTER_FUNCTION_URL as string | undefined
  if (!url) throw new Error('Registrácia nie je dostupná.')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  let data: { sent?: boolean; error?: string } = {}
  try { data = await response.json() } catch { /* Gateway may return non-JSON. */ }
  if (!response.ok || data.sent !== true) {
    throw new Error(data.error || 'Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.')
  }
}
