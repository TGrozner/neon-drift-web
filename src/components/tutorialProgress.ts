import { getPlayer, type RaceState } from '../../shared/race'
import { hasActiveDraft } from './draftSignals'

export type TutorialStepId =
  | 'menu'
  | 'launch'
  | 'thrust'
  | 'airbrake'
  | 'boost'
  | 'pads'
  | 'draft'
  | 'line'
  | 'checkpoints'
  | 'complete'

export const shouldAdvanceTutorial = (step: TutorialStepId, race: RaceState): boolean => {
  const player = getPlayer(race)
  if (step === 'menu') return race.phase !== 'menu'
  if (step === 'launch') return race.phase === 'racing' && player.forwardSpeed > 3
  if (step === 'thrust') return player.forwardSpeed > 18 && Math.abs(player.lane) > 0.8
  if (step === 'airbrake') return player.airbrakeExitPulse > 0.05 || player.telemetry.airbrakeExitCharge > 0.55
  if (step === 'boost') return player.isBoosting || player.boostStartPulse > 0.05
  if (step === 'pads') return player.speedPadPulse > 0.05 || player.rechargePadPulse > 0.05
  if (step === 'draft') return hasActiveDraft(player)
  if (step === 'line') return player.telemetry.cleanLineQuality > 0.65 || player.powerDamagePulse > 0.05
  if (step === 'checkpoints') return player.gatePulse > 0.05 || player.lapPulse > 0.05
  return false
}
