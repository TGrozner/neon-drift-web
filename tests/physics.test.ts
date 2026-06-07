import { describe, expect, it } from 'vitest'
import { SHIP_PROFILES } from '../shared/constants'
import {
  EMPTY_INPUT,
  applyPowerDamage,
  createVehicle,
  resetToLastGate,
  stepVehicle,
} from '../shared/physics'
import { NEON_OVAL, trackById } from '../shared/track'

const noSlipstream = {
  strength: 0,
  accelerationBonus: 0,
  lanePull: 0,
  activeSegments: 0,
  stackCapped: false,
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

    expect(vehicle.forwardSpeed).toBeGreaterThan(60)
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

    expect(committedYaw).toBeGreaterThan(0.25)
    expect(Math.abs(vehicle.yawOffset)).toBeGreaterThan(committedYaw * 0.9)
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
    expect(SHIP_PROFILES.heavy.railPowerDamage).toBeLessThan(SHIP_PROFILES.swift.railPowerDamage)
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

  it('fades slipstream acceleration near normal max speed', () => {
    const lowSpeed = createVehicle('low', 'Low', 'balanced', true, 20, 0)
    const nearMax = createVehicle('near-max', 'Near Max', 'balanced', true, 20, 0)
    lowSpeed.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.6
    nearMax.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 1.01
    const slipstream = {
      strength: 1,
      accelerationBonus: 46,
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

    expect(lowSpeed.slipstreamPulse).toBeGreaterThan(0)
    expect(nearMax.slipstreamPulse).toBe(0)
  })

  it('crash-out restores checkpoint, power, grace, and penalty', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 40, 3)
    vehicle.previousDistance = 36
    vehicle.previousLane = 2
    vehicle.lastGateDistance = 25
    applyPowerDamage(vehicle, 2)

    expect(vehicle.distance).toBe(25)
    expect(vehicle.lane).toBe(0)
    expect(vehicle.previousDistance).toBe(vehicle.distance)
    expect(vehicle.previousLane).toBe(vehicle.lane)
    expect(vehicle.power).toBeGreaterThan(0.3)
    expect(vehicle.crashOutCount).toBe(1)
    expect(vehicle.timePenalty).toBe(3)
    expect(vehicle.crashOutGraceRemaining).toBeGreaterThan(1)
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
