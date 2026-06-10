import { useEffect, useRef } from 'react'
import { SHIP_PROFILES } from '../../shared/constants'
import type { Vehicle } from '../../shared/physics'
import { gapToNext, getPlayer, type RaceState } from '../../shared/race'
import { draftMeterRatio } from './draftSignals'
import { standingsForHud } from './hudRows'
import { triggerMobileHaptic } from './mobileFeedback'

type Props = {
  race: RaceState
}

type MobilePulseSnapshot = {
  boostStartPulse: number
  rechargePadPulse: number
  powerDamagePulse: number
  crashOutPulse: number
}

function MobileRaceHaptics({ player }: { player: Vehicle }) {
  const previousRef = useRef<MobilePulseSnapshot>({
    boostStartPulse: 0,
    rechargePadPulse: 0,
    powerDamagePulse: 0,
    crashOutPulse: 0,
  })

  useEffect(() => {
    const previous = previousRef.current
    if (player.boostStartPulse > 0.2 && previous.boostStartPulse <= 0.2) triggerMobileHaptic(18)
    if (player.rechargePadPulse > 0.2 && previous.rechargePadPulse <= 0.2) triggerMobileHaptic([8, 28, 10])
    if (player.powerDamagePulse > 0.2 && previous.powerDamagePulse <= 0.2) triggerMobileHaptic([18, 36, 18])
    if (player.crashOutPulse > 0.2 && previous.crashOutPulse <= 0.2) triggerMobileHaptic([40, 60, 40])
    previousRef.current = {
      boostStartPulse: player.boostStartPulse,
      rechargePadPulse: player.rechargePadPulse,
      powerDamagePulse: player.powerDamagePulse,
      crashOutPulse: player.crashOutPulse,
    }
  }, [player.boostStartPulse, player.crashOutPulse, player.powerDamagePulse, player.rechargePadPulse])

  return null
}

