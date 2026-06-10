export type DiagnosticLevel = 'info' | 'warn' | 'error'
export type DiagnosticPayload = Record<string, unknown>

export type NeonDiagnosticEntry = {
  id: number
  sessionId: string
  timestamp: number
  isoTime: string
  elapsedMs: number
  level: DiagnosticLevel
  category: string
  message: string
  payload?: DiagnosticPayload
}

export type NeonDiagnosticsSession = {
  id: string
  startedAt: string
  startedAtMs: number
  environment: DiagnosticPayload
}

export type NeonDiagnosticsReport = {
  version: 1
  generatedAt: string
  session: NeonDiagnosticsSession
  currentEnvironment: DiagnosticPayload
  entries: NeonDiagnosticEntry[]
  summary: {
    totalEntries: number
    levelCounts: Record<DiagnosticLevel, number>
    droppedEntries: number
    storageAvailable: boolean
    maxEntries: number
  }
}

type StoredDiagnostics = {
  version: 1
  savedAt: string
  droppedEntries: number
  entries: NeonDiagnosticEntry[]
}

type DiagnosticsWindow = Window & typeof globalThis & {
  __NEON_DIAGNOSTICS__?: NeonDiagnosticsApi
}

type NeonDiagnosticsApi = {
  log: (category: string, message: string, payload?: DiagnosticPayload) => void
  warn: (category: string, message: string, payload?: DiagnosticPayload) => void
  error: (category: string, message: string, payload?: DiagnosticPayload) => void
  getEntries: () => NeonDiagnosticEntry[]
  exportReport: () => NeonDiagnosticsReport
  exportText: () => string
  copyToClipboard: () => Promise<boolean>
  clear: () => void
  flushRemote: () => Promise<boolean>
}

type ConnectionSource = {
  effectiveType?: string
  rtt?: number
  downlink?: number
  saveData?: boolean
}

type NavigatorWithDiagnostics = Navigator & {
  connection?: ConnectionSource
  deviceMemory?: number
  standalone?: boolean
}

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit?: number
    totalJSHeapSize?: number
    usedJSHeapSize?: number
  }
}

type FrameWindow = {
  startedAtMs: number
  count: number
  totalMs: number
  maxMs: number
  slowFrames: number
  verySlowFrames: number
}

export const NEON_DIAGNOSTICS_STORAGE_KEY = 'neon-drift:diagnostics:v1'

const STORAGE_PROBE_KEY = 'neon-drift:diagnostics-probe'
const UPLOAD_CURSOR_KEY = 'neon-drift:diagnostics-upload-cursor'
const MAX_ENTRIES = 600
const MAX_UPLOAD_ENTRIES = 120
const MAX_PAYLOAD_DEPTH = 3
const MAX_PAYLOAD_KEYS = 18
const MAX_STRING_LENGTH = 420
const PERSIST_DEBOUNCE_MS = 1200
const UPLOAD_DEBOUNCE_MS = 15_000
const FRAME_WINDOW_MS = 10_000
const SLOW_FRAME_MS = 50
const VERY_SLOW_FRAME_MS = 120
const SLOW_FRAME_LOG_COOLDOWN_MS = 5_000

let loaded = false
let installed = false
let storageAvailable: boolean | null = null
let persistTimer: number | null = null
let uploadTimer: number | null = null
let uploadInFlight = false
let uploadCursorLoaded = false
let lastUploadedEntryId = 0
let entries: NeonDiagnosticEntry[] = []
let droppedEntries = 0
let nextEntryId = 1
let lastSlowFrameLogAt = 0
let frameWindow: FrameWindow = createFrameWindow(nowMs())

const session: NeonDiagnosticsSession = {
  id: createSessionId(),
  startedAt: new Date().toISOString(),
  startedAtMs: nowMs(),
  environment: captureEnvironment(),
}

