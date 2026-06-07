import { createBotBrain, getBotInput, type BotBrain } from './bot'
import { CRASH_OUT, PACK_CONTACT, RACE, SHIP_PROFILES, TRACK_LIMITS, type ShipProfileId } from './constants'
import { distanceAlongForward, signedWrappedDelta } from './math'
import { triggerTrackPads, type PadCooldownState } from './pads'
import {
  EMPTY_INPUT,
  applyLaunchBoost,
  applyPadTrigger,
  applyPowerDamage,
  createVehicle,
  hasCrossedGate,
  markGatePassed,
  stepVehicle,
  updateLaunchBoostCharge,
  type Vehicle,
  type VehicleInput,
} from './physics'
import {
  createSlipstreamState,
  publishSlipstream,
  sampleSlipstream,
  type SlipstreamState,
} from './slipstream'
import { trackById, type RaceTrack, type TrackId } from './track'

export type RacePhase = 'menu' | 'warmup' | 'countdown' | 'racing' | 'finished' | 'results'

export type RaceState = {
  track: RaceTrack
  phase: RacePhase
  phaseTime: number
  raceTime: number
  totalLaps: number
  nextFinalPosition: number
  playerId: string
  vehicles: Vehicle[]
  botBrains: Record<string, BotBrain>
  slipstream: SlipstreamState
  padCooldowns: PadCooldownState
  standings: Vehicle[]
  rivals: Vehicle[]
  rivalGaps: Record<string, number>
  lastToast: string
  toastAge: number
}

const botNames = ['Vela', 'Ion', 'Pulse', 'Nova', 'Rook']
const botProfiles: ShipProfileId[] = ['swift', 'balanced', 'heavy', 'balanced', 'swift']

export const createRaceState = (
  profileId: ShipProfileId = 'balanced',
  trackId: TrackId = 'neon-oval',
): RaceState => {
  const track = trackById(trackId)
  const vehicles: Vehicle[] = []
  const botBrains: Record<string, BotBrain> = {}
  const slots = track.startGrid
  const playerSlot = slots[0]
  vehicles.push(
    createVehicle(
      'player',
      'You',
      profileId,
      true,
      track.totalLength - playerSlot.back,
      0,
    ),
  )

  for (let i = 0; i < botNames.length; i += 1) {
    const slot = slots[i + 1] ?? slots[0]
    const id = `bot-${i + 1}`
    vehicles.push(
      createVehicle(
        id,
        botNames[i] ?? `Bot ${i + 1}`,
        botProfiles[i] ?? 'balanced',
        false,
        track.totalLength - slot.back,
        slot.lane,
      ),
    )
    botBrains[id] = createBotBrain(id, 0.17 + i * 0.137)
  }

  return {
    track,
    phase: 'menu',
    phaseTime: 0,
    raceTime: 0,
    totalLaps: RACE.totalLaps,
    nextFinalPosition: 1,
    playerId: 'player',
    vehicles,
    botBrains,
    slipstream: createSlipstreamState(),
    padCooldowns: {},
    standings: vehicles,
    rivals: [],
    rivalGaps: {},
    lastToast: '',
    toastAge: 0,
  }
}

export const getPlayer = (race: RaceState): Vehicle =>
  race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]

export const startRace = (profileId: ShipProfileId, trackId: TrackId = 'neon-oval'): RaceState => {
  const fresh = createRaceState(profileId, trackId)
  fresh.phase = 'warmup'
  setToast(fresh, 'READY')
  return fresh
}

export const goToMenu = (race: RaceState): void => {
  race.phase = 'menu'
  race.phaseTime = 0
  race.raceTime = 0
  setToast(race, 'MENU')
}

const setToast = (race: RaceState, message: string): void => {
  race.lastToast = message
  race.toastAge = 0
}

