import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined

export const isSupabaseConfigured = Boolean(authUrl && dataApiUrl)
export const supabase = isSupabaseConfigured ? createClient({
  auth: { adapter: SupabaseAuthAdapter(), url: authUrl!, allowAnonymous: false },
  dataApi: { url: dataApiUrl!, options: { db: { schema: 'public' } } },
}) : null
