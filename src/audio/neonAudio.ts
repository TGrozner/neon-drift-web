import { CRASH_OUT, RACE, SHIP_PROFILES } from '../../shared/constants'
import { getPlayer, type RacePhase, type RaceState } from '../../shared/race'
import { publicAsset } from '../publicAssets'

type Cue =
  | 'ready'
  | 'countdown_tick'
  | 'go'
  | 'boost_start'
  | 'speed_pad'
  | 'recharge_pad'
  | 'airbrake_exit'
  | 'slipstream_surge'
  | 'rail_scrape'
  | 'rail_hit'
  | 'ship_bump'
  | 'power_damage'
  | 'power_danger'
  | 'rival_pass'
  | 'knockout_reward'
  | 'crash_out'
  | 'crash_launch'
  | 'gate'
  | 'lap'
  | 'final_lap'
  | 'finish'
  | 'power_critical'
  | 'wrong_way'
  | 'menu_forward'
  | 'menu_back'
  | 'menu_deny'
  | 'menu_hover'
  | 'music_menu'
  | 'music_race'
  | 'engine_loop'

export type MenuAudioCue = 'forward' | 'back' | 'deny' | 'hover'

type Snapshot = {
  phase: RacePhase
  countdown: number
  finalLap: boolean
  boostStartPulse: number
  speedPadPulse: number
  rechargePadPulse: number
  airbrakeExitPulse: number
  slipstreamPulse: number
  gatePulse: number
  lapPulse: number
  crashOutPulse: number
  crashLaunchPulse: number
  powerDamagePulse: number
  packBumpPulse: number
  rivalPassPulse: number
  knockoutRewardPulse: number
  powerCritical: boolean
  offTrack: boolean
  wrongWay: boolean
}

const audioPath = (cue: Cue): string => publicAsset(`audio/neon_drift/${cuePaths[cue]}`)

const cuePaths: Record<Cue, string> = {
  ready: 'ready.wav',
  countdown_tick: 'countdown_tick.wav',
  go: 'go.wav',
  boost_start: 'boost_start.wav',
  speed_pad: 'speed_pad.wav',
  recharge_pad: 'recharge_pad.wav',
  airbrake_exit: 'airbrake_exit.wav',
  slipstream_surge: 'slipstream_surge.wav',
  rail_scrape: 'rail_scrape.wav',
  rail_hit: 'rail_hit.wav',
  ship_bump: 'ship_bump.wav',
  power_damage: 'power_damage.wav',
  power_danger: 'power_danger.wav',
  rival_pass: 'rival_pass.wav',
  knockout_reward: 'knockout_reward.wav',
  crash_out: 'crash_out.wav',
  crash_launch: 'crash_launch.wav',
  gate: 'gate.wav',
  lap: 'lap.wav',
  final_lap: 'final_lap.wav',
  finish: 'finish.wav',
  power_critical: 'power_critical.wav',
  wrong_way: 'wrong_way.wav',
  menu_forward: 'menu_forward.wav',
  menu_back: 'menu_back.wav',
  menu_deny: 'menu_deny.wav',
  menu_hover: 'menu_hover.wav',
  music_menu: 'music_menu.wav',
  music_race: 'music_race.wav',
  engine_loop: 'engine_loop.wav',
}

const oneShotVolume: Partial<Record<Cue, number>> = {
  ready: 0.4,
  countdown_tick: 0.5,
  go: 0.62,
  boost_start: 0.42,
  speed_pad: 0.56,
  recharge_pad: 0.46,
  airbrake_exit: 0.58,
  slipstream_surge: 0.38,
  rail_scrape: 0.24,
  rail_hit: 0.54,
  ship_bump: 0.5,
  power_damage: 0.5,
  power_danger: 0.62,
  rival_pass: 0.5,
  knockout_reward: 0.44,
  crash_out: 0.72,
  crash_launch: 0.54,
  gate: 0.38,
  lap: 0.55,
  final_lap: 0.68,
  finish: 0.66,
  power_critical: 0.42,
  wrong_way: 0.56,
  menu_forward: 0.68,
  menu_back: 0.6,
  menu_deny: 0.72,
  menu_hover: 0.38,
}

