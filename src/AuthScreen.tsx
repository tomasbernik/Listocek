import { useState } from 'react'
import { ListChecks, LoaderCircle, Mail } from 'lucide-react'

type Mode = 'login' | 'register' | 'recover'
type Props = {
  loading: boolean; busy: boolean; setup: boolean; inviteCode: string
  error: string | null; message: string | null
  authenticate: (mode: Mode, email: string, password: string, invite: string) => Promise<void>
  savePassword: (password: string) => Promise<boolean>
  clearFeedback: () => void
}

export default function AuthScreen(props: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validation, setValidation] = useState('')
  function switchMode(value: Mode) {
    setMode(value); setPassword(''); setConfirmation(''); setValidation(''); props.clearFeedback()
  }
  async function submit() {
    setValidation('')
    if (props.setup) {
      if (password !== confirmation) { setValidation('Heslá sa nezhodujú.'); return }
      if (await props.savePassword(password)) { setPassword(''); setConfirmation('') }
    } else {
      await props.authenticate(mode, email, password, props.inviteCode)
      setPassword('')
    }
  }
  return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div>
    <p className="eyebrow">VITAJTE V APLIKÁCII</p><h1>Lístoček</h1>
    {props.loading ? <div className="loading"><LoaderCircle className="spin" />Pripájam zoznam…</div> : <>
      <h2>{props.setup ? 'Nastavte si heslo' : mode === 'login' ? 'Prihlásenie' : mode === 'register' ? 'Prvé prihlásenie' : 'Zabudnuté heslo'}</h2>
      <p className="onboarding-copy">{props.setup ? 'Nabudúce sa prihlásite e-mailom a heslom. Heslo musí mať aspoň 8 znakov.' : mode === 'login' ? 'Prihláste sa svojím e-mailom a heslom.' : mode === 'register' ? 'E-mail overíte jedným odkazom a potom si vytvoríte heslo. Funguje aj pre doterajšie účty bez hesla.' : 'Pošleme vám odkaz na nastavenie nového hesla.'}</p>
      {props.setup && <p className="auth-note">Ak tento účet používate aj v našich ďalších aplikáciách, nové heslo bude platiť aj tam.</p>}
      {props.inviteCode && <p className="invite-notice">Máte pozvanie do domácnosti. Kód bude po prihlásení predvyplnený.</p>}
      {(validation || props.error) && <p role="alert" className="error-message">{validation || props.error}</p>}
      {props.message && !props.setup ? <div className="success-message" role="status"><Mail size={23} /><strong>Skontrolujte e-mail</strong><span>{props.message}</span></div> : <form className="email-form" onSubmit={event => { event.preventDefault(); void submit() }}>
        {!props.setup && <><label htmlFor="email">E-mailová adresa</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="vas@email.sk" disabled={props.busy} /></>}
        {(props.setup || mode === 'login') && <><label htmlFor="password">{props.setup ? 'Nové heslo' : 'Heslo'}</label><input id="password" type="password" autoComplete={props.setup ? 'new-password' : 'current-password'} minLength={props.setup ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} disabled={props.busy} /></>}
        {props.setup && <><label htmlFor="confirmation">Zopakujte heslo</label><input id="confirmation" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={props.busy} /></>}
        <button className="primary-wide" disabled={props.busy}>{props.busy ? 'Počkajte…' : props.setup ? 'Uložiť heslo a pokračovať' : mode === 'login' ? 'Prihlásiť sa' : mode === 'register' ? 'Poslať overovací odkaz' : 'Poslať odkaz na obnovu hesla'}</button>
      </form>}
      {!props.setup && <>
        {mode !== 'login' || props.message ? <button className="text-button" disabled={props.busy} onClick={() => switchMode('login')}>Späť na prihlásenie</button> : <>
          <button className="text-button" disabled={props.busy} onClick={() => switchMode('register')}>Ešte nemám heslo</button>
          <button className="text-button" disabled={props.busy} onClick={() => switchMode('recover')}>Zabudnuté heslo</button>
        </>}
      </>}
    </>}
  </main>
}
