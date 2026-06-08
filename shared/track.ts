import { SOURCE_TRACK_SPECS, type SourceTrackNode, type SourceTrackSpec } from './sourceTracks'
import {
  add3,
  clamp,
  cross3,
  distance3,
  dot3,
  lerp,
  lerp3,
  normalize3,
  scale3,
  sub3,
  type Vec3,
  wrapDistance,
} from './math'

export type TrackId =
  | 'tutorial-circuit'
  | 'neon-oval'
  | 'friend-circuit'
  | 'skyline-sprint'
  | 'banked-speedway'
  | 'gravity-loop'
  | 'helix-loop'
  | 'inversion-ribbon'
  | 'corkscrew-relay'
  | 'looping-inferno'

export type TrackProfile = {
  center: Vec3
  tangent: Vec3
  right: Vec3
  up: Vec3
  width: number
  distance: number
  bankDegrees: number
}

export type TrackVisualSegment = TrackProfile & {
  length: number
}

export type SkylineTowerVisual = {
  position: Vec3
  scale: Vec3
  color: string
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
  visualSegments: TrackVisualSegment[]
  skylineTowers: SkylineTowerVisual[]
  sample: (distance: number) => TrackProfile
}

type TrackSample = TrackProfile

const WORLD_SCALE = 0.01
const SOURCE_MIN_TRACK_WIDTH = 900
const SOURCE_SPEED_PAD_LENGTH = 310
const up: Vec3 = { x: 0, y: 1, z: 0 }
const gateCount = 8

const STUNT_TRACKS = new Set<TrackId>([
  'gravity-loop',
  'helix-loop',
  'inversion-ribbon',
  'corkscrew-relay',
  'looping-inferno',
])

const nodeAt = (nodes: SourceTrackNode[], index: number): SourceTrackNode => {
  const wrapped = ((index % nodes.length) + nodes.length) % nodes.length
  return nodes[wrapped]
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

const catmullDerivative = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t
  return 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2)
}

const catmullVec = (p0: SourceTrackNode, p1: SourceTrackNode, p2: SourceTrackNode, p3: SourceTrackNode, t: number): Vec3 => ({
  x: catmull(p0.x, p1.x, p2.x, p3.x, t),
  y: catmull(p0.y, p1.y, p2.y, p3.y, t),
  z: catmull(p0.z, p1.z, p2.z, p3.z, t),
})

const catmullDerivativeVec = (p0: SourceTrackNode, p1: SourceTrackNode, p2: SourceTrackNode, p3: SourceTrackNode, t: number): Vec3 => ({
  x: catmullDerivative(p0.x, p1.x, p2.x, p3.x, t),
  y: catmullDerivative(p0.y, p1.y, p2.y, p3.y, t),
  z: catmullDerivative(p0.z, p1.z, p2.z, p3.z, t),
})

const sourcePositionToWorld = (spec: SourceTrackSpec, position: Vec3): Vec3 => ({
  x: position.x * spec.footprintMultiplier * WORLD_SCALE,
  y: position.z * clamp(spec.heightMultiplier, 0, 1.5) * WORLD_SCALE,
  z: position.y * spec.footprintMultiplier * WORLD_SCALE,
})

const sourceDirectionToWorld = (spec: SourceTrackSpec, direction: Vec3): Vec3 => ({
  x: direction.x * spec.footprintMultiplier,
  y: direction.z * clamp(spec.heightMultiplier, 0, 1.5),
  z: direction.y * spec.footprintMultiplier,
})

const rotateAroundAxis = (vector: Vec3, axis: Vec3, radians: number): Vec3 => {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return add3(
    add3(scale3(vector, c), scale3(cross3(axis, vector), s)),
    scale3(axis, dot3(axis, vector) * (1 - c)),
  )
}

