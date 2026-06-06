import {
  CRASH_OUT,
  LAUNCH,
  PADS,
  POWER,
  SHIP_PROFILES,
  TRACK_LIMITS,
  type ShipProfileId,
} from './constants'
import { approach, clamp, cross, expDecay, saturate, signedWrappedDelta, wrapDistance } from './math'
import type { PadTrigger } from './pads'
import type { SlipstreamSample } from './slipstream'
import type { RaceTrack } from './track'

export type VehicleInput = {
  throttle: number
  steer: number
  boost: boolean
  airbrake: boolean
  reset: boolean
}

export type VehicleTelemetry = {
  speedRatio: number
  powerCritical: boolean
  offTrack: boolean
  railPressure: number
  cleanLineQuality: number
  airbrakeExitCharge: number
}

export type Vehicle = {
  id: string
  name: string
  profileId: ShipProfileId
  isPlayer: boolean
  distance: number
  lane: number
  previousDistance: number
  previousLane: number
  forwardSpeed: number
  lateralSpeed: number
  yawOffset: number
  power: number
  boostIntensity: number
  isBoosting: boolean
  boostEmptyLockout: boolean
  isAirbraking: boolean
  airbrakeHoldSeconds: number
  airbrakeExitCooldown: number
  lastAirbrakeExitStrength: number
  lap: number
  nextGateIndex: number
  lastGateIndex: number
  lastGateDistance: number
  finished: boolean
  finishTime: number
  timePenalty: number
  crashOutCount: number
  crashOutLockRemaining: number
  crashOutGraceRemaining: number
  crashOutLaunchRemaining: number
  railDamageCooldown: number
  launchBoostCharge: number
  launchThrottlePressedAt: number
  launchThrottleWasHeld: boolean
  speedPadPulse: number
  rechargePadPulse: number
  boostStartPulse: number
  airbrakeExitPulse: number
  slipstreamPulse: number
  crashOutPulse: number
  powerDamagePulse: number
  cleanLinePulse: number
  gatePulse: number
  lapPulse: number
  rivalPassPulse: number
  telemetry: VehicleTelemetry
}

export const EMPTY_INPUT: VehicleInput = {
  throttle: 0,
  steer: 0,
  boost: false,
  airbrake: false,
  reset: false,
}

export const createVehicle = (
  id: string,
  name: string,
  profileId: ShipProfileId,
  isPlayer: boolean,
  distance: number,
  lane: number,
): Vehicle => ({
  id,
  name,
  profileId,
  isPlayer,
  distance,
  lane,
  previousDistance: distance,
  previousLane: lane,
  forwardSpeed: 0,
  lateralSpeed: 0,
  yawOffset: 0,
  power: 1,
  boostIntensity: 0,
  isBoosting: false,
  boostEmptyLockout: false,
  isAirbraking: false,
  airbrakeHoldSeconds: 0,
  airbrakeExitCooldown: 999,
  lastAirbrakeExitStrength: 0,
  lap: 1,
  nextGateIndex: 1,
  lastGateIndex: 0,
  lastGateDistance: 0,
  finished: false,
  finishTime: -1,
  timePenalty: 0,
  crashOutCount: 0,
  crashOutLockRemaining: 0,
  crashOutGraceRemaining: 0,
  crashOutLaunchRemaining: 0,
  railDamageCooldown: 0,
  launchBoostCharge: 0,
  launchThrottlePressedAt: -1,
  launchThrottleWasHeld: false,
  speedPadPulse: 0,
  rechargePadPulse: 0,
  boostStartPulse: 0,
  airbrakeExitPulse: 0,
  slipstreamPulse: 0,
  crashOutPulse: 0,
  powerDamagePulse: 0,
  cleanLinePulse: 0,
  gatePulse: 0,
  lapPulse: 0,
  rivalPassPulse: 0,
  telemetry: {
    speedRatio: 0,
    powerCritical: false,
    offTrack: false,
    railPressure: 0,
    cleanLineQuality: 0,
    airbrakeExitCharge: 0,
  },
})

