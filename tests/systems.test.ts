import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { createBotBrain, getBotInput } from '../shared/bot'
import { FIXED_DT, PACK_CONTACT, RACE, SHIP_PROFILES, SLIPSTREAM } from '../shared/constants'
import { clamp, cross3, distanceAlongForward, dot3, signedWrappedDelta, wrapDistance } from '../shared/math'
import { EMPTY_INPUT, crashOut, createVehicle } from '../shared/physics'
import { isInsidePad, triggerTrackPads } from '../shared/pads'
import { applyTutorialBotAssist, getPlayer, startRace, updateRace, updateRivals, updateStandings } from '../shared/race'
import { SOURCE_TRACK_SPECS } from '../shared/sourceTracks'
import {
  createSlipstreamState,
  publishSlipstream,
  sampleSlipstream,
  slipstreamSegmentInfluence,
} from '../shared/slipstream'
import { ALL_TRACKS, TUTORIAL_CIRCUIT, TRACKS, trackToWorld } from '../shared/track'
import { travelYawForVehicle, visualYawForVehicle } from '../shared/vehicleVisuals'
import { NeonAudioEngine } from '../src/audio/neonAudio'
import { RaceOverlay } from '../src/components/RaceOverlay'
import { TelemetryCockpit } from '../src/components/TelemetryCockpit'
import { Tutorial } from '../src/components/Tutorial'
import { draftMeterRatio } from '../src/components/draftSignals'
import { standingsForHud } from '../src/components/hudRows'
import { shouldAdvanceTutorial } from '../src/components/tutorialProgress'
import { applyTouchCommand, createTouchState } from '../src/hooks/useNeonGame'
import { VISUAL_LIGHTING, createRenderBasis } from '../src/render/renderer'

const angleBetweenDegrees = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => Math.acos(Math.max(-1, Math.min(1, dot3(a, b)))) * 180 / Math.PI

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('numeric guardrails', () => {
  it('keeps non-finite values from leaking into core distance helpers', () => {
    expect(clamp(Number.NaN, -1, 1)).toBe(-1)
    expect(clamp(Number.POSITIVE_INFINITY, -1, 1)).toBe(1)
    expect(wrapDistance(Number.NaN, 100)).toBe(0)
    expect(wrapDistance(112, Number.NaN)).toBe(112)
    expect(signedWrappedDelta(Number.NaN, 10, 100)).toBe(10)
    expect(distanceAlongForward(10, Number.NaN, 100)).toBe(90)
  })
})