const sampleSourceNode = (spec: SourceTrackSpec, index: number, t: number): Omit<TrackSample, 'distance'> => {
  const p0 = nodeAt(spec.nodes, index - 1)
  const p1 = nodeAt(spec.nodes, index)
  const p2 = nodeAt(spec.nodes, index + 1)
  const p3 = nodeAt(spec.nodes, index + 2)
  const center = sourcePositionToWorld(spec, catmullVec(p0, p1, p2, p3, t))
  const rawTangent = sourceDirectionToWorld(spec, catmullDerivativeVec(p0, p1, p2, p3, t))
  const fallbackDirection = sourceDirectionToWorld(spec, sub3({ x: p2.x, y: p2.y, z: p2.z }, { x: p1.x, y: p1.y, z: p1.z }))
  const tangent = normalize3(rawTangent, normalize3(fallbackDirection, { x: 1, y: 0, z: 0 }))
  const width = clamp(
    catmull(p0.width, p1.width, p2.width, p3.width, t) * spec.widthMultiplier,
    SOURCE_MIN_TRACK_WIDTH,
    spec.maxWidth,
  ) * WORLD_SCALE
  const bank = catmull(p0.bank, p1.bank, p2.bank, p3.bank, t) * clamp(spec.bankMultiplier, 0, 1.5)
  const flatRight = normalize3(cross3(up, tangent), { x: 0, y: 0, z: -1 })
  let right = normalize3(rotateAroundAxis(flatRight, tangent, (bank * Math.PI) / 180), flatRight)
  let bankedUp = normalize3(cross3(tangent, right), up)

  if (!spec.allowInvertedFrame && bankedUp.y < 0) {
    bankedUp = scale3(bankedUp, -1)
    right = scale3(right, -1)
  }

  return {
    center,
    tangent,
    right: normalize3(right, flatRight),
    up: normalize3(bankedUp, up),
    width,
    bankDegrees: bank,
  }
}

const bakeTrackSamples = (spec: SourceTrackSpec): { samples: TrackSample[]; totalLength: number } => {
  const samples: TrackSample[] = []
  let distance = 0
  let previous: TrackSample | null = null

  for (let index = 0; index < spec.nodes.length; index += 1) {
    for (let step = 0; step < spec.subdivisions; step += 1) {
      const t = step / spec.subdivisions
      const sample = sampleSourceNode(spec, index, t)
      if (previous) distance += distance3(sample.center, previous.center)
      const baked = { ...sample, distance }
      samples.push(baked)
      previous = baked
    }
  }

  const totalLength = samples.length > 1
    ? distance + distance3(samples[0].center, samples[samples.length - 1].center)
    : distance
  return { samples, totalLength }
}

const makeVisualSegments = (samples: TrackSample[], totalLength: number, allowInvertedFrame: boolean): TrackVisualSegment[] =>
  samples.map((a, index) => {
    const b = samples[(index + 1) % samples.length]
    const length = index === samples.length - 1
      ? Math.max(0.0001, totalLength - a.distance)
      : Math.max(0.0001, b.distance - a.distance)
    const tangent = normalize3(sub3(b.center, a.center), normalize3(a.tangent, { x: 1, y: 0, z: 0 }))
    const averagedRight = add3(a.right, b.right)
    const projectedRight = sub3(averagedRight, scale3(tangent, dot3(averagedRight, tangent)))
    let right = normalize3(projectedRight, normalize3(a.right, { x: 0, y: 0, z: -1 }))
    const averageUp = normalize3(add3(a.up, b.up), normalize3(a.up, up))
    let segmentUp = normalize3(cross3(tangent, right), averageUp)

    if (!allowInvertedFrame && segmentUp.y < 0) {
      segmentUp = scale3(segmentUp, -1)
      right = scale3(right, -1)
    }

    right = normalize3(cross3(segmentUp, tangent), right)
    segmentUp = normalize3(cross3(tangent, right), segmentUp)

    return {
      center: lerp3(a.center, b.center, 0.5),
      tangent,
      right,
      up: segmentUp,
      width: (a.width + b.width) * 0.5,
      distance: wrapDistance(a.distance + length * 0.5, totalLength),
      bankDegrees: (a.bankDegrees + b.bankDegrees) * 0.5,
      length,
    }
  })

const skylineTowerColors = {
  city: '#05070b',
  cityDim: '#040509',
  cityCyan: '#04425c',
  cityMagenta: '#570f52',
} as const

