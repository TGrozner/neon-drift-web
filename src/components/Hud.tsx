import { CRASH_OUT, RACE, SHIP_PROFILES } from '../../shared/constants'
import { gapToNext, getPlayer, type RaceState } from '../../shared/race'

type Props = {
  race: RaceState
}

const formatTime = (seconds: number): string => {
  if (seconds < 0) return '--:--'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

const formatSpeed = (speed: number): string => `${Math.round(speed * 3.6).toString().padStart(3, '0')}`

export function Hud({ race }: Props) {
  const player = getPlayer(race)
  const profile = SHIP_PROFILES[player.profileId]
  const speedRatio = Math.min(1, player.forwardSpeed / Math.max(1, profile.boostSpeed))
  const powerPct = `${Math.round(player.power * 100)}%`
  const localPosition = Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1)
  const nextGateDistance = gapToNext(race, player)
  const raceTime = race.phase === 'racing' || race.phase === 'finished' || race.phase === 'results'
    ? race.raceTime + player.timePenalty
    : 0

  return (
    <div className="hud" data-testid="hud">
      <div className="hud-panel hud-speed">
        <div className="hud-label">SPEED</div>
        <div className="speed-readout">{formatSpeed(player.forwardSpeed)}</div>
        <div className="unit">km/h</div>
        <div className="meter">
          <span style={{ width: `${speedRatio * 100}%` }} />
        </div>
        <div className="power-row">
          <span className={player.telemetry.powerCritical ? 'warning' : ''}>POWER</span>
          <strong>{powerPct}</strong>
        </div>
        <div className="meter power">
          <span style={{ width: `${player.power * 100}%` }} />
        </div>
        <div className="meter draft">
          <span style={{ width: `${Math.min(1, player.slipstreamPulse) * 100}%` }} />
        </div>
      </div>

      <div className="hud-panel hud-race">
        <div className="race-main">LAP {Math.min(player.lap, RACE.totalLaps)}/{RACE.totalLaps}</div>
        <div>POS {localPosition}/{race.vehicles.length}</div>
        <div>GATE {player.nextGateIndex + 1} {Math.round(nextGateDistance)}m</div>
        <div>{formatTime(raceTime)}</div>
        {player.timePenalty > 0 && <div className="warning">+{player.timePenalty.toFixed(1)}s penalty</div>}
      </div>

      <div className="hud-panel standings">
        <div className="hud-label">STANDINGS</div>
        {race.standings.slice(0, 4).map((vehicle, index) => (
          <div className={vehicle.id === player.id ? 'standing local' : 'standing'} key={vehicle.id}>
            <span>{index + 1}</span>
            <span>{vehicle.name}</span>
            <span>{vehicle.finished ? formatTime(vehicle.finishTime) : `${Math.round(vehicle.forwardSpeed)}m/s`}</span>
          </div>
        ))}
      </div>

      {(race.lastToast || race.phase === 'countdown' || race.phase === 'finished') && (
        <div className="toast" data-testid="race-toast">{race.lastToast}</div>
      )}

      <div className="event-strip">
        {player.telemetry.offTrack && <span className="warning">TRACK LIMIT</span>}
        {player.isAirbraking && <span>AIRBRAKE</span>}
        {player.airbrakeExitPulse > 0 && <span>EXIT BOOST</span>}
        {player.isBoosting && <span>BOOST</span>}
        {player.slipstreamPulse > 0.05 && <span>DRAFT</span>}
        {player.crashOutPulse > 0 && <span className="warning">CRASH OUT</span>}
      </div>

      <div className="airbrake-charge">
        <span>AIRBRAKE CHARGE</span>
        <div className="meter">
          <span style={{ width: `${Math.min(1, player.telemetry.airbrakeExitCharge) * 100}%` }} />
        </div>
      </div>

      {player.crashOutLockRemaining > 0 && (
        <div className="crash-overlay">
          <strong>CRASH OUT</strong>
          <span>Rebooting +{CRASH_OUT.timePenaltySeconds.toFixed(1)}s</span>
          <div className="meter">
            <span style={{ width: `${100 - (player.crashOutLockRemaining / CRASH_OUT.lockSeconds) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