const decayPulse = (pulse: number, dt: number, duration: number): number =>
  Math.max(0, pulse - dt / Math.max(0.001, duration))

export const calculateAirbrakeExitStrength = (
  heldSeconds: number,
  steer: number,
  lateralSlip: number,
  profileId: ShipProfileId,
): number => {
  const profile = SHIP_PROFILES[profileId]
  const holdRatio = saturate(
    (heldSeconds - profile.airbrakeExitMinSeconds) /
      Math.max(0.01, profile.airbrakeExitFullSeconds - profile.airbrakeExitMinSeconds),
  )
  const slipRatio = saturate(Math.abs(lateralSlip) / Math.max(1, profile.airbrakeExitSlipForFullBoost))
  const steerRatio = clamp(Math.abs(steer), 0.65, 1)
  return clamp((0.45 + holdRatio * 0.35 + slipRatio * 0.2) * steerRatio, 0.42, 1)
}

export const calculateAirbrakeExitCharge = (
  vehicle: Vehicle,
  input: VehicleInput,
): number => {
  const profile = SHIP_PROFILES[vehicle.profileId]
  if (!vehicle.isAirbraking) return Math.max(vehicle.lastAirbrakeExitStrength * vehicle.airbrakeExitPulse, 0)
  if (vehicle.airbrakeHoldSeconds < profile.airbrakeExitMinSeconds) {
    return clamp(
      (vehicle.airbrakeHoldSeconds / Math.max(0.01, profile.airbrakeExitMinSeconds)) * 0.42,
      0,
      0.42,
    )
  }
  return calculateAirbrakeExitStrength(
    vehicle.airbrakeHoldSeconds,
    input.steer,
    vehicle.lateralSpeed,
    vehicle.profileId,
  )
}

export const updateLaunchBoostCharge = (
  vehicle: Vehicle,
  throttle: number,
  countdownRemaining: number,
): void => {
  const held = throttle > 0.35
  if (!held) {
    vehicle.launchBoostCharge = 0
    vehicle.launchThrottlePressedAt = -1
    vehicle.launchThrottleWasHeld = false
    return
  }

  if (!vehicle.launchThrottleWasHeld) {
    vehicle.launchThrottlePressedAt = countdownRemaining
  }

  vehicle.launchThrottleWasHeld = true
  const timing =
    1 -
    saturate(
      Math.abs(vehicle.launchThrottlePressedAt - LAUNCH.perfectSeconds) /
        Math.max(0.01, LAUNCH.perfectSeconds * 1.6),
    )
  const earlyPenalty = vehicle.launchThrottlePressedAt > LAUNCH.earlyPenaltySeconds ? 0.28 : 1
  const holdConfidence = saturate(
    1 - countdownRemaining / Math.max(0.01, vehicle.launchThrottlePressedAt),
  )
  vehicle.launchBoostCharge = saturate(0.18 + timing * 0.82) * earlyPenalty * (0.55 + holdConfidence * 0.45)
}

export const applyLaunchBoost = (vehicle: Vehicle): void => {
  const charge = saturate(vehicle.launchBoostCharge)
  if (charge > 0.08) {
    vehicle.forwardSpeed += LAUNCH.boostImpulse * charge
    vehicle.boostStartPulse = 1
  }
  vehicle.launchBoostCharge = 0
  vehicle.launchThrottlePressedAt = -1
  vehicle.launchThrottleWasHeld = false
}

export const applyPowerDamage = (vehicle: Vehicle, amount: number): void => {
  if (amount <= 0 || vehicle.crashOutGraceRemaining > 0 || vehicle.finished) return
  vehicle.power = saturate(vehicle.power - amount)
  vehicle.powerDamagePulse = 1
  if (vehicle.power <= 0) crashOut(vehicle)
}

