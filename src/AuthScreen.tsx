import { useEffect, useState } from 'react'
import { ListChecks, LoaderCircle } from 'lucide-react'
import type { PendingRegistration } from './registration'

type Props = {
  loading: boolean; busy: boolean; inviteCode: string
  error: string | null
  authenticate: (email: string) => Promise<void>
  clearFeedback: () => void
  registration: PendingRegistration | null
  verifyRegistration: (code: string) => Promise<void>
  cancelRegistration: () => void
}

export default function AuthScreen(props: Props) {
  const [email, setEmail] = useState(props.registration?.email ?? '')
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!props.registration) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [props.registration])
  const resendSeconds = Math.min(60, Math.max(0, Math.ceil(((props.registration?.resendAt ?? 0) - now) / 1000)))

  if (props.registration && !props.loading) return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div>
    <p className="eyebrow">VITAJTE V APLIKÁCII</p><h1>Lístoček</h1>
    <h2>Overte svoj e-mail</h2>
    <p className="onboarding-copy" role="status">Kód sme poslali na <strong>{props.registration.email}</strong>. Zadajte ho sem a pokračujte.</p>
    {props.error && <p role="alert" className="error-message">{props.error}</p>}
    <form className="email-form" onSubmit={event => { event.preventDefault(); void props.verifyRegistration(code) }}>
      <label htmlFor="registration-code">Overovací kód</label>
      <input id="registration-code" autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} disabled={props.busy} aria-describedby="code-help" />
      <button className="primary-wide" disabled={props.busy}>{props.busy ? 'Počkajte…' : 'Overiť kód'}</button>
    </form>
    <p id="code-help" className="auth-note">E-mail neprišiel? Skontrolujte aj spam. Použite kód z posledného e-mailu.</p>
    <button className="text-button" disabled={props.busy || resendSeconds > 0} onClick={() => { setCode(''); void props.authenticate(props.registration!.email) }}>{resendSeconds > 0 ? `Poslať nový kód o ${resendSeconds} s` : 'Poslať nový kód'}</button>
    <button className="text-button" disabled={props.busy} onClick={() => { setEmail(props.registration!.email); setCode(''); props.cancelRegistration(); props.clearFeedback() }}>Zmeniť e-mail</button>
  </main>

  return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div>
    <p className="eyebrow">VITAJTE V APLIKÁCII</p><h1>Lístoček</h1>
    {props.loading ? <div className="loading"><LoaderCircle className="spin" />Pripájam zoznam…</div> : <>
      <h2>Prihlásenie alebo registrácia</h2>
      <p className="onboarding-copy">Na e-mail vám pošleme jednorazový kód. Rovnaký postup funguje pre existujúci aj nový účet.</p>
      {props.inviteCode && <p className="invite-notice">Máte pozvanie do domácnosti. Kód bude po prihlásení predvyplnený.</p>}
      {props.error && <p role="alert" className="error-message">{props.error}</p>}
      <form className="email-form" onSubmit={event => { event.preventDefault(); void props.authenticate(email) }}>
        <label htmlFor="email">E-mailová adresa</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="vas@email.sk" disabled={props.busy} />
        <button className="primary-wide" disabled={props.busy}>{props.busy ? 'Počkajte…' : 'Poslať prihlasovací kód'}</button>
      </form>
    </>}
  </main>
}