function createSessionId(): string {
  const randomId = crypto.randomUUID?.()
  if (randomId) return randomId
  return `nd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function canUseBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function diagnosticsEndpoint(): string {
  return (import.meta.env.VITE_DIAGNOSTICS_ENDPOINT ?? '').trim()
}

function matchesMedia(query: string): boolean {
  if (!canUseBrowser() || typeof window.matchMedia !== 'function') return false

  try {
    return window.matchMedia(query).matches === true
  } catch {
    return false
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function createFrameWindow(startedAtMs: number): FrameWindow {
  return {
    startedAtMs,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    slowFrames: 0,
    verySlowFrames: 0,
  }
}

function getStorage(): Storage | null {
  if (!canUseBrowser()) return null
  if (storageAvailable === false) return null

  try {
    const storage = window.localStorage
    if (storageAvailable === null) {
      storage.setItem(STORAGE_PROBE_KEY, '1')
      storage.removeItem(STORAGE_PROBE_KEY)
      storageAvailable = true
    }
    return storage
  } catch {
    storageAvailable = false
    return null
  }
}

function loadUploadCursor(): void {
  if (uploadCursorLoaded) return
  uploadCursorLoaded = true
  const storage = getStorage()
  if (!storage) return
  const stored = Number(storage.getItem(UPLOAD_CURSOR_KEY) ?? 0)
  lastUploadedEntryId = Number.isFinite(stored) ? stored : 0
}

function storeUploadCursor(entryId: number): void {
  lastUploadedEntryId = Math.max(lastUploadedEntryId, entryId)
  const storage = getStorage()
  try {
    storage?.setItem(UPLOAD_CURSOR_KEY, String(lastUploadedEntryId))
  } catch {
    storageAvailable = false
  }
}

function loadStoredEntries(): void {
  if (loaded) return
  loaded = true

  const storage = getStorage()
  if (!storage) return

  try {
    const raw = storage.getItem(NEON_DIAGNOSTICS_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<StoredDiagnostics>
    const storedEntries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(isDiagnosticEntry)
      : []
    entries = storedEntries.slice(-MAX_ENTRIES)
    droppedEntries = Number.isFinite(parsed.droppedEntries) ? Number(parsed.droppedEntries) : 0
    nextEntryId = entries.reduce((maxId, entry) => Math.max(maxId, entry.id), 0) + 1
  } catch {
    entries = []
    droppedEntries = 0
    nextEntryId = 1
  }
}

function isDiagnosticEntry(value: unknown): value is NeonDiagnosticEntry {
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

function persistNow(): void {
  if (persistTimer !== null && canUseBrowser()) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }

  const storage = getStorage()
  if (!storage) return

  const stored: StoredDiagnostics = {
    version: 1,
    savedAt: new Date().toISOString(),
    droppedEntries,
    entries,
  }

  try {
    storage.setItem(NEON_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    storageAvailable = false
  }
}

function schedulePersist(immediate = false): void {
  if (!getStorage()) return
  if (immediate || !canUseBrowser()) {
    persistNow()
    return
  }
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => persistNow(), PERSIST_DEBOUNCE_MS)
}

function pendingUploadEntries(): NeonDiagnosticEntry[] {
  loadStoredEntries()
  loadUploadCursor()
  return entries.filter((entry) => entry.id > lastUploadedEntryId).slice(-MAX_UPLOAD_ENTRIES)
}

function uploadPayload(reason: string, uploadEntries: NeonDiagnosticEntry[]): string {
  return JSON.stringify({
    version: 1,
    reason,
    generatedAt: new Date().toISOString(),
    session,
    currentEnvironment: captureEnvironment(),
    entries: uploadEntries,
    summary: {
      totalEntries: entries.length,
      uploadedEntries: uploadEntries.length,
      levelCounts: levelCountsFor(entries),
      droppedEntries,
      storageAvailable: getStorage() !== null,
      maxEntries: MAX_ENTRIES,
    },
  })
}

async function uploadNow(reason = 'scheduled', preferBeacon = false): Promise<boolean> {
  if (uploadInFlight || !canUseBrowser()) return false
  const endpoint = diagnosticsEndpoint()
  if (!endpoint) return false
  const uploadEntries = pendingUploadEntries()
  if (uploadEntries.length === 0) return true

  const maxEntryId = uploadEntries[uploadEntries.length - 1]?.id ?? lastUploadedEntryId
  const body = uploadPayload(reason, uploadEntries)

  if (preferBeacon && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
    if (sent) storeUploadCursor(maxEntryId)
    return sent
  }

  uploadInFlight = true
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: reason === 'pagehide' || reason === 'visibility_hidden',
    })
    if (!response.ok) return false
    storeUploadCursor(maxEntryId)
    return true
  } catch {
    return false
  } finally {
    uploadInFlight = false
  }
}

function scheduleUpload(immediate = false): void {
  if (!diagnosticsEndpoint() || !canUseBrowser()) return
  if (immediate) {
    if (uploadTimer !== null) {
      window.clearTimeout(uploadTimer)
      uploadTimer = null
    }
    void uploadNow('immediate')
    return
  }
  if (uploadTimer !== null) return
  uploadTimer = window.setTimeout(() => {
    uploadTimer = null
    void uploadNow('scheduled')
  }, UPLOAD_DEBOUNCE_MS)
}

function trimEntries(): void {
  if (entries.length <= MAX_ENTRIES) return
  const overflow = entries.length - MAX_ENTRIES
  entries.splice(0, overflow)
  droppedEntries += overflow
}

function pushEntry(entry: NeonDiagnosticEntry): void {
  loadStoredEntries()
  entries.push(entry)
  trimEntries()
  schedulePersist(entry.level !== 'info')
  scheduleUpload(entry.level !== 'info')
}

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Error) return formatDiagnosticError(value)
  if (Array.isArray(value)) {
    if (depth >= MAX_PAYLOAD_DEPTH) return `[Array(${value.length})]`
    return value.slice(0, 12).map((item) => sanitizeValue(item, depth + 1))
  }
  if (typeof value !== 'object') return String(value)
  if (depth >= MAX_PAYLOAD_DEPTH) return '[Object]'

  try {
    const result: DiagnosticPayload = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, MAX_PAYLOAD_KEYS)) {
      result[key] = sanitizeValue(nestedValue, depth + 1)
    }
    return result
  } catch {
    return '[Unserializable object]'
  }
}

function sanitizePayload(payload?: DiagnosticPayload): DiagnosticPayload | undefined {
  if (!payload) return undefined
  const result: DiagnosticPayload = {}
  for (const [key, value] of Object.entries(payload)) {
    result[key] = sanitizeValue(value)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function formatDiagnosticError(error: unknown): DiagnosticPayload {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
      stack: error.stack ? sanitizeString(error.stack) : undefined,
    }
  }
  return { value: sanitizeValue(error) }
}

function captureEnvironment(): DiagnosticPayload {
  if (!canUseBrowser()) return { browser: false }

  const nav = window.navigator as NavigatorWithDiagnostics
  const perf = window.performance as PerformanceWithMemory
  const screenInfo = window.screen
  const connection = nav.connection
  const visualViewport = window.visualViewport

  return {
    browser: true,
    baseUrl: import.meta.env.BASE_URL,
    href: window.location.href,
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    maxTouchPoints: nav.maxTouchPoints,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      visualWidth: visualViewport?.width ?? null,
      visualHeight: visualViewport?.height ?? null,
      orientation: screenInfo.orientation?.type ?? null,
    },
    screen: screenInfo
      ? {
          width: screenInfo.width,
          height: screenInfo.height,
          availWidth: screenInfo.availWidth,
          availHeight: screenInfo.availHeight,
        }
      : null,
    connection: connection
      ? {
          effectiveType: connection.effectiveType ?? null,
          rtt: connection.rtt ?? null,
          downlink: connection.downlink ?? null,
          saveData: connection.saveData ?? null,
        }
      : null,
    memory: perf.memory
      ? {
          jsHeapSizeLimit: perf.memory.jsHeapSizeLimit ?? null,
          totalJSHeapSize: perf.memory.totalJSHeapSize ?? null,
          usedJSHeapSize: perf.memory.usedJSHeapSize ?? null,
        }
      : null,
    visibilityState: document.visibilityState,
    standalone: Boolean(nav.standalone) || matchesMedia('(display-mode: standalone)'),
    localStorageAvailable: getStorage() !== null,
  }
}

function createEntry(
  level: DiagnosticLevel,
  category: string,
  message: string,
  payload?: DiagnosticPayload,
): NeonDiagnosticEntry {
  const timestamp = Date.now()
  return {
    id: nextEntryId,
    sessionId: session.id,
    timestamp,
    isoTime: new Date(timestamp).toISOString(),
    elapsedMs: Math.round(nowMs() - session.startedAtMs),
    level,
    category,
    message,
    payload: sanitizePayload(payload),
  }
}

function log(level: DiagnosticLevel, category: string, message: string, payload?: DiagnosticPayload): void {
  loadStoredEntries()
  const entry = createEntry(level, category, message, payload)
  nextEntryId += 1
  pushEntry(entry)
}

function installGlobalHandlers(): void {
  if (!canUseBrowser()) return

  window.addEventListener('error', (event) => {
    log('error', 'runtime', 'window_error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: formatDiagnosticError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    log('error', 'runtime', 'unhandled_rejection', {
      reason: formatDiagnosticError(event.reason),
    })
  })

  document.addEventListener('visibilitychange', () => {
    log('info', 'lifecycle', 'visibility_change', {
      visibilityState: document.visibilityState,
    })
    if (document.visibilityState === 'hidden') {
      persistNow()
      void uploadNow('visibility_hidden', true)
    }
  })

  window.addEventListener('pagehide', (event) => {
    log('info', 'lifecycle', 'pagehide', {
      persisted: event.persisted,
      visibilityState: document.visibilityState,
    })
    persistNow()
    void uploadNow('pagehide', true)
  })

  window.addEventListener('pageshow', (event) => {
    log('info', 'lifecycle', 'pageshow', {
      persisted: event.persisted,
      visibilityState: document.visibilityState,
    })
  })
}

function exposeWindowApi(): void {
  if (!canUseBrowser()) return
  const diagnosticsWindow = window as DiagnosticsWindow
  diagnosticsWindow.__NEON_DIAGNOSTICS__ = neonDiagnostics
}

export function installNeonDiagnostics(): void {
  loadStoredEntries()
  exposeWindowApi()
  if (installed) return
  installed = true
  installGlobalHandlers()
  log('info', 'diagnostics', 'session_start', {
    sessionId: session.id,
    environment: session.environment,
  })
}

function levelCountsFor(entriesToCount: NeonDiagnosticEntry[]): Record<DiagnosticLevel, number> {
  const counts: Record<DiagnosticLevel, number> = { info: 0, warn: 0, error: 0 }
  for (const entry of entriesToCount) counts[entry.level] += 1
  return counts
}

function exportReport(): NeonDiagnosticsReport {
  loadStoredEntries()
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    session,
    currentEnvironment: captureEnvironment(),
    entries: [...entries],
    summary: {
      totalEntries: entries.length,
      levelCounts: levelCountsFor(entries),
      droppedEntries,
      storageAvailable: getStorage() !== null,
      maxEntries: MAX_ENTRIES,
    },
  }
}

function exportText(): string {
  return JSON.stringify(exportReport(), null, 2)
}

async function copyToClipboard(): Promise<boolean> {
  if (!canUseBrowser() || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(exportText())
    log('info', 'diagnostics', 'report_copied')
    return true
  } catch (error) {
    log('warn', 'diagnostics', 'report_copy_failed', {
      error: formatDiagnosticError(error),
    })
    return false
  }
}

function clear(): void {
  entries = []
  droppedEntries = 0
  nextEntryId = 1
  lastUploadedEntryId = 0
  uploadCursorLoaded = true
  if (uploadTimer !== null && canUseBrowser()) {
    window.clearTimeout(uploadTimer)
    uploadTimer = null
  }
  const storage = getStorage()
  try {
    storage?.removeItem(NEON_DIAGNOSTICS_STORAGE_KEY)
    storage?.removeItem(UPLOAD_CURSOR_KEY)
  } catch {
    storageAvailable = false
  }
}

function forceFlush(): void {
  persistNow()
}

export function summarizeRenderStats(renderStats: unknown): DiagnosticPayload {
  if (!renderStats || typeof renderStats !== 'object') return {}
  const record = renderStats as Record<string, unknown>
  const keys = [
    'calls',
    'triangles',
    'sourceShipCount',
    'bloomStrength',
    'toneMappingExposure',
    'sourceTrackKitLoaded',
    'trackEnvironmentInstances',
    'cameraFov',
    'cameraFrameDot',
    'renderedSlipstreamSegmentCount',
    'rivalDraftWakeCount',
    'boostLightningSegmentCount',
  ]
  const summary: DiagnosticPayload = {}
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      summary[key] = value
    }
  }
  return summary
}

function recordFrame(frameMs: number, context?: DiagnosticPayload): void {
  if (!Number.isFinite(frameMs) || frameMs <= 0) return

  const currentTime = nowMs()
  frameWindow.count += 1
  frameWindow.totalMs += frameMs
  frameWindow.maxMs = Math.max(frameWindow.maxMs, frameMs)
  if (frameMs >= SLOW_FRAME_MS) frameWindow.slowFrames += 1
  if (frameMs >= VERY_SLOW_FRAME_MS) frameWindow.verySlowFrames += 1

  if (frameMs >= SLOW_FRAME_MS && currentTime - lastSlowFrameLogAt >= SLOW_FRAME_LOG_COOLDOWN_MS) {
    lastSlowFrameLogAt = currentTime
    log(frameMs >= VERY_SLOW_FRAME_MS ? 'warn' : 'info', 'performance', frameMs >= VERY_SLOW_FRAME_MS ? 'very_slow_frame' : 'slow_frame', {
      frameMs: Math.round(frameMs),
      ...context,
    })
  }

  if (currentTime - frameWindow.startedAtMs < FRAME_WINDOW_MS || frameWindow.count === 0) return

  const averageFrameMs = frameWindow.totalMs / frameWindow.count
  log(frameWindow.slowFrames > 0 ? 'warn' : 'info', 'performance', 'frame_window', {
    durationMs: Math.round(currentTime - frameWindow.startedAtMs),
    frameCount: frameWindow.count,
    averageFrameMs: Math.round(averageFrameMs * 10) / 10,
    estimatedFps: Math.round((1000 / averageFrameMs) * 10) / 10,
    maxFrameMs: Math.round(frameWindow.maxMs),
    slowFrames: frameWindow.slowFrames,
    verySlowFrames: frameWindow.verySlowFrames,
    ...context,
  })
  frameWindow = createFrameWindow(currentTime)
}

export const neonDiagnostics = {
  log: (category: string, message: string, payload?: DiagnosticPayload) => log('info', category, message, payload),
  warn: (category: string, message: string, payload?: DiagnosticPayload) => log('warn', category, message, payload),
  error: (category: string, message: string, payload?: DiagnosticPayload) => log('error', category, message, payload),
  getEntries: (): NeonDiagnosticEntry[] => {
    loadStoredEntries()
    return [...entries]
  },
  exportReport,
  exportText,
  copyToClipboard,
  clear,
  flushRemote: () => uploadNow('manual'),
  forceFlush,
  recordFrame,
  formatError: formatDiagnosticError,
}
