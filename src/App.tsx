import { useMemo, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Cloud, CloudOff, Copy, ListChecks, LoaderCircle, LogOut, Mail, Plus, RefreshCw, ShoppingBasket, Store, Trash2, UserRound, Users, X } from 'lucide-react'
import { useShoppingList } from './useShoppingList'
import type { Shop, ShoppingItem } from './types'

const shops: Shop[] = ['Lidl', 'dm', 'Globus', 'Penny', 'Kaufland', 'Tesco', 'Iné']

export default function App() {
  const { items, suggestions, addItem, updateItem, toggleItem, removeItem, clearChecked, household, members, memberCount, currentUserId, updateMemberName, loading, error, authMessage, signedIn, isOnline, syncStatus, pendingCount, retrySync, signInWithEmail, signOut, createHousehold, joinHousehold } = useShoppingList()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [shop, setShop] = useState<Shop | ''>('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [email, setEmail] = useState('')
  const [memberName, setMemberName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editShop, setEditShop] = useState<Shop | ''>('')

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
  const visibleSuggestions = useMemo(() => {
    const query = name.trim().toLocaleLowerCase('sk')
    if (!query) return suggestions
    return suggestions.filter(item => item.name.toLocaleLowerCase('sk').includes(query)).slice(0, 6)
  }, [name, suggestions])

  function submit(itemName = name, preferredShop: Shop | '' = shop, preferredQuantity = quantity) {
    addItem(itemName, preferredQuantity, preferredShop || undefined)
    setName(''); setQuantity(''); setShop(''); setDetailsOpen(false)
  }

  function openEditor(item: ShoppingItem) {
    setEditingItem(item); setEditName(item.name); setEditQuantity(item.quantity ?? ''); setEditShop(item.shop ?? '')
  }

  function saveEdit() {
    if (!editingItem || !editName.trim()) return
    void updateItem(editingItem.id, editName, editQuantity, editShop || undefined); setEditingItem(null)
  }

  function openMembers() {
    setProfileName(members.find(member => member.userId === currentUserId)?.displayName ?? '')
    setMembersOpen(true)
  }

  const memberNameFor = (userId?: string) => members.find(member => member.userId === userId)?.displayName

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
    <label className="setup-name">Ako sa voláte?<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Vaše meno" maxLength={50} /></label>
    <button className="primary-wide" disabled={memberName.trim().length < 2} onClick={() => void createHousehold(memberName)}>Vytvoriť náš zoznam</button>
    <div className="divider"><span>alebo</span></div>
    <form className="join-form" onSubmit={e => { e.preventDefault(); void joinHousehold(joinCode, memberName) }}><input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Pozývací kód" maxLength={8} /><button disabled={joinCode.length < 6 || memberName.trim().length < 2}>Pripojiť sa</button></form>
    <button className="text-button" onClick={() => void signOut()}><LogOut size={15} />Použiť iný e-mail</button>
  </main>

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><ListChecks size={22} strokeWidth={2.5} /></div>
        <div><p className="eyebrow">NÁŠ NÁKUP</p><h1>Lístoček</h1></div>
        <button className="people-button" aria-label="Členovia zoznamu" onClick={openMembers}><Users size={18} /><span>{memberCount}</span></button>
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

        {visibleSuggestions.length > 0 && <div className="suggestions">
          <p>{name.trim() ? 'Nájdené návrhy' : 'Často pridávate'}</p>
          <div>{visibleSuggestions.map(item => <button key={item.name} onClick={() => submit(item.name, item.preferredShop ?? '', item.preferredQuantity ?? '')}><Plus size={14} /><span>{item.name}{(item.preferredQuantity || item.preferredShop) && <small>{[item.preferredQuantity, item.preferredShop].filter(Boolean).join(' · ')}</small>}</span></button>)}</div>
        </div>}
      </section>

      <section className="list-section">
        {syncStatus === 'error' && error && <button className="sync-error" onClick={() => void retrySync()}><AlertCircle size={17} /><span>{error}</span><strong>Skúsiť znova</strong></button>}
        <div className="section-heading"><h2>Treba kúpiť</h2><span>{active.length} {active.length === 1 ? 'položka' : active.length < 5 ? 'položky' : 'položiek'}</span></div>
        {active.length === 0 ? <div className="empty-state"><div><ShoppingBasket size={36} /></div><h3>Zoznam je prázdny</h3><p>Vyzerá to, že máte všetko. Pridajte položku alebo vyberte z návrhov.</p></div> :
          <div className="groups">{grouped.map(([group, groupItems]) => <div className="shop-group" key={group}>
            <div className="shop-title"><Store size={15} /><span>{group}</span></div>
            <div className="item-card">{groupItems.map(item => <div className="item" key={item.id}>
              <button className="checkbox" onClick={() => toggleItem(item.id)} aria-label={`Označiť ${item.name} ako kúpené`}><Check size={17} /></button>
              <button className="item-name" onClick={() => openEditor(item)} aria-label={`Upraviť ${item.name}`}><span>{item.name}{item.quantity && <small>{item.quantity}</small>}</span>{memberNameFor(item.createdBy) && <em>Pridal/a {memberNameFor(item.createdBy)}</em>}</button>
              <button className="delete" onClick={() => removeItem(item.id)} aria-label={`Odstrániť ${item.name}`}><Trash2 size={17} /></button>
            </div>)}</div>
          </div>)}</div>}

        {checked.length > 0 && <div className="checked-section">
          <div className="section-heading"><h2>Kúpené</h2><button onClick={clearChecked}><Trash2 size={14} />Vymazať</button></div>
          <div className="item-card">{checked.map(item => <div className="item is-checked" key={item.id}>
            <button className="checkbox" onClick={() => toggleItem(item.id)}><Check size={17} /></button>
            <button className="item-name" onClick={() => openEditor(item)} aria-label={`Upraviť ${item.name}`}><span>{item.name}{item.quantity && <small>{item.quantity}</small>}</span>{memberNameFor(item.purchasedBy) && <em>Kúpil/a {memberNameFor(item.purchasedBy)}</em>}</button>
            <button className="delete" onClick={() => removeItem(item.id)}><Trash2 size={17} /></button>
          </div>)}</div>
        </div>}
      </section>

      <footer className={`sync-status ${syncStatus}`}>
        {syncStatus === 'local' && <><Cloud size={13} /> Lokálny režim</>}
        {syncStatus === 'synced' && <><span className="status-dot" /> Zoznam je synchronizovaný</>}
        {syncStatus === 'syncing' && <><RefreshCw className="spin" size={13} /> Synchronizujem{pendingCount ? ` (${pendingCount})` : '…'}</>}
        {syncStatus === 'offline' && <><CloudOff size={13} /> Bez internetu · {pendingCount} {pendingCount === 1 ? 'zmena čaká' : 'zmien čaká'}</>}
        {syncStatus === 'error' && <button onClick={() => void retrySync()}><AlertCircle size={13} /> Synchronizácia zlyhala · skúsiť znova</button>}
      </footer>
      {membersOpen && <div className="modal-backdrop" onClick={() => setMembersOpen(false)}><section className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setMembersOpen(false)}><X size={20} /></button><Users size={29} /><h2>Spoločný zoznam</h2>
        {isOnline && household ? <><p>Pošlite tento kód človeku, ktorého chcete pridať.</p><button className="invite-code" onClick={() => void navigator.clipboard.writeText(household.inviteCode)}><strong>{household.inviteCode}</strong><Copy size={17} /></button>
          <div className="member-list">{members.map(member => <div key={member.userId}><span><UserRound size={15} /></span><strong>{member.displayName}</strong>{member.userId === currentUserId && <small>Vy</small>}</div>)}</div>
          <form className="profile-name" onSubmit={e => { e.preventDefault(); void updateMemberName(profileName) }}><label>Vaše zobrazované meno</label><div><input value={profileName} onChange={e => setProfileName(e.target.value)} maxLength={50} /><button disabled={profileName.trim().length < 2}>Uložiť</button></div></form>
          <button className="text-button" onClick={() => void signOut()}><LogOut size={14} />Odhlásiť sa</button></> : <p>Po pripojení Supabase tu bude pozývací kód pre ďalších členov.</p>}
      </section></div>}
      {editingItem && <div className="modal-backdrop" onClick={() => setEditingItem(null)}><section className="modal edit-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={() => setEditingItem(null)} aria-label="Zavrieť"><X size={20} /></button>
        <h2>Upraviť položku</h2>
        <form onSubmit={e => { e.preventDefault(); saveEdit() }}>
          <label>Názov<input autoFocus value={editName} onChange={e => setEditName(e.target.value)} maxLength={100} /></label>
          <div className="edit-fields">
            <label>Množstvo<input value={editQuantity} onChange={e => setEditQuantity(e.target.value)} placeholder="napr. 2 ks" maxLength={40} /></label>
            <label>Obchod<select value={editShop} onChange={e => setEditShop(e.target.value as Shop | '')}><option value="">Bez obchodu</option>{shops.map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
          <button className="primary-wide" disabled={!editName.trim()}>Uložiť zmeny</button>
        </form>
      </section></div>}
    </main>
  )
}
