export type Vec2 = {
  x: number
  y: number
}

export type Vec3 = {
  x: number
  y: number
  z: number
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y })

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })

export const scale = (v: Vec2, amount: number): Vec2 => ({
  x: v.x * amount,
  y: v.y * amount,
})

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y

export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x

export const lengthSq = (v: Vec2): number => dot(v, v)

export const length = (v: Vec2): number => Math.hypot(v.x, v.y)

export const normalize = (v: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
  const len = length(v)
  return len > 0.000001 ? scale(v, 1 / len) : fallback
}

export const perpendicularRight = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x })

export const fromAngle = (angle: number): Vec2 => ({
  x: Math.cos(angle),
  y: Math.sin(angle),
})

export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x)

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const saturate = (value: number): number => clamp(value, 0, 1)

export const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t

export const expDecay = (value: number, rate: number, dt: number): number =>
  value * Math.exp(-rate * dt)

export const approach = (value: number, target: number, rate: number, dt: number): number =>
  lerp(value, target, saturate(rate * dt))

export const wrapDistance = (distance: number, totalLength: number): number => {
  if (totalLength <= 0) return distance
  const wrapped = distance % totalLength
  return wrapped < 0 ? wrapped + totalLength : wrapped
}

export const signedWrappedDelta = (from: number, to: number, totalLength: number): number => {
  if (totalLength <= 0) return to - from
  let delta = to - from
  if (delta > totalLength * 0.5) delta -= totalLength
  if (delta < -totalLength * 0.5) delta += totalLength
  return delta
}

export const distanceAlongForward = (
  from: number,
  to: number,
  totalLength: number,
): number => {
  if (totalLength <= 0) return to - from
  let ahead = wrapDistance(to, totalLength) - wrapDistance(from, totalLength)
  if (ahead < 0) ahead += totalLength
  return ahead
}

export const rotate = (v: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

export const scale3 = (v: Vec3, amount: number): Vec3 => ({
  x: v.x * amount,
  y: v.y * amount,
  z: v.z * amount,
})

export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

export const normalize3 = (
  v: Vec3,
  fallback: Vec3 = { x: 1, y: 0, z: 0 },
): Vec3 => {
  const len = length3(v)
  return len > 0.000001 ? scale3(v, 1 / len) : fallback
}

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
})

export const distance3 = (a: Vec3, b: Vec3): number => length3(sub3(a, b))

