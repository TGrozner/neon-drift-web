import { useMemo } from 'react'
import { getPlayer, type RaceState } from '../../shared/race'
import { averageSpeed, cleanLineRatio, formatSpeedKmh } from './raceStatsView'

type Props = {
  race: RaceState
}

const telemetryDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('debug') === 'telemetry' || params.has('telemetry')
}

export function TelemetryCockpit({ race }: Props) {
  const enabled = useMemo(() => telemetryDebugEnabled(), [])
  if (!enabled || race.phase === 'menu') return null

  const player = getPlayer(race)
  const stats = race.runStats
  const cleanLine = cleanLineRatio(stats)
  const rows = [
    ['RUN', `${race.raceTime.toFixed(1)}s`],
    ['AVG', `${formatSpeedKmh(averageSpeed(stats))} km/h`],
    ['MAX', `${formatSpeedKmh(stats.maxSpeed)} km/h`],
    ['BOOST', `${stats.boostStarts} / ${stats.boostSeconds.toFixed(1)}s`],
    ['DRIFT', `${stats.airbrakeExits} exits`],
    ['CONTACT', `${stats.contactCount} / ${stats.contactSeconds.toFixed(1)}s`],
    ['DAMAGE', `${Math.round(stats.integrityDamageTaken * 100)}%`],
    ['CLEAN', `${Math.round(cleanLine * 100)}%`],
    ['OFF', `${stats.offTrackSeconds.toFixed(1)}s`],
    ['DRAFT', `${stats.draftSeconds.toFixed(1)}s`],
    ['POWER', `${Math.round(player.power * 100)}%`],
    ['HULL', `${Math.round(player.integrity * 100)}%`],
  ]

  return (
    <aside className="telemetry-cockpit" data-testid="telemetry-cockpit">
      <div className="telemetry-title">
        <span>RUN TELEMETRY</span>
        <strong>{race.track.name}</strong>
      </div>
      <div className="telemetry-grid">
        {rows.map(([label, value]) => (
          <div className="telemetry-cell" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </aside>
  )
}
