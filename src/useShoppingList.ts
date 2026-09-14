import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import type { ProductHistory, Shop, ShoppingItem, SyncStatus } from './types'

const ITEMS_KEY = 'listocek.items'
const HISTORY_KEY = 'listocek.history'
const HOUSEHOLD_KEY = 'listocek.household'
const QUEUE_KEY = 'listocek.sync-queue'
const starterHistory: ProductHistory[] = [['Mlieko', 8], ['Vajcia', 7], ['Maslo', 6], ['Chlieb', 5], ['Cibuľa', 4], ['Strúhaný syr', 3]].map(([name, count]) => ({ name: String(name), count: Number(count), lastUsed: new Date(0).toISOString() }))
type Household = { id: string; name: string; inviteCode: string }
type DbItem = { id: string; name: string; quantity: string | null; shop: string | null; checked: boolean; created_at: string }
type PendingOperation =
  | { id: string; type: 'save'; householdId: string; item: ShoppingItem }
  | { id: string; type: 'toggle'; householdId: string; itemId: string; checked: boolean }
  | { id: string; type: 'remove'; householdId: string; itemId: string }
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback } }
function mapItem(row: DbItem): ShoppingItem { return { id: row.id, name: row.name, quantity: row.quantity ?? undefined, shop: row.shop as Shop | undefined, checked: row.checked, createdAt: row.created_at } }

