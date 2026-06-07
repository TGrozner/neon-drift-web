import { SHIP_PROFILES, type ShipProfileId } from '../../shared/constants'
import type { RaceState } from '../../shared/race'
import { TRACKS, type TrackId } from '../../shared/track'

type Props = {
  race: RaceState
  selectedProfile: ShipProfileId
  selectedTrack: TrackId
  onSelectProfile: (profile: ShipProfileId) => void
  onSelectTrack: (track: TrackId) => void
  onStart: () => void
}

export function MenuPanel({ race, selectedProfile, selectedTrack, onSelectProfile, onSelectTrack, onStart }: Props) {
  if (race.phase !== 'menu') return null
  const profiles = Object.values(SHIP_PROFILES)
  const activeTrack = TRACKS.find((track) => track.id === selectedTrack) ?? race.track

  return (
    <div className="menu-shell" data-testid="main-menu">
      <div className="menu-panel">
        <div className="brand">NEON DRIFT</div>
        <div className="menu-meta">Solo vs Bots · {activeTrack.name} · Source-audited web port</div>

        <button className="start-button" onClick={onStart} type="button" data-testid="start-race">
          START RACE
        </button>

        <div className="menu-section">
          <span>TRACK</span>
          <div className="track-options">
            {TRACKS.map((track) => (
              <button
                className={track.id === selectedTrack ? 'track-option selected' : 'track-option'}
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                type="button"
              >
                <strong>{track.name}</strong>
                <small>{track.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="menu-section">
          <span>SHIP</span>
          <div className="ship-options">
            {profiles.map((profile) => (
              <button
                className={profile.id === selectedProfile ? 'ship-card selected' : 'ship-card'}
                key={profile.id}
                onClick={() => onSelectProfile(profile.id)}
                type="button"
              >
                <span className="swatch" style={{ backgroundColor: profile.color }} />
                <strong>{profile.label}</strong>
                <small>{profile.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="menu-section track-card">
          <span>MODE</span>
          <strong>Solo vs Bots</strong>
          <small>Race the current AI pack. Online modes remain s&box-only for now.</small>
        </div>

      </div>
    </div>
  )
}
