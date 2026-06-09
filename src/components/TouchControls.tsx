import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { TouchCommand } from '../hooks/useNeonGame'
import { triggerMobileHaptic } from './mobileFeedback'

type DriveButtonCommand = Extract<TouchCommand, 'left' | 'right' | 'boost' | 'airbrake'>

type Props = {
  airbrakeCharge: number
  autoThrottle: boolean
  onTouch: (command: TouchCommand, active: boolean) => void
  onReset: () => void
}

const MOBILE_CONTROLS_QUERY = '(max-width: 820px)'
const MOBILE_BOOST_TAP_MS = 1200

const clearDriveButtons = (onTouch: (command: TouchCommand, active: boolean) => void) => {
  onTouch('left', false)
  onTouch('right', false)
  onTouch('boost', false)
  onTouch('airbrake', false)
}

const bindAction = (
  command: DriveButtonCommand,
  onTouch: (command: TouchCommand, active: boolean) => void,
  setPressed: (command: DriveButtonCommand, active: boolean) => void,
) => ({
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic test events may not create a capturable pointer.
    }
    setPressed(command, true)
    onTouch(command, true)
    triggerMobileHaptic(command === 'airbrake' ? 12 : 6)
  },
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPressed(command, false)
    onTouch(command, false)
  },
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPressed(command, false)
    onTouch(command, false)
  },
  onLostPointerCapture: () => {
    setPressed(command, false)
    onTouch(command, false)
  },
  onContextMenu: (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
  },
})

export function TouchControls({ airbrakeCharge, autoThrottle, onTouch, onReset }: Props) {
  const [boostPulseToken, setBoostPulseToken] = useState(0)
  const boostPointerActive = useRef(false)
  const [pressed, setPressedState] = useState<Record<DriveButtonCommand, boolean>>({
    left: false,
    right: false,
    boost: false,
    airbrake: false,
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      onTouch('throttle', false)
      clearDriveButtons(onTouch)
      return undefined
    }
    const media = window.matchMedia(MOBILE_CONTROLS_QUERY)
    const updateThrottle = () => {
      const mobileDriving = autoThrottle && media.matches
      onTouch('throttle', mobileDriving)
      if (!mobileDriving) clearDriveButtons(onTouch)
    }
    updateThrottle()
    media.addEventListener('change', updateThrottle)
    return () => {
      media.removeEventListener('change', updateThrottle)
      onTouch('throttle', false)
      clearDriveButtons(onTouch)
    }
  }, [autoThrottle, onTouch])

  useEffect(() => {
    if (boostPulseToken <= 0) return undefined
    const timeout = window.setTimeout(() => {
      setPressedState((current) => ({ ...current, boost: false }))
      onTouch('boost', false)
    }, MOBILE_BOOST_TAP_MS)
    return () => window.clearTimeout(timeout)
  }, [boostPulseToken, onTouch])

  const setPressed = useCallback((command: DriveButtonCommand, active: boolean) => {
    setPressedState((current) => ({ ...current, [command]: active }))
  }, [])

  const handleDriveTouch = useCallback((command: TouchCommand, active: boolean) => {
    if (command === 'airbrake' && active) {
      setPressed('boost', false)
      onTouch('boost', false)
    }
    onTouch(command, active)
  }, [onTouch, setPressed])

  const armBoostPulse = (withHaptic = true) => {
    setPressed('boost', true)
    onTouch('boost', true)
    setBoostPulseToken((token) => token + 1)
    if (withHaptic) triggerMobileHaptic(18)
  }

  const boostButtonProps = () => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic test events may not create a capturable pointer.
      }
      boostPointerActive.current = true
      armBoostPulse()
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (boostPointerActive.current) {
        boostPointerActive.current = false
        armBoostPulse(false)
      }
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      boostPointerActive.current = false
    },
    onContextMenu: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
    },
    'aria-pressed': pressed.boost,
    className: `touch-action-button boost ${pressed.boost ? 'pressed' : ''}`.trim(),
    draggable: false,
  })

  const normalizedAirbrakeCharge = Math.max(0, Math.min(1, Number.isFinite(airbrakeCharge) ? airbrakeCharge : 0))
  const visibleAirbrakeCharge = pressed.airbrake ? Math.max(normalizedAirbrakeCharge, 0.28) : normalizedAirbrakeCharge
  const airbrakeFill = `${visibleAirbrakeCharge * 100}%`
  const buttonProps = (command: DriveButtonCommand) => ({
    ...bindAction(command, handleDriveTouch, setPressed),
    'aria-pressed': pressed[command],
    className: `${command === 'left' || command === 'right' ? 'steer-button' : 'touch-action-button'} ${command} ${pressed[command] ? 'pressed' : ''}`.trim(),
    draggable: false,
  })

  return (
    <div className="touch-controls" aria-label="Touch driving controls">
      <div className="touch-actions">
        <button type="button" {...boostButtonProps()} aria-label="Boost">
          <span
            className="touch-button-fill boost-fill"
            key={boostPulseToken}
            style={{ animationDuration: `${MOBILE_BOOST_TAP_MS}ms` }}
            data-testid="mobile-boost-fill"
            aria-hidden="true"
          />
          <span className="touch-button-label">BOOST</span>
        </button>
        <button type="button" {...buttonProps('airbrake')} aria-label="Drift airbrake">
          <span
            className="touch-button-fill airbrake-fill"
            style={{ width: airbrakeFill, minWidth: pressed.airbrake ? '28%' : undefined }}
            data-testid="mobile-airbrake-fill"
            aria-hidden="true"
          />
          <span className="touch-button-label">DRIFT</span>
        </button>
      </div>

      <button type="button" {...buttonProps('left')} aria-label="Turn left">
        <span aria-hidden="true">←</span>
      </button>

      <button
        type="button"
        className="touch-reset-button"
        draggable={false}
        onClick={onReset}
        onPointerDown={(event) => {
          event.currentTarget.blur()
          triggerMobileHaptic(16)
        }}
        aria-label="Reset to checkpoint"
      >
        RESET
      </button>

      <button type="button" {...buttonProps('right')} aria-label="Turn right">
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
