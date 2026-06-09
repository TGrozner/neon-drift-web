import { useEffect, useMemo, useState } from 'react'
import type { RaceState } from '../../shared/race'
import type { TrackId } from '../../shared/track'
import { shouldAdvanceTutorial, type TutorialStepId } from './tutorialProgress'

type TutorialStep = {
  id: TutorialStepId
  title: string
  body: string
  goal: string
}

const storageKey = 'neon_drift_web.tutorial.v1.complete'
const mobileControlsQuery = '(max-width: 820px)'
const mobileControlsMatch = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(mobileControlsQuery).matches

const tutorialComplete = (): boolean => {
  try {
    return window.localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

const setTutorialComplete = (complete: boolean): void => {
  try {
    if (complete) window.localStorage.setItem(storageKey, 'true')
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Storage can be unavailable in privacy/sandboxed contexts.
  }
}

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
    body: 'Cyan pads add speed. Green pads refill Power and patch Integrity.',
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
    body: 'The tutorial track is wide, but rail pressure damages Integrity. Reset and recover if you drift wide.',
    goal: 'Goal: hold a clean line through the next bend.',
  },
  {
    id: 'checkpoints',
    title: 'Gates make laps',
    body: 'Hit every checkpoint gate in order; the finish only counts after the lap gates.',
    goal: 'Goal: clear the next checkpoint gate.',
  },
]

const mobileSteps: TutorialStep[] = [
  {
    id: 'menu',
    title: 'Pick a session',
    body: 'Use the setup steps, keep Tutorial Circuit selected, then start the race.',
    goal: 'Goal: choose a ship and start the tutorial track.',
  },
  {
    id: 'launch',
    title: 'Launch clean',
    body: 'Auto-throttle is on mobile. Wait for GO and keep both thumbs ready on the lower pads.',
    goal: 'Goal: start moving after the countdown.',
  },
  {
    id: 'thrust',
    title: 'Thumb steering',
    body: 'Hold the left pad to turn left, or the right pad to turn right. Release to straighten.',
    goal: 'Goal: steer left or right.',
  },
  {
    id: 'airbrake',
    title: 'Drift hold',
    body: 'Hold DRIFT while steering, then release for exit speed. The DRIFT button shows charge.',
    goal: 'Goal: perform one airbrake drift.',
  },
  {
    id: 'boost',
    title: 'Tap boost',
    body: 'Tap BOOST once for a short burst. The button fill shows the active burst timing.',
    goal: 'Goal: trigger one manual boost.',
  },
  {
    id: 'pads',
    title: 'Pads and meters',
    body: 'Cyan pads add speed. Green pads refill BOOST and repair HULL in the mobile status panel.',
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
    title: 'Protect hull',
    body: 'Rail pressure damages HULL. Keep your line clean and use RESET if you drift wide.',
    goal: 'Goal: hold a clean line through the next bend.',
  },
  {
    id: 'checkpoints',
    title: 'Gates make laps',
    body: 'Hit every checkpoint gate in order; the finish only counts after the lap gates.',
    goal: 'Goal: clear the next checkpoint gate.',
  },
]

type Props = {
  activeTrackId: TrackId
  race: RaceState
  raceVersion: number
}

export function Tutorial({ activeTrackId, race, raceVersion }: Props) {
  const trainingTrackActive = activeTrackId === 'tutorial-circuit'
  const initiallyComplete = useMemo(() => !trainingTrackActive && tutorialComplete(), [trainingTrackActive])
  const [index, setIndex] = useState(initiallyComplete ? steps.length : 0)
  const [acknowledged, setAcknowledged] = useState(false)
  const [mobileControlsActive, setMobileControlsActive] = useState(mobileControlsMatch)
  const activeSteps = mobileControlsActive ? mobileSteps : steps
  const current = activeSteps[index]
  const visible =
    trainingTrackActive &&
    Boolean(current) &&
    race.phase !== 'finished' &&
    race.phase !== 'results' &&
    (mobileControlsActive
      ? current?.id !== 'menu' && race.phase !== 'menu'
      : current?.id === 'menu' || race.phase !== 'menu')
  const awaitingAcknowledgement = visible && current?.id !== 'menu' && !acknowledged

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(mobileControlsQuery)
    const update = () => setMobileControlsActive(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F1') {
        setTutorialComplete(true)
        setIndex(activeSteps.length)
      }
      if (event.code === 'F2') {
        setTutorialComplete(false)
        setIndex(race.phase === 'menu' ? 0 : 1)
        setAcknowledged(false)
      }
      if (event.code === 'Enter' && awaitingAcknowledgement) setAcknowledged(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSteps.length, awaitingAcknowledgement, race.phase])

  useEffect(() => {
    if (mobileControlsActive && race.phase !== 'menu' && activeSteps[index]?.id === 'menu') {
      const timeout = window.setTimeout(() => {
        setIndex(1)
        setAcknowledged(false)
      }, 0)
      return () => window.clearTimeout(timeout)
    }
    return undefined
  }, [activeSteps, index, mobileControlsActive, race.phase])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (trainingTrackActive && race.phase === 'menu') {
        setIndex(0)
        setAcknowledged(false)
        return
      }
      if (!trainingTrackActive && tutorialComplete()) {
        setIndex(activeSteps.length)
        setAcknowledged(false)
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [activeSteps.length, race.phase, trainingTrackActive])

  useEffect(() => {
    if (!current) return
    if (current.id !== 'menu' && !acknowledged) return
    if (!shouldAdvanceTutorial(current.id, race)) return
    const stepId = current.id
    const timeout = window.setTimeout(() => {
      setIndex((value) => {
        if (activeSteps[value]?.id !== stepId) return value
        const next = value + 1
        if (next >= activeSteps.length) setTutorialComplete(true)
        return next
      })
      setAcknowledged(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [acknowledged, activeSteps, current, race, raceVersion])

  if (!visible) return null
  const stepProgress = Math.min(1, (index + (awaitingAcknowledgement ? 0 : 0.15)) / activeSteps.length)

  return (
    <div className="tutorial" data-testid="tutorial">
      <div className="tutorial-counter">{index + 1}/{activeSteps.length}</div>
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
