import { useEffect, useMemo, useState } from 'react'
import { neonDiagnostics, type NeonDiagnosticEntry, type NeonDiagnosticsReport } from '../diagnostics/neonDiagnostics'
import './DiagnosticsPanel.css'

type CopyState = 'idle' | 'copied' | 'failed'

type PanelSnapshot = {
  report: NeonDiagnosticsReport
  text: string
}

const REFRESH_MS = 1500

const diagnosticsUiEnabled = (): boolean => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.has('logs') || params.get('debug') === 'logs' || params.get('debug') === 'diagnostics'
}

const createSnapshot = (): PanelSnapshot => ({
  report: neonDiagnostics.exportReport(),
  text: neonDiagnostics.exportText(),
})

const entryTime = (entry: NeonDiagnosticEntry): string =>
  new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function DiagnosticsPanel() {
  const enabled = useMemo(() => diagnosticsUiEnabled(), [])
  const [open, setOpen] = useState(true)
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(() => createSnapshot())
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (!enabled || !open) return undefined
    const refresh = () => setSnapshot(createSnapshot())
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [enabled, open])

  if (!enabled) return null

  const recentEntries = snapshot.report.entries.slice(-8).reverse()
  const { levelCounts, totalEntries, droppedEntries, storageAvailable } = snapshot.report.summary

  const handleCopy = async (): Promise<void> => {
    setCopyState('idle')
    const copied = await neonDiagnostics.copyToClipboard()
    setCopyState(copied ? 'copied' : 'failed')
    setSnapshot(createSnapshot())
  }

  const handleClear = (): void => {
    neonDiagnostics.clear()
    setCopyState('idle')
    setSnapshot(createSnapshot())
  }

  if (!open) {
    return (
      <button className="diagnostics-toggle" type="button" onClick={() => setOpen(true)}>
        LOGS {totalEntries}
      </button>
    )
  }

  return (
    <aside className="diagnostics-panel" aria-label="Neon Drift diagnostics logs">
      <header className="diagnostics-header">
        <div>
          <span>DIAGNOSTICS</span>
          <strong>{totalEntries} entries</strong>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide diagnostics panel">
          ×
        </button>
      </header>

      <div className="diagnostics-summary">
        <span>info {levelCounts.info}</span>
        <span>warn {levelCounts.warn}</span>
        <span>err {levelCounts.error}</span>
        <span>drop {droppedEntries}</span>
        <span>{storageAvailable ? 'persist OK' : 'no storage'}</span>
      </div>

      <div className="diagnostics-actions">
        <button type="button" onClick={() => void handleCopy()}>
          Copier
        </button>
        <button type="button" onClick={handleClear}>
          Effacer
        </button>
      </div>

      {copyState === 'copied' && <p className="diagnostics-status good">Rapport copié.</p>}
      {copyState === 'failed' && <p className="diagnostics-status warn">Copie bloquée : sélectionne le JSON ci-dessous.</p>}

      <div className="diagnostics-recent">
        <span>Récents</span>
        {recentEntries.length === 0 ? (
          <p>Aucun log pour l’instant.</p>
        ) : (
          recentEntries.map((entry) => (
            <div className={`diagnostics-entry ${entry.level}`} key={entry.id}>
              <span>{entryTime(entry)}</span>
              <strong>{entry.level}</strong>
              <em>{entry.category}</em>
              <p>{entry.message}</p>
            </div>
          ))
        )}
      </div>

      <textarea
        aria-label="Diagnostics JSON report"
        readOnly
        value={snapshot.text}
        onFocus={(event) => event.currentTarget.select()}
      />
    </aside>
  )
}
