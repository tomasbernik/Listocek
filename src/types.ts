export type Shop = 'Lidl' | 'dm' | 'Globus' | 'Penny' | 'Kaufland' | 'Tesco' | 'Iné'

export type ShoppingItem = {
  id: string
  name: string
  quantity?: string
  shop?: Shop
  checked: boolean
  createdAt: string
  createdBy?: string
  purchasedBy?: string
}

export type HouseholdMember = { userId: string; displayName: string }

export type ProductHistory = {
  name: string
  count: number
  lastUsed: string
  preferredShop?: Shop
  preferredQuantity?: string
}

export type SyncStatus = 'local' | 'offline' | 'syncing' | 'synced' | 'error'
