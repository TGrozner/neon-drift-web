const mobileFeedbackQuery = '(max-width: 820px)'

export const mobileFeedbackActive = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(mobileFeedbackQuery).matches

export const triggerMobileHaptic = (pattern: number | number[]): void => {
  if (!mobileFeedbackActive()) return
  try {
    window.navigator.vibrate?.(pattern)
  } catch {
    // Vibration support varies by mobile browser and user setting.
  }
}
