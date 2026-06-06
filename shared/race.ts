import { createBotBrain, getBotInput, type BotBrain } from './bot'
import { CRASH_OUT, RACE, SHIP_PROFILES, type ShipProfileId } from './constants'
import { distanceAlongForward, signedWrappedDelta } from './math'
import { triggerTrackPads, type PadCooldownState } from './pads'
import {
  EMPTY_INPUT,
  applyLaunchBoost,
  applyPadTrigger,
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
import { NEON_OVAL, type RaceTrack } from './track'

export type RacePhase = 'menu' | 'warmup' | 'countdown' | 'racing' | 'finished' | 'results'

export type RaceState = {
  track: RaceTrack
  phase: RacePhase
  phaseTime: number
  raceTime: number
  totalLaps: number
  playerId: string
  vehicles: Vehicle[]
  botBrains: Record<string, BotBrain>
  slipstream: SlipstreamState
  padCooldowns: PadCooldownState
  standings: Vehicle[]
  lastToast: string
}

const botNames = ['Vela', 'Ion', 'Pulse', 'Nova', 'Rook']
const botProfiles: ShipProfileId[] = ['swift', 'balanced', 'heavy', 'balanced', 'swift']

export const createRaceState = (profileId: ShipProfileId = 'balanced'): RaceState => {
  const track = NEON_OVAL
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
      playerSlot.lane,
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
    playerId: 'player',
    vehicles,
    botBrains,
    slipstream: createSlipstreamState(),
    padCooldowns: {},
    standings: vehicles,
    lastToast: '',
  }
}

export const getPlayer = (race: RaceState): Vehicle =>
  race.vehicles.find((vehicle) => vehicle.id === race.playerId) ?? race.vehicles[0]

export const startRace = (profileId: ShipProfileId): RaceState => {
  const fresh = createRaceState(profileId)
  fresh.phase = 'warmup'
  fresh.lastToast = 'READY'
  return fresh
}

export const goToMenu = (race: RaceState): void => {
  race.phase = 'menu'
  race.phaseTime = 0
  race.raceTime = 0
  race.lastToast = 'MENU'
}

const progressFor = (race: RaceState, vehicle: Vehicle): number => {
  const base = (vehicle.lap - 1) * race.track.totalLength + vehicle.distance
  return vehicle.finished ? race.totalLaps * race.track.totalLength + 1000 - vehicle.finishTime : base
}

export const updateStandings = (race: RaceState): void => {
  race.standings = [...race.vehicles].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime
    if (a.finished) return -1
    if (b.finished) return 1
    return progressFor(race, b) - progressFor(race, a)
  })
}

const nearbyVehicleCount = (race: RaceState, vehicle: Vehicle): number =>
  race.vehicles.filter((other) => {
    if (other.id === vehicle.id || other.finished) return false
    const gap = Math.abs(signedWrappedDelta(vehicle.distance, other.distance, race.track.totalLength))
    return gap < 6.2 && Math.abs(other.lane - vehicle.lane) < 3.2
  }).length

const checkGates = (race: RaceState, vehicle: Vehicle): void => {
  const gateIndex = vehicle.nextGateIndex
  if (!hasCrossedGate(race.track, vehicle, gateIndex)) return

  const gate = race.track.gates[gateIndex]
  if (!gate) return
  if (gateIndex === 0) {
    if (vehicle.lap >= race.totalLaps) {
      vehicle.finished = true
      vehicle.finishTime = race.raceTime + vehicle.timePenalty
      vehicle.forwardSpeed *= 0.45
      vehicle.gatePulse = 1
      vehicle.lapPulse = 1
      if (vehicle.isPlayer) {
        race.phase = 'finished'
        race.phaseTime = 0
        race.lastToast = 'FINISH'
      }
      return
    }
    vehicle.lap += 1
    race.lastToast = vehicle.isPlayer ? `LAP ${vehicle.lap}/${race.totalLaps}` : race.lastToast
  }
  markGatePassed(vehicle, gateIndex, gate.distance)
}

const applyRivalPassReward = (race: RaceState, beforeProgress: Record<string, number>): void => {
  const player = getPlayer(race)
  const beforePlayer = beforeProgress[player.id] ?? 0
  const afterPlayer = progressFor(race, player)
  for (const other of race.vehicles) {
    if (other.id === player.id || other.finished) continue
    const beforeOther = beforeProgress[other.id] ?? 0
    const afterOther = progressFor(race, other)
    if (beforePlayer <= beforeOther && afterPlayer > afterOther) {
      player.power = Math.min(1, player.power + RACE.rivalPassPowerReward)
      player.rivalPassPulse = 1
      race.lastToast = 'RIVAL PASSED'
      return
    }
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

  if (race.phase === 'menu') return

  if (race.phase === 'warmup') {
    if (race.phaseTime >= RACE.warmupSeconds) {
      race.phase = 'countdown'
      race.phaseTime = 0
      race.lastToast = '3'
    }
    return
  }

  if (race.phase === 'countdown') {
    const remaining = countdownRemaining(race)
    updateLaunchBoostCharge(getPlayer(race), playerInput.throttle, remaining)
    const display = Math.max(1, Math.ceil(remaining))
    race.lastToast = String(display)
    if (race.phaseTime >= RACE.countdownSeconds) {
      race.phase = 'racing'
      race.phaseTime = 0
      race.raceTime = 0
      race.lastToast = getPlayer(race).launchBoostCharge > 0.75 ? 'PERFECT START' : 'GO'
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
      if (vehicle.isPlayer) race.lastToast = trigger.pad.kind === 'boost' ? 'BOOST PAD' : 'POWER PAD'
    }

    checkGates(race, vehicle)
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

    if (vehicle.isPlayer && vehicle.crashOutPulse > 0.95) {
      race.lastToast = `CRASH OUT +${CRASH_OUT.timePenaltySeconds.toFixed(1)}s`
    }
  }

  applyRivalPassReward(race, beforeProgress)
  updateStandings(race)

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
