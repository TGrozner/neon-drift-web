import { useEffect, useState } from 'react'
import type { RaceState } from '../../shared/race'
import { NeonAudioEngine } from '../audio/neonAudio'

export const useNeonAudio = (race: RaceState): void => {
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
}
