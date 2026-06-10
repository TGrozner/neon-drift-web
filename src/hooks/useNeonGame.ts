import { useCallback, useEffect, useRef, useState } from 'react'
import { FIXED_DT, MAX_ACCUMULATED_TIME, type ShipProfileId } from '../../shared/constants'
import { type VehicleInput } from '../../shared/physics'
import {
  createRaceState,
  getPlayer,
  goToMenu,
  startRace,
  updateRace,
  type RacePhase,
  type RaceState,
} from '../../shared/race'
import { clamp, finiteOr } from '../../shared/math'
import type { TrackId } from '../../shared/track'
import { neonDiagnostics } from '../diagnostics/neonDiagnostics'
import { runAssessment, statCardsFor } from '../components/raceStatsView'

type KeyState = {
  throttle: number
  steer: number
  boost: boolean
  airbrake: boolean
  reset: boolean
}

type NeonInputDebug = {
  pressedKeyCount: number
  touchThrottle: number
  touchSteer: number
  touchBoost: boolean
  touchAirbrake: boolean
}

type NeonDebugWindow = Window & typeof globalThis & {
  __NEON_E2E__?: boolean
  __NEON_INPUT_STATE__?: NeonInputDebug
}

export type TouchState = KeyState & {
  left: boolean
  right: boolean
}

export type TouchCommand = 'left' | 'right' | 'throttle' | 'boost' | 'airbrake'

const createKeyState = (): KeyState => ({
  throttle: 0,
  steer: 0,
  boost: false,
  airbrake: false,
  reset: false,
})

export const createTouchState = (): TouchState => ({
  ...createKeyState(),
  left: false,
  right: false,
})

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
}

type KeyboardEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'target'>

export const shouldSuppressGameInputDefault = (event: KeyboardEventLike): boolean =>
  !isEditableTarget(event.target) &&
  (
    ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) ||
    [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
  )

const normalizeKey = (event: KeyboardEvent): string =>
  event.key.length === 1 ? event.key.toLowerCase() : event.key

const hasAny = (keys: Set<string>, values: string[]): boolean =>
  values.some((value) => keys.has(value))

const STEER_LEFT = 1
const STEER_RIGHT = -1
const REACT_PUBLISH_INTERVAL_MS = 50
const LARGE_FRAME_GAP_SECONDS = 0.2
const LARGE_FRAME_GAP_LOG_COOLDOWN_MS = 5_000
const TOUCH_COMMAND_LOG_COOLDOWN_MS = 1_000
const clampInput = (value: number): number => clamp(value, -1, 1)

const shouldPublishInputDebug = (): boolean =>
  new URLSearchParams(window.location.search).has('e2e') ||
  Boolean((window as NeonDebugWindow).__NEON_E2E__)

const publishInputDebug = (pressedKeys: Set<string>, touch: TouchState): void => {
  if (!shouldPublishInputDebug()) return
  const debugWindow = window as NeonDebugWindow
  debugWindow.__NEON_INPUT_STATE__ = {
    pressedKeyCount: pressedKeys.size,
    touchThrottle: touch.throttle,
    touchSteer: touch.steer,
    touchBoost: touch.boost,
    touchAirbrake: touch.airbrake,
  }
}

export const applyTouchCommand = (
  touch: TouchState,
  command: TouchCommand,
  active: boolean,
): void => {
  if (command === 'left' || command === 'right') {
    if (command === 'left') touch.left = active
    if (command === 'right') touch.right = active
    touch.steer = (touch.left ? STEER_LEFT : 0) + (touch.right ? STEER_RIGHT : 0)
    return
  }

  if (command === 'throttle') touch.throttle = active ? 1 : 0
  if (command === 'boost') touch.boost = active
  if (command === 'airbrake') touch.airbrake = active
}

