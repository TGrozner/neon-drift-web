import {
  add3,
  cross3,
  dot3,
  normalize3,
  scale3,
  sub3,
  type Vec3,
  wrapDistance,
} from './math'

export type TrackId = 'neon-oval'

export type TrackProfile = {
  center: Vec3
  tangent: Vec3
  right: Vec3
  up: Vec3
  width: number
  distance: number
  bankDegrees: number
}

export type TrackGate = {
  index: number
  distance: number
  halfWidth: number
}

export type TrackPadKind = 'boost' | 'recharge'

export type TrackPad = {
  id: string
  kind: TrackPadKind
  distance: number
  lane: number
  halfLength: number
  halfWidth: number
  cooldownSeconds: number
}

export type StartGridSlot = {
  index: number
  distance: number
  lane: number
  back: number
}

export type RaceTrack = {
  id: TrackId
  name: string
  description: string
  totalLength: number
  width: number
  gates: TrackGate[]
  pads: TrackPad[]
  startGrid: StartGridSlot[]
  sample: (distance: number) => TrackProfile
}

const up: Vec3 = { x: 0, y: 1, z: 0 }
const straightHalfLength = 39
const turnRadius = 9
const trackWidth = 19.1
const lowerForwardLength = straightHalfLength
const arcLength = Math.PI * turnRadius
const upperLength = straightHalfLength * 2
const lowerReturnLength = straightHalfLength
const neonOvalLength = lowerForwardLength + arcLength + upperLength + arcLength + lowerReturnLength

type OvalSample = {
  center: Vec3
  tangent: Vec3
}

const sampleNeonOvalCenter = (distance: number): OvalSample => {
  let d = wrapDistance(distance, neonOvalLength)

  if (d <= lowerForwardLength) {
    return {
      center: { x: d, y: 0, z: -turnRadius },
      tangent: { x: 1, y: 0, z: 0 },
    }
  }

  d -= lowerForwardLength
  if (d <= arcLength) {
    const angle = -Math.PI * 0.5 + d / turnRadius
    return {
      center: {
        x: straightHalfLength + Math.cos(angle) * turnRadius,
        y: 0,
        z: Math.sin(angle) * turnRadius,
      },
      tangent: normalize3({ x: -Math.sin(angle), y: 0, z: Math.cos(angle) }),
    }
  }

  d -= arcLength
  if (d <= upperLength) {
    return {
      center: { x: straightHalfLength - d, y: 0, z: turnRadius },
      tangent: { x: -1, y: 0, z: 0 },
    }
  }

  d -= upperLength
  if (d <= arcLength) {
    const angle = Math.PI * 0.5 + d / turnRadius
    return {
      center: {
        x: -straightHalfLength + Math.cos(angle) * turnRadius,
        y: 0,
        z: Math.sin(angle) * turnRadius,
      },
      tangent: normalize3({ x: -Math.sin(angle), y: 0, z: Math.cos(angle) }),
    }
  }

  d -= arcLength
  return {
    center: {
      x: -straightHalfLength + Math.min(d, lowerReturnLength),
      y: 0,
      z: -turnRadius,
    },
    tangent: { x: 1, y: 0, z: 0 },
  }
}

const bankForDistance = (distance: number): number => {
  const d = wrapDistance(distance, neonOvalLength)
  const firstTurn = d > lowerForwardLength && d < lowerForwardLength + arcLength
  const secondTurn =
    d > lowerForwardLength + arcLength + upperLength &&
    d < lowerForwardLength + arcLength + upperLength + arcLength
  if (!firstTurn && !secondTurn) return 0
  const turnStart = firstTurn
    ? lowerForwardLength
    : lowerForwardLength + arcLength + upperLength
  const turnRatio = (d - turnStart) / arcLength
  const eased = Math.sin(Math.PI * Math.min(1, Math.max(0, turnRatio)))
  return (firstTurn ? -1 : 1) * eased * 22
}