describe('track and pads', () => {
  it('has valid length, gates, grid, and pads on the track', () => {
    expect(TUTORIAL_CIRCUIT.totalLength).toBeGreaterThan(100)
    expect(TUTORIAL_CIRCUIT.gates).toHaveLength(8)
    expect(TUTORIAL_CIRCUIT.startGrid).toHaveLength(8)
    for (const pad of TUTORIAL_CIRCUIT.pads) {
      expect(Math.abs(pad.lane)).toBeLessThan(TUTORIAL_CIRCUIT.width * 0.5)
      expect(pad.distance).toBeGreaterThanOrEqual(0)
      expect(pad.distance).toBeLessThan(TUTORIAL_CIRCUIT.totalLength)
      expect(isInsidePad(TUTORIAL_CIRCUIT, pad, pad.distance, pad.lane)).toBe(true)
    }
  })

  it('builds every source-authored track with finite samples and valid pads', () => {
    expect(ALL_TRACKS).toHaveLength(SOURCE_TRACK_SPECS.length)
    expect(ALL_TRACKS[0].id).toBe('tutorial-circuit')
    for (const track of ALL_TRACKS) {
      const sourceSpec = SOURCE_TRACK_SPECS.find((spec) => spec.id === track.id)
      expect(track.totalLength).toBeGreaterThan(100)
      expect(track.gates).toHaveLength(8)
      expect(track.startGrid).toHaveLength(8)
      expect(track.visualSegments).toHaveLength((sourceSpec?.nodes.length ?? 0) * (sourceSpec?.subdivisions ?? 0))
      expect('skylineTowers' in track).toBe(false)
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

  it('includes the Vortex Gauntlet as a high-inversion stunt track', () => {
    const vortex = ALL_TRACKS.find((track) => track.id === 'vortex-gauntlet')
    const spec = SOURCE_TRACK_SPECS.find((track) => track.id === 'vortex-gauntlet')

    expect(vortex?.name).toBe('Vortex Gauntlet')
    expect(spec?.allowInvertedFrame).toBe(true)
    const nodeBanks = spec?.nodes.map((node) => node.bank) ?? []
    expect(Math.max(...nodeBanks)).toBeGreaterThan(205)
    expect(Math.min(...nodeBanks)).toBeLessThan(-205)

    const sampledHeights: number[] = []
    const sampledUpY: number[] = []
    const sampledCenters: { x: number; y: number; z: number }[] = []
    const sampleCount = 96
    for (let i = 0; i < sampleCount; i += 1) {
      const profile = vortex?.sample(((vortex?.totalLength ?? 0) * i) / sampleCount)
      if (!profile) continue
      sampledHeights.push(profile.center.y)
      sampledUpY.push(profile.up.y)
      sampledCenters.push(profile.center)
    }

    expect(Math.max(...sampledHeights) - Math.min(...sampledHeights)).toBeGreaterThan(60)
    expect(Math.min(...sampledUpY)).toBeLessThan(-0.65)

    let closestNonLocalDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < sampledCenters.length; i += 1) {
      for (let j = i + 1; j < sampledCenters.length; j += 1) {
        const wrappedGap = Math.min(j - i, sampledCenters.length - (j - i))
        if (wrappedGap < 8) continue
        const a = sampledCenters[i]
        const b = sampledCenters[j]
        closestNonLocalDistance = Math.min(
          closestNonLocalDistance,
          Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
        )
      }
    }
    expect(closestNonLocalDistance).toBeGreaterThan(22)
  })

  it('exposes source-authored tracks except the baseline oval as playable tracks', () => {
    const expectedPlayableTrackIds = SOURCE_TRACK_SPECS
      .map((track) => track.id)
      .filter((id) => id !== 'neon-oval')

    expect(TRACKS.map((track) => track.id)).toEqual(expectedPlayableTrackIds)
    expect(TRACKS[0]).toBe(TUTORIAL_CIRCUIT)
    expect(TRACKS.some((track) => track.id === 'neon-oval')).toBe(false)
    expect(TRACKS.some((track) => track.id === 'inversion-ribbon')).toBe(true)
  })

  it('keeps source-authored tracks inside smooth playable envelopes', () => {
    for (const track of ALL_TRACKS) {
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
    const world = trackToWorld(TUTORIAL_CIRCUIT, 12, 2, 1)
    expect(Number.isFinite(world.x)).toBe(true)
    expect(Number.isFinite(world.y)).toBe(true)
    expect(Number.isFinite(world.z)).toBe(true)
  })

  it('triggers pads with swept crossing and respects per-vehicle cooldown', () => {
    const pad = TUTORIAL_CIRCUIT.pads[0]
    const cooldowns = {}
    const first = triggerTrackPads(
      TUTORIAL_CIRCUIT,
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
      TUTORIAL_CIRCUIT,
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
      TUTORIAL_CIRCUIT,
      'owner',
      60,
      0,
      SLIPSTREAM.minEmitSpeed + 4,
      SHIP_PROFILES.balanced.maxSpeed,
      1,
    )
    expect(emitted).toBe(true)
    const ownerSample = sampleSlipstream(state, TUTORIAL_CIRCUIT, 'owner', 48, 0, 1.1)
    expect(ownerSample.strength).toBe(0)
  })

  it('samples in trail, rejects outside width, decays with age, and caps stacks', () => {
    const state = createSlipstreamState()
    for (let i = 0; i < 8; i += 1) {
      publishSlipstream(
        state,
        TUTORIAL_CIRCUIT,
        `owner-${i}`,
        80 + i * 0.02,
        0,
        SHIP_PROFILES.balanced.maxSpeed,
        SHIP_PROFILES.balanced.maxSpeed,
        i * SLIPSTREAM.emitInterval,
      )
    }
    const now = 2
    const inside = sampleSlipstream(state, TUTORIAL_CIRCUIT, 'ship', 68, 0, now)
    const outside = sampleSlipstream(state, TUTORIAL_CIRCUIT, 'ship', 68, SLIPSTREAM.halfWidth + 2, now)
    const old = sampleSlipstream(state, TUTORIAL_CIRCUIT, 'ship', 68, 0, SLIPSTREAM.lifetime + 8)

    expect(inside.strength).toBeGreaterThan(0)
    expect(inside.strength).toBeLessThanOrEqual(SLIPSTREAM.stackCap)
    expect(outside.strength).toBe(0)
    expect(old.strength).toBe(0)
  })

  it('uses the same segment influence for physics sampling and visual draft bands', () => {
    const state = createSlipstreamState()
    expect(publishSlipstream(
      state,
      TUTORIAL_CIRCUIT,
      'owner',
      80,
      0,
      SHIP_PROFILES.balanced.maxSpeed,
      SHIP_PROFILES.balanced.maxSpeed,
      1,
    )).toBe(true)
    const segment = state.segments[0]
    const sample = sampleSlipstream(state, TUTORIAL_CIRCUIT, 'player', segment.centerDistance, 0, 1.2)
    const influence = slipstreamSegmentInfluence(segment, TUTORIAL_CIRCUIT, 'player', segment.centerDistance, 0, 1.2)
    const outside = slipstreamSegmentInfluence(
      segment,
      TUTORIAL_CIRCUIT,
      'player',
      segment.centerDistance,
      segment.halfWidth + 0.01,
      1.2,
    )
    const owner = slipstreamSegmentInfluence(segment, TUTORIAL_CIRCUIT, 'owner', segment.centerDistance, 0, 1.2)

    expect(influence.strength).toBeGreaterThan(0)
    expect(sample.strength).toBeCloseTo(Math.min(influence.strength, SLIPSTREAM.stackCap))
    expect(influence.alongRatio).toBe(1)
    expect(influence.lateralRatio).toBe(1)
    expect(outside.strength).toBe(0)
    expect(owner.strength).toBe(0)
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

describe('draft UI alignment', () => {
  it('keeps DRAFT meters tied to active slipstream instead of reward pulses', () => {
    const vehicle = createVehicle('player', 'P1', 'balanced', true, 0, 0)

    vehicle.slipstreamPulse = 0
    vehicle.rivalPassPulse = 1
    vehicle.knockoutRewardPulse = 1
    expect(draftMeterRatio(vehicle)).toBe(0)

    vehicle.slipstreamPulse = 0.42
    expect(draftMeterRatio(vehicle)).toBeCloseTo(0.42)

    vehicle.slipstreamPulse = 2
    expect(draftMeterRatio(vehicle)).toBe(1)

    vehicle.slipstreamPulse = Number.NaN
    expect(draftMeterRatio(vehicle)).toBe(0)
  })

  it('advances the tutorial draft step only from real slipstream', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)

    player.slipstreamPulse = 0
    player.rivalPassPulse = 1
    expect(shouldAdvanceTutorial('draft', race)).toBe(false)

    player.slipstreamPulse = 0.06
    expect(shouldAdvanceTutorial('draft', race)).toBe(true)
  })
})

describe('bot ai', () => {
  it('changes lane or brakes when a slower vehicle is ahead', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, 40, 0)
    const ahead = createVehicle('slow', 'Slow', 'heavy', false, 46, 0)
    bot.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.72
    ahead.forwardSpeed = SHIP_PROFILES.heavy.maxSpeed * 0.18
    const brain = createBotBrain('bot', 0.4)
    const input = getBotInput(brain, TUTORIAL_CIRCUIT, bot, [bot, ahead], 1 / 60)
    expect(Math.abs(input.steer) + (1 - input.throttle)).toBeGreaterThan(0.05)
    expect(brain.trafficBrakeIntent).toBeGreaterThan(0)
  })

  it('does not brake just because a faster vehicle is ahead', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, 40, 0)
    const ahead = createVehicle('fast', 'Fast', 'swift', false, 46.2, 0)
    bot.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.32
    ahead.forwardSpeed = SHIP_PROFILES.swift.maxSpeed * 0.58
    const brain = createBotBrain('bot', 0.4)

    getBotInput(brain, TUTORIAL_CIRCUIT, bot, [bot, ahead], 1 / 60)

    expect(brain.trafficBrakeIntent).toBe(0)
  })

  it('targets useful pads deterministically', () => {
    const bot = createVehicle('bot', 'Bot', 'balanced', false, TUTORIAL_CIRCUIT.pads[0].distance - 8, 0)
    const brain = createBotBrain('bot', 0.4)
    const first = getBotInput(brain, TUTORIAL_CIRCUIT, bot, [bot], 1 / 60)
    const second = getBotInput(createBotBrain('bot', 0.4), TUTORIAL_CIRCUIT, bot, [bot], 1 / 60)
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

    expect(getBotInput(createBotBrain('bot', 0.4), TUTORIAL_CIRCUIT, rightYaw, [rightYaw], 1 / 60).steer).toBeLessThan(-0.3)
    expect(getBotInput(createBotBrain('bot', 0.4), TUTORIAL_CIRCUIT, leftYaw, [leftYaw], 1 / 60).steer).toBeGreaterThan(0.3)
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

  it('keeps stunt-track bot noses close to their travel direction', () => {
    const race = startRace('balanced', 'inversion-ribbon')
    updateRace(race, EMPTY_INPUT, 0.5)
    updateRace(race, EMPTY_INPUT, 3.1)

    let maxBotYaw = 0
    let maxTravelMismatch = 0
    let maxVisualTravelMismatch = 0
    let sustainedMismatchFrames = 0
    let sustainedVisualMismatchFrames = 0
    for (let frame = 0; frame < 540; frame += 1) {
      updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)
      for (const vehicle of race.vehicles) {
        if (vehicle.isPlayer || vehicle.finished || vehicle.forwardSpeed < 12) continue
        const travelYaw = travelYawForVehicle(vehicle)
        const visualTravelMismatch = Math.abs(visualYawForVehicle(vehicle) - travelYaw)
        const mismatch = Math.abs(vehicle.yawOffset - travelYaw)
        maxBotYaw = Math.max(maxBotYaw, Math.abs(vehicle.yawOffset))
        maxTravelMismatch = Math.max(maxTravelMismatch, mismatch)
        maxVisualTravelMismatch = Math.max(maxVisualTravelMismatch, visualTravelMismatch)
        if (mismatch > 0.58) sustainedMismatchFrames += 1
        if (visualTravelMismatch > 0.48) sustainedVisualMismatchFrames += 1
      }
    }

    expect(maxBotYaw).toBeLessThan(0.92)
    expect(maxTravelMismatch).toBeLessThan(0.72)
    expect(maxVisualTravelMismatch).toBeLessThan(0.56)
    expect(sustainedMismatchFrames).toBeLessThan(12)
    expect(sustainedVisualMismatchFrames).toBeLessThan(8)
  })

  it('makes bumped bot visuals follow their actual travel direction', () => {
    const bot = createVehicle('bot-visual', 'Bot Visual', 'balanced', false, 0, 0)
    bot.forwardSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.72
    bot.lateralSpeed = SHIP_PROFILES.balanced.maxSpeed * 0.34
    bot.yawOffset = -0.36
    bot.packBumpPulse = 0.65

    const travelYaw = travelYawForVehicle(bot)
    const visualYaw = visualYawForVehicle(bot)

    expect(Math.abs(visualYaw - travelYaw)).toBeLessThan(Math.abs(bot.yawOffset - travelYaw) * 0.42)
    expect(Math.abs(visualYaw)).toBeLessThanOrEqual(0.92)
  })

  it('softens tutorial bots that are already ahead of the player', () => {
    const race = startRace('balanced', 'tutorial-circuit')
    race.phase = 'racing'
    race.raceTime = 8
    const player = getPlayer(race)
    const bot = race.vehicles[1]
    if (!bot) throw new Error('Missing bot')
    player.distance = 30
    bot.distance = 78

    const input = { throttle: 1, steer: 0.36, boost: true, airbrake: false, reset: false }
    const assisted = applyTutorialBotAssist(race, bot, input)

    expect(assisted.throttle).toBeLessThan(0.9)
    expect(assisted.boost).toBe(false)
    expect(assisted.steer).toBe(input.steer)
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

  it('keeps the tutorial race from ending before there is meaningful driving time', () => {
    const race = startRace('balanced', 'tutorial-circuit')
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
    player.power = 0.4
    player.integrity = 0.7

    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)

    expect(player.packBumpPulse).toBeGreaterThan(0)
    expect(rival.packBumpPulse).toBeGreaterThan(0)
    expect(Math.abs(rival.lane - player.lane)).toBeGreaterThan(0.2)
    expect(player.power).toBeGreaterThanOrEqual(0.4)
    expect(player.integrity).toBeLessThan(0.7)
    expect(race.runStats.contactCount).toBeGreaterThan(0)
    expect(race.runStats.integrityDamageTaken).toBeGreaterThan(0)
  })

  it('records run telemetry for tuning without changing race flow', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    race.raceTime = 0
    const player = getPlayer(race)
    player.forwardSpeed = SHIP_PROFILES[player.profileId].maxSpeed * 0.42

    updateRace(race, { throttle: 1, steer: 0, boost: true, airbrake: false, reset: false }, 1 / 60)
    updateRace(race, { throttle: 1, steer: 1, boost: false, airbrake: true, reset: false }, 1 / 60)
    updateRace(race, { throttle: 1, steer: 1, boost: false, airbrake: false, reset: true }, 1 / 60)
    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: true }, 1 / 60)

    expect(race.phase).toBe('racing')
    expect(race.runStats.sampleSeconds).toBeGreaterThan(0)
    expect(race.runStats.maxSpeed).toBeGreaterThan(0)
    expect(race.runStats.boostStarts).toBeGreaterThanOrEqual(1)
    expect(race.runStats.boostSeconds).toBeGreaterThan(0)
    expect(race.runStats.resetCount).toBe(1)
    expect(race.runStats.lowestIntegrity).toBeLessThanOrEqual(1)
  })

  it('charges more pack contact damage to the closing ship', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)
    const rival = race.vehicles[1]
    if (!rival) throw new Error('Missing rival')
    player.profileId = 'balanced'
    rival.profileId = 'balanced'
    player.distance = 50
    rival.distance = 49.72
    player.lane = 0
    rival.lane = 0
    player.forwardSpeed = 20
    rival.forwardSpeed = 58
    player.integrity = 0.7
    rival.integrity = 0.7

    updateRace(race, EMPTY_INPUT, 1 / 600)

    expect(player.packBumpPulse).toBeGreaterThan(0)
    expect(rival.packBumpPulse).toBeGreaterThan(0)
    expect(player.integrity).toBeLessThan(0.7)
    expect(rival.integrity).toBeLessThan(player.integrity)
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
    player.integrity = 0.4
    rival.distance = 84
    rival.lane = race.track.sample(rival.distance).width * 0.5
    rival.lastGateDistance = 70
    rival.forwardSpeed = SHIP_PROFILES[rival.profileId].boostSpeed
    rival.lateralSpeed = 120
    rival.integrity = 0.001
    rival.crashOutGraceRemaining = 0

    updateRace(race, EMPTY_INPUT, 1 / 60)

    expect(rival.crashOutCount).toBe(1)
    expect(player.power).toBeGreaterThan(0.45)
    expect(player.integrity).toBeGreaterThan(0.45)
    expect(player.knockoutRewardPulse).toBe(1)
    expect(player.rivalPassPulse).toBe(0)
    expect(race.lastToast).toBe('KO ENERGY')
  })

  it('ends the run when the player is permanently eliminated', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)

    crashOut(player)
    updateRace(race, EMPTY_INPUT, 1 / 60)

    expect(player.finished).toBe(true)
    expect(player.eliminated).toBe(true)
    expect(player.crashOutLaunchRemaining).toBe(0)
    expect(race.phase).toBe('finished')
    expect(race.lastToast).toBe('CRASH OUT')

    updateRace(race, EMPTY_INPUT, RACE.resultsDelaySeconds + 0.01)

    expect(race.phase).toBe('results')
  })

  it('rewards overtakes outside the previous rival window', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    const player = getPlayer(race)
    const staleRivals = race.vehicles.slice(1, 4)
    const passedRival = race.vehicles[4]
    if (!passedRival) throw new Error('Missing rival')

    race.rivals = staleRivals
    player.distance = 50
    player.lane = 0
    player.forwardSpeed = 110
    player.power = 0.35
    player.integrity = 0.48
    passedRival.distance = 50.45
    passedRival.lane = race.track.width * 0.35
    passedRival.forwardSpeed = 0
    for (const [index, vehicle] of staleRivals.entries()) {
      vehicle.distance = 95 + index * 8
      vehicle.lane = race.track.width * -0.35
      vehicle.forwardSpeed = 0
    }

    updateRace(race, { throttle: 1, steer: 0, boost: false, airbrake: false, reset: false }, 1 / 60)

    expect(player.rivalPassPulse).toBe(1)
    expect(player.power).toBeGreaterThan(0.4)
    expect(player.integrity).toBeGreaterThan(0.5)
    expect(race.lastToast).toBe('RIVAL PASSED')
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

  it('caps one-frame lateral shove in dense pack pileups', () => {
    const race = startRace('balanced')
    race.phase = 'racing'
    race.raceTime = 5
    const packedVehicles = race.vehicles.slice(0, 5)
    for (const [index, vehicle] of packedVehicles.entries()) {
      vehicle.distance = 50 + index * 0.04
      vehicle.lane = 0
      vehicle.forwardSpeed = index === 0 ? 62 : 24
      vehicle.lateralSpeed = 0
      vehicle.packBumpPulse = 0
    }

    updateRace(race, EMPTY_INPUT, 1 / 60)

    const maxLateralSpeed = Math.max(...packedVehicles.map((vehicle) => Math.abs(vehicle.lateralSpeed)))
    expect(maxLateralSpeed).toBeLessThanOrEqual(PACK_CONTACT.maxLateralSpeedDeltaPerSecond * (1 / 60) + 0.35)
    expect(packedVehicles.some((vehicle) => vehicle.packBumpPulse > 0)).toBe(true)
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

  it('renders run analysis and retry affordance on results', () => {
    const race = startRace('balanced')
    const player = getPlayer(race)
    race.phase = 'results'
    race.raceTime = 48.2
    player.finished = true
    player.finishTime = 48.2
    player.bestLapSeconds = 23.4
    player.finalPosition = 1
    race.runStats.sampleSeconds = 12
    race.runStats.speedSeconds = 840
    race.runStats.maxSpeed = 88
    race.runStats.cleanLineSeconds = 9
    race.runStats.boostStarts = 3
    race.runStats.boostSeconds = 2.4
    race.runStats.contactCount = 1
    updateStandings(race)

    render(createElement(RaceOverlay, { race, onRestart: vi.fn(), onMenu: vi.fn() }))

    expect(screen.getByTestId('run-analysis')).toBeTruthy()
    expect(screen.getByText('AVG')).toBeTruthy()
    expect(screen.getByText('MAX')).toBeTruthy()
    expect(screen.getByTestId('retry-race').textContent).toBe('RETRY NOW')
  })

  it('shows the telemetry cockpit only when explicitly requested', () => {
    const race = startRace('balanced')
    race.phase = 'racing'

    window.history.pushState({}, '', '/')
    render(createElement(TelemetryCockpit, { race }))
    expect(screen.queryByTestId('telemetry-cockpit')).toBeNull()
    cleanup()

    window.history.pushState({}, '', '/?debug=telemetry')
    render(createElement(TelemetryCockpit, { race }))
    expect(screen.getByTestId('telemetry-cockpit').textContent).toContain('RUN TELEMETRY')
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
  it('keeps global bloom and gate lighting under readable caps', () => {
    expect(VISUAL_LIGHTING.bloomBase + VISUAL_LIGHTING.bloomBoost).toBeLessThanOrEqual(0.55)
    expect(VISUAL_LIGHTING.exposureBase + VISUAL_LIGHTING.exposureBoost).toBeLessThanOrEqual(0.92)
    expect(
      VISUAL_LIGHTING.nextGateBeamBaseEmissive + VISUAL_LIGHTING.nextGateBeamPulseEmissive,
    ).toBeLessThanOrEqual(0.9)
    expect(VISUAL_LIGHTING.padChevronEmissive).toBeLessThan(1)
    expect(VISUAL_LIGHTING.railEmissive).toBeLessThan(VISUAL_LIGHTING.padBaseEmissive)
    expect(VISUAL_LIGHTING.sourceTrackRailEmissive).toBeLessThan(VISUAL_LIGHTING.sourceTrackStrongEmissive)
  })

  it('builds right-handed render bases from authored track frames', () => {
    for (const track of ALL_TRACKS) {
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

  it('keeps mobile direction held while auto throttle and actions change', () => {
    const touch = createTouchState()

    applyTouchCommand(touch, 'right', true)
    applyTouchCommand(touch, 'boost', true)
    applyTouchCommand(touch, 'airbrake', true)
    applyTouchCommand(touch, 'throttle', true)

    expect(touch.steer).toBe(-1)
    expect(touch.boost).toBe(true)
    expect(touch.airbrake).toBe(true)
    expect(touch.throttle).toBe(1)

    applyTouchCommand(touch, 'boost', false)
    applyTouchCommand(touch, 'airbrake', false)

    expect(touch.steer).toBe(-1)

    applyTouchCommand(touch, 'right', false)
    expect(touch.steer).toBe(0)
  })

  it('renders tutorial UI when tutorial storage is unavailable', () => {
    const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage unavailable')
        },
        setItem: () => {
          throw new Error('storage unavailable')
        },
        removeItem: () => {
          throw new Error('storage unavailable')
        },
      },
    })

    try {
      const race = startRace('balanced', 'tutorial-circuit')
      render(createElement(Tutorial, { activeTrackId: 'tutorial-circuit', race, raceVersion: 0 }))
      expect(screen.getByTestId('tutorial')).toBeTruthy()
    } finally {
      if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
    }
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

  it('plays crash-out feedback without recovery launch for permanent death', () => {
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

    crashOut(getPlayer(race))
    engine.sync(race, 0)
    expect(audioEvents.some((event) => event.src.endsWith('/crash_out.wav'))).toBe(true)
    expect(audioEvents.some((event) => event.src.endsWith('/crash_launch.wav'))).toBe(false)

    updateRace(race, EMPTY_INPUT, RACE.resultsDelaySeconds + 0.01)
    engine.sync(race, RACE.resultsDelaySeconds + 0.01)
    engine.dispose()

    expect(getPlayer(race).eliminated).toBe(true)
    expect(race.phase).toBe('finished')
    expect(audioEvents.some((event) => event.src.endsWith('/crash_launch.wav'))).toBe(false)
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
