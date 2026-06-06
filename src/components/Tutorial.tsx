import { useEffect, useMemo, useState } from 'react'
import { getPlayer, type RaceState } from '../../shared/race'

type StepId =
  | 'menu'
  | 'launch'
  | 'thrust'
  | 'airbrake'
  | 'boost'
  | 'pads'
  | 'draft'
  | 'contact'
  | 'checkpoints'
  | 'complete'

type TutorialStep = {
  id: StepId
  title: string
  body: string
}

const storageKey = 'neon_drift_web.tutorial.v1.complete'

const steps: TutorialStep[] = [
  { id: 'menu', title: 'Pick a ship', body: 'Start Solo on Neon Oval. The pack is live as soon as GO hits.' },
  { id: 'launch', title: 'Launch clean', body: 'Hold throttle near the end of the countdown for launch boost.' },
  { id: 'thrust', title: 'Thrust and steer', body: 'Build speed first, then carve across the lane.' },
  { id: 'airbrake', title: 'Airbrake drift', body: 'Hold airbrake into a turn, steer, then release for exit boost.' },
  { id: 'boost', title: 'Manual boost', body: 'Boost spends Power and locks out if the meter empties.' },
  { id: 'pads', title: 'Pads and power', body: 'Cyan pads add speed. Green pads recharge Power.' },
  { id: 'draft', title: 'Draft the pack', body: 'Sit in another ship’s wake to gain slipstream acceleration.' },
  { id: 'contact', title: 'Contact costs power', body: 'Rails damage Power. Empty Power triggers crash-out recovery.' },
  { id: 'checkpoints', title: 'Gates make laps', body: 'Clear gates in order and finish after three laps.' },
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
  if (step === 'contact') return player.powerDamagePulse > 0.05 || player.crashOutPulse > 0.05
  if (step === 'checkpoints') return player.gatePulse > 0.05 || player.lapPulse > 0.05
  return false
}

export function Tutorial({ race }: { race: RaceState }) {
  const initiallyComplete = useMemo(() => localStorage.getItem(storageKey) === 'true', [])
  const [index, setIndex] = useState(initiallyComplete ? steps.length : 0)
  const [acknowledged, setAcknowledged] = useState(false)
  const current = steps[index]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F1') {
        localStorage.setItem(storageKey, 'true')
        setIndex(steps.length)
      }
      if (event.code === 'F2') {
        localStorage.removeItem(storageKey)
        setIndex(0)
        setAcknowledged(false)
      }
      if (event.code === 'Enter') setAcknowledged(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!current) return
    if (!acknowledged && current.id !== 'menu') return
    if (!shouldAdvance(current.id, race)) return
    const timeout = window.setTimeout(() => {
      setIndex((value) => {
        const next = value + 1
        if (next >= steps.length) localStorage.setItem(storageKey, 'true')
        return next
      })
      setAcknowledged(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [acknowledged, current, race])

  if (!current) return null

  return (
    <div className="tutorial" data-testid="tutorial">
      <div className="tutorial-counter">{index + 1}/{steps.length}</div>
      <strong>{current.title}</strong>
      <p>{current.body}</p>
      {current.id !== 'menu' && !acknowledged && (
        <button type="button" onClick={() => setAcknowledged(true)}>
          OK
        </button>
      )}
    </div>
  )
}
