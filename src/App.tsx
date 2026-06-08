import { useState } from 'react'
import type { ShipProfileId } from '../shared/constants'
import type { TrackId } from '../shared/track'
import { GameCanvas } from './components/GameCanvas'
import { Hud } from './components/Hud'
import { MenuPanel } from './components/MenuPanel'
import { RaceOverlay } from './components/RaceOverlay'
import { TouchControls } from './components/TouchControls'
import { Tutorial } from './components/Tutorial'
import { useNeonAudio } from './hooks/useNeonAudio'
import { useNeonGame } from './hooks/useNeonGame'
import './App.css'

function App() {
  const { race, raceRef, start, menu, setTouch, setTouchSteer, reset, version } = useNeonGame()
  const [selectedProfile, setSelectedProfile] = useState<ShipProfileId>('balanced')
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('tutorial-circuit')
  const audio = useNeonAudio(race)
  const tutorialTrackId = race.phase === 'menu' ? selectedTrack : race.track.id

  return (
    <main className="app-shell">
      <GameCanvas raceRef={raceRef} />
      <Hud race={race} />
      <Tutorial activeTrackId={tutorialTrackId} race={race} raceVersion={version} />
      <RaceOverlay
        race={race}
        onRestart={() => start(selectedProfile, selectedTrack)}
        onMenu={menu}
      />
      <MenuPanel
        race={race}
        selectedProfile={selectedProfile}
        selectedTrack={selectedTrack}
        onSelectProfile={setSelectedProfile}
        onSelectTrack={setSelectedTrack}
        onMenuCue={audio.playMenuCue}
        onStart={() => start(selectedProfile, selectedTrack)}
      />
      <TouchControls
        autoThrottle={race.phase !== 'menu' && race.phase !== 'results'}
        onSteer={setTouchSteer}
        onTouch={setTouch}
        onReset={reset}
      />
    </main>
  )
}

export default App
