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
  | 'tutorial-debug-circuit'
  | 'neon-oval'
  | 'friend-circuit'
  | 'skyline-sprint'
  | 'banked-speedway'
  | 'gravity-loop'
  | 'helix-loop'
  | 'inversion-ribbon'
  | 'corkscrew-relay'
  | 'looping-inferno'
  | 'vortex-gauntlet'
  | 'neon-blender'

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
  sample: (distance: number) => TrackProfile
}

type TrackSample = TrackProfile

const WORLD_SCALE = 0.01
const SOURCE_MIN_TRACK_WIDTH = 900
const SOURCE_SPEED_PAD_LENGTH = 310
export const TRACK_GEOMETRY_SMOOTHING = 2
const up: Vec3 = { x: 0, y: 1, z: 0 }
const gateCount = 8

const isSimpleTrainingGeometryTrack = (trackId: TrackId): boolean =>
  trackId === 'tutorial-circuit' || trackId === 'tutorial-debug-circuit'

const STUNT_TRACKS = new Set<TrackId>([
  'gravity-loop',
  'helix-loop',
  'inversion-ribbon',
  'corkscrew-relay',
  'looping-inferno',
  'vortex-gauntlet',
  'neon-blender',
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

const bakeTrackSamples = (
  spec: SourceTrackSpec,
  subdivisions = spec.subdivisions,
): { samples: TrackSample[]; totalLength: number } => {
  const samples: TrackSample[] = []
  let distance = 0
  let previous: TrackSample | null = null

  for (let index = 0; index < spec.nodes.length; index += 1) {
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions
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

const makeSmoothVisualSegments = (
  samples: TrackSample[],
  totalLength: number,
  segmentCount: number,
  allowInvertedFrame: boolean,
): TrackVisualSegment[] => {
  const segmentLength = totalLength / Math.max(1, segmentCount)
  return Array.from({ length: segmentCount }, (_, index) => {
    const distance = index * segmentLength + segmentLength * 0.5
    return {
      ...interpolateSample(samples, totalLength, distance, allowInvertedFrame),
      length: segmentLength,
    }
  })
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
    const fractions = gateFractionsFor(track as RaceTrack)
    const distance = track.totalLength * (fractions[index] ?? index / gateCount)
    const profile = track.sample(distance)
    const pressure = gatePressureFor(track as RaceTrack, index)
    return {
      index,
      distance,
      halfWidth: profile.width * pressure + 0.42,
    }
  })

const gateFractionsFor = (track: RaceTrack): number[] => {
  if (isSimpleTrainingGeometryTrack(track.id)) return [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88]
  if (STUNT_TRACKS.has(track.id)) return [0, 0.08, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9]
  if (track.id === 'banked-speedway') return [0, 0.1, 0.23, 0.36, 0.5, 0.64, 0.77, 0.9]
  return [0, 0.09, 0.22, 0.36, 0.5, 0.63, 0.77, 0.9]
}

const gatePressureFor = (track: RaceTrack, index: number): number => {
  if (index === 0) return 0.46
  if (STUNT_TRACKS.has(track.id)) return index % 2 === 0 ? 0.31 : 0.34
  if (isSimpleTrainingGeometryTrack(track.id)) return index % 2 === 0 ? 0.36 : 0.39
  return index % 2 === 0 ? 0.33 : 0.36
}

const makeStartGrid = (trackId: TrackId): StartGridSlot[] => {
  if (isSimpleTrainingGeometryTrack(trackId)) {
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
  if (isSimpleTrainingGeometryTrack(id)) return [0.32, 0.48, 0.62, 0.78, 0.9]
  if (STUNT_TRACKS.has(id)) return [0.1, 0.24, 0.4, 0.56, 0.72, 0.88]
  if (id === 'banked-speedway') return [0.11, 0.28, 0.43, 0.57, 0.74, 0.9]
  return [0.1, 0.24, 0.48, 0.62, 0.82, 0.93]
}

const rechargePadFractionsFor = (id: TrackId): number[] => {
  if (isSimpleTrainingGeometryTrack(id)) return [0.18, 0.36, 0.68]
  if (STUNT_TRACKS.has(id)) return [0.33, 0.67]
  if (id === 'banked-speedway') return [0.36, 0.69]
  return [0.34, 0.74]
}

const speedPadLaneScaleFor = (track: RaceTrack, index: number, fraction: number): number => {
  if (track.id !== 'banked-speedway' && !STUNT_TRACKS.has(track.id)) {
    return index % 3 === 1 ? -0.34 : index % 3 === 2 ? 0.34 : index % 2 === 0 ? 0.18 : -0.18
  }

  const inside = insideTurnLaneScale(track, fraction, 0.36)
  if (Math.abs(inside) > 0.01) return inside
  return index % 2 === 0 ? 0.22 : index % 4 === 1 ? -0.32 : 0.32
}

const rechargePadLaneScaleFor = (track: RaceTrack, index: number, fraction: number): number => {
  if (track.id !== 'banked-speedway' && !STUNT_TRACKS.has(track.id)) return index % 2 === 0 ? -0.4 : 0.4

  const inside = insideTurnLaneScale(track, fraction, 0.42)
  if (Math.abs(inside) > 0.01) return -inside
  return index % 2 === 0 ? -0.38 : 0.38
}

const makePads = (track: RaceTrack): TrackPad[] => {
  const speedHalfLength = SOURCE_SPEED_PAD_LENGTH * 0.5 * WORLD_SCALE
  const referenceWidth = track.width
  const halfWidth = referenceWidth * 0.058
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
  const visualSegmentCount = spec.nodes.length * spec.subdivisions
  const { samples: runtimeSamples, totalLength } = bakeTrackSamples(
    spec,
    spec.subdivisions * TRACK_GEOMETRY_SMOOTHING,
  )
  const averageWidth = runtimeSamples.reduce((sum, sample) => sum + sample.width, 0) / Math.max(1, runtimeSamples.length)
  const track: RaceTrack = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    totalLength,
    width: averageWidth,
    gates: [],
    pads: [],
    startGrid: makeStartGrid(spec.id),
    visualSegments: makeSmoothVisualSegments(
      runtimeSamples,
      totalLength,
      visualSegmentCount * TRACK_GEOMETRY_SMOOTHING,
      spec.allowInvertedFrame,
    ),
    sample: (distance: number) => interpolateSample(runtimeSamples, totalLength, distance, spec.allowInvertedFrame),
  }
  track.gates = makeGates(track)
  track.pads = makePads(track)
  return track
}

export const ALL_TRACKS: RaceTrack[] = SOURCE_TRACK_SPECS.map(makeSourceTrack)

export const TUTORIAL_CIRCUIT: RaceTrack =
  ALL_TRACKS.find((track) => track.id === 'tutorial-circuit') ?? ALL_TRACKS[0]

const SELECTABLE_TRACKS = ALL_TRACKS.filter((track) => track.id !== 'neon-oval')
const DEBUG_TRACK = SELECTABLE_TRACKS.find((track) => track.id === 'tutorial-debug-circuit')
export const TRACKS: RaceTrack[] = DEBUG_TRACK
  ? [...SELECTABLE_TRACKS.filter((track) => track.id !== 'tutorial-debug-circuit'), DEBUG_TRACK]
  : SELECTABLE_TRACKS

export const trackById = (id: TrackId): RaceTrack =>
  ALL_TRACKS.find((track) => track.id === id) ?? TUTORIAL_CIRCUIT

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
