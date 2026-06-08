import { SLIPSTREAM } from './constants'
import { signedWrappedDelta, saturate } from './math'
import type { RaceTrack } from './track'

export type SlipstreamSegment = {
  ownerId: string
  trackId: string
  centerDistance: number
  lane: number
  createdAt: number
  lifetime: number
  halfLength: number
  halfWidth: number
  intensity: number
}

export type SlipstreamState = {
  segments: SlipstreamSegment[]
  lastEmitByOwner: Record<string, number>
  lastPrunedAt: number
}

export type SlipstreamSample = {
  strength: number
  accelerationBonus: number
  lanePull: number
  activeSegments: number
  stackCapped: boolean
}

export type SlipstreamSegmentInfluence = {
  strength: number
  lanePull: number
  alongRatio: number
  lateralRatio: number
  ageRatio: number
}

export const createSlipstreamState = (): SlipstreamState => ({
  segments: [],
  lastEmitByOwner: {},
  lastPrunedAt: Number.NEGATIVE_INFINITY,
})

const noInfluence: SlipstreamSegmentInfluence = {
  strength: 0,
  lanePull: 0,
  alongRatio: 0,
  lateralRatio: 0,
  ageRatio: 0,
}

export const pruneSlipstream = (state: SlipstreamState, now: number): void => {
  if (now <= state.lastPrunedAt) return
  state.segments = state.segments.filter((segment) => now - segment.createdAt <= segment.lifetime)
  state.lastPrunedAt = now
}

export const publishSlipstream = (
  state: SlipstreamState,
  track: RaceTrack,
  ownerId: string,
  distance: number,
  lane: number,
  speed: number,
  maxSpeed: number,
  now: number,
): boolean => {
  pruneSlipstream(state, now)
  if (speed < SLIPSTREAM.minEmitSpeed) return false
  const lastEmit = state.lastEmitByOwner[ownerId] ?? Number.NEGATIVE_INFINITY
  if (now - lastEmit < SLIPSTREAM.emitInterval) return false

  const speedRatio = speed / Math.max(1, maxSpeed)
  const intensity = saturate((speedRatio - 0.45) / 0.55)
  state.lastEmitByOwner[ownerId] = now
  state.segments.push({
    ownerId,
    trackId: track.id,
    centerDistance: distance - SLIPSTREAM.halfLength * 1.15,
    lane,
    createdAt: now,
    lifetime: SLIPSTREAM.lifetime,
    halfLength: SLIPSTREAM.halfLength,
    halfWidth: SLIPSTREAM.halfWidth,
    intensity: Math.max(0.25, intensity),
  })

  if (state.segments.length > SLIPSTREAM.maxSegments) {
    state.segments.splice(0, state.segments.length - SLIPSTREAM.maxSegments)
  }

  return true
}

export const sampleSlipstream = (
  state: SlipstreamState,
  track: RaceTrack,
  vehicleId: string,
  distance: number,
  lane: number,
  now: number,
): SlipstreamSample => {
  pruneSlipstream(state, now)

  let combined = 0
  let strongest = 0
  let lanePull = 0
  let stackCapped = false

  for (const segment of state.segments) {
    const influence = slipstreamSegmentInfluence(segment, track, vehicleId, distance, lane, now)
    const { strength } = influence
    if (strength <= 0) continue

    combined += strength
    if (strength > strongest) {
      strongest = strength
      lanePull = influence.lanePull
    }
  }

  if (combined > SLIPSTREAM.stackCap) {
    combined = SLIPSTREAM.stackCap
    stackCapped = true
  }

  return {
    strength: combined,
    accelerationBonus: SLIPSTREAM.acceleration * combined,
    lanePull,
    activeSegments: state.segments.length,
    stackCapped,
  }
}

export const slipstreamSegmentInfluence = (
  segment: SlipstreamSegment,
  track: RaceTrack,
  vehicleId: string,
  distance: number,
  lane: number,
  now: number,
): SlipstreamSegmentInfluence => {
  if (segment.trackId !== track.id) return noInfluence
  if (segment.ownerId === vehicleId) return noInfluence
  const age = now - segment.createdAt
  if (age < 0 || age > segment.lifetime) return noInfluence

  const along = signedWrappedDelta(segment.centerDistance, distance, track.totalLength)
  if (Math.abs(along) > segment.halfLength) return noInfluence
  const lateral = lane - segment.lane
  if (Math.abs(lateral) > segment.halfWidth) return noInfluence

  const alongRatio = 1 - Math.abs(along) / Math.max(1, segment.halfLength)
  const lateralRatio = 1 - Math.abs(lateral) / Math.max(1, segment.halfWidth)
  const ageRatio = 1 - age / Math.max(0.01, segment.lifetime)
  const strength = segment.intensity * alongRatio * lateralRatio * ageRatio
  if (strength <= 0) return noInfluence

  return {
    strength,
    lanePull: Math.max(-1, Math.min(1, lateral / Math.max(1, segment.halfWidth))),
    alongRatio,
    lateralRatio,
    ageRatio,
  }
}
