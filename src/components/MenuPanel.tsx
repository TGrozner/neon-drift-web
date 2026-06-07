import { SHIP_PROFILES, type ShipProfileId } from '../../shared/constants'
import type { RaceState } from '../../shared/race'
import { TRACKS, type TrackId } from '../../shared/track'
import type { MenuAudioCue } from '../audio/neonAudio'

type Props = {
  race: RaceState
  selectedProfile: ShipProfileId
  selectedTrack: TrackId
  onSelectProfile: (profile: ShipProfileId) => void
  onSelectTrack: (track: TrackId) => void
  onMenuCue: (cue: MenuAudioCue) => void
  onStart: () => void
}

export function MenuPanel({
  race,
  selectedProfile,
  selectedTrack,
  onSelectProfile,
  onSelectTrack,
  onMenuCue,
  onStart,
}: Props) {
  if (race.phase !== 'menu') return null
  const profiles = Object.values(SHIP_PROFILES)
  const activeTrack = TRACKS.find((track) => track.id === selectedTrack) ?? race.track
  const selectTrack = (track: TrackId) => {
    if (track !== selectedTrack) onMenuCue('forward')
    onSelectTrack(track)
  }
  const selectProfile = (profile: ShipProfileId) => {
    if (profile !== selectedProfile) onMenuCue('forward')
    onSelectProfile(profile)
  }
  const startRace = () => {
    onMenuCue('forward')
    onStart()
  }

  return (
    <div className="menu-shell" data-testid="main-menu">
      <div className="menu-panel">
        <div className="brand">NEON DRIFT</div>
        <div className="menu-meta">Solo vs Bots · {activeTrack.name} · Source-audited web port</div>

        <button className="start-button" onClick={startRace} onPointerEnter={() => onMenuCue('hover')} type="button" data-testid="start-race">
          START RACE
        </button>

        <div className="menu-section">
          <span>MODE</span>
          <div className="mode-options">
            <button className="mode-option selected" onPointerEnter={() => onMenuCue('hover')} onClick={() => onMenuCue('forward')} type="button">
              <strong>Solo vs Bots</strong>
              <small>Race the current AI pack.</small>
            </button>
            <button className="mode-option unavailable" onPointerEnter={() => onMenuCue('hover')} onClick={() => onMenuCue('deny')} type="button">
              <strong>Public Game Online</strong>
              <small>s&box-only published session.</small>
            </button>
            <button className="mode-option unavailable" onPointerEnter={() => onMenuCue('hover')} onClick={() => onMenuCue('deny')} type="button">
              <strong>Private Game</strong>
              <small>s&box-only Steam invite.</small>
            </button>
          </div>
        </div>

        <div className="menu-section">
          <span>TRACK</span>
          <div className="track-options">
            {TRACKS.map((track) => {
              const trainingTrack = track.id === 'tutorial-circuit'
              return (
                <button
                  className={[
                    'track-option',
                    track.id === selectedTrack ? 'selected' : '',
                    trainingTrack ? 'training-track' : '',
                  ].filter(Boolean).join(' ')}
                  key={track.id}
                  onClick={() => selectTrack(track.id)}
                  onPointerEnter={() => onMenuCue('hover')}
                  type="button"
                >
                  <strong>{track.name}</strong>
                  {trainingTrack && <span className="track-tag">Training</span>}
                  <small>{track.description}</small>
                </button>
              )
            })}
          </div>
        </div>

        <div className="menu-section">
          <span>SHIP</span>
          <div className="ship-options">
            {profiles.map((profile) => (
              <button
                className={profile.id === selectedProfile ? 'ship-card selected' : 'ship-card'}
                key={profile.id}
                onClick={() => selectProfile(profile.id)}
                onPointerEnter={() => onMenuCue('hover')}
                type="button"
              >
                <span className="swatch" style={{ backgroundColor: profile.color }} />
                <strong>{profile.label}</strong>
                <small>{profile.description}</small>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
