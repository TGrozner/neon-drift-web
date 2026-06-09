import type { RaceState } from '../../shared/race'
import { getPlayer } from '../../shared/race'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export type DiagnosticEntry = {
  id: number
  at: string
  ageMs: number
  level: DiagnosticLevel
  kind: string
  message: string
  data?: Record<string, unknown>
}

export type DiagnosticsExport = {
  exportedAt: string
  sessionId: string
  device: Record<string, unknown>
  entries: DiagnosticEntry[]
}

type DiagnosticsWindow = Window & typeof globalThis & {
  __NEON_DIAGNOSTICS__?: {
    add: typeof addDiagnosticLog
    clear: typeof clearDiagnosticLogs
    export: typeof exportDiagnosticLogs
    get: typeof getDiagnosticLogs
    text: typeof diagnosticsText
  }
  __NEON_RENDER_STATS?: Record<string, unknown>
}

type NetworkInformationLike = {
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
}

type NavigatorWithHints = Navigator & {
  deviceMemory?: number
  connection?: NetworkInformationLike
  mozConnection?: NetworkInformationLike
  webkitConnection?: NetworkInformationLike
}

const STORAGE_KEY = 'neon-drift:persistent-diagnostics:v1'
const SESSION_KEY = 'neon-drift:diagnostics-session:v1'
const MAX_ENTRIES = 180
const startedAt = performance.now()
let nextId = 1
let installed = false
let lastPerfLogAt = 0
let perfWindowStartedAt = 0
let perfFrames = 0
let perfSlowFrames = 0
let perfVerySlowFrames = 0
let perfWorstFrameMs = 0

const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const nowIso = (): string => new Date().toISOString()

