import { mobileViewportMatches } from './mobileViewport'

export const mobileFeedbackActive = (): boolean => mobileViewportMatches()

export const triggerMobileHaptic = (pattern: number | number[]): void => {
  if (!mobileFeedbackActive()) return
  try {
    window.navigator.vibrate?.(pattern)
  } catch {
    // Vibration support varies by mobile browser and user setting.
  }
}
