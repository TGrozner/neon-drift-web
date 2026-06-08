import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBotBrain, getBotInput } from '../shared/bot'
import { FIXED_DT, RACE, SHIP_PROFILES, SLIPSTREAM } from '../shared/constants'
import { cross3, dot3 } from '../shared/math'
import { EMPTY_INPUT, createVehicle } from '../shared/physics'
import { isInsidePad, triggerTrackPads } from '../shared/pads'
import { getPlayer, startRace, updateRace, updateRivals, updateStandings } from '../shared/race'
import { SOURCE_TRACK_SPECS } from '../shared/sourceTracks'
import {
  createSlipstreamState,
  publishSlipstream,
  sampleSlipstream,
} from '../shared/slipstream'
import { NEON_OVAL, TRACKS, trackToWorld } from '../shared/track'
import { NeonAudioEngine } from '../src/audio/neonAudio'
import { standingsForHud } from '../src/components/hudRows'
import { applyTouchCommand, applyTouchSteer, createTouchState } from '../src/hooks/useNeonGame'
import { createRenderBasis } from '../src/render/renderer'

const angleBetweenDegrees = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => Math.acos(Math.max(-1, Math.min(1, dot3(a, b)))) * 180 / Math.PI

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('builds every source-authored track with finite samples and valid pads', () => {
    expect(TRACKS).toHaveLength(10)
    expect(TRACKS[0].id).toBe('tutorial-circuit')
    for (const track of TRACKS) {
      const sourceSpec = SOURCE_TRACK_SPECS.find((spec) => spec.id === track.id)
      expect(track.totalLength).toBeGreaterThan(100)
      expect(track.gates).toHaveLength(8)
      expect(track.startGrid).toHaveLength(8)
      expect(track.visualSegments).toHaveLength((sourceSpec?.nodes.length ?? 0) * (sourceSpec?.subdivisions ?? 0))
      expect(track.skylineTowers).toHaveLength(0)
      for (let i = 0; i < 12; i += 1) {
        const profile = track.sample((track.totalLength * i) / 12)
        expect(Number.isFinite(profile.center.x)).toBe(true)
        expect(Number.isFinite(profile.center.y)).toBe(true)
        expect(Number.isFinite(profile.center.z)).toBe(true)
        expect(profile.width).toBeGreaterThan(8)
      }
      expect(track.sample(0).up.y, `${track.id} start up`).toBeGreaterThan(0.98)
      for (const pad of track.pads) {
        expect(Math.abs(pad.lane)).toBeLessThan(track.sample(pad.distance).width * 0.5)
        expect(pad.distance).toBeGreaterThanOrEqual(0)
        expect(pad.distance).toBeLessThan(track.totalLength)
        expect(isInsidePad(track, pad, pad.distance, pad.lane)).toBe(true)
      }
    }
  })

  it('makes the tutorial circuit wider and less crowded than the baseline oval', () => {
    const tutorial = TRACKS.find((track) => track.id === 'tutorial-circuit')

    expect(tutorial?.width).toBeGreaterThan(NEON_OVAL.width)
    expect(tutorial?.startGrid[4].back).toBeGreaterThan(NEON_OVAL.startGrid[4].back)
    expect(tutorial?.startGrid[0].lane).toBe(0)
    expect(Math.abs(tutorial?.startGrid[3].lane ?? 0)).toBeGreaterThan(Math.abs(NEON_OVAL.startGrid[3].lane))
  })

  it('keeps source-authored tracks inside smooth playable envelopes', () => {
    for (const track of TRACKS) {
      let maxTangentDelta = 0
      let maxBankDelta = 0
      let maxFrameDot = 0
      let previous = track.sample(0)
      const samples = 720
      for (let i = 1; i <= samples; i += 1) {
        const profile = track.sample((track.totalLength * i) / samples)
        maxTangentDelta = Math.max(maxTangentDelta, angleBetweenDegrees(previous.tangent, profile.tangent))
        maxBankDelta = Math.max(maxBankDelta, Math.abs(profile.bankDegrees - previous.bankDegrees))
        maxFrameDot = Math.max(
          maxFrameDot,
          Math.abs(dot3(profile.tangent, profile.right)),
          Math.abs(dot3(profile.tangent, profile.up)),
          Math.abs(dot3(profile.right, profile.up)),
        )
        previous = profile
      }

      const start = track.sample(0)
      const ahead = track.sample(Math.min(18, track.totalLength * 0.04))
      const behind = track.sample(track.totalLength - Math.min(18, track.totalLength * 0.04))
      expect(maxTangentDelta, `${track.id} tangent delta`).toBeLessThan(12)
      expect(maxBankDelta, `${track.id} bank delta`).toBeLessThan(5)
      expect(maxFrameDot, `${track.id} frame orthogonality`).toBeLessThan(0.01)
      expect(angleBetweenDegrees(start.tangent, ahead.tangent), `${track.id} launch straight ahead`).toBeLessThan(8)
      expect(angleBetweenDegrees(start.tangent, behind.tangent), `${track.id} launch straight behind`).toBeLessThan(8)
      expect(Math.abs(start.bankDegrees), `${track.id} launch bank`).toBeLessThan(1)
      expect(start.up.y, `${track.id} launch up`).toBeGreaterThan(0.98)
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

  it('applies a published trail through the race update loop', () => {
    const withDraft = startRace('balanced')
    const withoutDraft = startRace('balanced')
    for (const race of [withDraft, withoutDraft]) {
      race.phase = 'racing'
      race.raceTime = 1
      const player = getPlayer(race)
      player.distance = 72
      player.previousDistance = 72
      player.lane = 0
      player.previousLane = 0
      player.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.58
      for (const vehicle of race.vehicles) {
        if (vehicle.isPlayer) continue
        vehicle.distance = 180 + Number(vehicle.id.split('-')[1] ?? 0) * 16
        vehicle.previousDistance = vehicle.distance
        vehicle.lane = race.track.width * 0.36
        vehicle.previousLane = vehicle.lane
        vehicle.forwardSpeed = SHIP_PROFILES[vehicle.profileId].maxSpeed * 0.52
      }
    }

    const draftOwner = withDraft.vehicles[1]
    draftOwner.distance = getPlayer(withDraft).distance + SLIPSTREAM.halfLength * 1.15
    draftOwner.previousDistance = draftOwner.distance
    draftOwner.lane = 0
    draftOwner.previousLane = 0
    draftOwner.forwardSpeed = SHIP_PROFILES[draftOwner.profileId].maxSpeed
    expect(publishSlipstream(
      withDraft.slipstream,
      withDraft.track,
      draftOwner.id,
      draftOwner.distance,
      draftOwner.lane,
      draftOwner.forwardSpeed,
      SHIP_PROFILES[draftOwner.profileId].maxSpeed,
      withDraft.raceTime,
    )).toBe(true)

    updateRace(withDraft, { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)
    updateRace(withoutDraft, { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)

    expect(getPlayer(withDraft).slipstreamPulse).toBeGreaterThan(0)
    expect(getPlayer(withDraft).forwardSpeed).toBeGreaterThan(getPlayer(withoutDraft).forwardSpeed)
  })
})

describe('bot ai', () => {
  it('changes lane or brakes when a slower vehicle is ahead', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, 40, 0)
    const ahead = createVehicle('slow', 'Slow', 'heavy', false, 46, 0)
    bot.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.72
    ahead.forwardSpeed = SHIP_PROFILES.heavy.maxSpeed * 0.18
    const brain = createBotBrain('bot', 0.4)
    const input = getBotInput(brain, NEON_OVAL, bot, [bot, ahead], 1 / 60)
    expect(Math.abs(input.steer) + (1 - input.throttle)).toBeGreaterThan(0.05)
    expect(brain.trafficBrakeIntent).toBeGreaterThan(0)
  })

  it('does not brake just because a faster vehicle is ahead', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, 40, 0)
    const ahead = createVehicle('fast', 'Fast', 'swift', false, 46.2, 0)
    bot.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.32
    ahead.forwardSpeed = SHIP_PROFILES.swift.maxSpeed * 0.58
    const brain = createBotBrain('bot', 0.4)

    getBotInput(brain, NEON_OVAL, bot, [bot, ahead], 1 / 60)

    expect(brain.trafficBrakeIntent).toBe(0)
  })

  it('targets useful pads deterministically', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, NEON_OVAL.pads[0].distance - 8, 0)
    const brain = createBotBrain('bot', 0.4)
    const first = getBotInput(brain, NEON_OVAL, bot, [bot], 1 / 60)
    const second = getBotInput(createBotBrain('bot', 0.4), NEON_OVAL, bot, [bot], 1 / 60)
    expect(first.steer).toBe(second.steer)
    expect(brain.wantsPad).toBe(true)
  })

  it('counter-steers sustained yaw instead of compounding bot spin', () => {
    const rightYaw = createVehicle('bot', 'Bot', 'balanced', false, 0, 0)
    rightYaw.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.62
    rightYaw.yawOffset = 0.92

    const leftYaw = createVehicle('bot', 'Bot', 'balanced', false, 0, 0)
    leftYaw.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.62
    leftYaw.yawOffset = -0.92

    expect(getBotInput(createBotBrain('bot', 0.4), NEON_OVAL, rightYaw, [rightYaw], 1 / 60).steer).toBeLessThan(-0.3)
    expect(getBotInput(createBotBrain('bot', 0.4), NEON_OVAL, leftYaw, [leftYaw], 1 / 60).steer).toBeGreaterThan(0.3)
  })

  it('keeps autonomous launch traffic out of sustained full-lock yaw', () => {
    const race = startRace('balanced')
    updateRace(race, { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }, 0.5)
    updateRace(race, { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }, 3.1)

    let maxBotYaw = 0
    let fullLockFrames = 0
    for (let frame = 0; frame < 420; frame += 1) {
      updateRace(race, { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)
      for (const vehicle of race.vehicles) {
        if (vehicle.isPlayer) continue
        const yaw = Math.abs(vehicle.yawOffset)
        maxBotYaw = Math.max(maxBotYaw, yaw)
        if (yaw > 1.12) fullLockFrames += 1
      }
    }

    expect(maxBotYaw).toBeLessThan(1.2)
    expect(fullLockFrames).toBe(0)
  })
})