const updateToast = (race: RaceState, dt: number): void => {
  if (!race.lastToast) return
  race.toastAge += dt
  const persistent =
    race.phase === 'warmup' ||
    race.phase === 'countdown' ||
    race.phase === 'finished' ||
    race.lastToast === 'FINAL LAP'
  if (!persistent && race.toastAge >= RACE.toastSeconds) {
    race.lastToast = ''
    race.toastAge = 0
  }
}

const progressFor = (race: RaceState, vehicle: Vehicle): number => {
  const firstGateDistance = race.track.gates[1]?.distance ?? race.track.totalLength
  const firstLapDistance =
    vehicle.lap === 1 &&
    vehicle.nextGateIndex === 1 &&
    vehicle.distance > firstGateDistance
      ? vehicle.distance - race.track.totalLength
      : vehicle.distance
  const base = (vehicle.lap - 1) * race.track.totalLength + firstLapDistance
  return vehicle.finished ? race.totalLaps * race.track.totalLength + 1000 - vehicle.finishTime : base
}

export const updateStandings = (race: RaceState): void => {
  race.standings = [...race.vehicles].sort((a, b) => {
    if (a.finished && b.finished) return (a.finalPosition || 999) - (b.finalPosition || 999) || a.finishTime - b.finishTime
    if (a.finished) return -1
    if (b.finished) return 1
    return progressFor(race, b) - progressFor(race, a)
  })
}

export const updateRivals = (race: RaceState): void => {
  const player = getPlayer(race)
  const playerProgress = progressFor(race, player)
  race.rivals = race.standings
    .filter((vehicle) => vehicle.id !== player.id && !vehicle.finished)
    .sort((a, b) =>
      Math.abs(progressFor(race, a) - playerProgress) -
      Math.abs(progressFor(race, b) - playerProgress),
    )
    .slice(0, 3)
  race.rivalGaps = Object.fromEntries(
    race.rivals.map((vehicle) => [
      vehicle.id,
      progressFor(race, vehicle) - progressFor(race, player),
    ]),
  )
}

const nearbyVehicleCount = (race: RaceState, vehicle: Vehicle): number =>
  race.vehicles.filter((other) => {
    if (other.id === vehicle.id || other.finished) return false
    const gap = Math.abs(signedWrappedDelta(vehicle.distance, other.distance, race.track.totalLength))
    return gap < 6.2 && Math.abs(other.lane - vehicle.lane) < 3.2
  }).length