export const crashOut = (vehicle: Vehicle): void => {
  vehicle.isBoosting = false
  vehicle.isAirbraking = false
  vehicle.boostIntensity = 0
  vehicle.forwardSpeed = 0
  vehicle.lateralSpeed = 0
  vehicle.distance = vehicle.lastGateDistance
  vehicle.lane = 0
  vehicle.power = CRASH_OUT.restorePower
  vehicle.crashOutCount += 1
  vehicle.timePenalty += CRASH_OUT.timePenaltySeconds
  vehicle.crashOutLockRemaining = CRASH_OUT.lockSeconds
  vehicle.crashOutGraceRemaining = CRASH_OUT.lockSeconds + CRASH_OUT.graceSeconds
  vehicle.crashOutLaunchRemaining = CRASH_OUT.respawnBoostSeconds
  vehicle.crashOutPulse = 1
}

export const resetToLastGate = (vehicle: Vehicle): void => {
  vehicle.distance = vehicle.lastGateDistance
  vehicle.lane = 0
  vehicle.forwardSpeed = Math.max(vehicle.forwardSpeed * 0.35, CRASH_OUT.respawnSpeed)
  vehicle.lateralSpeed = 0
  vehicle.crashOutGraceRemaining = Math.max(vehicle.crashOutGraceRemaining, 0.6)
}

export const applyPadTrigger = (vehicle: Vehicle, trigger: PadTrigger): void => {
  if (trigger.boostImpulse > 0) {
    vehicle.forwardSpeed += trigger.boostImpulse
    vehicle.speedPadPulse = 1
  }
  if (trigger.rechargeAmount > 0) {
    vehicle.power = saturate(vehicle.power + trigger.rechargeAmount)
    vehicle.rechargePadPulse = 1
  }
}

const cleanLineQuality = (track: RaceTrack, vehicle: Vehicle, throttle: number): number => {
  if (throttle <= 0.15 || vehicle.telemetry.offTrack || vehicle.crashOutLockRemaining > 0) return 0
  const here = track.sample(vehicle.distance)
  const ahead = track.sample(vehicle.distance + 9.8)
  const turn = cross({ x: here.tangent.x, y: here.tangent.z }, { x: ahead.tangent.x, y: ahead.tangent.z })
  const turnIntensity = saturate(Math.abs(turn) / Math.max(0.001, 0.075 * 2.8))
  if (turnIntensity <= 0.01) return 0

  const idealLane = (turn > 0 ? -1 : 1) * here.width * 0.22
  const tolerance = Math.max(1, here.width * 0.18)
  const laneError = Math.abs(vehicle.lane - idealLane)
  return saturate((1 - laneError / tolerance) * turnIntensity * (1 - vehicle.telemetry.railPressure))
}

export type StepVehicleContext = {
  track: RaceTrack
  input: VehicleInput
  dt: number
  slipstream: SlipstreamSample
  nearbyVehicles: number
}

