export const FIXED_DT = 1 / 60
export const MAX_ACCUMULATED_TIME = 0.18
export const SBOX_TO_WEB_SPEED = 1 / 100

export type ShipProfileId = 'balanced' | 'swift' | 'heavy'

export type ShipProfile = {
  id: ShipProfileId
  label: string
  description: string
  color: string
  acceleration: number
  maxSpeed: number
  boostSpeed: number
  drag: number
  lateralGrip: number
  driftGrip: number
  turnRate: number
  airbrakeTurnBoost: number
  strafeForce: number
  boostDrainRate: number
  boostRampUpRate: number
  boostRampDownRate: number
  boostSustainAccelerationScale: number
  boostActivationThreshold: number
  boostContinueThreshold: number
  boostRiskDrainScale: number
  railPowerDamage: number
  railSpeedDamage: number
  railGlanceRetention: number
  railHeavyHitRetention: number
  airbrakeExitMinSeconds: number
  airbrakeExitFullSeconds: number
  airbrakeExitBoostImpulse: number
  airbrakeExitSpeedBonus: number
  airbrakeExitSlipForFullBoost: number
  airbrakeExitPowerCost: number
  airbrakeExitCooldown: number
}

const scaled = (value: number) => value * SBOX_TO_WEB_SPEED

const common = {
  airbrakeTurnBoost: 1.86,
  boostRampUpRate: 12,
  boostRampDownRate: 4.4,
  boostSustainAccelerationScale: 0.82,
  boostActivationThreshold: 0.12,
  boostContinueThreshold: 0.025,
  boostRiskDrainScale: 0.34,
  airbrakeExitMinSeconds: 0.16,
  airbrakeExitFullSeconds: 0.62,
  airbrakeExitSlipForFullBoost: scaled(360),
  airbrakeExitPowerCost: 0.018,
  airbrakeExitCooldown: 0.36,
}

export const SHIP_PROFILES: Record<ShipProfileId, ShipProfile> = {
  balanced: {
    ...common,
    id: 'balanced',
    label: 'Balanced',
    description: 'Stable, readable, strong all-rounder.',
    color: '#ff3df2',
    acceleration: scaled(6400),
    maxSpeed: scaled(7200),
    boostSpeed: scaled(9500),
    drag: 0.75,
    lateralGrip: 10.75,
    driftGrip: 3.05,
    turnRate: (174 * Math.PI) / 180,
    strafeForce: scaled(1400),
    boostDrainRate: 0.2,
    railPowerDamage: 0.068,
    railSpeedDamage: 0.06,
    railGlanceRetention: 0.89,
    railHeavyHitRetention: 0.72,
    airbrakeExitBoostImpulse: scaled(3050),
    airbrakeExitSpeedBonus: scaled(2500),
  },
  swift: {
    ...common,
    id: 'swift',
    label: 'Swift',
    description: 'Explosive acceleration and exits, fragile on rails.',
    color: '#5dfd7a',
    acceleration: scaled(7900),
    maxSpeed: scaled(6900),
    boostSpeed: scaled(9200),
    drag: 0.82,
    lateralGrip: 11.85,
    driftGrip: 2.72,
    turnRate: (194 * Math.PI) / 180,
    strafeForce: scaled(1550),
    boostDrainRate: 0.24,
    railPowerDamage: 0.086,
    railSpeedDamage: 0.074,
    railGlanceRetention: 0.85,
    railHeavyHitRetention: 0.67,
    airbrakeExitBoostImpulse: scaled(3200),
    airbrakeExitSpeedBonus: scaled(2600),
  },
  heavy: {
    ...common,
    id: 'heavy',
    label: 'Heavy',
    description: 'Higher top speed and tougher wall contact.',
    color: '#ffbf4a',
    acceleration: scaled(4300),
    maxSpeed: scaled(7900),
    boostSpeed: scaled(10300),
    drag: 0.5,
    lateralGrip: 9.45,
    driftGrip: 3.3,
    turnRate: (148 * Math.PI) / 180,
    strafeForce: scaled(1120),
    boostDrainRate: 0.16,
    railPowerDamage: 0.047,
    railSpeedDamage: 0.043,
    railGlanceRetention: 0.93,
    railHeavyHitRetention: 0.82,
    airbrakeExitBoostImpulse: scaled(2850),
    airbrakeExitSpeedBonus: scaled(2400),
  },
}

export const POWER = {
  criticalThreshold: 0.22,
  regenThrottle: 0.13,
  regenCoast: 0.19,
  offTrackRegenMultiplier: 0.35,
  cleanLineBonus: 0.03,
  cleanLineThreshold: 0.72,
  cleanLineMinSpeedRatio: 0.52,
}

export const CRASH_OUT = {
  restorePower: 0.35,
  lockSeconds: 0.95,
  stallSeconds: 0.48,
  respawnSpeed: scaled(1180),
  respawnBoostSeconds: 0.95,
  respawnBoostSpeedBonus: scaled(620),
  graceSeconds: 1.6,
  timePenaltySeconds: 3,
}

export const RACE = {
  warmupSeconds: 0.45,
  countdownSeconds: 3,
  resultsDelaySeconds: 2.25,
  totalLaps: 3,
  gateCount: 8,
  rivalPassPowerReward: 0.08,
  rivalCrashOutPowerReward: 0.12,
}

export const PADS = {
  boostImpulse: scaled(2150),
  speedPadSpeedBonus: scaled(2700),
  speedPadSustainAcceleration: scaled(4400),
  speedPadPulseSeconds: 1.7,
  rechargeAmount: 0.28,
  boostCooldownSeconds: 0.85,
  rechargeCooldownSeconds: 1.15,
  halfLength: 3.1,
  halfWidth: 1.9,
}

export const SLIPSTREAM = {
  minEmitSpeed: scaled(1800),
  emitInterval: 0.14,
  lifetime: 5.6,
  halfLength: scaled(1220),
  halfWidth: scaled(255),
  acceleration: scaled(4600),
  lanePull: scaled(180),
  stackCap: 0.95,
  nearMaxFadeStart: 0.9,
  maxSegments: 512,
}

export const LAUNCH = {
  boostImpulse: scaled(1250),
  perfectSeconds: 0.42,
  earlyPenaltySeconds: 1.25,
}

export const TRACK_LIMITS = {
  railPadding: 3.4,
  shipHalfWidth: 1.15,
  railDamageInterval: 0.18,
  heavyHitSpeedThreshold: scaled(620),
  glanceHitSpeedThreshold: scaled(460),
  offTrackDragMultiplier: 2.4,
}

