import { useState } from 'react'
import type { ShipProfileId } from '../shared/constants'
import { GameCanvas } from './components/GameCanvas'
import { Hud } from './components/Hud'
import { MenuPanel } from './components/MenuPanel'
import { TouchControls } from './components/TouchControls'
import { Tutorial } from './components/Tutorial'
import { useNeonGame } from './hooks/useNeonGame'
import './App.css'

function App() {
  const { race, start, setTouch, reset } = useNeonGame()
  const [selectedProfile, setSelectedProfile] = useState<ShipProfileId>('balanced')

  return (
    <main className="app-shell">
      <GameCanvas race={race} />
      <Hud race={race} />
      <Tutorial race={race} />
      <MenuPanel
        race={race}
        selectedProfile={selectedProfile}
        onSelectProfile={setSelectedProfile}
        onStart={() => start(selectedProfile)}
      />
      <TouchControls onTouch={setTouch} onReset={reset} />
    </main>
  )
}

export default App

