import {
  BANKED_CONTROL,
  CRASH_OUT,
  HOVER,
  INTEGRITY,
  LAUNCH,
  PADS,
  POWER,
  SHIP_PROFILES,
  SLIPSTREAM,
  TRACK_LIMITS,
  type ShipProfileId,
} from './constants'
import {
  add3,
  approach,
  clamp,
  cross,
  distanceAlongForward,
  dot3,
  expDecay,
  finiteOr,
  normalize3,
  saturate,
  scale3,
  signedWrappedDelta,
  wrapDistance,
} from './math'
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
  integrityCritical: boolean
  integrityDamaged: boolean
  offTrack: boolean
  wrongWay: boolean
  railPressure: number
  railPinnedRatio: number
  trackLimitRatio: number
  hoverClearance: number
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
  visualBank: number
  visualPitch: number
  power: number
  integrity: number
  boostIntensity: number
  isBoosting: boolean
  boostEmptyLockout: boolean
  isAirbraking: boolean
  airbrakeHoldSeconds: number
  airbrakeExitCooldown: number
  lastAirbrakeExitStrength: number
  lap: number
  lapStartedAt: number
  lastLapSeconds: number
  bestLapSeconds: number
  nextGateIndex: number
  lastGateIndex: number
  lastGateDistance: number
  finished: boolean
  finalPosition: number
  finishTime: number
  timePenalty: number
  crashOutCount: number
  crashOutLockRemaining: number
  crashOutGraceRemaining: number
  crashOutLaunchRemaining: number
  railDamageCooldown: number
  railContactHoldSeconds: number
  railContactMemorySeconds: number
  railContactSide: number
  wrongWaySeconds: number
  launchBoostCharge: number
  launchThrottlePressedAt: number
  launchThrottleWasHeld: boolean
  speedPadPulse: number
  rechargePadPulse: number
  boostStartPulse: number
  airbrakeExitPulse: number
  slipstreamPulse: number
  crashOutPulse: number
  packBumpPulse: number
  powerDamagePulse: number
  cleanLinePulse: number
  gatePulse: number
  lapPulse: number
  rivalPassPulse: number
  knockoutRewardPulse: number
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
  visualBank: 0,
  visualPitch: 0,
  power: 1,
  integrity: 1,
  boostIntensity: 0,
  isBoosting: false,
  boostEmptyLockout: false,
  isAirbraking: false,
  airbrakeHoldSeconds: 0,
  airbrakeExitCooldown: 999,
  lastAirbrakeExitStrength: 0,
  lap: 1,
  lapStartedAt: 0,
  lastLapSeconds: -1,
  bestLapSeconds: -1,
  nextGateIndex: 1,
  lastGateIndex: 0,
  lastGateDistance: 0,
  finished: false,
  finalPosition: 0,
  finishTime: -1,
  timePenalty: 0,
  crashOutCount: 0,
  crashOutLockRemaining: 0,
  crashOutGraceRemaining: 0,
  crashOutLaunchRemaining: 0,
  railDamageCooldown: 0,
  railContactHoldSeconds: 0,
  railContactMemorySeconds: 0,
  railContactSide: 0,
  wrongWaySeconds: 0,
  launchBoostCharge: 0,
  launchThrottlePressedAt: -1,
  launchThrottleWasHeld: false,
  speedPadPulse: 0,
  rechargePadPulse: 0,
  boostStartPulse: 0,
  airbrakeExitPulse: 0,
  slipstreamPulse: 0,
  crashOutPulse: 0,
  packBumpPulse: 0,
  powerDamagePulse: 0,
  cleanLinePulse: 0,
  gatePulse: 0,
  lapPulse: 0,
  rivalPassPulse: 0,
  knockoutRewardPulse: 0,
  telemetry: {
    speedRatio: 0,
    powerCritical: false,
    integrityCritical: false,
    integrityDamaged: false,
    offTrack: false,
    wrongWay: false,
    railPressure: 0,
    railPinnedRatio: 0,
    trackLimitRatio: 0,
    hoverClearance: HOVER.height,
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

const trackLimitPreview = (track: RaceTrack, vehicle: Vehicle): { offTrack: boolean; railPressure: number } => {
  const profile = track.sample(vehicle.distance)
  const railLimit = profile.width * 0.5 - TRACK_LIMITS.shipHalfWidth
  const overLimit = Math.abs(vehicle.lane) - railLimit
  return {
    offTrack: overLimit > 0,
    railPressure: saturate(overLimit / Math.max(0.001, TRACK_LIMITS.railPadding)),
  }
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

export const syncResourceTelemetry = (vehicle: Vehicle): void => {
  vehicle.telemetry.powerCritical = vehicle.power <= POWER.criticalThreshold
  vehicle.telemetry.integrityCritical = vehicle.integrity <= INTEGRITY.criticalThreshold
  vehicle.telemetry.integrityDamaged = vehicle.integrity <= INTEGRITY.damagedThreshold
}

export const applyIntegrityDamage = (vehicle: Vehicle, amount: number): void => {
  if (amount <= 0 || vehicle.crashOutGraceRemaining > 0 || vehicle.finished) return
  vehicle.integrity = saturate(vehicle.integrity - amount)
  vehicle.powerDamagePulse = 1
  syncResourceTelemetry(vehicle)
  if (vehicle.integrity <= 0) crashOut(vehicle)
}

const syncSweepOrigin = (vehicle: Vehicle): void => {
  vehicle.previousDistance = vehicle.distance
  vehicle.previousLane = vehicle.lane
}

export const crashOut = (vehicle: Vehicle): void => {
  vehicle.isBoosting = false
  vehicle.isAirbraking = false
  vehicle.boostIntensity = 0
  vehicle.forwardSpeed = 0
  vehicle.lateralSpeed = 0
  vehicle.visualBank = 0
  vehicle.visualPitch = 0
  vehicle.distance = vehicle.lastGateDistance
  vehicle.lane = 0
  syncSweepOrigin(vehicle)
  vehicle.power = Math.max(vehicle.power, CRASH_OUT.restorePower)
  vehicle.integrity = CRASH_OUT.restoreIntegrity
  vehicle.crashOutCount += 1
  vehicle.timePenalty += CRASH_OUT.timePenaltySeconds
  vehicle.crashOutLockRemaining = CRASH_OUT.lockSeconds
  vehicle.crashOutGraceRemaining = CRASH_OUT.lockSeconds + CRASH_OUT.graceSeconds
  vehicle.crashOutLaunchRemaining = CRASH_OUT.respawnBoostSeconds
  vehicle.crashOutPulse = 1
  vehicle.packBumpPulse = 0
  vehicle.wrongWaySeconds = 0
  vehicle.railContactHoldSeconds = 0
  vehicle.railContactMemorySeconds = 0
  vehicle.railContactSide = 0
  vehicle.telemetry.wrongWay = false
  syncResourceTelemetry(vehicle)
}

export const resetToLastGate = (vehicle: Vehicle): void => {
  vehicle.distance = vehicle.lastGateDistance
  vehicle.lane = 0
  syncSweepOrigin(vehicle)
  vehicle.forwardSpeed = Math.max(vehicle.forwardSpeed * 0.35, CRASH_OUT.respawnSpeed)
  vehicle.lateralSpeed = 0
  vehicle.yawOffset = 0
  vehicle.visualBank = 0
  vehicle.visualPitch = 0
  vehicle.wrongWaySeconds = 0
  vehicle.railContactHoldSeconds = 0
  vehicle.railContactMemorySeconds = 0
  vehicle.railContactSide = 0
  vehicle.crashOutGraceRemaining = Math.max(vehicle.crashOutGraceRemaining, 0.6)
  vehicle.telemetry.wrongWay = false
  vehicle.telemetry.offTrack = false
  vehicle.telemetry.railPressure = 0
  vehicle.telemetry.railPinnedRatio = 0
  vehicle.telemetry.trackLimitRatio = 0
}

export const applyPadTrigger = (vehicle: Vehicle, trigger: PadTrigger): void => {
  if (trigger.boostImpulse > 0) {
    vehicle.forwardSpeed += trigger.boostImpulse
    vehicle.speedPadPulse = 1
  }
  if (trigger.rechargeAmount > 0) {
    vehicle.power = saturate(vehicle.power + trigger.rechargeAmount)
    vehicle.integrity = saturate(vehicle.integrity + INTEGRITY.rechargePadRepair)
    vehicle.rechargePadPulse = 1
    syncResourceTelemetry(vehicle)
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

const bankedControlRatioFor = (bankDegrees: number): number =>
  saturate(Math.abs(bankDegrees) / Math.max(1, BANKED_CONTROL.maxBankDegrees))

const railPinnedRatioFor = (vehicle: Vehicle): number =>
  saturate(vehicle.railContactHoldSeconds / Math.max(0.01, TRACK_LIMITS.railSlidePinnedSeconds))

const updateRailContactHold = (vehicle: Vehicle, side: number, dt: number): number => {
  const recent = vehicle.railContactMemorySeconds > 0
  const sameRail = side !== 0 && side === vehicle.railContactSide && recent
  vehicle.railContactHoldSeconds = sameRail
    ? Math.min(TRACK_LIMITS.railSlidePinnedSeconds * 2, Math.max(vehicle.railContactHoldSeconds, dt) + dt)
    : dt
  vehicle.railContactSide = side
  vehicle.railContactMemorySeconds = TRACK_LIMITS.railSlideHeadingMemorySeconds
  return railPinnedRatioFor(vehicle)
}

const decayRailContactHold = (vehicle: Vehicle, dt: number): void => {
  vehicle.railContactMemorySeconds = Math.max(0, vehicle.railContactMemorySeconds - dt)
  if (vehicle.railContactMemorySeconds > TRACK_LIMITS.railSlideHeadingMemorySeconds - TRACK_LIMITS.railSlideContactGraceSeconds) {
    return
  }
  if (vehicle.railContactHoldSeconds <= 0) return
  const decay = (TRACK_LIMITS.railSlidePinnedSeconds / Math.max(0.01, TRACK_LIMITS.railSlideHoldDecaySeconds)) * dt
  vehicle.railContactHoldSeconds = Math.max(0, vehicle.railContactHoldSeconds - decay)
  if (vehicle.railContactHoldSeconds <= 0 && vehicle.railContactMemorySeconds <= 0) vehicle.railContactSide = 0
}

const slopeHoverBonus = (track: RaceTrack, distance: number): number => {
  const profile = track.sample(distance)
  const vertical = Math.abs(profile.tangent.y)
  return HOVER.slopeExtraHeight * saturate(vertical / Math.max(0.01, HOVER.slopeMaxVertical))
}

const updateWrongWay = (vehicle: Vehicle, dt: number): void => {
  const speed = Math.abs(vehicle.forwardSpeed)
  const directionDot = (vehicle.forwardSpeed >= 0 ? 1 : -1) * Math.cos(vehicle.yawOffset)
  if (speed < TRACK_LIMITS.wrongWayMinSpeed) {
    vehicle.wrongWaySeconds = 0
    vehicle.telemetry.wrongWay = false
    return
  }
  const wrongWay = directionDot < TRACK_LIMITS.wrongWayDotThreshold
  vehicle.wrongWaySeconds = wrongWay ? vehicle.wrongWaySeconds + dt : 0
  vehicle.telemetry.wrongWay = vehicle.wrongWaySeconds >= TRACK_LIMITS.wrongWayDelay
}

const clampYawOffset = (yawOffset: number): number => clamp(yawOffset, -1.28, 1.28)

const yawOffsetForHeading = (
  tangent: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
  heading: { x: number; y: number; z: number },
): number => clampYawOffset(Math.atan2(dot3(heading, right), dot3(heading, tangent)))

export type StepVehicleContext = {
  track: RaceTrack
  input: VehicleInput
  dt: number
  slipstream: SlipstreamSample
  nearbyVehicles: number
}

export const stepVehicle = (vehicle: Vehicle, context: StepVehicleContext): void => {
  const { track, input, slipstream, nearbyVehicles } = context
  const dt = Math.max(0, finiteOr(context.dt))
  const profile = SHIP_PROFILES[vehicle.profileId]
  const throttle = clamp(finiteOr(input.throttle), -1, 1)
  const steer = clamp(finiteOr(input.steer), -1, 1)

  vehicle.previousDistance = vehicle.distance
  vehicle.previousLane = vehicle.lane
  vehicle.speedPadPulse = decayPulse(vehicle.speedPadPulse, dt, PADS.speedPadPulseSeconds)
  vehicle.rechargePadPulse = decayPulse(vehicle.rechargePadPulse, dt, 0.55)
  vehicle.boostStartPulse = decayPulse(vehicle.boostStartPulse, dt, 0.36)
  vehicle.airbrakeExitPulse = decayPulse(vehicle.airbrakeExitPulse, dt, 0.62)
  vehicle.slipstreamPulse = decayPulse(vehicle.slipstreamPulse, dt, 0.55)
  vehicle.crashOutPulse = decayPulse(vehicle.crashOutPulse, dt, 1.45)
  vehicle.packBumpPulse = decayPulse(vehicle.packBumpPulse, dt, 0.4)
  vehicle.powerDamagePulse = decayPulse(vehicle.powerDamagePulse, dt, 0.55)
  vehicle.cleanLinePulse = decayPulse(vehicle.cleanLinePulse, dt, 0.45)
  vehicle.gatePulse = decayPulse(vehicle.gatePulse, dt, 0.45)
  vehicle.lapPulse = decayPulse(vehicle.lapPulse, dt, 1.15)
  vehicle.rivalPassPulse = decayPulse(vehicle.rivalPassPulse, dt, 0.75)
  vehicle.knockoutRewardPulse = decayPulse(vehicle.knockoutRewardPulse, dt, 0.9)
  vehicle.airbrakeExitCooldown += dt
  vehicle.railDamageCooldown = Math.max(0, vehicle.railDamageCooldown - dt)
  vehicle.crashOutGraceRemaining = Math.max(0, vehicle.crashOutGraceRemaining - dt)
  decayRailContactHold(vehicle, dt)

  if (input.reset) {
    resetToLastGate(vehicle)
    return
  }

  if (vehicle.finished) {
    vehicle.telemetry.speedRatio = Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.boostSpeed)
    syncResourceTelemetry(vehicle)
    return
  }

  if (vehicle.crashOutLockRemaining > 0) {
    vehicle.crashOutLockRemaining = Math.max(0, vehicle.crashOutLockRemaining - dt)
    vehicle.visualBank = approach(vehicle.visualBank, 0, 9, dt)
    vehicle.visualPitch = approach(vehicle.visualPitch, 0, 9, dt)
    vehicle.telemetry.wrongWay = false
    vehicle.telemetry.airbrakeExitCharge = calculateAirbrakeExitCharge(vehicle, input)
    syncResourceTelemetry(vehicle)
    return
  }

  if (vehicle.crashOutLaunchRemaining > 0) {
    if (vehicle.forwardSpeed < CRASH_OUT.respawnSpeed) vehicle.forwardSpeed = CRASH_OUT.respawnSpeed
    vehicle.forwardSpeed += profile.acceleration * 0.24 * dt
    vehicle.crashOutLaunchRemaining = Math.max(0, vehicle.crashOutLaunchRemaining - dt)
  }

  const limitPreview = trackLimitPreview(track, vehicle)
  const currentRailPressure = Math.max(vehicle.telemetry.railPressure, limitPreview.railPressure)
  const currentlyOffTrack = vehicle.telemetry.offTrack || limitPreview.offTrack

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
      1 + Math.abs(steer) * profile.boostRiskDrainScale + currentRailPressure * 0.48 + (nearbyVehicles > 0 ? 0.12 : 0)
    vehicle.power = saturate(vehicle.power - profile.boostDrainRate * risk * dt)
    if (vehicle.power <= profile.boostContinueThreshold) {
      vehicle.power = 0
      vehicle.isBoosting = false
      vehicle.boostEmptyLockout = true
    }
  } else {
    let regen = throttle > 0.1 ? POWER.regenThrottle : POWER.regenCoast
    if (currentlyOffTrack && currentRailPressure <= 0.05) {
      regen *= POWER.offTrackRegenMultiplier
    }
    vehicle.power = saturate(vehicle.power + regen * dt)
  }
  syncResourceTelemetry(vehicle)

  if (!vehicle.isAirbraking && wasAirbraking) {
    const heldSeconds = vehicle.airbrakeHoldSeconds
    vehicle.airbrakeHoldSeconds = 0
    vehicle.lastAirbrakeExitStrength = 0
    const exitHasDriftIntent =
      Math.abs(steer) >= 0.22 ||
      Math.abs(vehicle.lateralSpeed) >= profile.airbrakeExitSlipForFullBoost * 0.16
    const canExitBoost =
      heldSeconds >= profile.airbrakeExitMinSeconds &&
      throttle > 0.15 &&
      exitHasDriftIntent &&
      vehicle.power > profile.airbrakeExitPowerCost * 0.65 &&
      !currentlyOffTrack &&
      currentRailPressure <= 0.05 &&
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

  const profileNow = track.sample(vehicle.distance)
  const bankedControlRatio = bankedControlRatioFor(profileNow.bankDegrees)
  const yawScale = 1.08 - saturate(vehicle.telemetry.speedRatio) * 0.24
  const airbrakeTurn = vehicle.isAirbraking ? profile.airbrakeTurnBoost : 1
  const bankedSteer = 1 + bankedControlRatio * BANKED_CONTROL.steerAssist
  vehicle.yawOffset = clampYawOffset(
    vehicle.yawOffset + steer * profile.turnRate * yawScale * airbrakeTurn * bankedSteer * dt,
  )

  const heading = normalize3(
    add3(scale3(profileNow.tangent, Math.cos(vehicle.yawOffset)), scale3(profileNow.right, Math.sin(vehicle.yawOffset))),
    profileNow.tangent,
  )
  const headingRight = normalize3(
    add3(scale3(profileNow.right, Math.cos(vehicle.yawOffset)), scale3(profileNow.tangent, -Math.sin(vehicle.yawOffset))),
    profileNow.right,
  )

  let velocity = add3(scale3(profileNow.tangent, vehicle.forwardSpeed), scale3(profileNow.right, vehicle.lateralSpeed))
  if (throttle > 0) velocity = add3(velocity, scale3(heading, profile.acceleration * throttle * dt))
  if (throttle < 0) velocity = add3(velocity, scale3(heading, profile.reverseAcceleration * throttle * dt))
  if (vehicle.boostIntensity > 0) {
    velocity = add3(velocity, scale3(heading, profile.acceleration * profile.boostSustainAccelerationScale * vehicle.boostIntensity * dt))
  }
  if (vehicle.speedPadPulse > 0) {
    velocity = add3(velocity, scale3(heading, PADS.speedPadSustainAcceleration * vehicle.speedPadPulse * dt))
  }
  let slipstreamSpeedBonus = 0
  if (slipstream.strength > 0) {
    const slipstreamStrength = saturate(slipstream.strength)
    slipstreamSpeedBonus = SLIPSTREAM.speedBonus * slipstreamStrength
    const slipstreamTargetSpeed = profile.maxSpeed + slipstreamSpeedBonus
    const maxRatio = vehicle.forwardSpeed / Math.max(1, slipstreamTargetSpeed)
    const fadeWindow = Math.max(0.01, 1 - SLIPSTREAM.nearMaxFadeStart)
    const belowTargetRatio = saturate((1 - maxRatio) / fadeWindow)
    const effectiveStrength = slipstream.strength * belowTargetRatio
    if (effectiveStrength > 0) {
      const forwardImpulse = Math.min(
        slipstream.accelerationBonus * belowTargetRatio * dt,
        Math.max(0, slipstreamTargetSpeed - vehicle.forwardSpeed),
      )
      velocity = add3(velocity, scale3(heading, forwardImpulse))
      velocity = add3(velocity, scale3(profileNow.right, -slipstream.lanePull * SLIPSTREAM.lanePull * effectiveStrength * dt))
      vehicle.slipstreamPulse = Math.max(vehicle.slipstreamPulse, slipstream.strength)
    }
  }

  velocity = add3(velocity, scale3(headingRight, steer * profile.strafeForce * (vehicle.isAirbraking ? 1.48 : 1) * dt))
  const curveLookahead = Math.max(8.4, profileNow.width * 0.54)
  const curveAhead = track.sample(vehicle.distance + curveLookahead)
  const curve = cross(
    { x: profileNow.tangent.x, y: profileNow.tangent.z },
    { x: curveAhead.tangent.x, y: curveAhead.tangent.z },
  )
  const cornerSpeedRatio = saturate(
    (Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.maxSpeed) - TRACK_LIMITS.cornerDriftMinSpeedRatio) /
      Math.max(0.01, 1 - TRACK_LIMITS.cornerDriftMinSpeedRatio),
  )
  const cornerRelief =
    1 -
    bankedControlRatio * TRACK_LIMITS.bankedCornerDriftRelief -
    (vehicle.isAirbraking ? TRACK_LIMITS.airbrakeCornerDriftRelief : 0)
  const curveForce =
    curve *
    Math.abs(vehicle.forwardSpeed) *
    Math.abs(vehicle.forwardSpeed) *
    TRACK_LIMITS.cornerDriftForce *
    cornerSpeedRatio *
    Math.max(0.28, cornerRelief) *
    dt
  const laneCenteringScale = vehicle.isAirbraking ? TRACK_LIMITS.airbrakeLaneCenteringScale : 1
  const centeringForce = -vehicle.lane * TRACK_LIMITS.laneCenteringForce * laneCenteringScale * dt
  velocity = add3(velocity, scale3(profileNow.right, curveForce + centeringForce))
  const movingGrip = profile.lateralGrip * (1 + saturate(vehicle.telemetry.speedRatio) * 0.18 + bankedControlRatio * BANKED_CONTROL.gripAssist)
  const bankedDriftGrip = profile.lateralGrip * 0.78 * (1 + bankedControlRatio * 0.18)
  const driftBlend = saturate(bankedControlRatio * BANKED_CONTROL.airbrakeGripAssist)
  const grip = vehicle.isAirbraking ? profile.driftGrip + (bankedDriftGrip - profile.driftGrip) * driftBlend : movingGrip
  let headingForwardSpeed = dot3(velocity, heading)
  let headingSideSpeed = dot3(velocity, headingRight)
  headingSideSpeed = expDecay(headingSideSpeed, grip, dt)

  let drag = profile.drag
  if (vehicle.isAirbraking) drag *= Math.abs(steer) > 0.2 ? 1.72 : 3.05
  if (vehicle.telemetry.offTrack) drag *= TRACK_LIMITS.offTrackDragMultiplier
  if (vehicle.railContactMemorySeconds > 0 || vehicle.packBumpPulse > 0) {
    drag *= TRACK_LIMITS.contactDragMultiplier
  }
  headingForwardSpeed = expDecay(headingForwardSpeed, drag, dt)
  headingSideSpeed = expDecay(headingSideSpeed, drag, dt)
  velocity = add3(scale3(heading, headingForwardSpeed), scale3(headingRight, headingSideSpeed))

  const targetMax =
    profile.maxSpeed +
    (profile.boostSpeed - profile.maxSpeed) * saturate(vehicle.boostIntensity) +
    slipstreamSpeedBonus +
    profile.airbrakeExitSpeedBonus * vehicle.airbrakeExitPulse +
    PADS.speedPadSpeedBonus * vehicle.speedPadPulse +
    CRASH_OUT.respawnBoostSpeedBonus * (vehicle.crashOutLaunchRemaining / CRASH_OUT.respawnBoostSeconds)
  const trackForwardSpeed = dot3(velocity, profileNow.tangent)
  const trackLateralSpeed = dot3(velocity, profileNow.right)
  const planarSpeed = Math.hypot(trackForwardSpeed, trackLateralSpeed)
  const maxPlanarSpeed = Math.max(profile.maxSpeed, targetMax)
  const speedScale = planarSpeed > maxPlanarSpeed ? maxPlanarSpeed / Math.max(0.0001, planarSpeed) : 1
  vehicle.forwardSpeed = clamp(trackForwardSpeed * speedScale, -profile.reverseAcceleration * 0.68, Number.POSITIVE_INFINITY)
  vehicle.lateralSpeed = trackLateralSpeed * speedScale

  vehicle.distance = wrapDistance(vehicle.distance + vehicle.forwardSpeed * dt, track.totalLength)
  vehicle.lane += vehicle.lateralSpeed * dt

  const activeProfile = track.sample(vehicle.distance)
  vehicle.yawOffset = yawOffsetForHeading(activeProfile.tangent, activeProfile.right, heading)
  if (Math.abs(vehicle.lane) > activeProfile.width * TRACK_LIMITS.autoResetOffsetMultiplier) {
    resetToLastGate(vehicle)
    vehicle.crashOutGraceRemaining = Math.max(vehicle.crashOutGraceRemaining, 0.6)
    return
  }

  const railLimit = activeProfile.width * 0.5 - TRACK_LIMITS.shipHalfWidth
  const overLimit = Math.abs(vehicle.lane) - railLimit
  vehicle.telemetry.offTrack = overLimit > 0
  vehicle.telemetry.railPressure = saturate(overLimit / Math.max(0.001, TRACK_LIMITS.railPadding))
  vehicle.telemetry.trackLimitRatio = saturate(Math.abs(vehicle.lane) / Math.max(1, activeProfile.width * 0.5))
  if (vehicle.telemetry.offTrack) {
    const side = Math.sign(vehicle.lane) || 1
    const pinnedRatio = updateRailContactHold(vehicle, side, dt)
    const outwardSpeed = Math.max(0, vehicle.lateralSpeed * side)
    vehicle.lane = clamp(vehicle.lane, -railLimit, railLimit)
    const releasePressure = Math.max(vehicle.telemetry.railPressure, TRACK_LIMITS.railReleaseContactFloor)
    const releaseSpeed = TRACK_LIMITS.railReleaseMinSpeed +
      TRACK_LIMITS.railReleasePressureSpeed * releasePressure +
      TRACK_LIMITS.railSlidePinnedReleaseSpeed * pinnedRatio
    const currentNormalSpeed = Math.max(0, -vehicle.lateralSpeed * side)
    const normalSpeed = clamp(
      Math.max(currentNormalSpeed, releaseSpeed),
      releaseSpeed,
      releaseSpeed + TRACK_LIMITS.railSlideMaxExtraOutwardSpeed,
    )
    vehicle.lateralSpeed = -side * normalSpeed
    const slideLoss = (1 - TRACK_LIMITS.railSlideTangentRetention) * vehicle.telemetry.railPressure
    const railRetentionFloor = Math.min(
      1,
      TRACK_LIMITS.railSlideForwardMinimumScale +
        (TRACK_LIMITS.railSlidePinnedForwardMinimumScale - TRACK_LIMITS.railSlideForwardMinimumScale) * pinnedRatio,
    )
    vehicle.forwardSpeed *= Math.max(railRetentionFloor, 1 - slideLoss)
    const yawSharpness = TRACK_LIMITS.railSlideYawSharpness +
      (TRACK_LIMITS.railSlidePinnedYawSharpness - TRACK_LIMITS.railSlideYawSharpness) * pinnedRatio
    vehicle.yawOffset = approach(vehicle.yawOffset, 0, yawSharpness, dt)
    if (vehicle.railDamageCooldown <= 0) {
      const hardHit = vehicle.forwardSpeed > TRACK_LIMITS.heavyHitSpeedThreshold && outwardSpeed > TRACK_LIMITS.glanceHitSpeedThreshold
      const retention = hardHit ? profile.railHeavyHitRetention : profile.railGlanceRetention
      vehicle.forwardSpeed *= retention
      const speedSeverity = saturate(vehicle.forwardSpeed / Math.max(1, profile.boostSpeed))
      applyIntegrityDamage(vehicle, profile.railIntegrityDamage + profile.railSpeedIntegrityDamage * speedSeverity)
      vehicle.railDamageCooldown = TRACK_LIMITS.railDamageInterval
    }
  }
  vehicle.telemetry.railPinnedRatio = railPinnedRatioFor(vehicle)

  const clean = cleanLineQuality(track, vehicle, throttle)
  vehicle.telemetry.cleanLineQuality = approach(vehicle.telemetry.cleanLineQuality, clean, 6.4, dt)
  if (
    !vehicle.isBoosting &&
    vehicle.telemetry.cleanLineQuality >= POWER.cleanLineThreshold &&
    vehicle.telemetry.speedRatio >= POWER.cleanLineMinSpeedRatio
  ) {
    vehicle.power = saturate(vehicle.power + POWER.cleanLineBonus * vehicle.telemetry.cleanLineQuality * dt)
    vehicle.integrity = saturate(vehicle.integrity + INTEGRITY.cleanLineRepair * vehicle.telemetry.cleanLineQuality * dt)
    vehicle.cleanLinePulse = Math.max(vehicle.cleanLinePulse, vehicle.telemetry.cleanLineQuality)
  }
  if (!currentlyOffTrack && slipstream.strength >= INTEGRITY.slipstreamRepairThreshold && vehicle.integrity < 1) {
    vehicle.integrity = saturate(vehicle.integrity + INTEGRITY.slipstreamRepair * slipstream.strength * dt)
  }

  updateWrongWay(vehicle, dt)
  const bankRatio = saturate(Math.abs(activeProfile.bankDegrees) / Math.max(1, HOVER.bankedMaxBankDegrees))
  vehicle.telemetry.hoverClearance =
    HOVER.height +
    bankRatio * HOVER.bankedExtraHeight +
    slopeHoverBonus(track, vehicle.distance) +
    saturate(Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.boostSpeed)) * HOVER.speedExtraHeight
  const impactBank = vehicle.packBumpPulse * 0.18 * Math.sign(vehicle.lane || 1) + vehicle.powerDamagePulse * 0.12 * Math.sign(vehicle.lane || 1)
  const targetBank =
    -steer * (vehicle.isAirbraking ? 42 : 31) * (Math.PI / 180) +
    vehicle.lateralSpeed * 1.2 * (Math.PI / 180) +
    impactBank
  const targetPitch =
    (-throttle * 5 - saturate(Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.boostSpeed)) * 3 + vehicle.boostIntensity * -4) *
    (Math.PI / 180)
  vehicle.visualBank = approach(vehicle.visualBank, clamp(targetBank, -48 * Math.PI / 180, 48 * Math.PI / 180), 8, dt)
  vehicle.visualPitch = approach(vehicle.visualPitch, clamp(targetPitch, -12 * Math.PI / 180, 11 * Math.PI / 180), 8, dt)
  vehicle.telemetry.speedRatio = Math.abs(vehicle.forwardSpeed) / Math.max(1, profile.boostSpeed)
  syncResourceTelemetry(vehicle)
  vehicle.telemetry.airbrakeExitCharge = calculateAirbrakeExitCharge(vehicle, input)
}

export const markGatePassed = (vehicle: Vehicle, gateIndex: number, gateDistance: number, gateCount = 8): void => {
  vehicle.lastGateIndex = gateIndex
  vehicle.lastGateDistance = gateDistance
  vehicle.nextGateIndex = (gateIndex + 1) % Math.max(1, gateCount)
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
  const travelled = Math.max(0.0001, distanceAlongForward(vehicle.previousDistance, vehicle.distance, track.totalLength))
  const gateDelta = distanceAlongForward(vehicle.previousDistance, gate.distance, track.totalLength)
  const t = clamp(gateDelta / travelled, 0, 1)
  const laneAtGate = vehicle.previousLane + (vehicle.lane - vehicle.previousLane) * t
  return crossedForward && Math.abs(laneAtGate) <= gate.halfWidth
}
