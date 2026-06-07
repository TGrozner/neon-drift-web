import { getPlayer, type RaceState } from '../../shared/race'

type Props = {
  race: RaceState
  onRestart: () => void
  onMenu: () => void
}

const formatTime = (seconds: number): string => {
  if (seconds < 0) return '--:--'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

export function RaceOverlay({ race, onRestart, onMenu }: Props) {
  if (race.phase !== 'finished' && race.phase !== 'results') return null

  const player = getPlayer(race)
  const playerPosition = race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1
  const title = race.phase === 'finished' ? 'FINISH' : 'RESULTS'

  return (
    <div className="race-overlay" data-testid="race-results">
      <div className="results-panel">
        <div className="results-header">
          <span>{title}</span>
          <strong>POS {Math.max(1, playerPosition)}/{race.vehicles.length}</strong>
        </div>
        <div className="results-track">{race.track.name}</div>
        {race.phase === 'finished' && <div className="results-wait">Compiling final timings...</div>}
        {race.phase === 'results' && (
          <>
            <div className="results-summary">
              <span>TIME {formatTime(player.finishTime)}</span>
              <span>BEST LAP {formatTime(player.bestLapSeconds)}</span>
            </div>
            <div className="results-table">
              {race.standings.map((vehicle, index) => (
                <div className={vehicle.id === player.id ? 'result-row local' : 'result-row'} key={vehicle.id}>
                  <span>{index + 1}</span>
                  <span>{vehicle.name}</span>
                  <span>{vehicle.finished ? formatTime(vehicle.finishTime) : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`}</span>
                  <span>{vehicle.timePenalty > 0 ? `+${vehicle.timePenalty.toFixed(1)}` : '-'}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {race.phase === 'results' && (
          <div className="results-actions">
            <button type="button" onClick={onRestart}>RACE AGAIN</button>
            <button type="button" onClick={onMenu}>CHANGE TRACK</button>
          </div>
        )}
      </div>
    </div>
  )
}
