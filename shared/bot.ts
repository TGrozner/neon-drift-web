import { SHIP_PROFILES } from './constants'
import { clamp, distanceAlongForward, signedWrappedDelta, saturate } from './math'
import type { Vehicle, VehicleInput } from './physics'
import type { RaceTrack } from './track'

export type BotBrain = {
  vehicleId: string
  seed: number
  laneBias: number
  padLaneBias: number
  cleanLineBias: number
  draftIntent: number
  trafficBrakeIntent: number
  wantsPad: boolean
}

export const createBotBrain = (vehicleId: string, seed: number): BotBrain => ({
  vehicleId,
  seed,
  laneBias: 0,
  padLaneBias: 0,
  cleanLineBias: 0,
  draftIntent: 0,
  trafficBrakeIntent: 0,
  wantsPad: false,
})

const smooth = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * saturate(rate * dt)

const turnDegreesAhead = (track: RaceTrack, distance: number, lookAhead: number): number => {
  const here = track.sample(distance)
  const ahead = track.sample(distance + lookAhead)
  const dot = clamp(
    here.tangent.x * ahead.tangent.x + here.tangent.z * ahead.tangent.z,
    -1,
    1,
  )
  return (Math.acos(dot) * 180) / Math.PI
}

const cleanLineBias = (track: RaceTrack, vehicle: Vehicle): { bias: number; intent: number } => {
  const here = track.sample(vehicle.distance)
  const ahead = track.sample(vehicle.distance + 16.5)
  const turn = here.tangent.x * ahead.tangent.z - here.tangent.z * ahead.tangent.x
  const intent = saturate(Math.abs(turn) / Math.max(0.001, 0.075 * 2.8))
  if (intent <= 0.01) return { bias: 0, intent: 0 }
  const side = turn > 0 ? -1 : 1
  const personality = 0.92 + ((brainFraction(vehicle.id) + 0.5) % 1 - 0.5) * 0.18
  return { bias: side * here.width * 0.23 * intent * personality, intent }
}

const brainFraction = (text: string): number => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 997) / 997
}

const findPadLaneBias = (
  brain: BotBrain,
  track: RaceTrack,
  vehicle: Vehicle,
): number => {
  brain.wantsPad = false
  let bestScore = Number.POSITIVE_INFINITY
  let bestLane = 0
  let bestAhead = 0
  const senseDistance = clamp(22 + Math.abs(vehicle.forwardSpeed) * 0.24, 25.5, 44)

  for (const pad of track.pads) {
    if (pad.kind === 'recharge' && vehicle.power > 0.62) continue
    const ahead = distanceAlongForward(vehicle.distance, pad.distance, track.totalLength)
    if (ahead <= 0 || ahead > senseDistance) continue
    const laneReachCost = Math.abs(pad.lane - vehicle.lane) * (ahead < 10 ? 1.45 : 0.82)
    const score = ahead + laneReachCost + (pad.kind === 'recharge' ? 1.2 : 0)
    if (score < bestScore) {
      bestScore = score
      bestLane = pad.lane
      bestAhead = ahead
    }
  }

  if (!Number.isFinite(bestScore)) return 0
  brain.wantsPad = true
  const urgency = clamp(1 - bestAhead / senseDistance, 0.18, 1)
  return clamp(bestLane - vehicle.lane, -track.width * 0.32, track.width * 0.32) * urgency
}

