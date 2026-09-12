import { useMemo, useState } from 'react'
import { Check, ChevronDown, Copy, ListChecks, LoaderCircle, LogOut, Mail, Plus, RotateCcw, ShoppingBasket, Store, Trash2, Users, X } from 'lucide-react'
import { useShoppingList } from './useShoppingList'
import type { Shop } from './types'

const shops: Shop[] = ['Lidl', 'dm', 'Globus', 'Penny', 'Kaufland', 'Tesco', 'Iné']

export default function App() {
  const { items, suggestions, addItem, toggleItem, removeItem, clearChecked, household, memberCount, loading, error, authMessage, signedIn, isOnline, signInWithEmail, signOut, createHousehold, joinHousehold } = useShoppingList()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [shop, setShop] = useState<Shop | ''>('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [email, setEmail] = useState('')

  const active = items.filter(item => !item.checked)
  const checked = items.filter(item => item.checked)
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof active>()
    active.forEach(item => {
      const key = item.shop ?? 'Bez obchodu'
      groups.set(key, [...(groups.get(key) ?? []), item])
    })
    return [...groups.entries()]
  }, [active])

  function submit(itemName = name, preferredShop: Shop | '' = shop) {
    addItem(itemName, quantity, preferredShop || undefined)
    setName(''); setQuantity(''); setShop(''); setDetailsOpen(false)
  }

  if (isOnline && (loading || !signedIn)) return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div>
    <p className="eyebrow">VITAJTE V APLIKÁCII</p><h1>Lístoček</h1>
    {loading ? <div className="loading"><LoaderCircle className="spin" />Pripájam zoznam…</div> : <>
      <p className="onboarding-copy">Zadajte svoj e-mail. Pošleme vám bezpečný prihlasovací odkaz bez hesla.</p>
      {error && <p className="error-message">{error}</p>}
      {authMessage ? <div className="success-message"><Mail size={23} /><strong>Skontrolujte e-mail</strong><span>{authMessage}</span><small>Túto stránku môžete zavrieť a otvoriť odkaz v e-maile.</small></div> : <form className="email-form" onSubmit={e => { e.preventDefault(); void signInWithEmail(email) }}><label htmlFor="email">E-mailová adresa</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="vas@email.sk" /><button className="primary-wide" disabled={!email.includes('@')}><Mail size={17} />Poslať prihlasovací odkaz</button></form>}
    </>}
  </main>

  if (isOnline && !household) return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div><p className="eyebrow">PRVÉ NASTAVENIE</p><h1>Spoločný zoznam</h1>
    <p className="onboarding-copy">Vytvorte nový nákupný zoznam alebo sa pripojte k existujúcemu.</p>
    {error && <p className="error-message">{error}</p>}
    <button className="primary-wide" onClick={() => void createHousehold()}>Vytvoriť náš zoznam</button>
    <div className="divider"><span>alebo</span></div>
    <form className="join-form" onSubmit={e => { e.preventDefault(); void joinHousehold(joinCode) }}><input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Pozývací kód" maxLength={8} /><button disabled={joinCode.length < 6}>Pripojiť sa</button></form>
    <button className="text-button" onClick={() => void signOut()}><LogOut size={15} />Použiť iný e-mail</button>
  </main>

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><ListChecks size={22} strokeWidth={2.5} /></div>
        <div><p className="eyebrow">NÁŠ NÁKUP</p><h1>Lístoček</h1></div>
        <button className="people-button" aria-label="Členovia zoznamu" onClick={() => setMembersOpen(true)}><Users size={18} /><span>{memberCount}</span></button>
      </header>

      <section className="composer" aria-label="Pridať položku">
        <form onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="input-row">
            <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Čo treba kúpiť?" aria-label="Názov položky" />
            <button type="submit" className="add-button" disabled={!name.trim()} aria-label="Pridať"><Plus size={25} /></button>
          </div>
          <button type="button" className="details-toggle" onClick={() => setDetailsOpen(value => !value)}>
            Množstvo a obchod <ChevronDown size={16} className={detailsOpen ? 'rotate' : ''} />
          </button>
          {detailsOpen && <div className="details-row">
            <input value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="napr. 2 ks" aria-label="Množstvo" />
            <label><Store size={17} /><select value={shop} onChange={event => setShop(event.target.value as Shop | '')} aria-label="Obchod"><option value="">Bez obchodu</option>{shops.map(value => <option key={value}>{value}</option>)}</select></label>
          </div>}
        </form>

        {suggestions.length > 0 && <div className="suggestions">
          <p>Často pridávate</p>
          <div>{suggestions.map(item => <button key={item.name} onClick={() => submit(item.name, item.preferredShop ?? '')}><Plus size={14} />{item.name}</button>)}</div>
        </div>}
      </section>

      <section className="list-section">
        <div className="section-heading"><h2>Treba kúpiť</h2><span>{active.length} {active.length === 1 ? 'položka' : active.length < 5 ? 'položky' : 'položiek'}</span></div>
        {active.length === 0 ? <div className="empty-state"><div><ShoppingBasket size={36} /></div><h3>Zoznam je prázdny</h3><p>Vyzerá to, že máte všetko. Pridajte položku alebo vyberte z návrhov.</p></div> :
          <div className="groups">{grouped.map(([group, groupItems]) => <div className="shop-group" key={group}>
            <div className="shop-title"><Store size={15} /><span>{group}</span></div>
            <div className="item-card">{groupItems.map(item => <div className="item" key={item.id}>
              <button className="checkbox" onClick={() => toggleItem(item.id)} aria-label={`Označiť ${item.name} ako kúpené`}><Check size={17} /></button>
              <button className="item-name" onClick={() => toggleItem(item.id)}>{item.name}{item.quantity && <small>{item.quantity}</small>}</button>
              <button className="delete" onClick={() => removeItem(item.id)} aria-label={`Odstrániť ${item.name}`}><Trash2 size={17} /></button>
            </div>)}</div>
          </div>)}</div>}

        {checked.length > 0 && <div className="checked-section">
          <div className="section-heading"><h2>Kúpené</h2><button onClick={clearChecked}><Trash2 size={14} />Vymazať</button></div>
          <div className="item-card">{checked.map(item => <div className="item is-checked" key={item.id}>
            <button className="checkbox" onClick={() => toggleItem(item.id)}><Check size={17} /></button>
            <button className="item-name" onClick={() => toggleItem(item.id)}>{item.name}{item.quantity && <small>{item.quantity}</small>}</button>
            <button className="delete" onClick={() => removeItem(item.id)}><Trash2 size={17} /></button>
          </div>)}</div>
        </div>}
      </section>

      <footer><span className="status-dot" /> {isOnline ? 'Zoznam je synchronizovaný' : 'Lokálny režim'} <RotateCcw size={12} /></footer>
      {membersOpen && <div className="modal-backdrop" onClick={() => setMembersOpen(false)}><section className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setMembersOpen(false)}><X size={20} /></button><Users size={29} /><h2>Spoločný zoznam</h2>
        {isOnline && household ? <><p>Pošlite tento kód človeku, ktorého chcete pridať.</p><button className="invite-code" onClick={() => void navigator.clipboard.writeText(household.inviteCode)}><strong>{household.inviteCode}</strong><Copy size={17} /></button><small>{memberCount} {memberCount === 1 ? 'člen' : 'členovia'} zoznamu</small><button className="text-button" onClick={() => void signOut()}><LogOut size={14} />Odhlásiť sa</button></> : <p>Po pripojení Supabase tu bude pozývací kód pre ďalších členov.</p>}
      </section></div>}
    </main>
  )
}
