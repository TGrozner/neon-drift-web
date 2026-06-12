import { useState } from 'react'
import type { ShipProfileId } from '../shared/constants'
import { getPlayer } from '../shared/race'
import type { TrackId } from '../shared/track'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { GameCanvas } from './components/GameCanvas'
import { Hud } from './components/Hud'
import { MenuPanel } from './components/MenuPanel'
import { RaceOverlay } from './components/RaceOverlay'
import { TelemetryCockpit } from './components/TelemetryCockpit'
import { TouchControls } from './components/TouchControls'
import { Tutorial } from './components/Tutorial'
import { useNeonAudio } from './hooks/useNeonAudio'
import { useNeonGame } from './hooks/useNeonGame'
import './App.css'

function App() {
  const { race, raceRef, start, menu, setTouch, reset, version } = useNeonGame()
  const [selectedProfile, setSelectedProfile] = useState<ShipProfileId>('balanced')
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('vortex-gauntlet')
  const audio = useNeonAudio(race)
  const tutorialTrackId = race.phase === 'menu' ? selectedTrack : race.track.id
  const touchControlsActive = race.phase === 'warmup' || race.phase === 'countdown' || race.phase === 'racing'
  const player = race.phase === 'menu' || race.phase === 'results' ? null : getPlayer(race)
  const airbrakeCharge = player?.telemetry.airbrakeExitCharge ?? 0

  return (
    <main className="app-shell">
      <GameCanvas raceRef={raceRef} />
      <Hud race={race} />
      <TelemetryCockpit race={race} />
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
        key={touchControlsActive ? 'drive' : 'idle'}
        airbrakeCharge={airbrakeCharge}
        autoThrottle={touchControlsActive}
        onTouch={setTouch}
        onReset={reset}
      />
      <DiagnosticsPanel />
    </main>
  )
}

export default App