describe('race flow', () => {
  it('starts the player centered instead of pinned near a rail', () => {
    const race = startRace('balanced')
    expect(getPlayer(race).lane).toBe(0)
  })

  it('matches the s&box eight-participant launch grid', () => {
    const race = startRace('balanced')

    expect(race.vehicles).toHaveLength(8)
    expect(race.vehicles.map((vehicle) => vehicle.name)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'])
    expect(race.vehicles.map((vehicle) => vehicle.profileId)).toEqual([
      'balanced',
      'swift',
      'heavy',
      'balanced',
      'swift',
      'balanced',
      'heavy',
      'swift',
    ])
  })

  it('uses the s&box Looping Inferno subdivision count', () => {
    expect(SOURCE_TRACK_SPECS.find((track) => track.id === 'looping-inferno')?.subdivisions).toBe(32)
  })

  it('moves from warmup to countdown to racing and applies launch boost', () => {
    const race = startRace('balanced')
    expect(race.track.id).toBe('tutorial-circuit')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 0.5)
    expect(race.phase).toBe('countdown')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 3.1)
    expect(race.phase).toBe('racing')
    expect(race.vehicles[0].forwardSpeed).toBeGreaterThan(0)
  })

  it('keeps the tutorial boost drill forgiving through the first bend', () => {
    const race = startRace('balanced', 'tutorial-circuit')
    const input = { throttle: 1, steer: 0, boost: true, airbrake: false, reset: false }

    for (let time = 0; time < 7; time += FIXED_DT) {
      updateRace(race, input, FIXED_DT)
    }

    expect(getPlayer(race).crashOutCount).toBe(0)
    expect(getPlayer(race).power).toBeGreaterThan(0.1)
  })

  it('expires non-critical race toasts after a short readable window', () => {
    const race = startRace('balanced')
    const idle = { throttle: 0, steer: 0, boost: false, airbrake: false, reset: false }
    race.phase = 'racing'
    race.lastToast = 'RIVAL PASSED'
    race.toastAge = 0
    for (const vehicle of race.vehicles) {
      vehicle.finished = true
    }

    updateRace(race, idle, RACE.toastSeconds + 0.01)

    expect(race.lastToast).toBe('')
  })

  it('keeps a short oval race from ending before there is meaningful driving time', () => {
    const race = startRace('balanced', 'neon-oval')
    const input = { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }
    for (let i = 0; i < 12 / (1 / 60); i += 1) {
      updateRace(race, input, 1 / 60)
    }

    expect(race.phase).toBe('racing')
    expect(getPlayer(race).finished).toBe(false)
    expect(race.vehicles.some((vehicle) => vehicle.finished)).toBe(false)
  })

  it('applies pack contact separation and feedback', () => {
    const race = startRace('balanced')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 0.5)
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 3.1)
    const player = race.vehicles[0]
    const rival = race.vehicles[1]
    player.distance = 50
    rival.distance = 50.4
    player.lane = 0
    rival.lane = 0.2
    player.forwardSpeed = 35
    rival.forwardSpeed = 20

    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)

    expect(player.packBumpPulse).toBeGreaterThan(0)
    expect(rival.packBumpPulse).toBeGreaterThan(0)
    expect(Math.abs(rival.lane - player.lane)).toBeGreaterThan(0.2)
  })

  it('does not trigger pads by sweeping from a pre-reset position', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)
    const pad = race.track.pads[0]
    player.distance = pad.distance - pad.halfLength - 1
    player.lane = pad.lane
    player.lastGateDistance = pad.distance + pad.halfLength + 1
    player.forwardSpeed = SHIP_PROFILES[player.profileId].maxSpeed

    updateRace(race, { ...EMPTY_INPUT, reset: true }, 1 / 60)

    expect(player.distance).toBe(player.lastGateDistance)
    expect(player.speedPadPulse + player.rechargePadPulse).toBe(0)
    expect(race.padCooldowns[`player:${pad.id}`]).toBeUndefined()
  })

  it('rewards the player when a nearby rival crashes out', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)
    const rival = race.vehicles[1]
    if (!rival) throw new Error('Missing rival')
    player.distance = 80
    player.lane = 0
    player.power = 0.35
    rival.distance = 84
    rival.lane = race.track.sample(rival.distance).width * 0.5
    rival.lastGateDistance = 70
    rival.forwardSpeed = SHIP_PROFILES[rival.profileId].boostSpeed
    rival.lateralSpeed = 120
    rival.power = 0.001
    rival.crashOutGraceRemaining = 0

    updateRace(race, EMPTY_INPUT, 1 / 60)

    expect(rival.crashOutCount).toBe(1)
    expect(player.power).toBeGreaterThan(0.45)
    expect(player.knockoutRewardPulse).toBe(1)
    expect(player.rivalPassPulse).toBe(0)
    expect(race.lastToast).toBe('KO ENERGY')
  })

  it('separates exact same-lane pack overlaps deterministically', () => {
    const race = startRace('balanced')
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 0.5)
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 3.1)
    const player = race.vehicles[0]
    const rival = race.vehicles[1]
    player.distance = 50
    rival.distance = 50
    player.lane = 0
    rival.lane = 0
    player.forwardSpeed = 35
    rival.forwardSpeed = 20

    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)

    expect(player.packBumpPulse).toBeGreaterThan(0)
    expect(rival.packBumpPulse).toBeGreaterThan(0)
    expect(Math.abs(rival.lane - player.lane)).toBeGreaterThan(0)
  })

  it('ranks first-lap vehicles by start-line progress after distance wrap', () => {
    const race = startRace('balanced')
    const player = getPlayer(race)
    const rival = race.vehicles.find((vehicle) => vehicle.id === 'bot-1')
    if (!rival) throw new Error('Missing bot-1')
    player.distance = 1
    player.lap = 1
    player.nextGateIndex = 1
    rival.distance = race.track.totalLength - 1
    rival.lap = 1
    rival.nextGateIndex = 1

    updateStandings(race)

    expect(race.standings.findIndex((vehicle) => vehicle.id === player.id)).toBeLessThan(
      race.standings.findIndex((vehicle) => vehicle.id === rival.id),
    )
  })

  it('does not emit slipstream from finished vehicles', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    for (const vehicle of race.vehicles) {
      vehicle.finished = true
      vehicle.forwardSpeed = SHIP_PROFILES[vehicle.profileId].boostSpeed
    }

    updateRace(race, { throttle: 1, steer: 0, boost: true, airbrake: false, reset: false }, 1 / 60)

    expect(race.slipstream.segments).toHaveLength(0)
  })

  it('tracks nearest rivals around the player instead of only the leaders', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const distances: Record<string, number> = {
      'bot-1': 8,
      'bot-2': 7,
      'bot-3': 6,
      'bot-4': 5,
      player: 4,
      'bot-5': 3,
      'bot-6': 2,
      'bot-7': 1,
    }
    for (const vehicle of race.vehicles) {
      vehicle.distance = distances[vehicle.id] ?? 0
      vehicle.lap = 1
      vehicle.finished = false
    }

    updateStandings(race)
    updateRivals(race)

    const rivalIds = race.rivals.map((vehicle) => vehicle.id)
    expect(race.standings.findIndex((vehicle) => vehicle.id === race.playerId)).toBe(4)
    expect(rivalIds).toContain('bot-4')
    expect(rivalIds).toContain('bot-5')
    expect(rivalIds).not.toContain('bot-1')
    expect(race.rivalGaps['bot-4']).toBeCloseTo(1)
    expect(race.rivalGaps['bot-5']).toBeCloseTo(-1)
  })

  it('keeps the local player visible in compact HUD standings', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    for (const [index, vehicle] of race.vehicles.entries()) {
      vehicle.distance = 16 - index * 2
    }
    getPlayer(race).distance = 5
    updateStandings(race)

    const rows = standingsForHud(race.standings, race.playerId)

    expect(rows).toHaveLength(4)
    expect(rows.at(-1)?.vehicle.id).toBe(race.playerId)
    expect(rows.at(-1)?.position).toBe(6)
  })
})