const applyPackBehavior = (
  brain: BotBrain,
  track: RaceTrack,
  vehicle: Vehicle,
  vehicles: Vehicle[],
  dt: number,
): number => {
  const profile = SHIP_PROFILES[vehicle.profileId]
  let desiredLaneBias = 0
  let draft = 0
  let brake = 0
  const packSenseDistance = clamp(46 + Math.abs(vehicle.forwardSpeed) * 0.22, 52, 74)
  const sideSenseDistance = 34
  const laneSpacing = 2.55

  for (const other of vehicles) {
    if (other.id === vehicle.id || other.finished) continue
    const gap = signedWrappedDelta(vehicle.distance, other.distance, track.totalLength)
    if (Math.abs(gap) > packSenseDistance) continue
    const lateralDelta = vehicle.lane - other.lane
    const lateralDistance = Math.abs(lateralDelta)
    if (gap > 0) {
      const closeness = 1 - gap / packSenseDistance
      draft = Math.max(draft, closeness)
      const side = Math.abs(lateralDelta) > 0.24 ? Math.sign(lateralDelta) : (brain.seed + brainFraction(other.id)) % 1 > 0.5 ? 1 : -1
      desiredLaneBias += side * 1.5 * closeness
      const closingSpeed = vehicle.forwardSpeed - other.forwardSpeed
      const sameLaneRisk = saturate(1 - lateralDistance / laneSpacing)
      const timeToContact = closingSpeed > 0 ? gap / Math.max(0.001, closingSpeed) : Number.POSITIVE_INFINITY
      const closingUrgency = Number.isFinite(timeToContact) ? saturate((1.15 - timeToContact) / 1.15) : 0
      const emergencyOverlap = gap < 5.4 ? saturate(1 - gap / 5.4) : 0
      const closingRatio = saturate(closingSpeed / Math.max(1, profile.maxSpeed * 0.38))
      brake = Math.max(
        brake,
        sameLaneRisk * Math.max(closingUrgency, closingRatio * closeness * 0.9, emergencyOverlap * 0.75),
      )
    }
    if (Math.abs(gap) <= sideSenseDistance && lateralDistance < laneSpacing) {
      const sidePressure = 1 - lateralDistance / laneSpacing
      const side = Math.abs(lateralDelta) > 0.2 ? Math.sign(lateralDelta) : brain.seed % 1 > 0.5 ? 1 : -1
      desiredLaneBias += side * 1.8 * sidePressure
    }
  }

  brain.laneBias = smooth(
    brain.laneBias,
    clamp(desiredLaneBias, -track.width * 0.34, track.width * 0.34),
    2.8,
    dt,
  )
  brain.draftIntent = draft
  brain.trafficBrakeIntent = brake
  return brake
}

export const getBotInput = (
  brain: BotBrain,
  track: RaceTrack,
  vehicle: Vehicle,
  vehicles: Vehicle[],
  dt: number,
): VehicleInput => {
  const profile = SHIP_PROFILES[vehicle.profileId]
  const lookAhead = clamp(Math.abs(vehicle.forwardSpeed) * 0.35, 12.5, 38)
  const turnDegrees = turnDegreesAhead(track, vehicle.distance, lookAhead)
  const clean = cleanLineBias(track, vehicle)
  brain.cleanLineBias = smooth(brain.cleanLineBias, clean.bias, 4.4, dt)
  brain.padLaneBias = smooth(brain.padLaneBias, findPadLaneBias(brain, track, vehicle), 6.4, dt)
  const brake = applyPackBehavior(brain, track, vehicle, vehicles, dt)

  const targetLane = clamp(
    brain.laneBias + brain.padLaneBias + brain.cleanLineBias,
    -track.sample(vehicle.distance).width * 0.42,
    track.sample(vehicle.distance).width * 0.42,
  )
  const laneError = targetLane - vehicle.lane
  const speedRatio = saturate(Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.boostSpeed))
  const laneGain = 0.16 - speedRatio * 0.045
  const lateralDamping = 0.075 + speedRatio * 0.035
  const yawDamping = 0.42 + speedRatio * 0.18
  const steer = clamp(
    laneError * laneGain - vehicle.lateralSpeed * lateralDamping - vehicle.yawOffset * yawDamping,
    -0.82,
    0.82,
  )

  const airbrakeThreshold = 10.4 + clean.intent * 2.2
  const wantsAirbrake = turnDegrees >= airbrakeThreshold && brake < 0.65
  const straightEnough = turnDegrees <= 10.5
  const usefulBoost =
    straightEnough &&
    brake < 0.28 &&
    !wantsAirbrake &&
    (brain.wantsPad || brain.draftIntent > 0.16 || clean.intent > 0.34 || vehicle.power > 0.52)
  const wantsBoost = usefulBoost && vehicle.power > profile.boostActivationThreshold
  const throttle = clamp(1 - brake * 0.42 - (wantsAirbrake ? 0.05 : 0), 0.25, 1)

  return {
    throttle,
    steer,
    boost: wantsBoost,
    airbrake: wantsAirbrake,
    reset: false,
  }
}
