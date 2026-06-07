const baseUrl = import.meta.env.BASE_URL.replace(/\/?$/, '/')

export const publicAsset = (path: string): string => `${baseUrl}${path.replace(/^\/+/, '')}`
