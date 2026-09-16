const INVITE_KEY = 'listocek.pending-invite'

export function normalizeInvite(code: string | null) {
  const normalized = code?.trim().toUpperCase() ?? ''
  return /^[A-F0-9]{8}$/.test(normalized) ? normalized : ''
}

export function captureInvite(url: string, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const incoming = normalizeInvite(new URL(url).searchParams.get('invite'))
  if (incoming) storage.setItem(INVITE_KEY, incoming)
  return incoming || normalizeInvite(storage.getItem(INVITE_KEY))
}

export function clearInvite(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(INVITE_KEY)
}

export function invitationUrl(baseUrl: string, code: string) {
  const url = new URL(baseUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('invite', normalizeInvite(code))
  return url.href
}
