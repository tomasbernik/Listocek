import { supabase } from './supabase'

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
  if (!supabase) throw new Error('Registrácia nie je dostupná.')
  const { data, error } = await supabase.functions.invoke('listocek-register', { body: { email } })
  if (error) {
    let detail: string | undefined
    if ('context' in error && error.context instanceof Response) {
      try { detail = (await error.context.json()).error } catch { /* Gateway may return non-JSON. */ }
    }
    throw new Error(detail || 'Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.')
  }
  if (data?.sent !== true) throw new Error('Kód sa nepodarilo odoslať. Skúste to o chvíľu znova.')
}
