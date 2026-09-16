import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import { applyPending, Outbox, SnapshotGuard } from './sync'
import type { PendingOperation } from './sync'
import type { HouseholdMember, ProductHistory, Shop, ShoppingItem, SyncStatus } from './types'

const ITEMS_KEY = 'listocek.items'
const HISTORY_KEY = 'listocek.history'
const HOUSEHOLD_KEY = 'listocek.household'
const QUEUE_KEY = 'listocek.sync-queue'
const MEMBERS_KEY = 'listocek.members'
const USER_KEY = 'listocek.user-id'
const starterHistory: ProductHistory[] = [['Mlieko', 8], ['Vajcia', 7], ['Maslo', 6], ['Chlieb', 5], ['Cibuľa', 4], ['Strúhaný syr', 3]].map(([name, count]) => ({ name: String(name), count: Number(count), lastUsed: new Date(0).toISOString() }))

type Household = { id: string; name: string; inviteCode: string }
type DbItem = { id: string; name: string; quantity: string | null; shop: string | null; checked: boolean; created_at: string; created_by: string; purchased_by: string | null }
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback } }
function mapItem(row: DbItem): ShoppingItem { return { id: row.id, name: row.name, quantity: row.quantity ?? undefined, shop: row.shop as Shop | undefined, checked: row.checked, createdAt: row.created_at, createdBy: row.created_by, purchasedBy: row.purchased_by ?? undefined } }
function message(error: unknown) { return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Nepodarilo sa pripojiť. Skúste to znova.' }

export function useShoppingList() {
  const [serverItems, setServerItems] = useState<ShoppingItem[]>(() => read(ITEMS_KEY, []))
  const [history, setHistory] = useState<ProductHistory[]>(() => read(HISTORY_KEY, starterHistory))
  const [household, setHousehold] = useState<Household | null>(() => read(HOUSEHOLD_KEY, null))
  const [members, setMembers] = useState<HouseholdMember[]>(() => read(MEMBERS_KEY, []))
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => read(USER_KEY, null))
  const [loading, setLoading] = useState(isSupabaseConfigured && navigator.onLine)
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(!isSupabaseConfigured || Boolean(read(HOUSEHOLD_KEY, null)))
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine)
  const [sessionReady, setSessionReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? (navigator.onLine ? 'syncing' : 'offline') : 'local')
  const [outbox] = useState(() => new Outbox(read<PendingOperation[]>(QUEUE_KEY, []), operations => localStorage.setItem(QUEUE_KEY, JSON.stringify(operations))))
  const queue = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot)
  const [guard] = useState(() => new SnapshotGuard())
  const householdRef = useRef(household)
  const userRef = useRef(currentUserId)
  const flushingRef = useRef(false)
  const retryBlocked = useRef(false)
  const actionRef = useRef(false)
  const contextVersion = useRef(0)
  const items = useMemo(() => household ? applyPending(serverItems, queue, household.id) : serverItems, [serverItems, queue, household])

  useEffect(() => { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)) }, [items])
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) }, [history])
  useEffect(() => { localStorage.setItem(MEMBERS_KEY, JSON.stringify(members)) }, [members])

  const selectHousehold = useCallback((value: Household | null) => {
    householdRef.current = value
    if (value) localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(value))
    else localStorage.removeItem(HOUSEHOLD_KEY)
    setHousehold(value)
  }, [])

  const clearHousehold = useCallback(() => {
    contextVersion.current++
    guard.invalidate()
    selectHousehold(null)
    setServerItems([]); setHistory([]); setMembers([])
    localStorage.removeItem(ITEMS_KEY); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(MEMBERS_KEY)
  }, [guard, selectHousehold])

  const reportSyncError = useCallback((cause: unknown) => {
    setError(message(cause))
    setSyncStatus(navigator.onLine ? 'error' : 'offline')
  }, [])

  const refreshHousehold = useCallback(async (householdId: string, request = guard.begin()) => {
    if (!supabase || !navigator.onLine) return
    try {
      const [houseResult, itemsResult, historyResult, membersResult] = await Promise.all([
        supabase.from('households').select('id,name,invite_code').eq('id', householdId).single(),
        supabase.from('shopping_items').select('id,name,quantity,shop,checked,created_at,created_by,purchased_by').eq('household_id', householdId).order('created_at', { ascending: false }),
        supabase.from('product_history').select('display_name,use_count,preferred_shop,preferred_quantity,last_used_at').eq('household_id', householdId),
        supabase.from('household_members').select('user_id,display_name').eq('household_id', householdId),
      ])
      if (!guard.isCurrent(request)) return
      for (const result of [houseResult, itemsResult, historyResult, membersResult]) if (result.error) throw result.error
      if (!houseResult.data || !itemsResult.data || !historyResult.data || !membersResult.data) throw new Error('Zoznam sa nepodarilo načítať. Vaše uložené položky zostávajú zachované.')
      selectHousehold({ id: houseResult.data.id, name: houseResult.data.name, inviteCode: houseResult.data.invite_code })
      setServerItems(itemsResult.data.map(row => mapItem(row as DbItem)))
      setHistory(historyResult.data.map(p => ({ name: p.display_name, count: p.use_count, preferredShop: p.preferred_shop as Shop | undefined, preferredQuantity: p.preferred_quantity ?? undefined, lastUsed: p.last_used_at })))
      setMembers(membersResult.data.map(member => ({ userId: member.user_id, displayName: member.display_name })))
      if (!retryBlocked.current) {
        setError(null)
        setSyncStatus(!navigator.onLine ? 'offline' : outbox.getSnapshot().length || flushingRef.current ? 'syncing' : 'synced')
      }
    } catch (cause) { if (guard.isCurrent(request)) reportSyncError(cause) }
  }, [guard, outbox, reportSyncError, selectHousehold])

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
    if (!navigator.onLine) { setLoading(false); setSyncStatus('offline'); return }
    let request = guard.begin()
    try {
      const { data, error: authError } = await supabase.auth.getSession()
      if (!guard.isCurrent(request)) return
      if (authError) throw authError
      if (!data.session) { setSessionReady(false); setSignedIn(false); return }
      const userId = data.session.user.id
      if (userRef.current && userRef.current !== userId) {
        if (outbox.getSnapshot().length) throw new Error('Na tomto zariadení čakajú zmeny predchádzajúceho účtu. Prihláste sa pôvodným e-mailom a synchronizujte ich.')
        clearHousehold()
        request = guard.begin()
      }
      userRef.current = userId
      setCurrentUserId(userId); setSignedIn(true)
      localStorage.setItem(USER_KEY, JSON.stringify(userId))
      setSessionReady(true)
      const { data: memberships, error: memberError } = await supabase.from('household_members').select('household_id').eq('user_id', userId).order('created_at', { ascending: true })
      if (!guard.isCurrent(request)) return
      if (memberError) throw memberError
      if (!memberships?.length) {
        if (outbox.getSnapshot().length) throw new Error('Čakajú neodoslané zmeny domácnosti, ku ktorej nemáte prístup.')
        clearHousehold(); setError(null); setSyncStatus('synced'); return
      }
      const selectedId = memberships.find(member => member.household_id === householdRef.current?.id)?.household_id ?? memberships[0].household_id
      await refreshHousehold(selectedId, request)
    } catch (cause) { if (guard.isCurrent(request)) reportSyncError(cause) }
    finally { if (!actionRef.current) setLoading(false) }
  }, [clearHousehold, guard, outbox, refreshHousehold, reportSyncError])

  useEffect(() => {
    if (!supabase) return
    void loadHousehold()
    const { data } = supabase.auth.onAuthStateChange(() => { window.setTimeout(() => void loadHousehold(), 0) })
    return () => { data.subscription.unsubscribe(); guard.invalidate() }
  }, [guard, loadHousehold])

  const flushQueue = useCallback(async () => {
    const active = householdRef.current
    if (!supabase || !active || !sessionReady || flushingRef.current || actionRef.current) return
    if (!navigator.onLine) { setSyncStatus('offline'); return }
    const client = supabase
    const context = contextVersion.current
    flushingRef.current = true
    setSyncStatus('syncing')
    let success = false
    try {
      await outbox.drain(active.id, async operation => {
        if (!navigator.onLine || context !== contextVersion.current) throw new Error('Odosielanie zmien bolo prerušené. Zmeny zostávajú uložené v zariadení.')
        const { error: operationError } = await client.rpc('apply_shopping_operation', { operation })
        if (operationError) throw operationError
      }, operation => {
        guard.invalidate()
        setServerItems(current => applyPending(current, [operation], active.id))
      })
      success = true
      retryBlocked.current = false
    } catch (cause) {
      retryBlocked.current = true
      if (context === contextVersion.current) reportSyncError(cause)
    } finally { flushingRef.current = false }
    if (success && context === contextVersion.current) await refreshHousehold(active.id)
  }, [guard, outbox, refreshHousehold, reportSyncError, sessionReady])

  const retrySync = useCallback(async () => {
    retryBlocked.current = false
    if (householdRef.current && sessionReady) await flushQueue()
    else await loadHousehold()
  }, [flushQueue, loadHousehold, sessionReady])

  useEffect(() => {
    if (networkOnline && household && queue.length && !retryBlocked.current) void flushQueue()
  }, [flushQueue, household?.id, networkOnline, queue])

  useEffect(() => {
    const online = () => { setNetworkOnline(true); void retrySync() }
    const offline = () => { setNetworkOnline(false); if (isSupabaseConfigured) setSyncStatus('offline') }
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void retrySync() }
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [retrySync])

  useEffect(() => {
    if (!supabase || !household?.id) return
    const client = supabase
    const id = household.id
    let disposed = false
    const refresh = () => { if (!disposed && !actionRef.current && householdRef.current?.id === id) void refreshHousehold(id) }
    const channel = client.channel(`shopping-list:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `household_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'households', filter: `id=eq.${id}` }, refresh)
      .subscribe(status => {
        if (disposed) return
        if (status === 'SUBSCRIBED') refresh()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reportSyncError(new Error('Živé spojenie sa prerušilo. Skúste zoznam obnoviť.'))
      })
    return () => { disposed = true; guard.invalidate(); void client.removeChannel(channel) }
  }, [guard, household?.id, refreshHousehold, reportSyncError])

  const enqueue = useCallback((operations: PendingOperation[]) => {
    if (actionRef.current) return false
    try {
      outbox.enqueue(operations)
      retryBlocked.current = false
      setError(null); setSyncStatus(navigator.onLine ? 'syncing' : 'offline')
      return true
    } catch { reportSyncError(new Error('Zmenu sa nepodarilo uložiť do zariadenia. Uvoľnite miesto a skúste to znova.')); return false }
  }, [outbox, reportSyncError])

  const remember = useCallback((name: string, quantity?: string, shop?: Shop) => {
    setHistory(current => {
      const found = current.find(p => p.name.localeCompare(name, 'sk', { sensitivity: 'base' }) === 0)
      return found ? current.map(p => p === found ? { ...p, count: p.count + 1, lastUsed: new Date().toISOString(), preferredShop: shop || p.preferredShop, preferredQuantity: quantity || p.preferredQuantity } : p) : [...current, { name, count: 1, lastUsed: new Date().toISOString(), preferredShop: shop, preferredQuantity: quantity }]
    })
  }, [])

  const addItem = useCallback((name: string, quantity?: string, shop?: Shop) => {
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > 100 || (quantity?.trim().length ?? 0) > 40) { setError('Názov môže mať 1 až 100 znakov a množstvo najviac 40 znakov.'); return false }
    const duplicate = items.find(item => !item.checked && item.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0)
    const item: ShoppingItem = duplicate ? { ...duplicate, quantity: quantity?.trim() || duplicate.quantity, shop: shop || duplicate.shop } : { id: crypto.randomUUID(), name: cleanName, quantity: quantity?.trim() || undefined, shop, checked: false, createdAt: new Date().toISOString(), createdBy: currentUserId ?? undefined }
    if (supabase && household) {
      const operation: PendingOperation = duplicate
        ? { id: crypto.randomUUID(), type: 'edit', householdId: household.id, itemId: item.id, name: item.name, quantity: item.quantity, shop: item.shop, recordHistory: true }
        : { id: crypto.randomUUID(), type: 'save', householdId: household.id, item, recordHistory: true }
      if (!enqueue([operation])) return false
    } else if (!supabase) setServerItems(current => duplicate ? current.map(value => value.id === item.id ? item : value) : [item, ...current])
    else return false
    remember(item.name, item.quantity, item.shop)
    return true
  }, [currentUserId, enqueue, household, items, remember])

  const updateItem = useCallback((id: string, name: string, quantity?: string, shop?: Shop) => {
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > 100 || (quantity?.trim().length ?? 0) > 40) return false
    const operation: PendingOperation = { id: crypto.randomUUID(), type: 'edit', householdId: household?.id ?? '', itemId: id, name: cleanName, quantity: quantity?.trim() || undefined, shop }
    if (supabase) return household ? enqueue([operation]) : false
    setServerItems(current => applyPending(current, [operation], ''))
    return true
  }, [enqueue, household])

  const toggleItem = useCallback((id: string) => {
    const item = items.find(value => value.id === id)
    if (!item) return
    const checked = !item.checked
    const operation: PendingOperation = { id: crypto.randomUUID(), type: 'toggle', householdId: household?.id ?? '', itemId: id, checked, purchasedBy: checked ? currentUserId ?? undefined : undefined }
    if (supabase) { if (household) enqueue([operation]) }
    else setServerItems(current => applyPending(current, [operation], ''))
  }, [currentUserId, enqueue, household, items])

  const removeItems = useCallback((ids: string[]) => {
    const operations: PendingOperation[] = ids.map(itemId => ({ id: crypto.randomUUID(), type: 'remove', householdId: household?.id ?? '', itemId }))
    if (supabase) return household ? enqueue(operations) : false
    setServerItems(current => applyPending(current, operations, ''))
    return true
  }, [enqueue, household])
  const removeItem = (id: string) => removeItems([id])
  const clearChecked = () => removeItems(items.filter(item => item.checked).map(item => item.id))
  const restoreItems = useCallback((restored: ShoppingItem[]) => {
    const operations: PendingOperation[] = restored.map(item => ({ id: crypto.randomUUID(), type: 'save', householdId: household?.id ?? '', item }))
    if (supabase) return household ? enqueue(operations) : false
    setServerItems(current => applyPending(current, operations, ''))
    return true
  }, [enqueue, household])

  const householdAction = useCallback(async (action: () => Promise<void>) => {
    if (!navigator.onLine) { setError('Na túto zmenu je potrebné pripojenie k internetu.'); return false }
    if (actionRef.current || flushingRef.current || outbox.getSnapshot().length) { setError('Najprv počkajte na synchronizáciu všetkých zmien.'); return false }
    actionRef.current = true
    guard.invalidate(); setLoading(true); setError(null)
    try { await action(); return true }
    catch (cause) { setError(message(cause)); return false }
    finally { actionRef.current = false; setLoading(false) }
  }, [guard, outbox])

  const createHousehold = (memberName: string, name: string) => householdAction(async () => {
    if (!supabase) return
    const { error: cause } = await supabase.rpc('create_household', { household_name: name.trim(), member_name: memberName.trim() })
    if (cause) throw cause
    await loadHousehold()
  })
  const joinHousehold = (code: string, memberName: string) => householdAction(async () => {
    if (!supabase) return
    const { error: cause } = await supabase.rpc('join_household', { code: code.trim().toUpperCase(), member_name: memberName.trim() })
    if (cause) throw cause
    await loadHousehold()
  })
  const leaveHousehold = () => householdAction(async () => {
    if (!supabase || !householdRef.current) return
    const { error: cause } = await supabase.rpc('leave_household', { target_household: householdRef.current.id })
    if (cause) throw cause
    clearHousehold(); setSyncStatus('synced')
    await loadHousehold()
  })
  const renameHousehold = (name: string) => householdAction(async () => {
    if (!supabase || !householdRef.current) return
    const id = householdRef.current.id
    const { error: cause } = await supabase.rpc('rename_household', { target_household: id, household_name: name.trim() })
    if (cause) throw cause
    await refreshHousehold(id)
  })
  const updateMemberName = async (displayName: string) => {
    const cleanName = displayName.trim()
    if (!supabase || !household || !currentUserId || cleanName.length < 2) return false
    try {
      const { error: cause } = await supabase.from('household_members').update({ display_name: cleanName }).eq('household_id', household.id).eq('user_id', currentUserId)
      if (cause) throw cause
      setMembers(current => current.map(member => member.userId === currentUserId ? { ...member, displayName: cleanName } : member)); setError(null)
      return true
    } catch (cause) { setError(message(cause)); return false }
  }
  const signInWithEmail = async (email: string, inviteCode = '') => {
    if (!supabase) return
    setLoading(true); setError(null); setAuthMessage(null)
    try {
      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin)
      if (inviteCode) redirectTo.searchParams.set('invite', inviteCode)
      const { error: cause } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo.href, shouldCreateUser: true } })
      if (cause) throw cause
      setAuthMessage(`Prihlasovací odkaz sme poslali na ${email.trim()}.`)
    } catch (cause) { setError(message(cause)) }
    finally { setLoading(false) }
  }
  const signOut = () => householdAction(async () => {
    if (!supabase) return
    const { error: cause } = await supabase.auth.signOut()
    if (cause) throw cause
    clearHousehold(); userRef.current = null; localStorage.removeItem(USER_KEY)
    setCurrentUserId(null); setSignedIn(false); setSessionReady(false); setAuthMessage(null)
  })
  const suggestions = useMemo(() => history.filter(p => !items.some(i => !i.checked && i.name.localeCompare(p.name, 'sk', { sensitivity: 'base' }) === 0)).sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed)), [history, items])
  return { items, suggestions, addItem, updateItem, toggleItem, removeItem, clearChecked, restoreItems, household, members, memberCount: Math.max(1, members.length), currentUserId, updateMemberName, loading, error, authMessage, signedIn, isOnline: isSupabaseConfigured, networkOnline, syncStatus, pendingCount: queue.length, retrySync, signInWithEmail, signOut, createHousehold, joinHousehold, leaveHousehold, renameHousehold }
}