describe('browser integration helpers', () => {
  it('builds right-handed render bases from authored track frames', () => {
    for (const track of TRACKS) {
      for (let i = 0; i < 16; i += 1) {
        const profile = track.sample((track.totalLength * i) / 16)
        const basis = createRenderBasis(profile.tangent, profile.up, profile.right)
        const determinant = dot3(cross3(basis.forward, basis.up), basis.right)

        expect(determinant, `${track.id} basis determinant`).toBeGreaterThan(0.99)
        expect(Math.abs(dot3(basis.forward, basis.up)), `${track.id} forward/up`).toBeLessThan(0.001)
        expect(Math.abs(dot3(basis.forward, basis.right)), `${track.id} forward/right`).toBeLessThan(0.001)
        expect(Math.abs(dot3(basis.up, basis.right)), `${track.id} up/right`).toBeLessThan(0.001)
      }
    }
  })

  it('keeps touch steering idempotent across duplicate pointer releases', () => {
    const touch = createTouchState()

    applyTouchCommand(touch, 'left', true)
    expect(touch.steer).toBe(1)
    applyTouchCommand(touch, 'left', false)
    applyTouchCommand(touch, 'left', false)
    expect(touch.steer).toBe(0)

    applyTouchCommand(touch, 'right', true)
    expect(touch.steer).toBe(-1)
    applyTouchCommand(touch, 'left', true)
    expect(touch.steer).toBe(0)
    applyTouchCommand(touch, 'right', false)
    applyTouchCommand(touch, 'right', false)
    expect(touch.steer).toBe(1)
  })

  it('applies analog mobile touch steering without sticky left/right state', () => {
    const touch = createTouchState()

    applyTouchSteer(touch, -0.62)
    expect(touch.steer).toBeCloseTo(-0.62)
    expect(touch.left).toBe(false)
    expect(touch.right).toBe(false)

    applyTouchCommand(touch, 'left', true)
    expect(touch.steer).toBe(1)
    applyTouchSteer(touch, 0)
    expect(touch.steer).toBe(0)
    expect(touch.left).toBe(false)
    expect(touch.right).toBe(false)
  })

  it('plays the finish cue once when results follow the finished phase', () => {
    const audioEvents: { type: 'play'; src: string }[] = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      volume = 1
      playbackRate = 1

      constructor(src = '') {
        this.src = src
      }

      play() {
        audioEvents.push({ type: 'play', src: this.src })
        return Promise.resolve()
      }

      pause() {
        return undefined
      }
    }

    vi.stubGlobal('Audio', FakeAudio)
    const race = startRace('balanced')
    race.phase = 'racing'
    const engine = new NeonAudioEngine()
    engine.unlock()
    engine.sync(race)

    race.phase = 'finished'
    engine.sync(race)
    race.phase = 'results'
    engine.sync(race)
    engine.dispose()

    expect(audioEvents.filter((event) => event.src.endsWith('/finish.wav'))).toHaveLength(1)
  })

  it('plays s&box menu feedback cues on explicit menu commands', () => {
    const audioEvents: { type: 'play' | 'playbackRate'; src: string; value?: number }[] = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      volume = 1
      private currentPlaybackRate = 1

      constructor(src = '') {
        this.src = src
      }

      get playbackRate() {
        return this.currentPlaybackRate
      }

      set playbackRate(value: number) {
        this.currentPlaybackRate = value
        audioEvents.push({ type: 'playbackRate', src: this.src, value })
      }

      play() {
        audioEvents.push({ type: 'play', src: this.src })
        return Promise.resolve()
      }

      pause() {
        return undefined
      }
    }

    vi.stubGlobal('Audio', FakeAudio)
    const engine = new NeonAudioEngine()
    engine.unlock()

    engine.playMenuCue('forward')
    engine.playMenuCue('back')
    engine.playMenuCue('hover')
    engine.playMenuCue('deny')
    engine.dispose()

    expect(audioEvents.filter((event) => event.type === 'play').map((event) => event.src.split('/').at(-1))).toEqual([
      'menu_forward.wav',
      'menu_back.wav',
      'menu_hover.wav',
      'menu_deny.wav',
    ])
    expect(audioEvents.find((event) => event.src.endsWith('/menu_deny.wav') && event.type === 'playbackRate')?.value).toBeCloseTo(0.66)
  })

  it('plays a low-volume menu back cue when returning to menu', () => {
    const audioEvents: { type: 'play' | 'volume'; src: string; value?: number }[] = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      playbackRate = 1
      private currentVolume = 1

      constructor(src = '') {
        this.src = src
      }

      get volume() {
        return this.currentVolume
      }

      set volume(value: number) {
        this.currentVolume = value
        audioEvents.push({ type: 'volume', src: this.src, value })
      }

      play() {
        audioEvents.push({ type: 'play', src: this.src })
        return Promise.resolve()
      }

      pause() {
        return undefined
      }
    }

    vi.stubGlobal('Audio', FakeAudio)
    const race = startRace('balanced')
    race.phase = 'racing'
    const engine = new NeonAudioEngine()
    engine.unlock()
    engine.sync(race)

    race.phase = 'menu'
    engine.sync(race, 0)
    engine.dispose()

    expect(audioEvents.some((event) => event.type === 'play' && event.src.endsWith('/menu_back.wav'))).toBe(true)
    expect(audioEvents.find((event) => event.src.endsWith('/menu_back.wav') && event.type === 'volume')?.value).toBeCloseTo(0.25)
  })

  it('plays the knockout reward cue separately from rival pass', () => {
    const audioEvents: { type: 'play'; src: string }[] = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      volume = 1
      playbackRate = 1

      constructor(src = '') {
        this.src = src
      }

      play() {
        audioEvents.push({ type: 'play', src: this.src })
        return Promise.resolve()
      }

      pause() {
        return undefined
      }
    }

    vi.stubGlobal('Audio', FakeAudio)
    const race = startRace('balanced')
    race.phase = 'racing'
    const engine = new NeonAudioEngine()
    engine.unlock()
    engine.sync(race)

    getPlayer(race).knockoutRewardPulse = 1
    engine.sync(race, 0)
    engine.dispose()

    expect(audioEvents.some((event) => event.src.endsWith('/knockout_reward.wav'))).toBe(true)
    expect(audioEvents.some((event) => event.src.endsWith('/rival_pass.wav'))).toBe(false)
  })

  it('decrements repeated audio cue cooldowns by elapsed sync time', () => {
    const audioEvents: { type: 'play'; src: string }[] = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      volume = 1
      playbackRate = 1

      constructor(src = '') {
        this.src = src
      }

      play() {
        audioEvents.push({ type: 'play', src: this.src })
        return Promise.resolve()
      }

      pause() {
        return undefined
      }
    }

    vi.stubGlobal('Audio', FakeAudio)
    const race = startRace('balanced')
    race.phase = 'racing'
    getPlayer(race).telemetry.offTrack = true
    const engine = new NeonAudioEngine()
    engine.unlock()

    engine.sync(race, 0)
    engine.sync(race, 0.01)
    engine.sync(race, 0.41)
    engine.sync(race, 0.02)
    engine.dispose()

    expect(audioEvents.filter((event) => event.src.endsWith('/rail_scrape.wav'))).toHaveLength(2)
  })
})
