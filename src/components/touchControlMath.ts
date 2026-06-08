const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0

export const TOUCH_STEER_DEADZONE = 0.1
export const TOUCH_STEER_MAX = 0.92
export const TOUCH_THUMB_TRAVEL = 76

export const touchSteerFromCenteredRatio = (centeredRatio: number): number => {
  const raw = clampUnit(-centeredRatio)
  const magnitude = Math.abs(raw)
  if (magnitude <= TOUCH_STEER_DEADZONE) return 0
  const shaped = ((magnitude - TOUCH_STEER_DEADZONE) / (1 - TOUCH_STEER_DEADZONE)) ** 1.18
  return Math.sign(raw) * Math.min(TOUCH_STEER_MAX, shaped * TOUCH_STEER_MAX)
}

export const touchThumbOffset = (steer: number): number =>
  -clampUnit(steer) * TOUCH_THUMB_TRAVEL