const oneShotPlaybackRate: Partial<Record<Cue, number>> = {
  ready: 0.78,
  countdown_tick: 0.82,
  go: 0.92,
  boost_start: 1.02,
  speed_pad: 0.98,
  recharge_pad: 0.84,
  airbrake_exit: 0.9,
  slipstream_surge: 0.94,
  rival_pass: 0.9,
  knockout_reward: 0.88,
  crash_out: 0.62,
  crash_launch: 0.9,
  gate: 0.8,
  lap: 0.88,
  final_lap: 0.86,
  finish: 0.9,
  power_critical: 0.6,
  wrong_way: 0.58,
  menu_forward: 0.9,
  menu_back: 0.78,
  menu_deny: 0.66,
  menu_hover: 0.88,
}

const menuCueMap: Record<MenuAudioCue, Cue> = {
  forward: 'menu_forward',
  back: 'menu_back',
  deny: 'menu_deny',
  hover: 'menu_hover',
}

const crossed = (current: number, previous: number | undefined, threshold = 0.05): boolean =>
  current > threshold && (previous ?? 0) <= threshold

const tryPlay = (audio: HTMLAudioElement): void => {
  const result = audio.play()
  if (result) result.catch(() => undefined)
}

export class NeonAudioEngine {
  private unlocked = false
  private latestRace: RaceState | null = null
  private previous: Snapshot | null = null
  private engineLoop: HTMLAudioElement | null = null
  private musicLoop: HTMLAudioElement | null = null
  private currentMusic: Cue | null = null
  private railScrapeCooldown = 0
  private powerCriticalCooldown = 0
  private wrongWayCooldown = 0
  private lastSyncAt = performance.now()

  unlock(): void {
    this.unlocked = true
    if (this.latestRace) this.sync(this.latestRace)
  }

  dispose(): void {
    this.stopLoop(this.engineLoop)
    this.stopLoop(this.musicLoop)
    this.engineLoop = null
    this.musicLoop = null
  }

  playMenuCue(cue: MenuAudioCue): void {
    this.play(menuCueMap[cue])
  }

  sync(race: RaceState, elapsedSeconds?: number): void {
    this.latestRace = race
    const dt = elapsedSeconds ?? this.elapsedSinceLastSync()
    const snapshot = this.snapshot(race)
    if (!this.previous) {
      this.previous = snapshot
      this.updateLoops(race, snapshot)
      return
    }

    this.updateCooldowns(dt)
    this.handlePhase(snapshot, this.previous)
    this.handlePulses(snapshot, this.previous)
    this.updateLoops(race, snapshot)
    this.previous = snapshot
  }

  private snapshot(race: RaceState): Snapshot {
    const player = getPlayer(race)
    return {
      phase: race.phase,
      countdown: race.phase === 'countdown' ? Math.max(1, Math.ceil(RACE.countdownSeconds - race.phaseTime)) : 0,
      finalLap: race.phase === 'racing' && player.lap === race.totalLaps,
      boostStartPulse: player.boostStartPulse,
      speedPadPulse: player.speedPadPulse,
      rechargePadPulse: player.rechargePadPulse,
      airbrakeExitPulse: player.airbrakeExitPulse,
      slipstreamPulse: player.slipstreamPulse,
      gatePulse: player.gatePulse,
      lapPulse: player.lapPulse,
      crashOutPulse: player.crashOutPulse,
      crashLaunchPulse: player.crashOutLaunchRemaining / CRASH_OUT.respawnBoostSeconds,
      powerDamagePulse: player.powerDamagePulse,
      packBumpPulse: player.packBumpPulse,
      rivalPassPulse: player.rivalPassPulse,
      knockoutRewardPulse: player.knockoutRewardPulse,
      powerCritical: player.telemetry.powerCritical,
      offTrack: player.telemetry.offTrack,
      wrongWay: player.telemetry.wrongWay,
    }
  }

  private handlePhase(current: Snapshot, previous: Snapshot): void {
    if (current.phase !== previous.phase) {
      if (current.phase === 'warmup') this.play('ready')
      if (current.phase === 'racing') this.play('go')
      if (current.phase === 'finished') this.play('finish')
      if (current.phase === 'menu' && previous.phase !== 'menu') this.play('menu_back', 0.25, 0.78)
    }

    if (current.phase === 'countdown' && current.countdown !== previous.countdown) {
      this.play('countdown_tick')
    }
    if (current.finalLap && !previous.finalLap) this.play('final_lap')
  }

