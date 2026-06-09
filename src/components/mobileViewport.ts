export const MOBILE_VIEWPORT_QUERY = '(max-width: 820px), (max-width: 960px) and (max-height: 520px)'

export const mobileViewportMatches = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
