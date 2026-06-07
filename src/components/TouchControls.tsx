import { useState, type PointerEvent } from 'react'
import type { TouchCommand } from '../hooks/useNeonGame'

type Props = {
  onTouch: (command: TouchCommand, active: boolean) => void
  onReset: () => void
}

const bindTouch = (
  command: TouchCommand,
  onTouch: (command: TouchCommand, active: boolean) => void,
  setPressed: (command: TouchCommand, active: boolean) => void,
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

export function TouchControls({ onTouch, onReset }: Props) {
  const [pressed, setPressedState] = useState<Record<TouchCommand, boolean>>({
    left: false,
    right: false,
    throttle: false,
    boost: false,
    airbrake: false,
  })
  const setPressed = (command: TouchCommand, active: boolean) => {
    setPressedState((current) => ({ ...current, [command]: active }))
  }
  const touchProps = (command: TouchCommand) => ({
    ...bindTouch(command, onTouch, setPressed),
    'aria-pressed': pressed[command],
    className: `${pressed[command] ? 'pressed' : ''} ${command === 'throttle' ? 'throttle-button' : ''}`.trim(),
  })

  return (
    <div className="touch-controls" aria-label="Touch driving controls">
      <div className="touch-cluster">
        <button type="button" {...touchProps('left')} aria-label="Steer left">←</button>
        <button type="button" {...touchProps('right')} aria-label="Steer right">→</button>
      </div>
      <div className="touch-cluster right">
        <button type="button" {...touchProps('airbrake')} aria-label="Airbrake">AB</button>
        <button type="button" {...touchProps('boost')} aria-label="Boost">B</button>
        <button type="button" {...touchProps('throttle')} aria-label="Throttle">▲</button>
        <button type="button" onClick={onReset} aria-label="Reset to checkpoint">R</button>
      </div>
    </div>
  )
}