  private handlePulses(current: Snapshot, previous: Snapshot): void {
    if (crossed(current.boostStartPulse, previous.boostStartPulse)) this.play('boost_start')
    if (crossed(current.speedPadPulse, previous.speedPadPulse)) this.play('speed_pad')
    if (crossed(current.rechargePadPulse, previous.rechargePadPulse)) this.play('recharge_pad')
    if (crossed(current.airbrakeExitPulse, previous.airbrakeExitPulse)) this.play('airbrake_exit')
    if (crossed(current.slipstreamPulse, previous.slipstreamPulse, 0.18)) this.play('slipstream_surge')
    if (crossed(current.gatePulse, previous.gatePulse)) this.play('gate')
    if (crossed(current.lapPulse, previous.lapPulse)) this.play('lap')
    if (crossed(current.crashOutPulse, previous.crashOutPulse)) this.play('crash_out')
    if (crossed(current.crashLaunchPulse, previous.crashLaunchPulse)) this.play('crash_launch')
    if (crossed(current.powerDamagePulse, previous.powerDamagePulse)) this.play('power_damage')
    if (crossed(current.packBumpPulse, previous.packBumpPulse)) this.play('ship_bump')
    if (crossed(current.rivalPassPulse, previous.rivalPassPulse)) this.play('rival_pass')
    if (crossed(current.knockoutRewardPulse, previous.knockoutRewardPulse)) this.play('knockout_reward')
    if (current.powerCritical && !previous.powerCritical) this.play('power_danger')
    if (current.powerCritical && this.powerCriticalCooldown <= 0) {
      this.play('power_critical')
      this.powerCriticalCooldown = 1.35
    }
    if (current.offTrack && this.railScrapeCooldown <= 0) {
      this.play('rail_scrape')
      this.railScrapeCooldown = 0.42
    }
    if (current.wrongWay && this.wrongWayCooldown <= 0) {
      this.play('wrong_way')
      this.wrongWayCooldown = 1.4
    }
  }

  private updateLoops(race: RaceState, snapshot: Snapshot): void {
    if (!this.unlocked) return
    const wantsRaceAudio = snapshot.phase !== 'menu' && snapshot.phase !== 'results'
    this.setMusic(snapshot.phase === 'menu' ? 'music_menu' : 'music_race')

    if (!wantsRaceAudio) {
      this.stopLoop(this.engineLoop)
      this.engineLoop = null
      return
    }

    const player = getPlayer(race)
    const profile = SHIP_PROFILES[player.profileId]
    const speedRatio = Math.min(1.2, Math.abs(player.forwardSpeed) / Math.max(1, profile.boostSpeed))
    const volume = 0.18 + speedRatio * 0.32 + player.boostIntensity * 0.28
    const playbackRate = 0.68 + Math.min(1, speedRatio) * 0.48 + player.boostIntensity * 0.025
    this.engineLoop = this.ensureLoop(this.engineLoop, 'engine_loop', Math.min(0.86, volume))
    this.engineLoop.playbackRate = playbackRate
  }

  private setMusic(cue: Cue): void {
    if (!this.unlocked || this.currentMusic === cue) return
    this.stopLoop(this.musicLoop)
    this.musicLoop = this.ensureLoop(null, cue, cue === 'music_menu' ? 0.28 : 0.42)
    this.currentMusic = cue
  }

  private ensureLoop(current: HTMLAudioElement | null, cue: Cue, volume: number): HTMLAudioElement {
    if (current) {
      current.volume = volume
      return current
    }
    const audio = new Audio(audioPath(cue))
    audio.loop = true
    audio.volume = volume
    tryPlay(audio)
    return audio
  }

  private stopLoop(audio: HTMLAudioElement | null): void {
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }

  private play(cue: Cue, volumeOverride?: number, playbackRateOverride?: number): void {
    if (!this.unlocked) return
    const audio = new Audio(audioPath(cue))
    audio.volume = volumeOverride ?? oneShotVolume[cue] ?? 0.5
    audio.playbackRate = playbackRateOverride ?? oneShotPlaybackRate[cue] ?? 1
    tryPlay(audio)
  }

  private elapsedSinceLastSync(): number {
    const now = performance.now()
    const elapsed = Math.max(0, (now - this.lastSyncAt) / 1000)
    this.lastSyncAt = now
    return Math.min(0.25, elapsed)
  }

  private updateCooldowns(dt: number): void {
    this.railScrapeCooldown = Math.max(0, this.railScrapeCooldown - dt)
    this.powerCriticalCooldown = Math.max(0, this.powerCriticalCooldown - dt)
    this.wrongWayCooldown = Math.max(0, this.wrongWayCooldown - dt)
  }
}
