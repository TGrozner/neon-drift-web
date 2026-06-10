import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installNeonDiagnostics,
  NEON_DIAGNOSTICS_STORAGE_KEY,
  neonDiagnostics,
  summarizeRenderStats,
} from '../src/diagnostics/neonDiagnostics'

describe('neon diagnostics', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    neonDiagnostics.clear()
  })

  it('persists diagnostic entries and exports a readable report', () => {
    installNeonDiagnostics()
    neonDiagnostics.log('mobile', 'manual_perf_report', { track: 'tutorial-circuit', fps: 42 })
    neonDiagnostics.forceFlush()

    const stored = window.localStorage.getItem(NEON_DIAGNOSTICS_STORAGE_KEY)
    expect(stored).toContain('manual_perf_report')

    const report = neonDiagnostics.exportReport()
    expect(report.summary.totalEntries).toBeGreaterThan(0)
    expect(report.entries.some((entry) => entry.message === 'manual_perf_report')).toBe(true)
    expect(neonDiagnostics.exportText()).toContain('tutorial-circuit')
  })

  it('captures diagnostics when matchMedia is unavailable', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    })

    try {
      expect(() => installNeonDiagnostics()).not.toThrow()
      expect(neonDiagnostics.exportReport().currentEnvironment.standalone).toBe(false)
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      })
    }
  })

  it('captures diagnostics when matchMedia throws', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => {
        throw new Error('media query unavailable')
      },
    })

    try {
      expect(() => installNeonDiagnostics()).not.toThrow()
      expect(neonDiagnostics.exportReport().currentEnvironment.standalone).toBe(false)
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      })
    }
  })

  it('summarizes renderer stats for compact frame diagnostics', () => {
    const summary = summarizeRenderStats({
      calls: 12,
      triangles: 12345,
      sourceTrackKitLoaded: true,
      ignoredNested: { tooMuch: true },
    })

    expect(summary.calls).toBe(12)
    expect(summary.triangles).toBe(12345)
    expect(summary.sourceTrackKitLoaded).toBe(true)
    expect(summary.ignoredNested).toBeUndefined()
  })

  it('silently uploads pending diagnostics when an endpoint is configured', async () => {
    vi.stubEnv('VITE_DIAGNOSTICS_ENDPOINT', 'https://logs.example.test/collect')
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)

    neonDiagnostics.log('mobile', 'manual_perf_report', { track: 'tutorial-circuit', fps: 42 })
    await expect(neonDiagnostics.flushRemote()).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith(
      'https://logs.example.test/collect',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('manual_perf_report'),
      }),
    )
  })
})
