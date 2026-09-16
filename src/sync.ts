import type { ShoppingItem } from './types'

export type PendingOperation =
  | { id: string; type: 'save'; householdId: string; item: ShoppingItem; recordHistory?: boolean }
  | { id: string; type: 'edit'; householdId: string; itemId: string; name: string; quantity?: string; shop?: ShoppingItem['shop']; recordHistory?: boolean }
  | { id: string; type: 'toggle'; householdId: string; itemId: string; checked: boolean; purchasedBy?: string }
  | { id: string; type: 'remove'; householdId: string; itemId: string }

// Replay only this household's pending changes over the latest server snapshot.
export function applyPending(items: ShoppingItem[], operations: readonly PendingOperation[], householdId: string): ShoppingItem[] {
  const result = new Map(items.map(item => [item.id, item]))
  for (const operation of operations) {
    if (operation.householdId !== householdId) continue
    if (operation.type === 'save') result.set(operation.item.id, operation.item)
    else if (operation.type === 'remove') result.delete(operation.itemId)
    else {
      const item = result.get(operation.itemId)
      if (!item) continue
      result.set(item.id, operation.type === 'edit'
        ? { ...item, name: operation.name, quantity: operation.quantity, shop: operation.shop }
        : { ...item, checked: operation.checked, purchasedBy: operation.purchasedBy })
    }
  }
  return [...result.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Immutable operation IDs are also used by the server to deduplicate retries.
export class Outbox {
  private operations: PendingOperation[]
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private persist: (operations: PendingOperation[]) => void

  constructor(initial: PendingOperation[], persist: (operations: PendingOperation[]) => void) {
    this.operations = initial
    this.persist = persist
  }

  getSnapshot = () => this.operations
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private replace(operations: PendingOperation[]) {
    // Persist before showing the change, so a storage failure cannot lose it on reload.
    this.persist(operations)
    this.operations = operations
    this.listeners.forEach(listener => listener())
  }

  enqueue(operations: PendingOperation[]) { this.replace([...this.operations, ...operations]) }

  drain(householdId: string, send: (operation: PendingOperation) => Promise<void>, acknowledge: (operation: PendingOperation) => void) {
    if (this.running) return this.running
    this.running = (async () => {
      while (true) {
        const operation = this.operations.find(value => value.householdId === householdId)
        if (!operation) return
        await send(operation)
        acknowledge(operation)
        // Remove exactly the acknowledged ID, including when a new edit arrived during send.
        this.replace(this.operations.filter(value => value.id !== operation.id))
      }
    })().finally(() => { this.running = null })
    return this.running
  }
}

// Reject reads started before a completed write or before a newer read.
export class SnapshotGuard {
  private version = 0
  begin() { return ++this.version }
  invalidate() { this.version++ }
  isCurrent(version: number) { return version === this.version }
}
