export type CellarDeepLink = {
  kind: 'visit' | 'wine'
  id: string
  returnTo: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function safeTravelReturnUrl(value: string | null, currentOrigin = window.location.origin): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const allowed =
      (url.origin === 'https://travel.higgshome.com' && url.pathname === '/') ||
      (url.origin === 'https://phillisandruby.com' && url.pathname === '/') ||
      (url.origin === 'https://scott-e-higgins.github.io' && url.pathname === '/phillis-ruby-hub/') ||
      (/^https?:\/\/localhost(?::\d+)?$/.test(currentOrigin) && url.origin === currentOrigin)
    return allowed ? url.href : null
  } catch {
    return null
  }
}

export function parseCellarDeepLink(search = window.location.search, currentOrigin = window.location.origin): CellarDeepLink | null {
  const params = new URLSearchParams(search)
  const visit = params.get('visit')
  const wine = params.get('wine')
  if ((visit && wine) || (!visit && !wine)) return null
  const kind = visit ? 'visit' : 'wine'
  const id = visit || wine || ''
  if (!UUID.test(id)) return null
  return { kind, id, returnTo: safeTravelReturnUrl(params.get('return_to'), currentOrigin) }
}
