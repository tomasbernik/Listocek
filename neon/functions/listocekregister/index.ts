import postgres from 'postgres'
import { registrationHandler } from './handler.ts'

const connectionString = process.env.DATABASE_URL ?? ''
const sql = connectionString ? postgres(connectionString, { max: 1, prepare: false }) : null
const origins = (process.env.LISTOCEK_ALLOWED_ORIGINS ?? 'https://tomasbernik.github.io,http://localhost:5173,http://127.0.0.1:4175')
  .split(',').map(value => value.trim()).filter(Boolean)

export default registrationHandler({
  authBaseUrl: process.env.NEON_AUTH_BASE_URL ?? '',
  origins,
}, sql ? async emailHash => {
  const rows = await sql`select public.listocek_reserve_registration_email(${emailHash}) as allowed`
  return rows[0]?.allowed === true
} : null)
