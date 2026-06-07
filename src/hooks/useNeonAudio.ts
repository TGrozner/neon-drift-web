import { useCallback, useEffect, useState } from 'react'
import type { RaceState } from '../../shared/race'
import { NeonAudioEngine, type MenuAudioCue } from '../audio/neonAudio'

export type NeonAudioControls = {
  playMenuCue: (cue: MenuAudioCue) => void
}

export const useNeonAudio = (race: RaceState): NeonAudioControls => {
  const [engine] = useState(() => new NeonAudioEngine())

  useEffect(() => {
    const unlock = () => engine.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      engine.dispose()
    }
  }, [engine])

  useEffect(() => {
    engine.sync(race)
  })

  const playMenuCue = useCallback((cue: MenuAudioCue) => {
    engine.playMenuCue(cue)
  }, [engine])

  return { playMenuCue }
}
