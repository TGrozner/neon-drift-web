import { useEffect, useState, type PointerEvent } from 'react'
import type { TouchCommand } from '../hooks/useNeonGame'

type DriveButtonCommand = Extract<TouchCommand, 'left' | 'right' | 'boost' | 'airbrake'>

type Props = {
  autoThrottle: boolean
  onTouch: (command: TouchCommand, active: boolean) => void
  onReset: () => void
}

const MOBILE_CONTROLS_QUERY = '(max-width: 820px)'

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

export function TouchControls({ autoThrottle, onTouch, onReset }: Props) {
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

  const setPressed = (command: DriveButtonCommand, active: boolean) => {
    setPressedState((current) => ({ ...current, [command]: active }))
  }

  const buttonProps = (command: DriveButtonCommand) => ({
    ...bindAction(command, onTouch, setPressed),
    'aria-pressed': pressed[command],
    className: `${command === 'left' || command === 'right' ? 'steer-button' : 'touch-action-button'} ${command} ${pressed[command] ? 'pressed' : ''}`.trim(),
  })

  return (
    <div className="touch-controls" aria-label="Touch driving controls">
      <button type="button" {...buttonProps('left')} aria-label="Turn left">
        <span aria-hidden="true">←</span>
      </button>

      <div className="touch-actions">
        <button type="button" {...buttonProps('boost')} aria-label="Boost">BOOST</button>
        <button type="button" {...buttonProps('airbrake')} aria-label="Drift airbrake">DRIFT</button>
        <button type="button" className="touch-reset-button" onClick={onReset} aria-label="Reset to checkpoint">RESET</button>
      </div>

      <button type="button" {...buttonProps('right')} aria-label="Turn right">
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