export function useShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>(() => read(ITEMS_KEY, []))
  const [history, setHistory] = useState<ProductHistory[]>(() => read(HISTORY_KEY, starterHistory))
  const [household, setHousehold] = useState<Household | null>(() => read(HOUSEHOLD_KEY, null))
  const [memberCount, setMemberCount] = useState(1)
  const [loading, setLoading] = useState(isSupabaseConfigured && navigator.onLine)
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(!isSupabaseConfigured || Boolean(read(HOUSEHOLD_KEY, null)))
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine)
  const [queue, setQueue] = useState<PendingOperation[]>(() => read(QUEUE_KEY, []))
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? (navigator.onLine ? 'syncing' : 'offline') : 'local')
  const flushingRef = useRef(false)

  useEffect(() => { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)) }, [items])
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) }, [history])
  useEffect(() => { if (household) localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(household)); else localStorage.removeItem(HOUSEHOLD_KEY) }, [household])
  useEffect(() => { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)) }, [queue])
  useEffect(() => {
    const online = () => setNetworkOnline(true)
    const offline = () => { setNetworkOnline(false); if (isSupabaseConfigured) setSyncStatus('offline') }
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline) }
  }, [])

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
    if (!navigator.onLine) { setSignedIn(Boolean(read<Household | null>(HOUSEHOLD_KEY, null))); setLoading(false); setSyncStatus('offline'); return }
    setLoading(true); setError(null)
    const { data: authData } = await supabase.auth.getSession()
    if (!authData.session) { setSignedIn(false); setLoading(false); return }
    setSignedIn(true)
    const { data: memberships, error: memberError } = await supabase.from('household_members').select('household_id').limit(1)
    if (memberError) { setError(memberError.message); setLoading(false); return }
    if (!memberships?.length) { setLoading(false); return }
    const householdId = memberships[0].household_id
    const [{ data: house }, { data: rows }, { data: products }, { count }] = await Promise.all([
      supabase.from('households').select('id,name,invite_code').eq('id', householdId).single(),
      supabase.from('shopping_items').select('id,name,quantity,shop,checked,created_at').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('product_history').select('display_name,use_count,preferred_shop,preferred_quantity,last_used_at').eq('household_id', householdId),
      supabase.from('household_members').select('*', { count: 'exact', head: true }).eq('household_id', householdId),
    ])
    if (house) setHousehold({ id: house.id, name: house.name, inviteCode: house.invite_code })
    setItems((rows ?? []).map(row => mapItem(row as DbItem)))
    setHistory((products ?? []).map(p => ({ name: p.display_name, count: p.use_count, preferredShop: p.preferred_shop as Shop | undefined, preferredQuantity: p.preferred_quantity ?? undefined, lastUsed: p.last_used_at })))
    setMemberCount(count ?? 1); setLoading(false); setSyncStatus(navigator.onLine ? 'synced' : 'offline')
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    void loadHousehold()
    const { data } = supabase.auth.onAuthStateChange(() => { window.setTimeout(() => void loadHousehold(), 0) })
    return () => data.subscription.unsubscribe()
  }, [loadHousehold])
  useEffect(() => {
    if (!supabase || !household) return
    const client = supabase
    const refresh = async () => { const { data } = await client.from('shopping_items').select('id,name,quantity,shop,checked,created_at').eq('household_id', household.id).order('created_at', { ascending: false }); setItems((data ?? []).map(row => mapItem(row as DbItem))) }
    const channel = client.channel(`shopping-list:${household.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `household_id=eq.${household.id}` }, () => { void refresh() }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [household])

  const flushQueue = useCallback(async () => {
    if (!supabase || !household || !navigator.onLine || queue.length === 0 || flushingRef.current) return
    flushingRef.current = true
    setSyncStatus('syncing')
    const snapshot = queue
    const remaining: PendingOperation[] = []
    let failed = false
    for (let index = 0; index < snapshot.length; index++) {
      const operation = snapshot[index]
      if (operation.householdId !== household.id) { remaining.push(operation); continue }
      let operationError: { message: string } | null = null
      if (operation.type === 'save') {
        const { error: saveError } = await supabase.from('shopping_items').upsert({ id: operation.item.id, household_id: household.id, name: operation.item.name, quantity: operation.item.quantity ?? null, shop: operation.item.shop ?? null, checked: operation.item.checked, created_by: (await supabase.auth.getUser()).data.user?.id })
        operationError = saveError
        if (!saveError) operationError = (await supabase.rpc('record_product_use', { target_household: household.id, product_name: operation.item.name, product_shop: operation.item.shop ?? null, product_quantity: operation.item.quantity ?? null })).error
      } else if (operation.type === 'toggle') operationError = (await supabase.from('shopping_items').update({ checked: operation.checked, updated_at: new Date().toISOString() }).eq('id', operation.itemId)).error
      else operationError = (await supabase.from('shopping_items').delete().eq('id', operation.itemId)).error
      if (operationError) {
        remaining.push(...snapshot.slice(index)); setError(`Synchronizácia zlyhala: ${operationError.message}`); setSyncStatus('error'); failed = true; break
      }
    }
    setQueue(current => [...remaining, ...current.slice(snapshot.length)])
    if (!failed) { setError(null); setSyncStatus(remaining.length ? 'offline' : 'synced') }
    flushingRef.current = false
  }, [household, queue])

  useEffect(() => { if (networkOnline && household && queue.length > 0) void flushQueue() }, [flushQueue, household, networkOnline, queue.length])

  const createHousehold = useCallback(async (name = 'Náš nákup') => { if (!supabase) return; setLoading(true); const { error: e } = await supabase.rpc('create_household', { household_name: name }); if (e) setError(e.message); await loadHousehold() }, [loadHousehold])
  const joinHousehold = useCallback(async (code: string) => { if (!supabase) return; setLoading(true); setError(null); const { error: e } = await supabase.rpc('join_household', { code }); if (e) { setError('Pozývací kód nie je platný.'); setLoading(false); return }; await loadHousehold() }, [loadHousehold])
  const signInWithEmail = useCallback(async (email: string) => {
    if (!supabase) return
    setLoading(true); setError(null); setAuthMessage(null)
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href
    const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo, shouldCreateUser: true } })
    if (e) setError(e.message)
    else setAuthMessage(`Prihlasovací odkaz sme poslali na ${email.trim()}.`)
    setLoading(false)
  }, [])
  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setHousehold(null); setItems([]); setHistory([]); setQueue([]); setSignedIn(false); setMemberCount(1)
  }, [])

  const addItem = useCallback(async (name: string, quantity?: string, shop?: Shop) => {
    const cleanName = name.trim(); if (!cleanName) return
    if (supabase && household) {
      const duplicate = items.find(i => !i.checked && i.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0)
      const item: ShoppingItem = duplicate ? { ...duplicate, quantity: quantity?.trim() || duplicate.quantity, shop: shop || duplicate.shop } : { id: crypto.randomUUID(), name: cleanName, quantity: quantity?.trim() || undefined, shop, checked: false, createdAt: new Date().toISOString() }
      setItems(current => duplicate ? current.map(value => value.id === duplicate.id ? item : value) : [item, ...current])
      setHistory(current => { const found = current.find(p => p.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0); return found ? current.map(p => p === found ? { ...p, count: p.count + 1, lastUsed: new Date().toISOString(), preferredShop: shop || p.preferredShop, preferredQuantity: quantity?.trim() || p.preferredQuantity } : p) : [...current, { name: cleanName, count: 1, lastUsed: new Date().toISOString(), preferredShop: shop, preferredQuantity: quantity?.trim() || undefined }] })
      setQueue(current => [...current, { id: crypto.randomUUID(), type: 'save', householdId: household.id, item }]); setSyncStatus(navigator.onLine ? 'syncing' : 'offline'); return
    }
    setItems(current => { const duplicate = current.find(i => !i.checked && i.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0); if (duplicate) return current.map(i => i.id === duplicate.id ? { ...i, quantity: quantity || i.quantity, shop: shop || i.shop } : i); return [{ id: crypto.randomUUID(), name: cleanName, quantity: quantity?.trim() || undefined, shop, checked: false, createdAt: new Date().toISOString() }, ...current] })
    setHistory(current => { const found = current.find(p => p.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0); if (!found) return [...current, { name: cleanName, count: 1, lastUsed: new Date().toISOString(), preferredShop: shop, preferredQuantity: quantity?.trim() || undefined }]; return current.map(p => p === found ? { ...p, count: p.count + 1, lastUsed: new Date().toISOString(), preferredShop: shop || p.preferredShop, preferredQuantity: quantity?.trim() || p.preferredQuantity } : p) })
  }, [household, items])
  const toggleItem = useCallback(async (id: string) => { const item = items.find(i => i.id === id); if (!item) return; const checked = !item.checked; setItems(current => current.map(i => i.id === id ? { ...i, checked } : i)); if (supabase && household) { setQueue(current => [...current, { id: crypto.randomUUID(), type: 'toggle', householdId: household.id, itemId: id, checked }]); setSyncStatus(navigator.onLine ? 'syncing' : 'offline') } }, [household, items])
  const removeItem = useCallback(async (id: string) => { setItems(current => current.filter(i => i.id !== id)); if (supabase && household) { setQueue(current => [...current, { id: crypto.randomUUID(), type: 'remove', householdId: household.id, itemId: id }]); setSyncStatus(navigator.onLine ? 'syncing' : 'offline') } }, [household])
  const clearChecked = useCallback(async () => { const ids = items.filter(item => item.checked).map(item => item.id); setItems(current => current.filter(i => !i.checked)); if (supabase && household) { setQueue(current => [...current, ...ids.map(itemId => ({ id: crypto.randomUUID(), type: 'remove' as const, householdId: household.id, itemId }))]); setSyncStatus(navigator.onLine ? 'syncing' : 'offline') } }, [household, items])
  const suggestions = useMemo(() => history.filter(p => !items.some(i => !i.checked && i.name.localeCompare(p.name, 'sk', { sensitivity: 'base' }) === 0)).sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed)).slice(0, 6), [history, items])
  return { items, suggestions, addItem, toggleItem, removeItem, clearChecked, household, memberCount, loading, error, authMessage, signedIn, isOnline: isSupabaseConfigured, syncStatus, pendingCount: queue.length, retrySync: flushQueue, signInWithEmail, signOut, createHousehold, joinHousehold }
}
