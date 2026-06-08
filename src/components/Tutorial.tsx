import { useEffect, useMemo, useState } from 'react'
import { getPlayer, type RaceState } from '../../shared/race'
import type { TrackId } from '../../shared/track'

type StepId =
  | 'menu'
  | 'launch'
  | 'thrust'
  | 'airbrake'
  | 'boost'
  | 'pads'
  | 'draft'
  | 'line'
  | 'checkpoints'
  | 'complete'

type TutorialStep = {
  id: StepId
  title: string
  body: string
  goal: string
}

const storageKey = 'neon_drift_web.tutorial.v1.complete'
const mobileControlsQuery = '(max-width: 820px)'
const mobileControlsMatch = (): boolean =>
  typeof window !== 'undefined' &&
  'matchMedia' in window &&
  window.matchMedia(mobileControlsQuery).matches

const steps: TutorialStep[] = [
  {
    id: 'menu',
    title: 'Pick a session',
    body: 'Start the Tutorial Circuit. It is built for launch, steering, pads, drafting, and gates.',
    goal: 'Goal: choose a ship and start the tutorial track.',
  },
  {
    id: 'launch',
    title: 'Launch clean',
    body: 'Wait for GO, then hold W. The grid has soft launch separation.',
    goal: 'Goal: start moving after the countdown.',
  },
  {
    id: 'thrust',
    title: 'Thrust and steer',
    body: 'Use W/S for thrust and A/D to carve across the lane.',
    goal: 'Goal: accelerate and steer left or right.',
  },
  {
    id: 'airbrake',
    title: 'Airbrake drift',
    body: 'Hold Space into a turn, add A/D, then release for exit boost.',
    goal: 'Goal: perform one airbrake drift.',
  },
  {
    id: 'boost',
    title: 'Manual boost',
    body: 'Hold Shift while accelerating. Boost spends your Power meter.',
    goal: 'Goal: trigger one manual boost.',
  },
  {
    id: 'pads',
    title: 'Pads and power',
    body: 'Cyan pads add speed. Green pads refill Power for more boost.',
    goal: 'Goal: hit a speed or energy pad.',
  },
  {
    id: 'draft',
    title: 'Draft the pack',
    body: 'Follow another ship to build slipstream, then pass your rival.',
    goal: 'Goal: draft traffic or keep racing.',
  },
  {
    id: 'line',
    title: 'Hold the racing line',
    body: 'The tutorial track is wide, but rail pressure still drains Power. Reset and recover if you drift wide.',
    goal: 'Goal: hold a clean line through the next bend.',
  },
  {
    id: 'checkpoints',
    title: 'Gates make laps',
    body: 'Hit every checkpoint gate in order; the finish only counts after the lap gates.',
    goal: 'Goal: clear the next checkpoint gate.',
  },
]

const shouldAdvance = (step: StepId, race: RaceState): boolean => {
  const player = getPlayer(race)
  if (step === 'menu') return race.phase !== 'menu'
  if (step === 'launch') return race.phase === 'racing' && player.forwardSpeed > 3
  if (step === 'thrust') return player.forwardSpeed > 18 && Math.abs(player.lane) > 0.8
  if (step === 'airbrake') return player.airbrakeExitPulse > 0.05 || player.telemetry.airbrakeExitCharge > 0.55
  if (step === 'boost') return player.isBoosting || player.boostStartPulse > 0.05
  if (step === 'pads') return player.speedPadPulse > 0.05 || player.rechargePadPulse > 0.05
  if (step === 'draft') return player.slipstreamPulse > 0.05 || player.rivalPassPulse > 0.05
  if (step === 'line') return player.telemetry.cleanLineQuality > 0.65 || player.powerDamagePulse > 0.05
  if (step === 'checkpoints') return player.gatePulse > 0.05 || player.lapPulse > 0.05
  return false
}

type Props = {
  activeTrackId: TrackId
  race: RaceState
  raceVersion: number
}

export function Tutorial({ activeTrackId, race, raceVersion }: Props) {
  const trainingTrackActive = activeTrackId === 'tutorial-circuit'
  const initiallyComplete = useMemo(() => !trainingTrackActive && localStorage.getItem(storageKey) === 'true', [trainingTrackActive])
  const [index, setIndex] = useState(initiallyComplete ? steps.length : 0)
  const [acknowledged, setAcknowledged] = useState(false)
  const [mobileControlsActive, setMobileControlsActive] = useState(mobileControlsMatch)
  const current = steps[index]
  const visible =
    trainingTrackActive &&
    !mobileControlsActive &&
    Boolean(current) &&
    race.phase !== 'finished' &&
    race.phase !== 'results' &&
    (current?.id === 'menu' || race.phase !== 'menu')
  const awaitingAcknowledgement = visible && current?.id !== 'menu' && !acknowledged

  useEffect(() => {
    if (!('matchMedia' in window)) return undefined
    const media = window.matchMedia(mobileControlsQuery)
    const update = () => setMobileControlsActive(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F1') {
        localStorage.setItem(storageKey, 'true')
        setIndex(steps.length)
      }
      if (event.code === 'F2') {
        localStorage.removeItem(storageKey)
        setIndex(race.phase === 'menu' ? 0 : 1)
        setAcknowledged(false)
      }
      if (event.code === 'Enter' && awaitingAcknowledgement) setAcknowledged(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [awaitingAcknowledgement, race.phase])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (trainingTrackActive && race.phase === 'menu') {
        setIndex(0)
        setAcknowledged(false)
        return
      }
      if (!trainingTrackActive && localStorage.getItem(storageKey) === 'true') {
        setIndex(steps.length)
        setAcknowledged(false)
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [race.phase, trainingTrackActive])

  useEffect(() => {
    if (!current) return
    if (current.id !== 'menu' && !acknowledged) return
    if (!shouldAdvance(current.id, race)) return
    const stepId = current.id
    const timeout = window.setTimeout(() => {
      setIndex((value) => {
        if (steps[value]?.id !== stepId) return value
        const next = value + 1
        if (next >= steps.length) localStorage.setItem(storageKey, 'true')
        return next
      })
      setAcknowledged(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [acknowledged, current, race, raceVersion])

  if (!visible) return null
  const stepProgress = Math.min(1, (index + (awaitingAcknowledgement ? 0 : 0.15)) / steps.length)

  return (
    <div className="tutorial" data-testid="tutorial">
      <div className="tutorial-counter">{index + 1}/{steps.length}</div>
      <strong>{current.title}</strong>
      <p>{current.body}</p>
      <small>{awaitingAcknowledgement ? 'Confirm: click or press Enter when you have read this.' : current.goal}</small>
      <div className="tutorial-progress" aria-hidden="true">
        <span style={{ width: `${stepProgress * 100}%` }} />
      </div>
      {awaitingAcknowledgement && (
        <button type="button" onClick={() => setAcknowledged(true)}>
          OK
        </button>
      )}
    </div>
  )
}