const skylineTowerPlacements = [
  ['minX', -2100, 'minZ', -2250, 520, 520, 1420, skylineTowerColors.cityDim],
  ['centerX', -2600, 'minZ', -2450, 380, 420, 960, skylineTowerColors.city],
  ['centerX', 2300, 'minZ', -2360, 440, 390, 1180, skylineTowerColors.cityDim],
  ['maxX', 2100, 'minZ', -1840, 500, 540, 1520, skylineTowerColors.city],
  ['maxX', 2380, 'centerZ', -960, 360, 360, 920, skylineTowerColors.cityCyan],
  ['maxX', 2220, 'centerZ', 1320, 560, 470, 1640, skylineTowerColors.cityDim],
  ['centerX', 1740, 'maxZ', 2180, 460, 430, 1220, skylineTowerColors.city],
  ['centerX', -1360, 'maxZ', 2400, 380, 380, 980, skylineTowerColors.cityDim],
  ['minX', -2020, 'maxZ', 1900, 520, 460, 1480, skylineTowerColors.city],
  ['minX', -2460, 'centerZ', 760, 360, 420, 900, skylineTowerColors.cityCyan],
  ['minX', -3100, 'centerZ', -1220, 340, 360, 1180, skylineTowerColors.cityDim],
  ['minX', -3320, 'centerZ', 1640, 300, 330, 1040, skylineTowerColors.cityCyan],
  ['centerX', -420, 'minZ', -3060, 420, 360, 1360, skylineTowerColors.city],
  ['centerX', 820, 'minZ', -3260, 300, 300, 880, skylineTowerColors.cityDim],
  ['maxX', 3100, 'centerZ', -1540, 380, 360, 1180, skylineTowerColors.cityCyan],
  ['maxX', 3300, 'centerZ', 540, 420, 400, 1360, skylineTowerColors.cityDim],
  ['centerX', 720, 'maxZ', 3120, 360, 340, 1280, skylineTowerColors.cityCyan],
  ['centerX', -720, 'maxZ', 3260, 330, 330, 1080, skylineTowerColors.cityDim],
  ['minX', -2920, 'minZ', -520, 260, 300, 820, skylineTowerColors.city],
  ['maxX', 2860, 'maxZ', -420, 280, 320, 960, skylineTowerColors.city],
  ['centerX', -1960, 'minZ', -3450, 300, 320, 1120, skylineTowerColors.cityMagenta],
  ['centerX', 1960, 'maxZ', 3520, 320, 340, 1320, skylineTowerColors.cityMagenta],
  ['minX', -3650, 'minZ', 360, 240, 300, 860, skylineTowerColors.cityCyan],
  ['maxX', 3680, 'maxZ', -680, 260, 300, 940, skylineTowerColors.cityCyan],
  ['centerX', 3160, 'minZ', -3060, 280, 320, 1040, skylineTowerColors.cityDim],
  ['centerX', -3040, 'maxZ', 3040, 280, 320, 1040, skylineTowerColors.cityDim],
  ['minX', -4300, 'minZ', -1620, 260, 280, 1160, skylineTowerColors.city],
  ['minX', -4380, 'maxZ', 920, 220, 260, 980, skylineTowerColors.cityMagenta],
  ['maxX', 4320, 'minZ', 1260, 260, 280, 1220, skylineTowerColors.city],
  ['maxX', 4460, 'maxZ', 1540, 240, 260, 1080, skylineTowerColors.cityCyan],
  ['centerX', -760, 'minZ', -4120, 260, 280, 1040, skylineTowerColors.cityCyan],
  ['centerX', 1460, 'minZ', -3980, 220, 260, 940, skylineTowerColors.cityDim],
  ['centerX', -1540, 'maxZ', 4080, 240, 280, 1080, skylineTowerColors.city],
  ['centerX', 460, 'maxZ', 4280, 260, 300, 1180, skylineTowerColors.cityMagenta],
] as const