const applyPackInteractions = (race: RaceState, dt: number): void => {
  for (let i = 0; i < race.vehicles.length; i += 1) {
    const a = race.vehicles[i]
    if (!a || a.finished || a.crashOutLockRemaining > 0) continue
    for (let j = i + 1; j < race.vehicles.length; j += 1) {
      const b = race.vehicles[j]
      if (!b || b.finished || b.crashOutLockRemaining > 0) continue

      const along = signedWrappedDelta(a.distance, b.distance, race.track.totalLength)
      const lateral = b.lane - a.lane
      const distance = Math.hypot(along, lateral)
      if (distance > PACK_CONTACT.proximityRadius) continue

      const safeDistance = Math.max(0.0001, distance)
      const proximity = 1 - safeDistance / PACK_CONTACT.proximityRadius
      const fallbackLaneDirection = a.id < b.id ? 1 : -1
      const laneDirection = Math.abs(lateral) > 0.0001 ? lateral / safeDistance : fallbackLaneDirection
      const alongDirection = Math.abs(along) > 0.0001 ? along / safeDistance : 0
      const repel = PACK_CONTACT.proximityRepelForce * proximity * dt
      a.lateralSpeed -= laneDirection * repel
      b.lateralSpeed += laneDirection * repel

      const slowdown = Math.max(0.82, 1 - PACK_CONTACT.proximitySlowdown * proximity * dt)
      a.forwardSpeed *= slowdown
      b.forwardSpeed *= slowdown

      if (distance > PACK_CONTACT.bumpRadius) continue

      const bump = 1 - distance / PACK_CONTACT.bumpRadius
      const aClosing = Math.max(0, a.forwardSpeed - b.forwardSpeed)
      const bClosing = Math.max(0, b.forwardSpeed - a.forwardSpeed)
      const aNoseContact = along > 0 ? Math.min(1, Math.abs(alongDirection)) : 0
      const bNoseContact = along < 0 ? Math.min(1, Math.abs(alongDirection)) : 0
      const strongestClosing = Math.max(aClosing, bClosing) / Math.max(1, Math.max(SHIP_PROFILES[a.profileId].boostSpeed, SHIP_PROFILES[b.profileId].boostSpeed))
      const deflection = PACK_CONTACT.bumpDeflection +
        (PACK_CONTACT.bumpNoseDeflection - PACK_CONTACT.bumpDeflection) * Math.max(aNoseContact, bNoseContact)
      const rebound = PACK_CONTACT.bumpReboundForce * bump * (0.35 + strongestClosing)
      const bumpForce = (PACK_CONTACT.bumpForce + Math.max(aClosing, bClosing) * deflection) * bump + rebound

      a.lateralSpeed -= laneDirection * bumpForce * dt
      b.lateralSpeed += laneDirection * bumpForce * dt

      if (aNoseContact > 0) {
        a.forwardSpeed *= Math.max(PACK_CONTACT.bumpMinRetention, 1 - PACK_CONTACT.bumpNoseSpeedLoss * bump * aNoseContact)
        b.forwardSpeed += Math.max(0, aClosing) * 0.18 * bump
      }
      if (bNoseContact > 0) {
        b.forwardSpeed *= Math.max(PACK_CONTACT.bumpMinRetention, 1 - PACK_CONTACT.bumpNoseSpeedLoss * bump * bNoseContact)
        a.forwardSpeed += Math.max(0, bClosing) * 0.18 * bump
      }

      const retentionFloor = Math.min(0.985, PACK_CONTACT.bumpMinRetention + (1 - Math.max(aNoseContact, bNoseContact)) * PACK_CONTACT.bumpSideRetentionBonus)
      const retention = Math.max(retentionFloor, 1 - PACK_CONTACT.bumpSpeedLoss * bump * strongestClosing)
      a.forwardSpeed *= retention
      b.forwardSpeed *= retention
      a.lane -= laneDirection * bump * PACK_CONTACT.bumpRadius * PACK_CONTACT.bumpDeflection * 0.5
      b.lane += laneDirection * bump * PACK_CONTACT.bumpRadius * PACK_CONTACT.bumpDeflection * 0.5
      a.packBumpPulse = Math.max(a.packBumpPulse, bump)
      b.packBumpPulse = Math.max(b.packBumpPulse, bump)

      const damage = PACK_CONTACT.bumpPowerDamage * bump * (0.78 + Math.max(aNoseContact, bNoseContact) * 0.34)
      applyPowerDamage(a, damage)
      applyPowerDamage(b, damage)
    }
  }
}

const checkGates = (race: RaceState, vehicle: Vehicle): void => {
  const gateIndex = vehicle.nextGateIndex
  if (!hasCrossedGate(race.track, vehicle, gateIndex)) return

  const gate = race.track.gates[gateIndex]
  if (!gate) return
  if (gateIndex === 0) {
    const lapSeconds = race.raceTime + vehicle.timePenalty - vehicle.lapStartedAt
    if (lapSeconds > 0) {
      vehicle.lastLapSeconds = lapSeconds
      vehicle.bestLapSeconds = vehicle.bestLapSeconds < 0 ? lapSeconds : Math.min(vehicle.bestLapSeconds, lapSeconds)
    }
    if (vehicle.lap >= race.totalLaps) {
      vehicle.finished = true
      vehicle.finalPosition = race.nextFinalPosition
      race.nextFinalPosition += 1
      vehicle.finishTime = race.raceTime + vehicle.timePenalty
      vehicle.forwardSpeed *= 0.45
      vehicle.gatePulse = 1
      vehicle.lapPulse = 1
      if (vehicle.isPlayer) {
        race.phase = 'finished'
        race.phaseTime = 0
        setToast(race, 'FINISH')
      }
      return
    }
    vehicle.lap += 1
    vehicle.lapStartedAt = race.raceTime + vehicle.timePenalty
    if (vehicle.isPlayer) setToast(race, vehicle.lap === race.totalLaps ? 'FINAL LAP' : `LAP ${vehicle.lap}/${race.totalLaps}`)
  }
  markGatePassed(vehicle, gateIndex, gate.distance, race.track.gates.length)
}

