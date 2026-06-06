import { describe, expect, it } from 'vitest'
import { SHIP_PROFILES } from '../shared/constants'
import {
  EMPTY_INPUT,
  applyPowerDamage,
  createVehicle,
  stepVehicle,
} from '../shared/physics'
import { NEON_OVAL } from '../shared/track'

const noSlipstream = {
  strength: 0,
  accelerationBonus: 0,
  lanePull: 0,
  activeSegments: 0,
  stackCapped: false,
}

describe('ship physics', () => {
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

  it('crash-out restores checkpoint, power, grace, and penalty', () => {
    const vehicle = createVehicle('ship', 'Ship', 'balanced', true, 40, 3)
    vehicle.lastGateDistance = 25
    applyPowerDamage(vehicle, 2)

    expect(vehicle.distance).toBe(25)
    expect(vehicle.lane).toBe(0)
    expect(vehicle.power).toBeGreaterThan(0.3)
    expect(vehicle.crashOutCount).toBe(1)
    expect(vehicle.timePenalty).toBe(3)
    expect(vehicle.crashOutGraceRemaining).toBeGreaterThan(1)
  })
})