export const sampleNeonOval = (distance: number): TrackProfile => {
  const wrapped = wrapDistance(distance, neonOvalLength)
  const sampled = sampleNeonOvalCenter(wrapped)
  const tangent = normalize3(sampled.tangent)
  const flatRight = normalize3(cross3(up, tangent), { x: 0, y: 0, z: 1 })
  const bank = bankForDistance(wrapped)
  const bankRadians = (bank * Math.PI) / 180
  const right = normalize3({
    x: flatRight.x * Math.cos(bankRadians) + up.x * Math.sin(bankRadians),
    y: flatRight.y * Math.cos(bankRadians) + up.y * Math.sin(bankRadians),
    z: flatRight.z * Math.cos(bankRadians) + up.z * Math.sin(bankRadians),
  })
  const bankedUp = normalize3(cross3(tangent, right), up)

  return {
    center: sampled.center,
    tangent,
    right,
    up: bankedUp,
    width: trackWidth,
    distance: wrapped,
    bankDegrees: bank,
  }
}

const gateCount = 8

const makeGates = (): TrackGate[] =>
  Array.from({ length: gateCount }, (_, index) => ({
    index,
    distance: (neonOvalLength * index) / gateCount,
    halfWidth: trackWidth * 0.56,
  }))

const makePads = (): TrackPad[] => [
  { id: 'boost-0', kind: 'boost', distance: neonOvalLength * 0.08, lane: -4.8, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
  { id: 'boost-1', kind: 'boost', distance: neonOvalLength * 0.2, lane: 4.8, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
  { id: 'recharge-0', kind: 'recharge', distance: neonOvalLength * 0.34, lane: -3.8, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 1.15 },
  { id: 'boost-2', kind: 'boost', distance: neonOvalLength * 0.46, lane: 5.2, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
  { id: 'boost-3', kind: 'boost', distance: neonOvalLength * 0.58, lane: -5.2, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
  { id: 'recharge-1', kind: 'recharge', distance: neonOvalLength * 0.72, lane: 3.8, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 1.15 },
  { id: 'boost-4', kind: 'boost', distance: neonOvalLength * 0.84, lane: -4.2, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
  { id: 'boost-5', kind: 'boost', distance: neonOvalLength * 0.94, lane: 4.2, halfLength: 3.1, halfWidth: 1.9, cooldownSeconds: 0.85 },
]

const makeStartGrid = (): StartGridSlot[] => {
  const slots: StartGridSlot[] = []
  const lateralSpacing = 4.9
  const rowSpacing = 5
  const columns = 4
  for (let index = 0; index < 8; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    slots.push({
      index,
      distance: 0,
      lane: (column - (columns - 1) * 0.5) * lateralSpacing,
      back: 8.2 + row * rowSpacing,
    })
  }
  return slots
}

export const NEON_OVAL: RaceTrack = {
  id: 'neon-oval',
  name: 'Neon Oval',
  description: 'Flat high-speed oval with banked visual sweepers.',
  totalLength: neonOvalLength,
  width: trackWidth,
  gates: makeGates(),
  pads: makePads(),
  startGrid: makeStartGrid(),
  sample: sampleNeonOval,
}

export const TRACKS: RaceTrack[] = [NEON_OVAL]

export const trackToWorld = (
  track: RaceTrack,
  distance: number,
  lane = 0,
  clearance = 0,
): Vec3 => {
  const profile = track.sample(distance)
  return add3(add3(profile.center, scale3(profile.right, lane)), scale3(profile.up, clearance))
}

export const nearestTrackCoordinate = (
  track: RaceTrack,
  world: Vec3,
  samples = 256,
): { distance: number; lane: number; lateralError: number } => {
  let bestDistance = 0
  let bestLane = 0
  let bestError = Number.POSITIVE_INFINITY

  for (let i = 0; i < samples; i += 1) {
    const distance = (track.totalLength * i) / samples
    const profile = track.sample(distance)
    const delta = sub3(world, profile.center)
    const lane = dot3(delta, profile.right)
    const along = dot3(delta, profile.tangent)
    const normal = dot3(delta, profile.up)
    const error = Math.abs(along) + Math.abs(normal) + Math.max(0, Math.abs(lane) - track.width * 0.5)
    if (error < bestError) {
      bestError = error
      bestDistance = distance
      bestLane = lane
    }
  }

  return {
    distance: bestDistance,
    lane: bestLane,
    lateralError: bestError,
  }
}

