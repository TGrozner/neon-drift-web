type DiagnosticLevel = 'info' | 'warn' | 'error'

type DiagnosticEntry = {
  id: number
  sessionId: string
  timestamp: number
  isoTime: string
  elapsedMs: number
  level: DiagnosticLevel
  category: string
  message: string
  payload?: Record<string, unknown>
}

type DiagnosticsPayload = {
  version: 1
  reason?: string
  generatedAt?: string
  session?: {
    id?: string
    startedAt?: string
    startedAtMs?: number
    environment?: Record<string, unknown>
  }
  currentEnvironment?: Record<string, unknown>
  entries?: DiagnosticEntry[]
  summary?: Record<string, unknown>
}

type SessionSummary = {
  sessionId: string
  firstSeenAt: string
  lastSeenAt: string
  startedAt?: string
  latestReason?: string
  latestOrigin?: string
  latestUserAgent?: string
  latestHref?: string
  entryCount: number
  batchCount: number
  levelCounts: Record<DiagnosticLevel, number>
  latestEntries: DiagnosticEntry[]
}

type LogStoreListResult = {
  keys: Array<{ name: string }>
}

type LogStore = {
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>
  list: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<LogStoreListResult>
}

type WorkerEnv = {
  LOGS: LogStore
  READ_TOKEN?: string
  ALLOWED_ORIGINS?: string
  LOG_RETENTION_DAYS?: string
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tgrozner.github.io',
  'http://localhost:4173',
  'http://localhost:5173',
]
const MAX_BODY_BYTES = 128_000
const MAX_BATCH_ENTRIES = 140
const MAX_LATEST_ENTRIES = 20
const DEFAULT_RETENTION_DAYS = 45

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function jsonResponse(body: unknown, init: ResponseInit = {}, origin?: string): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...corsHeaders(origin),
      ...init.headers,
    },
  })
}

function corsHeaders(origin?: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function allowedOrigins(env: WorkerEnv): Set<string> {
  const configured = env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean)
  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS)
}

function isAllowedOrigin(request: Request, env: WorkerEnv): string | undefined {
  const origin = request.headers.get('Origin') ?? ''
  if (!origin) return undefined
  return allowedOrigins(env).has(origin) ? origin : ''
}

function retentionSeconds(env: WorkerEnv): number {
  const configured = Number(env.LOG_RETENTION_DAYS)
  const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
  return Math.round(days * 24 * 60 * 60)
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim()
  return new URL(request.url).searchParams.get('token')?.trim() ?? ''
}

function isAuthorized(request: Request, env: WorkerEnv): boolean {
  return Boolean(env.READ_TOKEN) && bearerToken(request) === env.READ_TOKEN
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, 600) : undefined
}

function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'number' &&
    typeof record.sessionId === 'string' &&
    typeof record.timestamp === 'number' &&
    typeof record.isoTime === 'string' &&
    typeof record.elapsedMs === 'number' &&
    (record.level === 'info' || record.level === 'warn' || record.level === 'error') &&
    typeof record.category === 'string' &&
    typeof record.message === 'string'
  )
}

function normalizePayload(value: unknown): DiagnosticsPayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as DiagnosticsPayload
  if (payload.version !== 1 || !payload.session?.id || !Array.isArray(payload.entries)) return null
  const entries = payload.entries.filter(isDiagnosticEntry).slice(-MAX_BATCH_ENTRIES)
  if (entries.length === 0) return null
  return { ...payload, entries }
}

async function readJson(request: Request): Promise<DiagnosticsPayload | null> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    return normalizePayload(JSON.parse(text))
  } catch {
    return null
  }
}

function countLevels(entries: DiagnosticEntry[]): Record<DiagnosticLevel, number> {
  const counts: Record<DiagnosticLevel, number> = { info: 0, warn: 0, error: 0 }
  for (const entry of entries) counts[entry.level] += 1
  return counts
}

function addCounts(
  left: Record<DiagnosticLevel, number>,
  right: Record<DiagnosticLevel, number>,
): Record<DiagnosticLevel, number> {
  return {
    info: left.info + right.info,
    warn: left.warn + right.warn,
    error: left.error + right.error,
  }
}

