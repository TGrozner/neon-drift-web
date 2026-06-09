import { beforeEach, describe, expect, it } from 'vitest'
import { installNeonDiagnostics, NEON_DIAGNOSTICS_STORAGE_KEY, neonDiagnostics } from '../src/diagnostics/neonDiagnostics'

describe('neon diagnostics', () => {
  beforeEach(() => {
    localStorage.clear()
    neonDiagnostics.clear()
  })

  it('persists diagnostic entries and exports a readable report', () => {
    installNeonDiagnostics()
    neonDiagnostics.log('mobile', 'manual_perf_report', { track: 'tutorial-circuit', fps: 42 })
    neonDiagnostics.forceFlush()

    const stored = localStorage.getItem(NEON_DIAGNOSTICS_STORAGE_KEY)
    expect(stored).toContain('manual_perf_report')

    const report = neonDiagnostics.exportReport()
    expect(report.summary.totalEntries).toBeGreaterThan(0)
    expect(report.entries.some((entry) => entry.message === 'manual_perf_report')).toBe(true)
    expect(neonDiagnostics.exportText()).toContain('tutorial-circuit')
  })

  it('summarizes renderer stats for compact frame diagnostics', () => {
    const summary = neonDiagnostics.exportReport().summary
    expect(summary.maxEntries).toBeGreaterThan(100)
    expect(summary.storageAvailable).toBe(true)
  })
})
