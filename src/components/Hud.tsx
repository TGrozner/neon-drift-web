import { CRASH_OUT, RACE, SHIP_PROFILES } from '../../shared/constants'
import { gapToNext, getPlayer, type RaceState } from '../../shared/race'
import { draftMeterRatio } from './draftSignals'
import { standingsForHud } from './hudRows'

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
  if (race.phase === 'menu' || race.phase === 'results') return null

  const player = getPlayer(race)
  const profile = SHIP_PROFILES[player.profileId]
  const speedRatio = Math.min(1, Math.abs(player.forwardSpeed) / Math.max(1, profile.boostSpeed))
  const powerPct = `${Math.round(player.power * 100)}%`
  const localPosition = Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1)
  const nextGateDistance = gapToNext(race, player)
  const nextUrgency = Math.max(0, Math.min(1, 1 - nextGateDistance / 180))
  const lineSafety = Math.max(0, Math.min(1, 1 - Math.max(player.telemetry.offTrack ? 1 : 0, player.telemetry.railPressure)))
  const draft = draftMeterRatio(player)
  const rivals = race.rivals.length > 0
    ? race.rivals
    : race.standings.filter((vehicle) => vehicle.id !== player.id && !vehicle.finished).slice(0, 3)
  const nearestRival = rivals[0]
  const nearestRivalGap = nearestRival ? race.rivalGaps[nearestRival.id] ?? 0 : 0
  const standingRows = standingsForHud(race.standings, player.id)
  const boostFlash = Math.min(
    1,
    player.boostIntensity * 0.34 +
      player.speedPadPulse * 0.42 +
      player.airbrakeExitPulse * 0.34 +
      player.slipstreamPulse * 0.18 +
      player.rivalPassPulse * 0.22 +
      player.knockoutRewardPulse * 0.24,
  )
  const raceTime = race.phase === 'racing' || race.phase === 'finished'
    ? race.raceTime + player.timePenalty
    : 0

  return (
    <div className="hud" data-testid="hud">
      <div className="speed-vignette" style={{ opacity: boostFlash }} />
      <div className="hud-panel hud-speed">
        <div className="hud-label">SPEED</div>
        <div className="speed-readout">{formatSpeed(Math.abs(player.forwardSpeed))}</div>
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
          <span style={{ width: `${draft * 100}%` }} />
        </div>
      </div>

      <div className="hud-panel hud-race">
        <div className="race-main">LAP {Math.min(player.lap, RACE.totalLaps)}/{RACE.totalLaps}</div>
        <div>POS {localPosition}/{race.vehicles.length}</div>
        <div>GATE {player.nextGateIndex + 1} {Math.round(nextGateDistance)}m</div>
        <div>{formatTime(raceTime)}</div>
        {player.timePenalty > 0 && <div className="warning">+{player.timePenalty.toFixed(1)}s penalty</div>}
      </div>

      <div className="mobile-race-strip" data-testid="mobile-race-strip">
        <strong>P{localPosition}/{race.vehicles.length}</strong>
        <span>GATE {player.nextGateIndex + 1} · {Math.round(nextGateDistance)}m</span>
        <span>{nearestRival ? `${nearestRival.name} ${nearestRivalGap >= 0 ? '+' : ''}${Math.round(nearestRivalGap)}m` : 'CLEAR AIR'}</span>
        <div className="mini-bars">
          <span style={{ width: `${nextUrgency * 100}%` }} />
          <span style={{ width: `${lineSafety * 100}%` }} />
          <span style={{ width: `${draft * 100}%` }} />
        </div>
      </div>

      <div className="hud-panel readability">
        <div className="hud-label">READABILITY</div>
        <div className="readability-row">
          <span>NEXT</span>
          <div className="meter"><span style={{ width: `${nextUrgency * 100}%` }} /></div>
        </div>
        <div className="readability-row">
          <span>LINE</span>
          <div className="meter line"><span style={{ width: `${lineSafety * 100}%` }} /></div>
        </div>
        <div className="readability-row">
          <span>DRAFT</span>
          <div className="meter draft-strong"><span style={{ width: `${draft * 100}%` }} /></div>
        </div>
      </div>

      <div className="hud-panel standings">
        <div className="hud-label">STANDINGS</div>
        {standingRows.map(({ vehicle, position }) => (
          <div className={vehicle.id === player.id ? 'standing local' : 'standing'} key={vehicle.id}>
            <span>{position}</span>
            <span>{vehicle.name}</span>
            <span>{vehicle.finished ? formatTime(vehicle.finishTime) : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`}</span>
          </div>
        ))}
      </div>

      <div className="hud-panel rivals">
        <div className="hud-label">RIVALS</div>
        {rivals.map((vehicle) => {
          const gap = race.rivalGaps[vehicle.id] ?? 0
          return (
            <div className={vehicle.telemetry.powerCritical ? 'rival-row warning' : 'rival-row'} key={vehicle.id}>
              <span>{vehicle.name}</span>
              <span>{gap >= 0 ? '+' : ''}{Math.round(gap)}m</span>
              <span>{vehicle.telemetry.powerCritical ? 'SMOKING' : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`}</span>
            </div>
          )
        })}
      </div>

      {(race.lastToast || race.phase === 'countdown' || race.phase === 'finished') && (
        <div className="toast" data-testid="race-toast">{race.lastToast}</div>
      )}

      <div className="event-strip">
        {player.telemetry.offTrack && <span className="warning">TRACK LIMIT</span>}
        {player.telemetry.wrongWay && <span className="warning">WRONG WAY</span>}
        {player.isAirbraking && <span>AIRBRAKE</span>}
        {player.airbrakeExitPulse > 0 && <span>EXIT BOOST</span>}
        {player.isBoosting && <span>BOOST</span>}
        {player.slipstreamPulse > 0.05 && <span>DRAFT</span>}
        {player.knockoutRewardPulse > 0.05 && <span>KO ENERGY</span>}
        {player.packBumpPulse > 0.05 && <span>CONTACT</span>}
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