const applyRivalPassReward = (
  race: RaceState,
  beforeProgress: Record<string, number>,
  beforeCrashOutCounts: Record<string, number>,
): void => {
  const player = getPlayer(race)
  const beforePlayer = beforeProgress[player.id] ?? 0
  const afterPlayer = progressFor(race, player)
  const rivals = race.rivals.length > 0
    ? race.rivals
    : race.vehicles.filter((vehicle) => vehicle.id !== player.id && !vehicle.finished)
  for (const other of rivals) {
    if (other.id === player.id || other.finished) continue
    if (other.crashOutCount > (beforeCrashOutCounts[other.id] ?? 0)) continue
    const beforeOther = beforeProgress[other.id] ?? 0
    const afterOther = progressFor(race, other)
    if (beforePlayer <= beforeOther && afterPlayer > afterOther) {
      player.power = Math.min(1, player.power + RACE.rivalPassPowerReward)
      player.rivalPassPulse = 1
      setToast(race, 'RIVAL PASSED')
      return
    }
  }
}

const applyRivalCrashOutReward = (
  race: RaceState,
  beforeCrashOutCounts: Record<string, number>,
  beforeProgress: Record<string, number>,
): void => {
  const player = getPlayer(race)
  if (player.finished) return
  const beforePlayer = beforeProgress[player.id] ?? progressFor(race, player)
  const maxRewardGap = Math.min(110, race.track.totalLength * 0.28)
  for (const other of race.vehicles) {
    if (other.id === player.id || other.finished) continue
    if (other.crashOutCount <= (beforeCrashOutCounts[other.id] ?? 0)) continue
    const beforeOther = beforeProgress[other.id] ?? progressFor(race, other)
    if (Math.abs(beforeOther - beforePlayer) > maxRewardGap) continue
    player.power = Math.min(1, player.power + RACE.rivalCrashOutPowerReward)
    player.rivalPassPulse = 1
    setToast(race, 'RIVAL DOWN')
    return
  }
}

const clampPostPackTrackLimits = (race: RaceState): void => {
  for (const vehicle of race.vehicles) {
    if (vehicle.finished) continue
    const profile = race.track.sample(vehicle.distance)
    const railLimit = profile.width * 0.5 - TRACK_LIMITS.shipHalfWidth
    if (Math.abs(vehicle.lane) <= railLimit) continue
    const side = Math.sign(vehicle.lane) || 1
    vehicle.lane = side * railLimit
    if (vehicle.lateralSpeed * side > 0) vehicle.lateralSpeed *= -0.28
  }
}

export const countdownRemaining = (race: RaceState): number =>
  race.phase === 'countdown' ? Math.max(0, RACE.countdownSeconds - race.phaseTime) : 0