const keyInput = (keys: Set<string>): KeyState => ({
  throttle:
    (hasAny(keys, ['KeyW', 'ArrowUp', 'w', 'z']) ? 1 : 0) +
    (hasAny(keys, ['KeyS', 'ArrowDown', 's']) ? -1 : 0),
  steer:
    (hasAny(keys, ['KeyA', 'ArrowLeft', 'a', 'q']) ? STEER_LEFT : 0) +
    (hasAny(keys, ['KeyD', 'ArrowRight', 'd']) ? STEER_RIGHT : 0),
  boost: hasAny(keys, ['ShiftLeft', 'ShiftRight', 'Shift']),
  airbrake: hasAny(keys, ['Space', ' ']),
  reset: hasAny(keys, ['KeyR', 'r']),
})

const mergeInput = (keyboard: KeyState, touch: KeyState): VehicleInput => ({
  throttle: clampInput(keyboard.throttle + touch.throttle),
  steer: clampInput(keyboard.steer + touch.steer),
  boost: keyboard.boost || touch.boost,
  airbrake: keyboard.airbrake || touch.airbrake,
  reset: keyboard.reset || touch.reset,
})

const compactRaceDiagnostics = (race: RaceState) => {
  const player = getPlayer(race)
  const finishedVehicles = race.vehicles.filter((vehicle) => vehicle.finished).length
  const eliminatedVehicles = race.vehicles.filter((vehicle) => vehicle.eliminated).length

  return {
    phase: race.phase,
    track: race.track.id,
    raceTime: Math.round(race.raceTime * 10) / 10,
    raceVehicleCount: race.vehicles.length,
    finishedVehicles,
    eliminatedVehicles,
    activeVehicles: race.vehicles.length - eliminatedVehicles,
    lap: player.lap,
    position: player.finalPosition || Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1),
    finished: player.finished,
    eliminated: player.eliminated,
    integrityPct: Math.round(player.integrity * 100),
    powerPct: Math.round(player.power * 100),
    crashOutCount: player.crashOutCount,
    maxSpeedKmh: Math.round(race.runStats.maxSpeed * 3.6),
    contactCount: race.runStats.contactCount,
    damagePct: Math.round(race.runStats.integrityDamageTaken * 100),
    offTrackSeconds: Math.round(race.runStats.offTrackSeconds * 10) / 10,
    draftSeconds: Math.round(race.runStats.draftSeconds * 10) / 10,
    boostStarts: race.runStats.boostStarts,
    airbrakeExits: race.runStats.airbrakeExits,
  }
}

type RaceCompletionReason = 'player_crash_out' | 'all_vehicles_finished' | 'results_after_wait' | 'ongoing'

const deriveRaceCompletionReason = (previousPhase: RacePhase, race: RaceState): RaceCompletionReason | undefined => {
  const player = getPlayer(race)
  if (race.phase === 'finished') {
    return player.eliminated ? 'player_crash_out' : 'ongoing'
  }
  if (race.phase === 'results' && previousPhase === 'finished') {
    return player.eliminated ? 'player_crash_out' : 'results_after_wait'
  }
  if (race.phase === 'results' && race.vehicles.every((vehicle) => vehicle.finished)) {
    return 'all_vehicles_finished'
  }
  if (race.phase === 'results' && player.finished) {
    return 'all_vehicles_finished'
  }
  return undefined
}

const roundNumber = (value: number, digits = 2): number => {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(digits))
}