export const stepVehicle = (vehicle: Vehicle, context: StepVehicleContext): void => {
  const { track, input, dt, slipstream, nearbyVehicles } = context
  const profile = SHIP_PROFILES[vehicle.profileId]
  const throttle = clamp(input.throttle, -1, 1)
  const steer = clamp(input.steer, -1, 1)

  vehicle.previousDistance = vehicle.distance
  vehicle.previousLane = vehicle.lane
  vehicle.speedPadPulse = decayPulse(vehicle.speedPadPulse, dt, PADS.speedPadPulseSeconds)
  vehicle.rechargePadPulse = decayPulse(vehicle.rechargePadPulse, dt, 0.55)
  vehicle.boostStartPulse = decayPulse(vehicle.boostStartPulse, dt, 0.36)
  vehicle.airbrakeExitPulse = decayPulse(vehicle.airbrakeExitPulse, dt, 0.62)
  vehicle.slipstreamPulse = decayPulse(vehicle.slipstreamPulse, dt, 0.55)
  vehicle.crashOutPulse = decayPulse(vehicle.crashOutPulse, dt, 1.45)
  vehicle.powerDamagePulse = decayPulse(vehicle.powerDamagePulse, dt, 0.55)
  vehicle.cleanLinePulse = decayPulse(vehicle.cleanLinePulse, dt, 0.45)
  vehicle.gatePulse = decayPulse(vehicle.gatePulse, dt, 0.45)
  vehicle.lapPulse = decayPulse(vehicle.lapPulse, dt, 1.15)
  vehicle.rivalPassPulse = decayPulse(vehicle.rivalPassPulse, dt, 0.75)
  vehicle.airbrakeExitCooldown += dt
  vehicle.railDamageCooldown = Math.max(0, vehicle.railDamageCooldown - dt)
  vehicle.crashOutGraceRemaining = Math.max(0, vehicle.crashOutGraceRemaining - dt)

  if (input.reset) {
    resetToLastGate(vehicle)
    return
  }

  if (vehicle.finished) {
    vehicle.telemetry.speedRatio = vehicle.forwardSpeed / Math.max(1, profile.boostSpeed)
    return
  }

  if (vehicle.crashOutLockRemaining > 0) {
    vehicle.crashOutLockRemaining = Math.max(0, vehicle.crashOutLockRemaining - dt)
    vehicle.telemetry.airbrakeExitCharge = calculateAirbrakeExitCharge(vehicle, input)
    return
  }

  if (vehicle.crashOutLaunchRemaining > 0) {
    if (vehicle.forwardSpeed < CRASH_OUT.respawnSpeed) vehicle.forwardSpeed = CRASH_OUT.respawnSpeed
    vehicle.forwardSpeed += profile.acceleration * 0.24 * dt
    vehicle.crashOutLaunchRemaining = Math.max(0, vehicle.crashOutLaunchRemaining - dt)
  }

  const wasAirbraking = vehicle.isAirbraking
  const wasBoosting = vehicle.isBoosting
  vehicle.isAirbraking = input.airbrake
  if (vehicle.isAirbraking) vehicle.airbrakeHoldSeconds += dt

  const wantsBoost = input.boost && throttle > 0.05
  if (!wantsBoost) vehicle.boostEmptyLockout = false
  const canContinueBoost = wasBoosting && vehicle.power > profile.boostContinueThreshold
  const canStartBoost = vehicle.power >= profile.boostActivationThreshold
  vehicle.isBoosting =
    wantsBoost && !vehicle.boostEmptyLockout && (canContinueBoost || canStartBoost)
  vehicle.boostIntensity = approach(
    vehicle.boostIntensity,
    vehicle.isBoosting ? 1 : 0,
    vehicle.isBoosting ? profile.boostRampUpRate : profile.boostRampDownRate,
    dt,
  )
  if (vehicle.isBoosting && !wasBoosting) vehicle.boostStartPulse = 1

  if (vehicle.isBoosting) {
    const risk =
      1 + Math.abs(steer) * profile.boostRiskDrainScale + vehicle.telemetry.railPressure * 0.28 + (nearbyVehicles > 0 ? 0.12 : 0)
    vehicle.power = saturate(vehicle.power - profile.boostDrainRate * risk * dt)
    if (vehicle.power <= profile.boostContinueThreshold) {
      vehicle.power = 0
      vehicle.isBoosting = false
      vehicle.boostEmptyLockout = true
    }
  } else {
    let regen = throttle > 0.1 ? POWER.regenThrottle : POWER.regenCoast
    if (vehicle.telemetry.offTrack && vehicle.telemetry.railPressure <= 0.05) {
      regen *= POWER.offTrackRegenMultiplier
    }
    vehicle.power = saturate(vehicle.power + regen * dt)
  }

  if (!vehicle.isAirbraking && wasAirbraking) {
    const heldSeconds = vehicle.airbrakeHoldSeconds
    vehicle.airbrakeHoldSeconds = 0
    vehicle.lastAirbrakeExitStrength = 0
    const canExitBoost =
      heldSeconds >= profile.airbrakeExitMinSeconds &&
      throttle > 0.15 &&
      vehicle.power > profile.airbrakeExitPowerCost * 0.65 &&
      !vehicle.telemetry.offTrack &&
      vehicle.telemetry.railPressure <= 0.05 &&
      vehicle.airbrakeExitCooldown >= profile.airbrakeExitCooldown
    if (canExitBoost) {
      const strength = calculateAirbrakeExitStrength(heldSeconds, steer, vehicle.lateralSpeed, vehicle.profileId)
      vehicle.forwardSpeed += profile.airbrakeExitBoostImpulse * strength
      vehicle.power = saturate(vehicle.power - profile.airbrakeExitPowerCost * strength)
      vehicle.lastAirbrakeExitStrength = strength
      vehicle.airbrakeExitPulse = 1
      vehicle.airbrakeExitCooldown = 0
    }
  } else if (!vehicle.isAirbraking) {
    vehicle.airbrakeHoldSeconds = 0
  }

  const yawScale = 1.08 - saturate(vehicle.telemetry.speedRatio) * 0.24
  const airbrakeTurn = vehicle.isAirbraking ? profile.airbrakeTurnBoost : 1
  vehicle.yawOffset = clamp(
    vehicle.yawOffset + steer * profile.turnRate * yawScale * airbrakeTurn * dt,
    -0.95,
    0.95,
  )
  vehicle.yawOffset = expDecay(vehicle.yawOffset, vehicle.isAirbraking ? 1.7 : 3.4, dt)

  if (throttle > 0) vehicle.forwardSpeed += profile.acceleration * throttle * dt
  if (throttle < 0) vehicle.forwardSpeed += profile.acceleration * 0.14 * throttle * dt
  if (vehicle.boostIntensity > 0) {
    vehicle.forwardSpeed += profile.acceleration * profile.boostSustainAccelerationScale * vehicle.boostIntensity * dt
  }
  if (vehicle.speedPadPulse > 0) {
    vehicle.forwardSpeed += PADS.speedPadSustainAcceleration * vehicle.speedPadPulse * dt
  }
  if (slipstream.strength > 0) {
    vehicle.forwardSpeed += slipstream.accelerationBonus * dt
    vehicle.lateralSpeed -= slipstream.lanePull * 1.8 * dt
    vehicle.slipstreamPulse = Math.max(vehicle.slipstreamPulse, slipstream.strength)
  }

  vehicle.lateralSpeed += steer * profile.strafeForce * (vehicle.isAirbraking ? 1.48 : 1) * dt
  const grip = vehicle.isAirbraking ? profile.driftGrip : profile.lateralGrip * (1 + saturate(vehicle.telemetry.speedRatio) * 0.18)
  vehicle.lateralSpeed = expDecay(vehicle.lateralSpeed, grip, dt)

  let drag = profile.drag
  if (vehicle.isAirbraking) drag *= Math.abs(steer) > 0.2 ? 1.72 : 3.05
  if (vehicle.telemetry.offTrack) drag *= TRACK_LIMITS.offTrackDragMultiplier
  vehicle.forwardSpeed = expDecay(vehicle.forwardSpeed, drag, dt)
  vehicle.forwardSpeed = Math.max(0, vehicle.forwardSpeed)

  const profileNow = track.sample(vehicle.distance)
  const yawForwardScale = Math.max(0.35, Math.cos(vehicle.yawOffset))
  vehicle.distance = wrapDistance(vehicle.distance + vehicle.forwardSpeed * yawForwardScale * dt, track.totalLength)
  vehicle.lane += (vehicle.lateralSpeed + Math.sin(vehicle.yawOffset) * vehicle.forwardSpeed * 0.28) * dt

  const railLimit = profileNow.width * 0.5 - TRACK_LIMITS.shipHalfWidth
  const overLimit = Math.abs(vehicle.lane) - railLimit
  vehicle.telemetry.offTrack = overLimit > 0
  vehicle.telemetry.railPressure = saturate(overLimit / Math.max(0.001, TRACK_LIMITS.railPadding))
  if (vehicle.telemetry.offTrack) {
    vehicle.lane = clamp(vehicle.lane, -railLimit, railLimit)
    vehicle.lateralSpeed *= -0.22
    const hardHit = vehicle.forwardSpeed > TRACK_LIMITS.heavyHitSpeedThreshold
    const retention = hardHit ? profile.railHeavyHitRetention : profile.railGlanceRetention
    vehicle.forwardSpeed *= retention
    if (vehicle.railDamageCooldown <= 0) {
      const speedSeverity = saturate(vehicle.forwardSpeed / Math.max(1, profile.boostSpeed))
      applyPowerDamage(vehicle, profile.railPowerDamage + profile.railSpeedDamage * speedSeverity)
      vehicle.railDamageCooldown = TRACK_LIMITS.railDamageInterval
    }
  }

  const clean = cleanLineQuality(track, vehicle, throttle)
  vehicle.telemetry.cleanLineQuality = approach(vehicle.telemetry.cleanLineQuality, clean, 6.4, dt)
  if (
    !vehicle.isBoosting &&
    vehicle.telemetry.cleanLineQuality >= POWER.cleanLineThreshold &&
    vehicle.telemetry.speedRatio >= POWER.cleanLineMinSpeedRatio
  ) {
    vehicle.power = saturate(vehicle.power + POWER.cleanLineBonus * vehicle.telemetry.cleanLineQuality * dt)
    vehicle.cleanLinePulse = Math.max(vehicle.cleanLinePulse, vehicle.telemetry.cleanLineQuality)
  }

  const targetMax =
    profile.maxSpeed +
    (profile.boostSpeed - profile.maxSpeed) * saturate(vehicle.boostIntensity) +
    profile.airbrakeExitSpeedBonus * vehicle.airbrakeExitPulse +
    PADS.speedPadSpeedBonus * vehicle.speedPadPulse +
    CRASH_OUT.respawnBoostSpeedBonus * (vehicle.crashOutLaunchRemaining / CRASH_OUT.respawnBoostSeconds)
  vehicle.forwardSpeed = Math.min(vehicle.forwardSpeed, Math.max(profile.maxSpeed, targetMax))

  vehicle.telemetry.speedRatio = vehicle.forwardSpeed / Math.max(1, profile.boostSpeed)
  vehicle.telemetry.powerCritical = vehicle.power <= POWER.criticalThreshold
  vehicle.telemetry.airbrakeExitCharge = calculateAirbrakeExitCharge(vehicle, input)
}

export const markGatePassed = (vehicle: Vehicle, gateIndex: number, gateDistance: number): void => {
  vehicle.lastGateIndex = gateIndex
  vehicle.lastGateDistance = gateDistance
  vehicle.nextGateIndex = (gateIndex + 1) % 8
  vehicle.gatePulse = 1
  if (gateIndex === 0) vehicle.lapPulse = 1
}

export const hasCrossedGate = (
  track: RaceTrack,
  vehicle: Vehicle,
  gateIndex: number,
): boolean => {
  const gate = track.gates[gateIndex]
  if (!gate) return false
  const previous = signedWrappedDelta(gate.distance, vehicle.previousDistance, track.totalLength)
  const current = signedWrappedDelta(gate.distance, vehicle.distance, track.totalLength)
  const crossedForward = previous < 0 && current >= 0
  return crossedForward && Math.abs(vehicle.lane) <= gate.halfWidth
}

