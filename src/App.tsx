import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Cloud, CloudOff, Copy, ListChecks, LoaderCircle, LogOut, Mail, Plus, RefreshCw, Share2, ShoppingBasket, Store, Trash2, UserRound, Users, X } from 'lucide-react'
import { useShoppingList } from './useShoppingList'
import { captureInvite, clearInvite, invitationUrl, normalizeInvite } from './invites'
import type { Shop, ShoppingItem } from './types'

const shops: Shop[] = ['Lidl', 'dm', 'Globus', 'Penny', 'Kaufland', 'Tesco', 'Iné']

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('sk')
}

export default function App() {
  const { items, suggestions, addItem, updateItem, toggleItem, removeItem, clearChecked, restoreItems, household, members, memberCount, currentUserId, updateMemberName, loading, error, authMessage, signedIn, isOnline, networkOnline, syncStatus, pendingCount, retrySync, signInWithEmail, signOut, createHousehold, joinHousehold, leaveHousehold, renameHousehold } = useShoppingList()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [shop, setShop] = useState<Shop | ''>('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [joinCode, setJoinCode] = useState(() => {
    try { return captureInvite(window.location.href, localStorage) }
    catch { return normalizeInvite(new URL(window.location.href).searchParams.get('invite')) }
  })
  const [email, setEmail] = useState('')
  const [memberName, setMemberName] = useState('')
  const [profileName, setProfileName] = useState('')
  const [householdName, setHouseholdName] = useState('Náš nákup')
  const [editedHouseholdName, setEditedHouseholdName] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [sharing, setSharing] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editShop, setEditShop] = useState<Shop | ''>('')
  const [undo, setUndo] = useState<{ message: string; items: ShoppingItem[] } | null>(null)
  const undoTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
  }, [])

  useEffect(() => {
    setEditingItem(null); setUndo(null); setMembersOpen(false); setConfirmLeave(false)
    setName(''); setQuantity(''); setShop('')
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
  }, [household?.id])

  const inviteUrl = household ? invitationUrl(new URL(import.meta.env.BASE_URL, window.location.origin).href, household.inviteCode) : ''
  const inviteText = `Pridaj sa k domácnosti „${household?.name ?? ''}“ v aplikácii Lístoček.`
  const managementDisabled = loading || !networkOnline || pendingCount > 0 || syncStatus === 'syncing'

  function dismissInvite() {
    try { clearInvite(localStorage) } catch { /* The URL still carries the invitation when storage is unavailable. */ }
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    window.history.replaceState(null, '', url)
    setJoinCode('')
  }

  async function joinInvitedHousehold() {
    if (await joinHousehold(joinCode, memberName)) dismissInvite()
  }

  async function copyInvitation() {
    try { await navigator.clipboard.writeText(inviteUrl); setShareMessage('Odkaz je skopírovaný. Vložte ho do správy v ľubovoľnej aplikácii.') }
    catch { setShareMessage('Odkaz sa nepodarilo skopírovať. Označte a skopírujte ho z poľa nižšie.') }
  }

  async function shareInvitation() {
    setShareMessage('')
    if (!navigator.share) { setShareMessage('Vyberte e-mail alebo skopírujte odkaz do aplikácie, ktorú používate.'); return }
    setSharing(true)
    try { await navigator.share({ title: 'Pozvanie do Lístočka', text: inviteText, url: inviteUrl }) }
    catch (cause) { if (!(cause instanceof Error && cause.name === 'AbortError')) setShareMessage('Ponuku zdieľania sa nepodarilo otvoriť. Použite e-mail alebo kopírovanie odkazu.') }
    finally { setSharing(false) }
  }

  async function leaveCurrentHousehold() {
    setMemberName(members.find(member => member.userId === currentUserId)?.displayName ?? profileName)
    if (await leaveHousehold()) { setMembersOpen(false); setConfirmLeave(false) }
  }

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
    const query = normalizeSearch(name.trim())
    return suggestions.filter(item => normalizeSearch(item.name).includes(query)).slice(0, 6)
  }, [name, suggestions])

  function submit(itemName = name, preferredShop: Shop | '' = shop, preferredQuantity = quantity) {
    if (addItem(itemName, preferredQuantity, preferredShop || undefined)) {
      setName(''); setQuantity(''); setShop(''); setDetailsOpen(false)
    }
  }

  function openEditor(item: ShoppingItem) {
    setEditingItem(item); setEditName(item.name); setEditQuantity(item.quantity ?? ''); setEditShop(item.shop ?? '')
  }

  function saveEdit() {
    if (!editingItem || !editName.trim()) return
    if (updateItem(editingItem.id, editName, editQuantity, editShop || undefined)) setEditingItem(null)
  }

  function openMembers() {
    setProfileName(members.find(member => member.userId === currentUserId)?.displayName ?? '')
    setEditedHouseholdName(household?.name ?? '')
    setShareMessage(''); setConfirmLeave(false)
    setMembersOpen(true)
  }

  function offerUndo(message: string, removedItems: ShoppingItem[]) {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo({ message, items: removedItems })
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
  }

  function removeWithUndo(item: ShoppingItem) {
    if (removeItem(item.id)) offerUndo(`„${item.name}“ bolo odstránené`, [item])
  }

  function clearCheckedWithUndo() {
    if (checked.length === 0) return
    const removedItems = [...checked]
    if (!clearChecked()) return
    offerUndo(`${removedItems.length} ${removedItems.length === 1 ? 'položka bola odstránená' : removedItems.length < 5 ? 'položky boli odstránené' : 'položiek bolo odstránených'}`, removedItems)
  }

  function undoRemoval() {
    if (!undo) return
    if (!restoreItems(undo.items)) return
    setUndo(null)
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    undoTimer.current = null
  }

  const memberNameFor = (userId?: string) => members.find(member => member.userId === userId)?.displayName

  if (isOnline && ((loading && !household) || !signedIn)) return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div>
    <p className="eyebrow">VITAJTE V APLIKÁCII</p><h1>Lístoček</h1>
    {loading ? <div className="loading"><LoaderCircle className="spin" />Pripájam zoznam…</div> : <>
      <p className="onboarding-copy">Zadajte svoj e-mail. Pošleme vám bezpečný prihlasovací odkaz bez hesla.</p>
      {joinCode && <p className="invite-notice">Máte pozvanie do domácnosti. Kód bude po prihlásení predvyplnený.</p>}
      {error && <p className="error-message">{error}</p>}
      {authMessage ? <div className="success-message"><Mail size={23} /><strong>Skontrolujte e-mail</strong><span>{authMessage}</span><small>Túto stránku môžete zavrieť a otvoriť odkaz v e-maile.</small></div> : <form className="email-form" onSubmit={e => { e.preventDefault(); void signInWithEmail(email, normalizeInvite(joinCode)) }}><label htmlFor="email">E-mailová adresa</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="vas@email.sk" /><button className="primary-wide" disabled={!email.includes('@')}><Mail size={17} />Poslať prihlasovací odkaz</button></form>}
    </>}
  </main>

  if (isOnline && !household) return <main className="app-shell onboarding">
    <div className="brand-mark large"><ListChecks size={32} /></div><p className="eyebrow">VAŠA DOMÁCNOSŤ</p><h1>Spoločný zoznam</h1>
    <p className="onboarding-copy">{joinCode ? 'Pozývací kód je pripravený. Zadajte svoje meno a pripojte sa k rodine.' : 'Vytvorte nový nákupný zoznam alebo sa pripojte k existujúcemu.'}</p>
    {error && <p className="error-message">{error}</p>}
    <label className="setup-name">Ako sa voláte?<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Vaše meno" maxLength={50} /></label>
    <form className="join-form" onSubmit={e => { e.preventDefault(); void joinInvitedHousehold() }}><input aria-label="Pozývací kód" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Pozývací kód" maxLength={8} /><button disabled={!networkOnline || !normalizeInvite(joinCode) || memberName.trim().length < 2}>Pripojiť sa</button></form>
    {joinCode ? <button className="text-button" onClick={dismissInvite}>Zrušiť pozvanie a vytvoriť vlastný zoznam</button> : <>
      <div className="divider"><span>alebo</span></div>
      <label className="setup-name">Názov domácnosti<input value={householdName} onChange={e => setHouseholdName(e.target.value)} placeholder="Napr. U Berníkovcov" maxLength={60} /></label>
      <button className="primary-wide" disabled={!networkOnline || memberName.trim().length < 2 || !householdName.trim()} onClick={() => void createHousehold(memberName, householdName)}>Vytvoriť náš zoznam</button>
    </>}
    {syncStatus === 'error' && <button className="text-button" onClick={() => void retrySync()}>Skúsiť načítať domácnosť znova</button>}
    <button className="text-button" onClick={() => void signOut()}><LogOut size={15} />Použiť iný e-mail</button>
  </main>

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><ListChecks size={22} strokeWidth={2.5} /></div>
        <div className="brand-title"><p className="eyebrow">{household?.name ?? 'NÁŠ NÁKUP'}</p><h1>Lístoček</h1></div>
        <button className="people-button" aria-label="Členovia zoznamu" onClick={openMembers}><Users size={18} /><span>{memberCount}</span></button>
      </header>

      {joinCode && household && <section className="invite-banner">
        <strong>{joinCode === household.inviteCode ? 'Do tejto domácnosti už patríte.' : 'Máte pozvanie do inej domácnosti.'}</strong>
        {joinCode !== household.inviteCode && <><p>Teraz používate „{household.name}“. Ak chcete prijať pozvanie, najprv opustite aktuálnu domácnosť.</p><button onClick={() => { openMembers(); setConfirmLeave(true) }}>Zmeniť domácnosť</button></>}
        <button className="text-button" onClick={dismissInvite}>Zavrieť pozvanie</button>
      </section>}

      <section className="composer" aria-label="Pridať položku">
        <form onSubmit={event => { event.preventDefault(); submit() }}>
          <div className="input-row">
            <input autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Čo treba kúpiť?" aria-label="Názov položky" />
            <button type="submit" className="add-button" disabled={!name.trim()} aria-label="Pridať"><Plus size={25} /></button>
          </div>
          <button type="button" className="details-toggle" onClick={() => setDetailsOpen(value => !value)}>
            Množstvo a obchod <ChevronDown size={16} className={detailsOpen ? 'rotate' : ''} />
          </button>
          {detailsOpen && <div className="details-row">
            <input maxLength={40} value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="napr. 2 ks" aria-label="Množstvo" />
            <label><Store size={17} /><select value={shop} onChange={event => setShop(event.target.value as Shop | '')} aria-label="Obchod"><option value="">Bez obchodu</option>{shops.map(value => <option key={value}>{value}</option>)}</select></label>
          </div>}
        </form>

        {visibleSuggestions.length > 0 && <div className="suggestions">
          <p>{name.trim() ? 'Nájdené návrhy' : 'Často pridávate'}</p>
          <div>{visibleSuggestions.map(item => <button key={item.name} onClick={() => submit(item.name, item.preferredShop ?? '', item.preferredQuantity ?? '')}><Plus size={14} /><span>{item.name}{(item.preferredQuantity || item.preferredShop) && <small>{[item.preferredQuantity, item.preferredShop].filter(Boolean).join(' · ')}</small>}</span></button>)}</div>
        </div>}
      </section>

      <section className="list-section">
        {error && <button className="sync-error" onClick={() => void retrySync()}><AlertCircle size={17} /><span>{error}</span><strong>Skúsiť znova</strong></button>}
        <div className="section-heading"><h2>Treba kúpiť</h2><span>{active.length} {active.length === 1 ? 'položka' : active.length < 5 ? 'položky' : 'položiek'}</span></div>
        {active.length === 0 ? <div className="empty-state"><div><ShoppingBasket size={36} /></div><h3>Zoznam je prázdny</h3><p>Vyzerá to, že máte všetko. Pridajte položku alebo vyberte z návrhov.</p></div> :
          <div className="groups">{grouped.map(([group, groupItems]) => <div className="shop-group" key={group}>
            <div className="shop-title"><Store size={15} /><span>{group}</span></div>
            <div className="item-card">{groupItems.map(item => <div className="item" key={item.id}>
              <button className="checkbox" onClick={() => toggleItem(item.id)} aria-label={`Označiť ${item.name} ako kúpené`}><Check size={17} /></button>
              <button className="item-name" onClick={() => openEditor(item)} aria-label={`Upraviť ${item.name}`}><span>{item.name}{item.quantity && <small>{item.quantity}</small>}</span>{memberNameFor(item.createdBy) && <em>Pridal/a {memberNameFor(item.createdBy)}</em>}</button>
              <button className="delete" onClick={() => removeWithUndo(item)} aria-label={`Odstrániť ${item.name}`}><Trash2 size={17} /></button>
            </div>)}</div>
          </div>)}</div>}

        {checked.length > 0 && <div className="checked-section">
          <div className="section-heading"><h2>Kúpené</h2><button onClick={clearCheckedWithUndo}><Trash2 size={14} />Vymazať</button></div>
          <div className="item-card">{checked.map(item => <div className="item is-checked" key={item.id}>
            <button className="checkbox" onClick={() => toggleItem(item.id)}><Check size={17} /></button>
            <button className="item-name" onClick={() => openEditor(item)} aria-label={`Upraviť ${item.name}`}><span>{item.name}{item.quantity && <small>{item.quantity}</small>}</span>{memberNameFor(item.purchasedBy) && <em>Kúpil/a {memberNameFor(item.purchasedBy)}</em>}</button>
            <button className="delete" onClick={() => removeWithUndo(item)} aria-label={`Odstrániť ${item.name}`}><Trash2 size={17} /></button>
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
      {membersOpen && <div className="modal-backdrop" onClick={() => setMembersOpen(false)}><section className="modal members-modal" role="dialog" aria-modal="true" aria-labelledby="members-title" onClick={e => e.stopPropagation()}>
        <button className="modal-close" aria-label="Zavrieť" onClick={() => setMembersOpen(false)}><X size={20} /></button><Users size={29} /><h2 id="members-title">{household?.name ?? 'Spoločný zoznam'}</h2>
        {isOnline && household ? <>
          <p>Pozvite rodinu do spoločného zoznamu.</p>
          <div className="invite-actions">
            <button className="primary-wide" disabled={sharing} onClick={() => void shareInvitation()}><Share2 size={17} />Zdieľať pozvanie</button>
            <button className="secondary-button" onClick={() => void copyInvitation()}><Copy size={16} />Kopírovať odkaz</button>
            <a className="secondary-button" href={`mailto:?subject=${encodeURIComponent('Pozvanie do Lístočka')}&body=${encodeURIComponent(`${inviteText}\n\n${inviteUrl}\n\nPozývací kód: ${household.inviteCode}`)}`}><Mail size={16} />Poslať e-mailom</a>
          </div>
          <p className="share-hint">Aplikáciu na zdieľanie si vyberiete v ponuke telefónu.</p>
          {shareMessage && <p className="share-feedback" role="status">{shareMessage}</p>}
          <label className="invite-link-label">Pozývací odkaz<input readOnly value={inviteUrl} onFocus={e => e.target.select()} /></label>
          <p className="invite-code-text">Pozývací kód: <strong>{household.inviteCode}</strong></p>
          <div className="member-list">{members.map(member => <div key={member.userId}><span><UserRound size={15} /></span><strong>{member.displayName}</strong>{member.userId === currentUserId && <small>Vy</small>}</div>)}</div>
          <form className="profile-name" onSubmit={e => { e.preventDefault(); void updateMemberName(profileName) }}><label htmlFor="profile-name">Vaše zobrazované meno</label><div><input id="profile-name" value={profileName} onChange={e => setProfileName(e.target.value)} maxLength={50} /><button disabled={loading || !networkOnline || profileName.trim().length < 2}>Uložiť</button></div></form>
          <form className="profile-name household-name" onSubmit={e => { e.preventDefault(); void renameHousehold(editedHouseholdName) }}><label htmlFor="household-name">Názov domácnosti</label><div><input id="household-name" value={editedHouseholdName} onChange={e => setEditedHouseholdName(e.target.value)} maxLength={60} /><button disabled={managementDisabled || !editedHouseholdName.trim()}>Uložiť</button></div></form>
          {error && <p className="error-message" role="alert">{error}</p>}
          {pendingCount > 0 && <p className="share-hint">Pred odchodom alebo odhlásením treba odoslať {pendingCount} čakajúce zmeny. <button className="inline-button" onClick={() => void retrySync()}>Synchronizovať</button></p>}
          {confirmLeave ? <div className="leave-confirmation">
            <strong>Opustiť „{household.name}“?</strong>
            <p>Zoznam zostane ostatným členom. Potom sa môžete pripojiť k inej domácnosti alebo vytvoriť vlastnú.</p>
            {memberCount === 1 && <p>Ste posledný člen. Ak sa chcete neskôr vrátiť, odložte si pozývací odkaz alebo kód <strong>{household.inviteCode}</strong>.</p>}
            {!networkOnline && <p>Na opustenie domácnosti potrebujete internet.</p>}
            <button className="danger-button" disabled={managementDisabled} onClick={() => void leaveCurrentHousehold()}>Opustiť domácnosť</button>
            <button className="text-button" disabled={loading} onClick={() => setConfirmLeave(false)}>Zostať v domácnosti</button>
          </div> : <button className="text-button danger-text" onClick={() => setConfirmLeave(true)}>Opustiť domácnosť</button>}
          <button className="text-button" disabled={managementDisabled} onClick={() => void signOut()}><LogOut size={14} />Odhlásiť sa</button></> : <p>Po pripojení Supabase tu bude pozývací kód pre ďalších členov.</p>}
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
      {undo && <div className="undo-toast" role="status" aria-live="polite">
        <span>{undo.message}</span><button onClick={undoRemoval}>Vrátiť</button>
      </div>}
    </main>
  )
}
