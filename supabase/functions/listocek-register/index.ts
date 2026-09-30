import { registrationHandler } from './handler.ts'
import nodemailer from 'npm:nodemailer@^9'

const host = Deno.env.get('LISTOCEK_SMTP_HOST') ?? 'smtp.strato.de'
const port = Number(Deno.env.get('LISTOCEK_SMTP_PORT') ?? '465')
const user = Deno.env.get('LISTOCEK_SMTP_USER') ?? ''
const pass = Deno.env.get('LISTOCEK_SMTP_PASSWORD') ?? ''
// Auth's SMTP configuration is not automatically available to Edge Functions.
const transport = host && user && pass && [465, 587].includes(port) ? nodemailer.createTransport({
  host, port, secure: port === 465, requireTLS: true,
  auth: { user, pass },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  disableFileAccess: true, disableUrlAccess: true,
  logger: false, debug: false,
}) : null

Deno.serve(registrationHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  from: Deno.env.get('LISTOCEK_EMAIL_FROM') ?? '',
  origins: (Deno.env.get('LISTOCEK_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
}, transport ? async email => {
  const result = await transport.sendMail(email)
  if (result.rejected.length || !result.accepted.length) throw new Error('delivery_failed')
} : null))
