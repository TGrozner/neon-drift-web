import { getPlayer, type RaceState } from '../../shared/race'
import { formatRaceTime, runAssessment, statCardsFor } from './raceStatsView'

type Props = {
  race: RaceState
  onRestart: () => void
  onMenu: () => void
}

export function RaceOverlay({ race, onRestart, onMenu }: Props) {
  if (race.phase !== 'finished' && race.phase !== 'results') return null

  const player = getPlayer(race)
  const playerEliminated = player.eliminated
  const playerPosition = race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1
  const title = playerEliminated ? 'CRASH OUT' : race.phase === 'finished' ? 'FINISH' : 'RESULTS'
  const statCards = statCardsFor(race.runStats)
  const assessment = runAssessment(race.runStats, playerEliminated)

  return (
    <div className="race-overlay" data-testid="race-results">
      <div className="results-panel">
        <div className="results-header">
          <span>{title}</span>
          <strong>POS {Math.max(1, playerPosition)}/{race.vehicles.length}</strong>
        </div>
        <div className="results-track">{race.track.name}</div>
        {race.phase === 'finished' && (
          <div className="results-wait">
            {playerEliminated ? 'Run terminated.' : 'Compiling final timings...'}
          </div>
        )}
        {race.phase === 'results' && (
          <>
            <div className="results-summary">
              <span>{playerEliminated ? 'STATUS OUT' : `TIME ${formatRaceTime(player.finishTime)}`}</span>
              <span>BEST LAP {formatRaceTime(player.bestLapSeconds)}</span>
            </div>
            <div className="results-analysis" data-testid="run-analysis">
              {statCards.map((card) => (
                <div className={card.tone ? `analysis-card ${card.tone}` : 'analysis-card'} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
            <div className="results-assessment">{assessment}</div>
            <div className="results-table">
              {race.standings.map((vehicle, index) => (
                <div className={vehicle.id === player.id ? 'result-row local' : 'result-row'} key={vehicle.id}>
                  <span>{index + 1}</span>
                  <span>{vehicle.name}</span>
                  <span>{vehicle.eliminated ? 'OUT' : vehicle.finished ? formatRaceTime(vehicle.finishTime) : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`}</span>
                  <span>{vehicle.timePenalty > 0 ? `+${vehicle.timePenalty.toFixed(1)}` : '-'}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {race.phase === 'results' && (
          <div className="results-actions">
            <button type="button" onClick={onRestart} data-testid="retry-race">RETRY NOW</button>
            <button type="button" onClick={onMenu}>SETUP</button>
          </div>
        )}
      </div>
    </div>
  )
}
