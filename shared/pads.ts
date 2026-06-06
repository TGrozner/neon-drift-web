import { PADS } from './constants'
import { distanceAlongForward, signedWrappedDelta } from './math'
import type { RaceTrack, TrackPad } from './track'

export type PadCooldownState = Record<string, number>

export type PadTrigger = {
  pad: TrackPad
  boostImpulse: number
  rechargeAmount: number
}

export const isInsidePad = (
  track: RaceTrack,
  pad: TrackPad,
  distance: number,
  lane: number,
): boolean => {
  const along = signedWrappedDelta(pad.distance, distance, track.totalLength)
  return Math.abs(along) <= pad.halfLength && Math.abs(lane - pad.lane) <= pad.halfWidth
}

export const sweptIntersectsPad = (
  track: RaceTrack,
  pad: TrackPad,
  previousDistance: number,
  previousLane: number,
  distance: number,
  lane: number,
): boolean => {
  if (isInsidePad(track, pad, previousDistance, previousLane)) return true
  if (isInsidePad(track, pad, distance, lane)) return true

  const travel = distanceAlongForward(previousDistance, distance, track.totalLength)
  if (travel <= 0 || travel > track.totalLength * 0.35) return false

  const ahead = distanceAlongForward(previousDistance, pad.distance, track.totalLength)
  if (ahead > travel + pad.halfLength) return false

  const t = Math.min(1, Math.max(0, ahead / Math.max(0.001, travel)))
  const interpolatedLane = previousLane + (lane - previousLane) * t
  return Math.abs(interpolatedLane - pad.lane) <= pad.halfWidth
}

export const triggerTrackPads = (
  track: RaceTrack,
  cooldowns: PadCooldownState,
  vehicleId: string,
  previousDistance: number,
  previousLane: number,
  distance: number,
  lane: number,
  now: number,
): PadTrigger[] => {
  const triggers: PadTrigger[] = []

  for (const pad of track.pads) {
    const cooldownKey = `${vehicleId}:${pad.id}`
    const lastTrigger = cooldowns[cooldownKey] ?? Number.NEGATIVE_INFINITY
    if (now - lastTrigger < pad.cooldownSeconds) continue
    if (!sweptIntersectsPad(track, pad, previousDistance, previousLane, distance, lane)) continue

    cooldowns[cooldownKey] = now
    triggers.push({
      pad,
      boostImpulse: pad.kind === 'boost' ? PADS.boostImpulse : 0,
      rechargeAmount: pad.kind === 'recharge' ? PADS.rechargeAmount : 0,
    })
  }

  return triggers
}

