import { describe, expect, it } from 'vitest'
import { createBotBrain, getBotInput } from '../shared/bot'
import { SHIP_PROFILES, SLIPSTREAM } from '../shared/constants'
import { createVehicle } from '../shared/physics'
import { isInsidePad, triggerTrackPads } from '../shared/pads'
import { startRace, updateRace } from '../shared/race'
import {
  createSlipstreamState,
  publishSlipstream,
  sampleSlipstream,
} from '../shared/slipstream'
import { NEON_OVAL, trackToWorld } from '../shared/track'

describe('track and pads', () => {
  it('has valid length, gates, grid, and pads on the track', () => {
    expect(NEON_OVAL.totalLength).toBeGreaterThan(100)
    expect(NEON_OVAL.gates).toHaveLength(8)
    expect(NEON_OVAL.startGrid).toHaveLength(8)
    for (const pad of NEON_OVAL.pads) {
      expect(Math.abs(pad.lane)).toBeLessThan(NEON_OVAL.width * 0.5)
      expect(pad.distance).toBeGreaterThanOrEqual(0)
      expect(pad.distance).toBeLessThan(NEON_OVAL.totalLength)
      expect(isInsidePad(NEON_OVAL, pad, pad.distance, pad.lane)).toBe(true)
    }
  })

  it('transforms track coordinates to 3D world positions', () => {
    const world = trackToWorld(NEON_OVAL, 12, 2, 1)
    expect(Number.isFinite(world.x)).toBe(true)
    expect(Number.isFinite(world.y)).toBe(true)
    expect(Number.isFinite(world.z)).toBe(true)
  })

  it('triggers pads with swept crossing and respects per-vehicle cooldown', () => {
    const pad = NEON_OVAL.pads[0]
    const cooldowns = {}
    const first = triggerTrackPads(
      NEON_OVAL,
      cooldowns,
      'ship',
      pad.distance - pad.halfLength - 1,
      pad.lane,
      pad.distance + pad.halfLength + 1,
      pad.lane,
      1,
    )
    expect(first).toHaveLength(1)
    const second = triggerTrackPads(
      NEON_OVAL,
      cooldowns,
      'ship',
      pad.distance - pad.halfLength,
      pad.lane,
      pad.distance + pad.halfLength,
      pad.lane,
      1.2,
    )
    expect(second).toHaveLength(0)
  })
})

describe('slipstream', () => {
  it('emits above minimum speed and never affects the owner', () => {
    const state = createSlipstreamState()
    const emitted = publishSlipstream(
      state,
      NEON_OVAL,
      'owner',
      60,
      0,
      SLIPSTREAM.minEmitSpeed + 4,
      SHIP_PROFILES.balanced.maxSpeed,
      1,
    )
    expect(emitted).toBe(true)
    const ownerSample = sampleSlipstream(state, NEON_OVAL, 'owner', 48, 0, 1.1)
    expect(ownerSample.strength).toBe(0)
  })

  it('samples in trail, rejects outside width, decays with age, and caps stacks', () => {
    const state = createSlipstreamState()
    for (let i = 0; i < 8; i += 1) {
      publishSlipstream(
        state,
        NEON_OVAL,
        `owner-${i}`,
        80 + i * 0.02,
        0,
        SHIP_PROFILES.balanced.maxSpeed,
        SHIP_PROFILES.balanced.maxSpeed,
        i * SLIPSTREAM.emitInterval,
      )
    }
    const now = 2
    const inside = sampleSlipstream(state, NEON_OVAL, 'ship', 68, 0, now)
    const outside = sampleSlipstream(state, NEON_OVAL, 'ship', 68, SLIPSTREAM.halfWidth + 2, now)
    const old = sampleSlipstream(state, NEON_OVAL, 'ship', 68, 0, SLIPSTREAM.lifetime + 8)

    expect(inside.strength).toBeGreaterThan(0)
    expect(inside.strength).toBeLessThanOrEqual(SLIPSTREAM.stackCap)
    expect(outside.strength).toBe(0)
    expect(old.strength).toBe(0)
  })
})

describe('bot ai', () => {
  it('changes lane or brakes when a slower vehicle is ahead', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, 40, 0)
    const ahead = createVehicle('slow', 'Slow', 'heavy', false, 46, 0)
    ahead.forwardSpeed = 4
    const brain = createBotBrain('bot', 0.4)
    const input = getBotInput(brain, NEON_OVAL, bot, [bot, ahead], 1 / 60)
    expect(Math.abs(input.steer) + (1 - input.throttle)).toBeGreaterThan(0.05)
  })

  it('targets useful pads deterministically', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, NEON_OVAL.pads[0].distance - 8, 0)
    const brain = createBotBrain('bot', 0.4)
    const first = getBotInput(brain, NEON_OVAL, bot, [bot], 1 / 60)
    const second = getBotInput(createBotBrain('bot', 0.4), NEON_OVAL, bot, [bot], 1 / 60)
    expect(first.steer).toBe(second.steer)
    expect(brain.wantsPad).toBe(true)
  })
})

describe('race flow', () => {
  it('moves from warmup to countdown to racing and applies launch boost', () => {
    const race = startRace('balanced')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 0.5)
    expect(race.phase).toBe('countdown')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 3.1)
    expect(race.phase).toBe('racing')
    expect(race.vehicles[0].forwardSpeed).toBeGreaterThan(0)
  })
})
