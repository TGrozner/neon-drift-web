import { describe, expect, it } from 'vitest'
import { CRASH_OUT, INTEGRITY, SHIP_PROFILES, SLIPSTREAM } from '../shared/constants'
import {
  EMPTY_INPUT,
  applyIntegrityDamage,
  createVehicle,
  resetToLastGate,
  stepVehicle,
} from '../shared/physics'
import { distanceAlongForward } from '../shared/math'
import { NEON_OVAL, trackById, type RaceTrack } from '../shared/track'

const noSlipstream = {
  strength: 0,
  accelerationBonus: 0,
  lanePull: 0,
  activeSegments: 0,
  stackCapped: false,
}

const straightTestTrack: RaceTrack = {
  id: 'neon-oval',
  name: 'Straight test track',
  description: 'Physics-only straightaway.',
  totalLength: 1000,
  width: 24,
  gates: [],
  pads: [],
  startGrid: [],
  visualSegments: [],
  sample: (distance) => ({
    center: { x: distance, y: 0, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    right: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    width: 24,
    distance,
    bankDegrees: 0,
  }),
}

const bankedDistance = (): number => {
  const bankedTrack = trackById('banked-speedway')
  for (let i = 0; i < 160; i += 1) {
    const distance = (bankedTrack.totalLength * i) / 160
    if (Math.abs(bankedTrack.sample(distance).bankDegrees) > 12) return distance
  }
  return 0
}

describe('ship physics', () => {
  it('reaches s&box-scale straight-line speed instead of crawling', () => {
    const track = trackById('banked-speedway')
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    for (let i = 0; i < 120; i += 1) {
      stepVehicle(vehicle, {
        track,
        input: { ...EMPTY_INPUT, throttle: 1 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }

    expect(vehicle.forwardSpeed).toBeGreaterThan(68)
    expect(vehicle.forwardSpeed).toBeLessThan(SHIP_PROFILES.balanced.maxSpeed)
  })

  it('keeps committed yaw after steering is released', () => {
    const track = trackById('banked-speedway')
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.5
    for (let i = 0; i < 10; i += 1) {
      stepVehicle(vehicle, {
        track,
        input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }
    const committedYaw = Math.abs(vehicle.yawOffset)
    for (let i = 0; i < 24; i += 1) {
      stepVehicle(vehicle, {
        track,
        input: { ...EMPTY_INPUT, throttle: 1, steer: 0 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }

    expect(committedYaw).toBeGreaterThan(0.08)
    expect(Math.abs(vehicle.yawOffset)).toBeGreaterThan(committedYaw * 0.9)
  })

  it('keeps sustained full-lock steering from snapping into the rail', () => {
    const track = trackById('tutorial-circuit')
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.64

    for (let i = 0; i < 54; i += 1) {
      stepVehicle(vehicle, {
        track,
        input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }

    expect(Math.abs(vehicle.yawOffset)).toBeLessThan(1.05)
    expect(vehicle.telemetry.offTrack).toBe(false)
    expect(Math.abs(vehicle.lane)).toBeGreaterThan(track.sample(vehicle.distance).width * 0.18)
    expect(Math.abs(vehicle.lane)).toBeLessThan(track.sample(vehicle.distance).width * 0.48)
  })

  it('caps combined planar speed instead of only forward speed', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed
    vehicle.lateralSpeed = SHIP_PROFILES.balanced.maxSpeed

    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1 },
      dt: 0.001,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(Math.hypot(vehicle.forwardSpeed, vehicle.lateralSpeed)).toBeLessThanOrEqual(
      SHIP_PROFILES.balanced.maxSpeed * 1.01,
    )
  })

  it('treats invalid direct physics input as neutral instead of steering or braking', () => {
    const invalid = createVehicle('invalid', 'Invalid', 'balanced', true, 20, 0)
    const neutral = createVehicle('neutral', 'Neutral', 'balanced', true, 20, 0)
    invalid.forwardSpeed = 40
    neutral.forwardSpeed = 40

    stepVehicle(invalid, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: Number.NaN, steer: Number.NaN },
      dt: 1 / 60,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    stepVehicle(neutral, {
      track: NEON_OVAL,
      input: EMPTY_INPUT,
      dt: 1 / 60,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(invalid.forwardSpeed).toBeCloseTo(neutral.forwardSpeed)
    expect(invalid.lane).toBeCloseTo(neutral.lane)
    expect(invalid.yawOffset).toBeCloseTo(neutral.yawOffset)
  })

  it('airbrake keeps more lateral slip and increases turn authority', () => {
    const normal = createVehicle('normal', 'Normal', 'balanced', true, 20, 0)
    const airbrake = createVehicle('airbrake', 'Airbrake', 'balanced', true, 20, 0)
    normal.lateralSpeed = 10
    airbrake.lateralSpeed = 10

    stepVehicle(normal, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    stepVehicle(airbrake, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1, airbrake: true },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(Math.abs(airbrake.lateralSpeed)).toBeGreaterThan(Math.abs(normal.lateralSpeed))
    expect(Math.abs(airbrake.yawOffset)).toBeGreaterThan(Math.abs(normal.yawOffset))
  })

  it('does not trigger airbrake exit boost before minimum hold', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1, airbrake: true },
      dt: 0.08,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    const before = vehicle.forwardSpeed
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(vehicle.airbrakeExitPulse).toBe(0)
    expect(vehicle.forwardSpeed - before).toBeLessThan(SHIP_PROFILES.balanced.airbrakeExitBoostImpulse * 0.2)
  })

  it('does not trigger airbrake exit boost without steer or lateral slip', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 0, airbrake: true },
      dt: 0.32,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    const before = vehicle.forwardSpeed
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 0 },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(vehicle.airbrakeExitPulse).toBe(0)
    expect(vehicle.forwardSpeed - before).toBeLessThan(SHIP_PROFILES.balanced.airbrakeExitBoostImpulse * 0.2)
  })

  it('does not trigger airbrake exit boost while already at the rail', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, NEON_OVAL.width * 0.5)
    vehicle.isAirbraking = true
    vehicle.airbrakeHoldSeconds = 0.32
    vehicle.lateralSpeed = 8

    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(vehicle.airbrakeExitPulse).toBe(0)
  })

  it('triggers airbrake exit boost after charge and respects cooldown', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.lateralSpeed = 8
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1, airbrake: true },
      dt: 0.28,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    const before = vehicle.forwardSpeed
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    const afterFirst = vehicle.forwardSpeed
    expect(vehicle.airbrakeExitPulse).toBeGreaterThan(0)
    expect(afterFirst).toBeGreaterThan(before)

    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1, airbrake: true },
      dt: 0.28,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    vehicle.airbrakeExitPulse = 0
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    expect(vehicle.airbrakeExitPulse).toBe(0)
  })

  it('honors boost activation, continue threshold, and empty lockout', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.power = SHIP_PROFILES.balanced.boostActivationThreshold - 0.01
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, boost: true },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    expect(vehicle.isBoosting).toBe(false)

    vehicle.power = 0.05
    vehicle.isBoosting = true
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, boost: true },
      dt: 0.016,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    expect(vehicle.isBoosting).toBe(true)

    vehicle.power = 0.026
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, boost: true },
      dt: 0.5,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    expect(vehicle.boostEmptyLockout).toBe(true)
    expect(vehicle.isBoosting).toBe(false)
  })

  it('profiles expose distinct handling values', () => {
    expect(SHIP_PROFILES.swift.acceleration).toBeGreaterThan(SHIP_PROFILES.balanced.acceleration)
    expect(SHIP_PROFILES.heavy.maxSpeed).toBeGreaterThan(SHIP_PROFILES.balanced.maxSpeed)
    expect(SHIP_PROFILES.heavy.railIntegrityDamage).toBeLessThan(SHIP_PROFILES.swift.railIntegrityDamage)
  })

  it('adds banked-turn assist to steering and grip', () => {
    const bankedTrack = trackById('banked-speedway')
    const straight = createVehicle('straight', 'Straight', 'balanced', true, 4, 0)
    const banked = createVehicle('banked', 'Banked', 'balanced', true, bankedDistance(), 0)
    straight.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.15
    banked.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.15
    straight.lateralSpeed = 12
    banked.lateralSpeed = 12

    stepVehicle(straight, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    stepVehicle(banked, {
      track: bankedTrack,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(Math.abs(banked.yawOffset)).toBeGreaterThan(Math.abs(straight.yawOffset))
    expect(Math.abs(banked.lateralSpeed)).toBeLessThan(Math.abs(straight.lateralSpeed))
  })

  it('lets slipstream pull past normal max speed but fades below boost speed', () => {
    const lowSpeed = createVehicle('low', 'Low', 'balanced', true, 20, 0)
    const nearMax = createVehicle('near-max', 'Near Max', 'balanced', true, 20, 0)
    const aboveDraft = createVehicle('above-draft', 'Above Draft', 'balanced', true, 20, 0)
    lowSpeed.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.6
    nearMax.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 1.01
    aboveDraft.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed + SLIPSTREAM.speedBonus * 1.02
    const slipstream = {
      strength: 1,
      accelerationBonus: SLIPSTREAM.acceleration,
      lanePull: 0,
      activeSegments: 1,
      stackCapped: false,
    }

    stepVehicle(lowSpeed, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 0 },
      dt: 1 / 60,
      slipstream,
      nearbyVehicles: 0,
    })
    stepVehicle(nearMax, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 0 },
      dt: 1 / 60,
      slipstream,
      nearbyVehicles: 0,
    })
    stepVehicle(aboveDraft, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 0 },
      dt: 1 / 60,
      slipstream,
      nearbyVehicles: 0,
    })

    expect(lowSpeed.slipstreamPulse).toBeGreaterThan(0)
    expect(nearMax.slipstreamPulse).toBeGreaterThan(0)
    expect(nearMax.forwardSpeed).toBeGreaterThan(SHIP_PROFILES.balanced.maxSpeed)
    expect(nearMax.forwardSpeed).toBeLessThan(SHIP_PROFILES.balanced.boostSpeed)
    expect(aboveDraft.slipstreamPulse).toBe(0)
  })

  it('turns sustained slipstream into meaningful catch-up distance', () => {
    const profile = SHIP_PROFILES.balanced
    const drafted = createVehicle('drafted', 'Drafted', 'balanced', true, 20, 0)
    const solo = createVehicle('solo', 'Solo', 'balanced', true, 20, 0)
    drafted.forwardSpeed = profile.maxSpeed * 0.86
    solo.forwardSpeed = drafted.forwardSpeed
    const strength = 0.85
    const slipstream = {
      strength,
      accelerationBonus: SLIPSTREAM.acceleration * strength,
      lanePull: 0,
      activeSegments: 1,
      stackCapped: false,
    }

    for (let i = 0; i < 180; i += 1) {
      stepVehicle(drafted, {
        track: straightTestTrack,
        input: { ...EMPTY_INPUT, throttle: 1 },
        dt: 1 / 60,
        slipstream,
        nearbyVehicles: 0,
      })
      stepVehicle(solo, {
        track: straightTestTrack,
        input: { ...EMPTY_INPUT, throttle: 1 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }

    expect(distanceAlongForward(solo.distance, drafted.distance, straightTestTrack.totalLength)).toBeGreaterThan(48)
    expect(drafted.forwardSpeed).toBeGreaterThan(solo.forwardSpeed + 16)
    expect(drafted.forwardSpeed).toBeLessThan(profile.boostSpeed)
  })

  it('applies integrity damage without draining boost power', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 40, 3)
    vehicle.power = 0.72
    vehicle.integrity = 0.68

    applyIntegrityDamage(vehicle, 0.22)

    expect(vehicle.power).toBe(0.72)
    expect(vehicle.integrity).toBeCloseTo(0.46)
    expect(vehicle.telemetry.integrityDamaged).toBe(true)
    expect(vehicle.crashOutCount).toBe(0)
  })

  it('crash-out restores checkpoint, integrity, power floor, grace, and penalty', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 40, 3)
    vehicle.previousDistance = 36
    vehicle.previousLane = 2
    vehicle.lastGateDistance = 25
    vehicle.power = 0.08
    applyIntegrityDamage(vehicle, 2)

    expect(vehicle.distance).toBe(25)
    expect(vehicle.lane).toBe(0)
    expect(vehicle.previousDistance).toBe(vehicle.distance)
    expect(vehicle.previousLane).toBe(vehicle.lane)
    expect(vehicle.power).toBeGreaterThanOrEqual(CRASH_OUT.restorePower)
    expect(vehicle.integrity).toBe(CRASH_OUT.restoreIntegrity)
    expect(vehicle.crashOutCount).toBe(1)
    expect(vehicle.timePenalty).toBe(3)
    expect(vehicle.crashOutGraceRemaining).toBeGreaterThan(1)
  })

  it('repairs damaged integrity through slipstream comeback pressure', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 20, 0)
    vehicle.integrity = INTEGRITY.damagedThreshold - 0.08
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.64
    const drafting = {
      strength: 0.7,
      accelerationBonus: 0,
      lanePull: 0,
      activeSegments: 1,
      stackCapped: false,
    }

    for (let i = 0; i < 120; i += 1) {
      stepVehicle(vehicle, {
        track: straightTestTrack,
        input: { ...EMPTY_INPUT, throttle: 1 },
        dt: 1 / 60,
        slipstream: drafting,
        nearbyVehicles: 0,
      })
    }

    expect(vehicle.integrity).toBeGreaterThan(INTEGRITY.damagedThreshold - 0.08)
    expect(vehicle.slipstreamPulse).toBeGreaterThan(0)
  })

  it('manual reset syncs swept crossing origin to the checkpoint', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 80, 3)
    vehicle.previousDistance = 70
    vehicle.previousLane = -2
    vehicle.lastGateDistance = 22

    resetToLastGate(vehicle)

    expect(vehicle.distance).toBe(22)
    expect(vehicle.lane).toBe(0)
    expect(vehicle.previousDistance).toBe(vehicle.distance)
    expect(vehicle.previousLane).toBe(vehicle.lane)
  })

  it('flags wrong-way after sustained reverse movement', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 40, 0)
    for (let i = 0; i < 80; i += 1) {
      stepVehicle(vehicle, {
        track: NEON_OVAL,
        input: { ...EMPTY_INPUT, throttle: -1 },
        dt: 1 / 60,
        slipstream: noSlipstream,
        nearbyVehicles: 0,
      })
    }

    expect(vehicle.forwardSpeed).toBeLessThan(0)
    expect(vehicle.telemetry.wrongWay).toBe(true)
  })

  it('pins rail contact and increases release feedback while scraping', () => {
    const vehicle = createVehicle('rail', 'Rail', 'balanced', true, 20, NEON_OVAL.width * 0.5)
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.8
    vehicle.lateralSpeed = 18

    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })
    const firstHold = vehicle.railContactHoldSeconds
    const firstRelease = Math.abs(vehicle.lateralSpeed)
    vehicle.lane = NEON_OVAL.width * 0.5
    vehicle.lateralSpeed = 18
    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1, steer: 1 },
      dt: 1 / 30,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(vehicle.telemetry.railPinnedRatio).toBeGreaterThan(0)
    expect(vehicle.railContactHoldSeconds).toBeGreaterThan(firstHold)
    expect(Math.abs(vehicle.lateralSpeed)).toBeGreaterThanOrEqual(firstRelease)
  })

  it('auto-recovers if projected far outside the track footprint', () => {
    const vehicle = createVehicle('lost', 'Lost', 'balanced', true, 50, NEON_OVAL.width * 2)
    vehicle.lastGateDistance = 12
    vehicle.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed

    stepVehicle(vehicle, {
      track: NEON_OVAL,
      input: { ...EMPTY_INPUT, throttle: 1 },
      dt: 1 / 60,
      slipstream: noSlipstream,
      nearbyVehicles: 0,
    })

    expect(vehicle.distance).toBe(12)
    expect(vehicle.lane).toBe(0)
    expect(vehicle.previousDistance).toBe(vehicle.distance)
    expect(vehicle.previousLane).toBe(vehicle.lane)
    expect(vehicle.crashOutGraceRemaining).toBeGreaterThan(0)
  })
})