async function loadSession(env: WorkerEnv, sessionId: string): Promise<SessionSummary | null> {
  const raw = await env.LOGS.get(`session:${sessionId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionSummary
  } catch {
    return null
  }
}

function sessionEnvironment(payload: DiagnosticsPayload): Record<string, unknown> {
  return payload.currentEnvironment ?? payload.session?.environment ?? {}
}

async function saveDiagnostics(request: Request, env: WorkerEnv, payload: DiagnosticsPayload): Promise<Response> {
  const origin = request.headers.get('Origin') ?? undefined
  const receivedAt = new Date().toISOString()
  const sessionId = payload.session?.id as string
  const batchId = crypto.randomUUID()
  const levelCounts = countLevels(payload.entries ?? [])
  const expirationTtl = retentionSeconds(env)
  const environment = sessionEnvironment(payload)
  const existing = await loadSession(env, sessionId)
  const previousCounts = existing?.levelCounts ?? { info: 0, warn: 0, error: 0 }
  const latestEntries = [...(existing?.latestEntries ?? []), ...(payload.entries ?? [])].slice(-MAX_LATEST_ENTRIES)
  const summary: SessionSummary = {
    sessionId,
    firstSeenAt: existing?.firstSeenAt ?? receivedAt,
    lastSeenAt: receivedAt,
    startedAt: safeString(payload.session?.startedAt),
    latestReason: safeString(payload.reason),
    latestOrigin: origin,
    latestUserAgent: safeString(environment.userAgent),
    latestHref: safeString(environment.href),
    entryCount: (existing?.entryCount ?? 0) + (payload.entries?.length ?? 0),
    batchCount: (existing?.batchCount ?? 0) + 1,
    levelCounts: addCounts(previousCounts, levelCounts),
    latestEntries,
  }
  const batch = {
    receivedAt,
    origin,
    request: {
      country: request.cf?.country ?? null,
      colo: request.cf?.colo ?? null,
    },
    payload,
  }

  await Promise.all([
    env.LOGS.put(`batch:${sessionId}:${Date.now()}:${batchId}`, JSON.stringify(batch), { expirationTtl }),
    env.LOGS.put(`session:${sessionId}`, JSON.stringify(summary), { expirationTtl }),
  ])

  return jsonResponse({ ok: true, sessionId, storedEntries: payload.entries?.length ?? 0 }, { status: 202 }, origin)
}

async function listSessions(env: WorkerEnv, limit: number): Promise<SessionSummary[]> {
  const listed = await env.LOGS.list({ prefix: 'session:', limit })
  const sessions = await Promise.all(listed.keys.map((key) => env.LOGS.get(key.name)))
  return sessions
    .flatMap((raw) => {
      if (!raw) return []
      try {
        return [JSON.parse(raw) as SessionSummary]
      } catch {
        return []
      }
    })
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
}

async function listBatches(env: WorkerEnv, sessionId: string, limit: number): Promise<unknown[]> {
  const listed = await env.LOGS.list({ prefix: `batch:${sessionId}:`, limit })
  const batches = await Promise.all(listed.keys.map((key) => env.LOGS.get(key.name)))
  return batches
    .flatMap((raw) => {
      if (!raw) return []
      try {
        return [JSON.parse(raw) as unknown]
      } catch {
        return []
      }
    })
    .reverse()
}

function numericLimit(request: Request, fallback: number, max: number): number {
  const value = Number(new URL(request.url).searchParams.get('limit') ?? fallback)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 1), max)
}

async function handleRead(request: Request, env: WorkerEnv): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  if (url.pathname === '/sessions') {
    return jsonResponse({ ok: true, sessions: await listSessions(env, numericLimit(request, 30, 100)) })
  }

  const batchMatch = url.pathname.match(/^\/sessions\/([^/]+)\/batches$/)
  if (batchMatch) {
    const sessionId = decodeURIComponent(batchMatch[1])
    return jsonResponse({
      ok: true,
      sessionId,
      batches: await listBatches(env, sessionId, numericLimit(request, 20, 100)),
    })
  }

  return jsonResponse({ ok: false, error: 'not_found' }, { status: 404 })
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const origin = isAllowedOrigin(request, env)
    if (origin === '') {
      return jsonResponse({ ok: false, error: 'origin_not_allowed' }, { status: 403 })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true }, undefined, origin)
    }

    if (request.method === 'POST' && url.pathname === '/collect') {
      const payload = await readJson(request)
      if (!payload) return jsonResponse({ ok: false, error: 'invalid_payload' }, { status: 400 }, origin)
      return saveDiagnostics(request, env, payload)
    }

    if (request.method === 'GET') return handleRead(request, env)

    return jsonResponse({ ok: false, error: 'method_not_allowed' }, { status: 405 }, origin)
  },
}