const buildRaceResultSummary = (race: RaceState) => {
  const player = getPlayer(race)
  const playerPosition = Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1)
  const leaderBoard = race.standings.slice(0, Math.min(8, race.standings.length)).map((vehicle, index) => ({
    position: index + 1,
    id: vehicle.id,
    name: vehicle.name,
    finished: vehicle.finished,
    eliminated: vehicle.eliminated,
    lap: vehicle.lap,
    finishTime: vehicle.finished ? roundNumber(vehicle.finishTime, 2) : null,
    bestLapSeconds: roundNumber(vehicle.bestLapSeconds, 2),
    penaltySeconds: roundNumber(vehicle.timePenalty, 2),
  }))
  const cards = statCardsFor(race.runStats).slice(0, 8)
  const avgSpeedKmh = roundNumber((race.runStats.sampleSeconds > 0 ? race.runStats.speedSeconds / race.runStats.sampleSeconds : 0) * 3.6, 0)

  return {
    track: race.track.id,
    trackName: race.track.name,
    phase: race.phase,
    totalLaps: race.totalLaps,
    raceSeconds: roundNumber(race.raceTime + player.timePenalty, 1),
    playerId: player.id,
    playerName: player.name,
    playerPosition,
    playerStatus: player.eliminated ? 'out' : player.finished ? 'finished' : 'dnf',
    playerLap: player.lap,
    playerFinishTime: player.finished ? roundNumber(player.finishTime, 2) : null,
    playerBestLap: roundNumber(player.bestLapSeconds, 2),
    finalIntegrity: roundNumber(player.integrity * 100),
    finalPower: roundNumber(player.power * 100),
    crashOuts: player.crashOutCount,
    displayCards: cards,
    assessment: runAssessment(race.runStats, player.eliminated),
    runStats: {
      avgSpeedKmh,
      maxSpeedKmh: roundNumber(race.runStats.maxSpeed * 3.6, 0),
      contactCount: race.runStats.contactCount,
      boostStarts: race.runStats.boostStarts,
      airbrakeExits: race.runStats.airbrakeExits,
      draftSeconds: roundNumber(race.runStats.draftSeconds, 1),
      offTrackSeconds: roundNumber(race.runStats.offTrackSeconds, 1),
      wrongWaySeconds: roundNumber(race.runStats.wrongWaySeconds, 1),
      cleanLineRatio: roundNumber(race.runStats.sampleSeconds > 0 ? race.runStats.cleanLineSeconds / race.runStats.sampleSeconds : 0, 3),
      rivalPasses: race.runStats.rivalPasses,
      resets: race.runStats.resetCount,
    },
    leaderBoard,
  }
}

