import type { TouchCommand } from '../hooks/useNeonGame'

type Props = {
  onTouch: (command: TouchCommand, active: boolean) => void
  onReset: () => void
}

const bindTouch = (
  command: TouchCommand,
  onTouch: (command: TouchCommand, active: boolean) => void,
) => ({
  onPointerDown: () => onTouch(command, true),
  onPointerUp: () => onTouch(command, false),
  onPointerCancel: () => onTouch(command, false),
  onPointerLeave: () => onTouch(command, false),
})

export function TouchControls({ onTouch, onReset }: Props) {
  return (
    <div className="touch-controls" aria-label="Touch driving controls">
      <div className="touch-cluster">
        <button type="button" {...bindTouch('left', onTouch)} aria-label="Steer left">←</button>
        <button type="button" {...bindTouch('right', onTouch)} aria-label="Steer right">→</button>
      </div>
      <div className="touch-cluster right">
        <button type="button" {...bindTouch('airbrake', onTouch)} aria-label="Airbrake">AB</button>
        <button type="button" {...bindTouch('boost', onTouch)} aria-label="Boost">B</button>
        <button type="button" {...bindTouch('throttle', onTouch)} aria-label="Throttle">▲</button>
        <button type="button" onClick={onReset} aria-label="Reset to checkpoint">R</button>
      </div>
    </div>
  )
}

