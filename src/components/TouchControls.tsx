import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { TouchCommand } from '../hooks/useNeonGame'

type ActionCommand = Extract<TouchCommand, 'boost' | 'airbrake'>

type Props = {
  autoThrottle: boolean
  onSteer: (steer: number) => void
  onTouch: (command: TouchCommand, active: boolean) => void
  onReset: () => void
}

const MOBILE_CONTROLS_QUERY = '(max-width: 820px)'

const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0

const bindAction = (
  command: ActionCommand,
  onTouch: (command: TouchCommand, active: boolean) => void,
  setPressed: (command: ActionCommand, active: boolean) => void,
) => ({
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic test events may not create a capturable pointer.
    }
    setPressed(command, true)
    onTouch(command, true)
  },
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPressed(command, false)
    onTouch(command, false)
  },
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPressed(command, false)
    onTouch(command, false)
  },
})

export function TouchControls({ autoThrottle, onSteer, onTouch, onReset }: Props) {
  const steeringActiveRef = useRef(false)
  const [steer, setSteer] = useState(0)
  const [pressed, setPressedState] = useState<Record<ActionCommand, boolean>>({
    boost: false,
    airbrake: false,
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      onTouch('throttle', false)
      return undefined
    }
    const media = window.matchMedia(MOBILE_CONTROLS_QUERY)
    const updateThrottle = () => {
      onTouch('throttle', autoThrottle && media.matches)
    }
    updateThrottle()
    media.addEventListener('change', updateThrottle)
    return () => {
      media.removeEventListener('change', updateThrottle)
      onTouch('throttle', false)
    }
  }, [autoThrottle, onTouch])

  const setPressed = (command: ActionCommand, active: boolean) => {
    setPressedState((current) => ({ ...current, [command]: active }))
  }

  const setSteeringFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clientX = Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width * 0.5
    const centered = (clientX - rect.left - rect.width * 0.5) / Math.max(1, rect.width * 0.5)
    const nextSteer = Math.abs(centered) < 0.08 ? 0 : clamp(-centered)
    setSteer(nextSteer)
    onSteer(nextSteer)
  }

  const clearSteering = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    steeringActiveRef.current = false
    setSteer(0)
    onSteer(0)
  }

  const actionProps = (command: ActionCommand) => ({
    ...bindAction(command, onTouch, setPressed),
    'aria-pressed': pressed[command],
    className: `touch-action-button ${command} ${pressed[command] ? 'pressed' : ''}`.trim(),
  })

  return (
    <div className="touch-controls" aria-label="Touch driving controls">
      <div
        className={steer === 0 ? 'steer-pad' : 'steer-pad pressed'}
        role="slider"
        tabIndex={0}
        aria-label="Steering pad"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(steer * 100)}
        onPointerDown={(event) => {
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Synthetic test events may not create a capturable pointer.
          }
          steeringActiveRef.current = true
          setSteeringFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (steeringActiveRef.current) setSteeringFromPointer(event)
        }}
        onPointerUp={clearSteering}
        onPointerCancel={clearSteering}
      >
        <span className="steer-zone left">←</span>
        <span className="steer-zone right">→</span>
        <span className="steer-thumb" style={{ transform: `translateX(${-steer * 56}px)` }} />
      </div>

      <div className="touch-actions">
        <button type="button" {...actionProps('boost')} aria-label="Boost">BOOST</button>
        <button type="button" {...actionProps('airbrake')} aria-label="Drift airbrake">DRIFT</button>
        <button type="button" className="touch-reset-button" onClick={onReset} aria-label="Reset to checkpoint">R</button>
      </div>
    </div>
  )
}
