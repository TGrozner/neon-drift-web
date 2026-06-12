export const FIXED_DT = 1 / 60
export const MAX_ACCUMULATED_TIME = 0.18
export const SBOX_TO_WEB_DISTANCE = 1 / 100
const WEB_RACE_SPEED_SCALE = 1.72
export const SBOX_TO_WEB_SPEED = SBOX_TO_WEB_DISTANCE * WEB_RACE_SPEED_SCALE

export type ShipProfileId = 'balanced' | 'swift' | 'heavy'

export type ShipProfile = {
  id: ShipProfileId
  label: string
  description: string
  color: string
  acceleration: number
  reverseAcceleration: number
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
  railIntegrityDamage: number
  railSpeedIntegrityDamage: number
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
const distanceScaled = (value: number) => value * SBOX_TO_WEB_DISTANCE

const common = {
  reverseAcceleration: scaled(860),
  airbrakeTurnBoost: 1.82,
  boostRampUpRate: 12,
  boostRampDownRate: 4.4,
  boostSustainAccelerationScale: 0.82,
  boostActivationThreshold: 0.12,
  boostContinueThreshold: 0.025,
  boostRiskDrainScale: 0.52,
  airbrakeExitMinSeconds: 0.12,
  airbrakeExitFullSeconds: 0.46,
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
    lateralGrip: 8.7,
    driftGrip: 2.45,
    turnRate: (148 * Math.PI) / 180,
    strafeForce: scaled(980),
    boostDrainRate: 0.2,
    railIntegrityDamage: 0.088,
    railSpeedIntegrityDamage: 0.072,
    railGlanceRetention: 0.84,
    railHeavyHitRetention: 0.58,
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
    lateralGrip: 9.45,
    driftGrip: 2.18,
    turnRate: (166 * Math.PI) / 180,
    strafeForce: scaled(1100),
    boostDrainRate: 0.24,
    railIntegrityDamage: 0.104,
    railSpeedIntegrityDamage: 0.086,
    railGlanceRetention: 0.78,
    railHeavyHitRetention: 0.52,
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
    lateralGrip: 7.65,
    driftGrip: 2.72,
    turnRate: (126 * Math.PI) / 180,
    strafeForce: scaled(780),
    boostDrainRate: 0.16,
    railIntegrityDamage: 0.064,
    railSpeedIntegrityDamage: 0.052,
    railGlanceRetention: 0.88,
    railHeavyHitRetention: 0.68,
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

export const INTEGRITY = {
  criticalThreshold: 0.24,
  damagedThreshold: 0.58,
  maxSingleHitDamage: 0.64,
  rechargePadRepair: 0.08,
  cleanLineRepair: 0.018,
  slipstreamRepair: 0.012,
  slipstreamRepairThreshold: 0.34,
}

export const CRASH_OUT = {
  lockSeconds: 0.95,
  stallSeconds: 0.48,
  respawnSpeed: scaled(1180),
  respawnBoostSeconds: 0.95,
  respawnBoostSpeedBonus: scaled(620),
  graceSeconds: 1.6,
}

export const RACE = {
  warmupSeconds: 0.45,
  countdownSeconds: 3,
  resultsDelaySeconds: 2.25,
  toastSeconds: 1.45,
  totalLaps: 3,
  gateCount: 8,
  rivalPassPowerReward: 0.08,
  rivalPassIntegrityReward: 0.035,
  rivalCrashOutPowerReward: 0.12,
  rivalCrashOutIntegrityReward: 0.06,
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
  halfLength: distanceScaled(1220),
  halfWidth: distanceScaled(255),
  acceleration: scaled(7400),
  speedBonus: scaled(2250),
  lanePull: scaled(180),
  stackCap: 0.95,
  nearMaxFadeStart: 0.94,
  maxSegments: 512,
}

export const BANKED_CONTROL = {
  maxBankDegrees: 62,
  steerAssist: 0.08,
  gripAssist: 0.12,
  airbrakeGripAssist: 1.28,
}

export const PACK_CONTACT = {
  proximityRadius: distanceScaled(285),
  proximityRepelForce: scaled(720),
  proximitySlowdown: 0.055,
  maxLateralSpeedDeltaPerSecond: scaled(3600),
  bumpRadius: distanceScaled(162),
  bumpForce: scaled(1320),
  bumpReboundForce: scaled(410),
  bumpDeflection: 0.48,
  bumpNoseDeflection: 0.3,
  bumpNoseSpeedLoss: 0.14,
  bumpSpeedLoss: 0.44,
  bumpSideRetentionBonus: 0.055,
  bumpMinRetention: 0.94,
  bumpIntegrityDamage: 0.012,
  bumpDamageClosingGrace: 0.12,
  bumpSideDamageScale: 0.38,
}

export const LAUNCH = {
  boostImpulse: scaled(1250),
  perfectSeconds: 0.42,
  earlyPenaltySeconds: 1.25,
}

export const TRACK_LIMITS = {
  railPadding: 3.4,
  shipHalfWidth: 1.15,
  autoResetOffsetMultiplier: 1.45,
  wrongWayDelay: 0.65,
  wrongWayDotThreshold: -0.28,
  wrongWayMinSpeed: scaled(420),
  railDamageInterval: 0.26,
  heavyHitSpeedThreshold: scaled(620),
  glanceHitSpeedThreshold: scaled(460),
  offTrackDragMultiplier: 3.2,
  contactDragMultiplier: 1.28,
  railSlideTangentRetention: 0.88,
  railReleaseMinSpeed: scaled(155),
  railReleasePressureSpeed: scaled(330),
  railReleaseContactFloor: 0.18,
  railSlideYawSharpness: 28,
  railSlidePinnedYawSharpness: 110,
  railSlidePinnedSeconds: 0.14,
  railSlideContactGraceSeconds: 0.34,
  railSlideHeadingMemorySeconds: 0.46,
  railSlideHoldDecaySeconds: 0.32,
  railSlideForwardMinimumScale: 0.76,
  railSlidePinnedForwardMinimumScale: 0.84,
  railSlidePinnedReleaseSpeed: scaled(1040),
  railSlideMaxExtraOutwardSpeed: scaled(520),
  cornerDriftForce: 0.052,
  cornerDriftMinSpeedRatio: 0.12,
  bankedCornerDriftRelief: 0.24,
  airbrakeCornerDriftRelief: 0.72,
  laneCenteringForce: 0.04,
  airbrakeLaneCenteringScale: 0.12,
}

export const HOVER = {
  height: distanceScaled(105),
  bankedExtraHeight: distanceScaled(34),
  bankedMaxBankDegrees: 62,
  slopeExtraHeight: distanceScaled(24),
  slopeMaxVertical: 0.34,
  speedExtraHeight: distanceScaled(18),
}
