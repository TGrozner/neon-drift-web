import type { RaceRunStats } from '../../shared/race'

export type StatCard = {
  label: string
  value: string
  tone?: 'warning' | 'good'
}

export const formatRaceTime = (seconds: number): string => {
  if (seconds < 0) return '--:--'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

export const formatSpeedKmh = (speed: number): string =>
  `${Math.round(Math.abs(speed) * 3.6).toString().padStart(3, '0')}`

export const averageSpeed = (stats: RaceRunStats): number =>
  stats.sampleSeconds > 0 ? stats.speedSeconds / stats.sampleSeconds : 0

export const cleanLineRatio = (stats: RaceRunStats): number =>
  stats.sampleSeconds > 0 ? stats.cleanLineSeconds / stats.sampleSeconds : 0

export const runAssessment = (stats: RaceRunStats, eliminated: boolean): string => {
  if (eliminated) return 'Hull failed before the finish. Review contact count and heavy hits first.'
  if (stats.integrityDamageTaken >= 0.32) return 'High-contact finish. The next gain is cleaner rail exits and fewer pack hits.'
  if (cleanLineRatio(stats) >= 0.72 && stats.offTrackSeconds < 1.2) return 'Clean baseline. Use this run to tune speed and AI pressure.'
  if (stats.boostSeconds < 1 && stats.boostStarts <= 1) return 'Low boost usage. Useful for checking base pacing without power spikes.'
  return 'Mixed run. Compare average speed, contact time, and drift exits after each tuning pass.'
}

export const statCardsFor = (stats: RaceRunStats): StatCard[] => [
  { label: 'AVG', value: `${formatSpeedKmh(averageSpeed(stats))} km/h` },
  { label: 'MAX', value: `${formatSpeedKmh(stats.maxSpeed)} km/h` },
  { label: 'CLEAN', value: `${Math.round(cleanLineRatio(stats) * 100)}%`, tone: cleanLineRatio(stats) >= 0.7 ? 'good' : undefined },
  { label: 'DAMAGE', value: `${Math.round(stats.integrityDamageTaken * 100)}%`, tone: stats.integrityDamageTaken >= 0.24 ? 'warning' : undefined },
  { label: 'CONTACT', value: `${stats.contactCount} / ${stats.contactSeconds.toFixed(1)}s`, tone: stats.heavyDamageHits > 0 ? 'warning' : undefined },
  { label: 'BOOST', value: `${stats.boostStarts} / ${stats.boostSeconds.toFixed(1)}s` },
  { label: 'DRIFT', value: `${stats.airbrakeExits} exits` },
  { label: 'PADS', value: `${stats.speedPadHits + stats.rechargePadHits}` },
  { label: 'DRAFT', value: `${stats.draftSeconds.toFixed(1)}s` },
  { label: 'OFF LINE', value: `${stats.offTrackSeconds.toFixed(1)}s`, tone: stats.offTrackSeconds >= 2 ? 'warning' : undefined },
  { label: 'RESETS', value: `${stats.resetCount}`, tone: stats.resetCount > 0 ? 'warning' : undefined },
  { label: 'PASSES', value: `${stats.rivalPasses}` },
]