export const getDiagnosticsSessionId = (): string => {
  const existing = window.localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const generated = `neon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  window.localStorage.setItem(SESSION_KEY, generated)
  return generated
}

export const getDiagnosticLogs = (): DiagnosticEntry[] =>
  safeJsonParse<DiagnosticEntry[]>(window.localStorage.getItem(STORAGE_KEY), [])

const saveDiagnosticLogs = (entries: DiagnosticEntry[]): void => {
  const trimmed = entries.slice(-MAX_ENTRIES)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

const normalizeError = (value: unknown): Record<string, unknown> => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  return { value: String(value) }
}

export const deviceSnapshot = (): Record<string, unknown> => {
  const nav = navigator as NavigatorWithHints
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection
  return {
    sessionId: getDiagnosticsSessionId(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    online: navigator.onLine,
    visibilityState: document.visibilityState,
    connection: connection
      ? {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
        }
      : null,
  }
}

export const raceSnapshot = (race: RaceState): Record<string, unknown> => {
  const player = getPlayer(race)
  return {
    phase: race.phase,
    trackId: race.track.id,
    raceTime: Number(race.raceTime.toFixed(2)),
    vehicleCount: race.vehicles.length,
    player: {
      speed: Number(player.forwardSpeed.toFixed(2)),
      power: Number(player.power.toFixed(3)),
      integrity: Number(player.integrity.toFixed(3)),
      lap: player.lap,
      gate: player.nextGateIndex,
      crashOutCount: player.crashOutCount,
      position: race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1,
      offTrack: player.telemetry.offTrack,
      wrongWay: player.telemetry.wrongWay,
    },
  }
}

export const addDiagnosticLog = (
  level: DiagnosticLevel,
  kind: string,
  message: string,
  data?: Record<string, unknown>,
): void => {
  const entry: DiagnosticEntry = {
    id: nextId,
    at: nowIso(),
    ageMs: Math.round(performance.now() - startedAt),
    level,
    kind,
    message,
    data,
  }
  nextId += 1
  saveDiagnosticLogs([...getDiagnosticLogs(), entry])
}

export const clearDiagnosticLogs = (): void => {
  window.localStorage.removeItem(STORAGE_KEY)
  addDiagnosticLog('info', 'diagnostics.clear', 'Diagnostics log cleared')
}

export const exportDiagnosticLogs = (): DiagnosticsExport => ({
  exportedAt: nowIso(),
  sessionId: getDiagnosticsSessionId(),
  device: deviceSnapshot(),
  entries: getDiagnosticLogs(),
})

export const diagnosticsText = (): string => JSON.stringify(exportDiagnosticLogs(), null, 2)

export const copyDiagnosticsToClipboard = async (): Promise<boolean> => {
  const text = diagnosticsText()
  if (!navigator.clipboard) return false
  await navigator.clipboard.writeText(text)
  return true
}

export const shareDiagnostics = async (): Promise<'shared' | 'copied' | 'downloaded'> => {
  const text = diagnosticsText()
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  const file = new File([text], `neon-drift-diagnostics-${Date.now()}.json`, {
    type: 'application/json',
  })
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({
      title: 'Neon Drift diagnostics',
      text: 'Neon Drift mobile diagnostics log',
      files: [file],
    })
    return 'shared'
  }
  if (await copyDiagnosticsToClipboard()) return 'copied'

  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

export const installGlobalDiagnostics = (): void => {
  if (installed) return
  installed = true
  const diagnosticsWindow = window as DiagnosticsWindow
  diagnosticsWindow.__NEON_DIAGNOSTICS__ = {
    add: addDiagnosticLog,
    clear: clearDiagnosticLogs,
    export: exportDiagnosticLogs,
    get: getDiagnosticLogs,
    text: diagnosticsText,
  }

  addDiagnosticLog('info', 'session.start', 'Neon Drift session started', deviceSnapshot())

  window.addEventListener('error', (event) => {
    addDiagnosticLog('error', 'window.error', event.message || 'Unhandled window error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: normalizeError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    addDiagnosticLog('error', 'promise.unhandledRejection', 'Unhandled promise rejection', {
      reason: normalizeError(event.reason),
    })
  })

  window.addEventListener('online', () => {
    addDiagnosticLog('info', 'network.online', 'Browser went online', deviceSnapshot())
  })

  window.addEventListener('offline', () => {
    addDiagnosticLog('warn', 'network.offline', 'Browser went offline', deviceSnapshot())
  })

  document.addEventListener('visibilitychange', () => {
    addDiagnosticLog('info', 'page.visibility', `Visibility changed to ${document.visibilityState}`, deviceSnapshot())
  })

  window.addEventListener('pagehide', () => {
    addDiagnosticLog('info', 'page.hide', 'Page hidden/unloaded', deviceSnapshot())
  })
}

export const logRaceEvent = (kind: string, message: string, race: RaceState): void => {
  addDiagnosticLog('info', kind, message, raceSnapshot(race))
}

export const logRenderFrame = (time: number, frameMs: number, race: RaceState): void => {
  perfFrames += 1
  if (frameMs > 34) perfSlowFrames += 1
  if (frameMs > 50) perfVerySlowFrames += 1
  perfWorstFrameMs = Math.max(perfWorstFrameMs, frameMs)

  if (perfWindowStartedAt <= 0) perfWindowStartedAt = time
  const elapsed = time - perfWindowStartedAt
  const shouldFlush = elapsed >= 5000
  if (!shouldFlush) return

  const fps = perfFrames / Math.max(0.001, elapsed / 1000)
  const shouldPersist = fps < 50 || perfSlowFrames > 10 || perfVerySlowFrames > 0 || time - lastPerfLogAt > 30000
  if (shouldPersist) {
    const diagnosticsWindow = window as DiagnosticsWindow
    addDiagnosticLog(fps < 45 || perfVerySlowFrames > 2 ? 'warn' : 'info', 'render.performance', 'Render performance window', {
      fps: Number(fps.toFixed(1)),
      frames: perfFrames,
      slowFrames: perfSlowFrames,
      verySlowFrames: perfVerySlowFrames,
      worstFrameMs: Number(perfWorstFrameMs.toFixed(1)),
      renderStats: diagnosticsWindow.__NEON_RENDER_STATS__ ?? null,
      race: raceSnapshot(race),
      device: deviceSnapshot(),
    })
    lastPerfLogAt = time
  }

  perfWindowStartedAt = time
  perfFrames = 0
  perfSlowFrames = 0
  perfVerySlowFrames = 0
  perfWorstFrameMs = 0
}