export const updateRace = (
  race: RaceState,
  playerInput: VehicleInput = EMPTY_INPUT,
  dt: number,
): void => {
  race.phaseTime += dt
  updateToast(race, dt)

  if (race.phase === 'menu') return

  if (race.phase === 'warmup') {
    if (race.phaseTime >= RACE.warmupSeconds) {
      race.phase = 'countdown'
      race.phaseTime = 0
      setToast(race, '3')
    }
    return
  }

  if (race.phase === 'countdown') {
    const remaining = countdownRemaining(race)
    updateLaunchBoostCharge(getPlayer(race), playerInput.throttle, remaining)
    const display = Math.max(1, Math.ceil(remaining))
    if (race.lastToast !== String(display)) setToast(race, String(display))
    if (race.phaseTime >= RACE.countdownSeconds) {
      race.phase = 'racing'
      race.phaseTime = 0
      race.raceTime = 0
      setToast(race, getPlayer(race).launchBoostCharge > 0.75 ? 'PERFECT START' : 'GO')
      applyLaunchBoost(getPlayer(race))
      for (const bot of race.vehicles.filter((vehicle) => !vehicle.isPlayer)) {
        bot.forwardSpeed += SHIP_PROFILES[bot.profileId].acceleration * 0.08
      }
    }
    return
  }

  if (race.phase === 'results') return

  race.raceTime += dt
  const beforeProgress = Object.fromEntries(race.vehicles.map((vehicle) => [vehicle.id, progressFor(race, vehicle)]))
  const beforeCrashOutCounts = Object.fromEntries(race.vehicles.map((vehicle) => [vehicle.id, vehicle.crashOutCount]))

  for (const vehicle of race.vehicles) {
    const input = vehicle.isPlayer
      ? playerInput
      : getBotInput(race.botBrains[vehicle.id], race.track, vehicle, race.vehicles, dt)
    const slipstream = sampleSlipstream(
      race.slipstream,
      race.track,
      vehicle.id,
      vehicle.distance,
      vehicle.lane,
      race.raceTime,
    )
    stepVehicle(vehicle, {
      track: race.track,
      input,
      dt,
      slipstream,
      nearbyVehicles: nearbyVehicleCount(race, vehicle),
    })
  }

  applyPackInteractions(race, dt)
  clampPostPackTrackLimits(race)

  for (const vehicle of race.vehicles) {
    if (vehicle.finished) continue

    const triggers = triggerTrackPads(
      race.track,
      race.padCooldowns,
      vehicle.id,
      vehicle.previousDistance,
      vehicle.previousLane,
      vehicle.distance,
      vehicle.lane,
      race.raceTime,
    )
    for (const trigger of triggers) {
      applyPadTrigger(vehicle, trigger)
      if (vehicle.isPlayer) setToast(race, trigger.pad.kind === 'boost' ? 'BOOST PAD' : 'POWER PAD')
    }

    checkGates(race, vehicle)
    if (!vehicle.finished) {
      publishSlipstream(
        race.slipstream,
        race.track,
        vehicle.id,
        vehicle.distance,
        vehicle.lane,
        vehicle.forwardSpeed,
        SHIP_PROFILES[vehicle.profileId].maxSpeed,
        race.raceTime,
      )
    }

    if (vehicle.isPlayer && vehicle.crashOutPulse > 0.95) {
      setToast(race, `CRASH OUT +${CRASH_OUT.timePenaltySeconds.toFixed(1)}s`)
    }
  }

  applyRivalCrashOutReward(race, beforeCrashOutCounts, beforeProgress)
  applyRivalPassReward(race, beforeProgress, beforeCrashOutCounts)
  updateStandings(race)
  updateRivals(race)

  if (race.phase === 'finished' && race.phaseTime >= RACE.resultsDelaySeconds) {
    race.phase = 'results'
    race.phaseTime = 0
  }

  if (race.phase === 'racing' && race.vehicles.every((vehicle) => vehicle.finished)) {
    race.phase = 'results'
    race.phaseTime = 0
  }
}

export const gapToNext = (race: RaceState, vehicle: Vehicle): number => {
  const nextGate = race.track.gates[vehicle.nextGateIndex]
  if (!nextGate) return 0
  return distanceAlongForward(vehicle.distance, nextGate.distance, race.track.totalLength)
}