const makeSkylineTowers = (trackId: TrackId, samples: TrackSample[]): SkylineTowerVisual[] => {
  if (trackId === 'tutorial-circuit' || trackId === 'neon-oval') return []
  const xs = samples.map((sample) => sample.center.x)
  const zs = samples.map((sample) => sample.center.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const anchors = {
    minX,
    maxX,
    centerX: (minX + maxX) * 0.5,
    minZ,
    maxZ,
    centerZ: (minZ + maxZ) * 0.5,
  }
  const world = (sourceUnits: number): number => sourceUnits * WORLD_SCALE
  const modelScale = (sourceUnits: number): number => sourceUnits * WORLD_SCALE * 2

  return skylineTowerPlacements.map(([xAnchor, xOffset, zAnchor, zOffset, width, depth, height, color]) => ({
    position: {
      x: anchors[xAnchor] + world(xOffset),
      y: world(height * 0.42),
      z: anchors[zAnchor] + world(zOffset),
    },
    scale: {
      x: modelScale(width),
      y: modelScale(height),
      z: modelScale(depth),
    },
    color,
  }))
}

const interpolateSample = (
  samples: TrackSample[],
  totalLength: number,
  distance: number,
  allowInvertedFrame: boolean,
): TrackProfile => {
  const wrapped = wrapDistance(distance, totalLength)
  let low = 0
  let high = samples.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (samples[mid].distance <= wrapped) low = mid + 1
    else high = mid - 1
  }
  const index = Math.max(0, high)

  const a = samples[index]
  const b = samples[(index + 1) % samples.length]
  const segmentEnd = index === samples.length - 1 ? totalLength : b.distance
  const segmentLength = Math.max(0.0001, segmentEnd - a.distance)
  const t = clamp((wrapped - a.distance) / segmentLength, 0, 1)
  const tangent = normalize3(lerp3(a.tangent, b.tangent, t), normalize3(sub3(b.center, a.center), a.tangent))
  const right = normalize3(lerp3(a.right, b.right, t), a.right)
  let profileUp = normalize3(cross3(tangent, right), lerp3(a.up, b.up, t))
  if (!allowInvertedFrame && profileUp.y < 0) profileUp = scale3(profileUp, -1)

  return {
    center: lerp3(a.center, b.center, t),
    tangent,
    right,
    up: profileUp,
    width: lerp(a.width, b.width, t),
    distance: wrapped,
    bankDegrees: lerp(a.bankDegrees, b.bankDegrees, t),
  }
}

const makeGates = (track: Pick<RaceTrack, 'totalLength' | 'sample'>): TrackGate[] =>
  Array.from({ length: gateCount }, (_, index) => {
    const distance = (track.totalLength * index) / gateCount
    return {
      index,
      distance,
      halfWidth: track.sample(distance).width * 0.5 + 0.92,
    }
  })