const formatTime = (seconds: number): string => {
  if (seconds < 0) return '--:--'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

const formatSpeed = (speed: number): string => `${Math.round(speed * 3.6).toString().padStart(3, '0')}`
const EVENT_BADGE_LIMIT = 3

type EventBadge = {
  label: string
  warning?: boolean
}

export function Hud({ race }: Props) {
  if (race.phase === 'menu' || race.phase === 'results') return null

  const player = getPlayer(race)
  const profile = SHIP_PROFILES[player.profileId]
  const speedRatio = Math.min(1, Math.abs(player.forwardSpeed) / Math.max(1, profile.boostSpeed))
  const powerPct = `${Math.round(player.power * 100)}%`
  const integrityPct = `${Math.round(player.integrity * 100)}%`
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
  const launchChargePct = Math.round(player.launchBoostCharge * 100)
  const launchChargeVisible = race.phase === 'countdown' && player.launchBoostCharge > 0.02
  const eventBadges: EventBadge[] = [
    player.crashOutPulse > 0 ? { label: 'CRASH OUT', warning: true } : null,
    player.telemetry.integrityCritical ? { label: 'INTEGRITY CRITICAL', warning: true } : null,
    player.telemetry.wrongWay ? { label: 'WRONG WAY', warning: true } : null,
    player.telemetry.offTrack ? { label: 'TRACK LIMIT', warning: true } : null,
    player.telemetry.railPressure > 0.35 ? { label: 'RAIL PRESSURE', warning: true } : null,
    player.powerDamagePulse > 0.05 ? { label: 'INTEGRITY HIT', warning: player.telemetry.integrityCritical } : null,
    player.packBumpPulse > 0.05 ? { label: 'CONTACT' } : null,
    player.knockoutRewardPulse > 0.05 ? { label: 'KO ENERGY' } : null,
    player.airbrakeExitPulse > 0 ? { label: 'EXIT BOOST' } : null,
    player.isBoosting ? { label: 'BOOST' } : null,
    player.slipstreamPulse > 0.05 ? { label: 'DRAFT' } : null,
    player.cleanLinePulse > 0.3 ? { label: 'CLEAN LINE' } : null,
    player.isAirbraking ? { label: 'AIRBRAKE' } : null,
  ].filter((badge): badge is EventBadge => Boolean(badge)).slice(0, EVENT_BADGE_LIMIT)

  return (
    <div className="hud" data-testid="hud">
      <MobileRaceHaptics player={player} />
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
        <div className="power-row">
          <span className={player.telemetry.integrityCritical ? 'warning' : ''}>INTEGRITY</span>
          <strong>{integrityPct}</strong>
        </div>
        <div className="meter integrity">
          <span style={{ width: `${player.integrity * 100}%` }} />
        </div>
        <div className="meter draft">
          <span style={{ width: `${draft * 100}%` }} />
        </div>
      </div>

      <div className="hud-panel hud-race">
        <div className="race-main">LAP {Math.min(player.lap, race.totalLaps)}/{race.totalLaps}</div>
        <div>POS {localPosition}/{race.vehicles.length}</div>
        <div>GATE {player.nextGateIndex + 1} {Math.round(nextGateDistance)}m</div>
        <div>{formatTime(raceTime)}</div>
        {player.timePenalty > 0 && <div className="warning">+{player.timePenalty.toFixed(1)}s penalty</div>}
      </div>

      <div className="mobile-race-strip" data-testid="mobile-race-strip">
        <strong>P{localPosition}/{race.vehicles.length}</strong>
        <span>GATE {player.nextGateIndex + 1} · {Math.round(nextGateDistance)}m</span>
        <span>SPEED {formatSpeed(Math.abs(player.forwardSpeed))} km/h</span>
        <span>{nearestRival ? `${nearestRival.name} ${nearestRivalGap >= 0 ? '+' : ''}${Math.round(nearestRivalGap)}m` : 'CLEAR AIR'}</span>
        <div className="mobile-status-bars">
          <div className="mobile-status-row">
            <span>BOOST</span>
            <strong>{powerPct}</strong>
            <div className="meter power" data-testid="mobile-boost-meter">
              <span style={{ width: `${player.power * 100}%` }} />
            </div>
          </div>
          <div className={player.telemetry.integrityCritical ? 'mobile-status-row warning' : 'mobile-status-row'}>
            <span>HULL</span>
            <strong>{integrityPct}</strong>
            <div className="meter integrity" data-testid="mobile-integrity-meter">
              <span style={{ width: `${player.integrity * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="mini-bars">
          <span style={{ width: `${nextUrgency * 100}%` }} />
          <span style={{ width: `${lineSafety * 100}%` }} />
          <span style={{ width: `${draft * 100}%` }} />
        </div>
        {launchChargeVisible && (
          <div className="mobile-launch-charge" data-testid="mobile-launch-charge">
            <span>LAUNCH</span>
            <strong>{launchChargePct}%</strong>
            <div className="meter"><span style={{ width: `${player.launchBoostCharge * 100}%` }} /></div>
          </div>
        )}
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
          const rivalStatus = vehicle.telemetry.integrityCritical
            ? 'CRITICAL'
            : vehicle.telemetry.integrityDamaged
              ? 'DAMAGED'
              : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`
          return (
            <div className={vehicle.telemetry.integrityCritical ? 'rival-row warning' : 'rival-row'} key={vehicle.id}>
              <span>{vehicle.name}</span>
              <span>{gap >= 0 ? '+' : ''}{Math.round(gap)}m</span>
              <span>{rivalStatus}</span>
            </div>
          )
        })}
      </div>

      {(race.lastToast || race.phase === 'countdown' || race.phase === 'finished') && (
        <div className="toast" data-testid="race-toast">{race.lastToast}</div>
      )}

      <div className="event-strip">
        {eventBadges.map((badge) => (
          <span className={badge.warning ? 'warning' : undefined} key={badge.label}>{badge.label}</span>
        ))}
      </div>

      {launchChargeVisible && (
        <div className="launch-charge" data-testid="launch-charge">
          <span>LAUNCH CHARGE</span>
          <strong>{launchChargePct}%</strong>
          <div className="meter">
            <span style={{ width: `${player.launchBoostCharge * 100}%` }} />
          </div>
        </div>
      )}

      <div className="airbrake-charge">
        <span>AIRBRAKE CHARGE</span>
        <div className="meter">
          <span style={{ width: `${Math.min(1, player.telemetry.airbrakeExitCharge) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