export const useNeonGame = () => {
  const [view, setView] = useState(() => ({ race: createRaceState(), version: 0 }))
  const raceRef = useRef<RaceState>(view.race)
  const pressedKeysRef = useRef(new Set<string>())
  const touchRef = useRef<TouchState>(createTouchState())
  const lastTimeRef = useRef<number | null>(null)
  const accumulatorRef = useRef(0)
  const nextPublishTimeRef = useRef(0)
  const lastPublishedPhaseRef = useRef(view.race.phase)
  const lastLargeFrameGapLogRef = useRef(0)
  const lastTouchCommandLogRef = useRef<Record<TouchCommand, number>>({
    left: 0,
    right: 0,
    throttle: 0,
    boost: 0,
    airbrake: 0,
  })

  useEffect(() => {
    const clearInputState = () => {
      pressedKeysRef.current.clear()
      touchRef.current = createTouchState()
      publishInputDebug(pressedKeysRef.current, touchRef.current)
      neonDiagnostics.log('input', 'cleared', {
        phase: raceRef.current.phase,
        visibilityState: document.visibilityState,
      })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearInputState()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      pressedKeysRef.current.add(event.code)
      pressedKeysRef.current.add(normalizeKey(event))
      publishInputDebug(pressedKeysRef.current, touchRef.current)
      if (shouldSuppressGameInputDefault(event)) {
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.code)
      pressedKeysRef.current.delete(normalizeKey(event))
      publishInputDebug(pressedKeysRef.current, touchRef.current)
    }
    publishInputDebug(pressedKeysRef.current, touchRef.current)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInputState)
    window.addEventListener('pagehide', clearInputState)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInputState)
      window.removeEventListener('pagehide', clearInputState)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time
      lastTimeRef.current = time
      const elapsedSeconds = Math.max(0, finiteOr((time - last) / 1000))
      const frameDt = Math.min(MAX_ACCUMULATED_TIME, elapsedSeconds)
      if (
        elapsedSeconds >= LARGE_FRAME_GAP_SECONDS &&
        time - lastLargeFrameGapLogRef.current >= LARGE_FRAME_GAP_LOG_COOLDOWN_MS
      ) {
        lastLargeFrameGapLogRef.current = time
        neonDiagnostics.warn('simulation', 'large_frame_gap', {
          elapsedMs: Math.round(elapsedSeconds * 1000),
          appliedMs: Math.round(frameDt * 1000),
          phase: raceRef.current.phase,
          track: raceRef.current.track.id,
        })
      }
      accumulatorRef.current += frameDt
      let stepped = false
      while (accumulatorRef.current >= FIXED_DT) {
        const input = mergeInput(keyInput(pressedKeysRef.current), touchRef.current)
        updateRace(raceRef.current, input, FIXED_DT)
        accumulatorRef.current -= FIXED_DT
        if (touchRef.current.reset) touchRef.current.reset = false
        stepped = true
      }
      const previousPhase = lastPublishedPhaseRef.current
      const phaseChanged = raceRef.current.phase !== previousPhase
      if (phaseChanged) {
        const raceSnapshot = compactRaceDiagnostics(raceRef.current)
        const completionReason = deriveRaceCompletionReason(previousPhase, raceRef.current)
        const transitionPayload = {
          from: previousPhase,
          to: raceRef.current.phase,
          completionReason,
          ...raceSnapshot,
        }
        neonDiagnostics.log('race', 'phase_change', transitionPayload)
        if (raceRef.current.phase === 'finished' || raceRef.current.phase === 'results') {
          if (raceRef.current.phase === 'results') {
            const raceSummary = buildRaceResultSummary(raceRef.current)
            const summaryPayload = {
              ...raceSummary,
              completionReason: completionReason === 'all_vehicles_finished' ? 'all_vehicles_finished' : completionReason ?? 'ongoing',
            }
            neonDiagnostics.log('race', 'results_summary', summaryPayload)
          }
          neonDiagnostics.log('race', 'summary', raceSnapshot)
        }
      }
      if (stepped && (phaseChanged || time >= nextPublishTimeRef.current)) {
        lastPublishedPhaseRef.current = raceRef.current.phase
        nextPublishTimeRef.current = time + REACT_PUBLISH_INTERVAL_MS
        setView((current) => ({
          race: raceRef.current,
          version: (current.version + 1) % 1_000_000,
        }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const start = useCallback((profileId: ShipProfileId, trackId: TrackId) => {
    neonDiagnostics.log('race', 'start_requested', { profileId, trackId })
    raceRef.current = startRace(profileId, trackId)
    lastPublishedPhaseRef.current = raceRef.current.phase
    nextPublishTimeRef.current = 0
    pressedKeysRef.current.clear()
    touchRef.current = createTouchState()
    publishInputDebug(pressedKeysRef.current, touchRef.current)
    setView((current) => ({
      race: raceRef.current,
      version: (current.version + 1) % 1_000_000,
    }))
  }, [])

  const setTouch = useCallback((command: TouchCommand, active: boolean) => {
    applyTouchCommand(touchRef.current, command, active)
    if (active) {
      const now = performance.now()
      if (now - lastTouchCommandLogRef.current[command] >= TOUCH_COMMAND_LOG_COOLDOWN_MS) {
        lastTouchCommandLogRef.current[command] = now
        neonDiagnostics.log('input', 'touch_command', {
          command,
          phase: raceRef.current.phase,
          track: raceRef.current.track.id,
        })
      }
    }
    publishInputDebug(pressedKeysRef.current, touchRef.current)
  }, [])

  const reset = useCallback(() => {
    touchRef.current.reset = true
    neonDiagnostics.log('input', 'reset_requested', {
      phase: raceRef.current.phase,
      track: raceRef.current.track.id,
    })
    publishInputDebug(pressedKeysRef.current, touchRef.current)
  }, [])

  const menu = useCallback(() => {
    neonDiagnostics.log('race', 'menu_requested', {
      phase: raceRef.current.phase,
      track: raceRef.current.track.id,
      raceTime: Math.round(raceRef.current.raceTime * 10) / 10,
    })
    goToMenu(raceRef.current)
    lastPublishedPhaseRef.current = raceRef.current.phase
    nextPublishTimeRef.current = 0
    pressedKeysRef.current.clear()
    touchRef.current = createTouchState()
    publishInputDebug(pressedKeysRef.current, touchRef.current)
    setView((current) => ({
      race: raceRef.current,
      version: (current.version + 1) % 1_000_000,
    }))
  }, [])

  return {
    race: view.race,
    raceRef,
    start,
    menu,
    setTouch,
    reset,
    version: view.version,
  }
}
