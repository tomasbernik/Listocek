import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import type { ProductHistory, Shop, ShoppingItem } from './types'

const ITEMS_KEY = 'listocek.items'
const HISTORY_KEY = 'listocek.history'
const starterHistory: ProductHistory[] = [['Mlieko', 8], ['Vajcia', 7], ['Maslo', 6], ['Chlieb', 5], ['Cibuľa', 4], ['Strúhaný syr', 3]].map(([name, count]) => ({ name: String(name), count: Number(count), lastUsed: new Date(0).toISOString() }))
type Household = { id: string; name: string; inviteCode: string }
type DbItem = { id: string; name: string; quantity: string | null; shop: string | null; checked: boolean; created_at: string }
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback } }
function mapItem(row: DbItem): ShoppingItem { return { id: row.id, name: row.name, quantity: row.quantity ?? undefined, shop: row.shop as Shop | undefined, checked: row.checked, createdAt: row.created_at } }

export function useShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>(() => isSupabaseConfigured ? [] : read(ITEMS_KEY, []))
  const [history, setHistory] = useState<ProductHistory[]>(() => isSupabaseConfigured ? [] : read(HISTORY_KEY, starterHistory))
  const [household, setHousehold] = useState<Household | null>(null)
  const [memberCount, setMemberCount] = useState(1)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(!isSupabaseConfigured)
  const [authMessage, setAuthMessage] = useState<string | null>(null)

  useEffect(() => { if (!isSupabaseConfigured) localStorage.setItem(ITEMS_KEY, JSON.stringify(items)) }, [items])
  useEffect(() => { if (!isSupabaseConfigured) localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) }, [history])

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
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
      supabase.from('product_history').select('display_name,use_count,preferred_shop,last_used_at').eq('household_id', householdId),
      supabase.from('household_members').select('*', { count: 'exact', head: true }).eq('household_id', householdId),
    ])
    if (house) setHousehold({ id: house.id, name: house.name, inviteCode: house.invite_code })
    setItems((rows ?? []).map(row => mapItem(row as DbItem)))
    setHistory((products ?? []).map(p => ({ name: p.display_name, count: p.use_count, preferredShop: p.preferred_shop as Shop | undefined, lastUsed: p.last_used_at })))
    setMemberCount(count ?? 1); setLoading(false)
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
    setHousehold(null); setItems([]); setHistory([]); setSignedIn(false); setMemberCount(1)
  }, [])

  const addItem = useCallback(async (name: string, quantity?: string, shop?: Shop) => {
    const cleanName = name.trim(); if (!cleanName) return
    if (supabase && household) {
      const duplicate = items.find(i => !i.checked && i.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0)
      if (duplicate) await supabase.from('shopping_items').update({ quantity: quantity?.trim() || duplicate.quantity || null, shop: shop || duplicate.shop || null, updated_at: new Date().toISOString() }).eq('id', duplicate.id)
      else { const { data } = await supabase.auth.getUser(); await supabase.from('shopping_items').insert({ household_id: household.id, name: cleanName, quantity: quantity?.trim() || null, shop: shop || null, created_by: data.user?.id }) }
      await supabase.rpc('record_product_use', { target_household: household.id, product_name: cleanName, product_shop: shop || null }); return
    }
    setItems(current => { const duplicate = current.find(i => !i.checked && i.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0); if (duplicate) return current.map(i => i.id === duplicate.id ? { ...i, quantity: quantity || i.quantity, shop: shop || i.shop } : i); return [{ id: crypto.randomUUID(), name: cleanName, quantity: quantity?.trim() || undefined, shop, checked: false, createdAt: new Date().toISOString() }, ...current] })
    setHistory(current => { const found = current.find(p => p.name.localeCompare(cleanName, 'sk', { sensitivity: 'base' }) === 0); if (!found) return [...current, { name: cleanName, count: 1, lastUsed: new Date().toISOString(), preferredShop: shop }]; return current.map(p => p === found ? { ...p, count: p.count + 1, lastUsed: new Date().toISOString(), preferredShop: shop || p.preferredShop } : p) })
  }, [household, items])
  const toggleItem = useCallback(async (id: string) => { const item = items.find(i => i.id === id); if (!item) return; setItems(current => current.map(i => i.id === id ? { ...i, checked: !i.checked } : i)); if (supabase && household) await supabase.from('shopping_items').update({ checked: !item.checked, updated_at: new Date().toISOString() }).eq('id', id) }, [household, items])
  const removeItem = useCallback(async (id: string) => { setItems(current => current.filter(i => i.id !== id)); if (supabase && household) await supabase.from('shopping_items').delete().eq('id', id) }, [household])
  const clearChecked = useCallback(async () => { setItems(current => current.filter(i => !i.checked)); if (supabase && household) await supabase.from('shopping_items').delete().eq('household_id', household.id).eq('checked', true) }, [household])
  const suggestions = useMemo(() => history.filter(p => !items.some(i => !i.checked && i.name.localeCompare(p.name, 'sk', { sensitivity: 'base' }) === 0)).sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed)).slice(0, 6), [history, items])
  return { items, suggestions, addItem, toggleItem, removeItem, clearChecked, household, memberCount, loading, error, authMessage, signedIn, isOnline: isSupabaseConfigured, signInWithEmail, signOut, createHousehold, joinHousehold }
}