const makeStartGrid = (trackId: TrackId): StartGridSlot[] => {
  if (trackId === 'tutorial-circuit') {
    return [
      { index: 0, distance: 0, lane: 0, back: 12 },
      { index: 1, distance: 0, lane: -10, back: 24 },
      { index: 2, distance: 0, lane: 10, back: 24 },
      { index: 3, distance: 0, lane: -16, back: 36 },
      { index: 4, distance: 0, lane: 16, back: 36 },
      { index: 5, distance: 0, lane: -5, back: 48 },
      { index: 6, distance: 0, lane: 5, back: 48 },
      { index: 7, distance: 0, lane: 0, back: 60 },
    ]
  }
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

const insideTurnLaneScale = (track: RaceTrack, fraction: number, scale: number): number => {
  const distance = track.totalLength * fraction
  const here = track.sample(distance)
  const ahead = track.sample(distance + track.totalLength * 0.035)
  const turn = here.tangent.x * ahead.tangent.z - here.tangent.z * ahead.tangent.x
  if (Math.abs(turn) < 0.075) return 0
  return turn > 0 ? -scale : scale
}

const speedPadFractionsFor = (id: TrackId): number[] => {
  if (id === 'tutorial-circuit') return [0.32, 0.48, 0.62, 0.78, 0.9]
  if (STUNT_TRACKS.has(id)) return [0.1, 0.24, 0.4, 0.56, 0.72, 0.88]
  if (id === 'banked-speedway') return [0.11, 0.28, 0.43, 0.57, 0.74, 0.9]
  return [0.1, 0.24, 0.48, 0.62, 0.82, 0.93]
}

const rechargePadFractionsFor = (id: TrackId): number[] => {
  if (id === 'tutorial-circuit') return [0.18, 0.36, 0.68]
  if (STUNT_TRACKS.has(id)) return [0.33, 0.67]
  if (id === 'banked-speedway') return [0.36, 0.69]
  return [0.34, 0.74]
}

const speedPadLaneScaleFor = (track: RaceTrack, index: number, fraction: number): number => {
  if (track.id !== 'banked-speedway' && !STUNT_TRACKS.has(track.id)) {
    return index % 3 === 1 ? -0.18 : index % 3 === 2 ? 0.18 : 0
  }

  const inside = insideTurnLaneScale(track, fraction, 0.22)
  if (Math.abs(inside) > 0.01) return inside
  return index % 2 === 0 ? 0 : index % 4 === 1 ? -0.13 : 0.13
}

const rechargePadLaneScaleFor = (track: RaceTrack, index: number, fraction: number): number => {
  if (track.id !== 'banked-speedway' && !STUNT_TRACKS.has(track.id)) return index % 2 === 0 ? -0.28 : 0.28

  const inside = insideTurnLaneScale(track, fraction, 0.3)
  if (Math.abs(inside) > 0.01) return inside
  return index % 2 === 0 ? -0.24 : 0.24
}

const makePads = (track: RaceTrack): TrackPad[] => {
  const speedHalfLength = SOURCE_SPEED_PAD_LENGTH * 0.5 * WORLD_SCALE
  const referenceWidth = track.width
  const halfWidth = referenceWidth * 0.09
  const speedPads: TrackPad[] = speedPadFractionsFor(track.id).map((fraction, index) => {
    const distance = track.totalLength * fraction
    const profile = track.sample(distance)
    return {
      id: `boost-${index}`,
      kind: 'boost',
      distance,
      lane: speedPadLaneScaleFor(track, index, fraction) * profile.width,
      halfLength: speedHalfLength,
      halfWidth,
      cooldownSeconds: 0.85,
    }
  })
  const rechargePads: TrackPad[] = rechargePadFractionsFor(track.id).map((fraction, index) => {
    const distance = track.totalLength * fraction
    const profile = track.sample(distance)
    return {
      id: `recharge-${index}`,
      kind: 'recharge',
      distance,
      lane: rechargePadLaneScaleFor(track, index, fraction) * profile.width,
      halfLength: speedHalfLength,
      halfWidth,
      cooldownSeconds: 1.15,
    }
  })

  return [...speedPads, ...rechargePads]
}

const makeSourceTrack = (spec: SourceTrackSpec): RaceTrack => {
  const { samples, totalLength } = bakeTrackSamples(spec)
  const averageWidth = samples.reduce((sum, sample) => sum + sample.width, 0) / Math.max(1, samples.length)
  const track: RaceTrack = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    totalLength,
    width: averageWidth,
    gates: [],
    pads: [],
    startGrid: makeStartGrid(spec.id),
    visualSegments: makeVisualSegments(samples, totalLength, spec.allowInvertedFrame),
    skylineTowers: makeSkylineTowers(spec.id, samples),
    sample: (distance: number) => interpolateSample(samples, totalLength, distance, spec.allowInvertedFrame),
  }
  track.gates = makeGates(track)
  track.pads = makePads(track)
  return track
}

export const TRACKS: RaceTrack[] = SOURCE_TRACK_SPECS.map(makeSourceTrack)

export const NEON_OVAL: RaceTrack = TRACKS.find((track) => track.id === 'neon-oval') ?? TRACKS[0]

export const trackById = (id: TrackId): RaceTrack =>
  TRACKS.find((track) => track.id === id) ?? NEON_OVAL

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
    const error = Math.abs(along) + Math.abs(normal) + Math.max(0, Math.abs(lane) - profile.width * 0.5)
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
