import { SHIP_PROFILES, type ShipProfileId } from '../../shared/constants'
import type { RaceState } from '../../shared/race'

type Props = {
  race: RaceState
  selectedProfile: ShipProfileId
  onSelectProfile: (profile: ShipProfileId) => void
  onStart: () => void
}

export function MenuPanel({ race, selectedProfile, onSelectProfile, onStart }: Props) {
  if (race.phase !== 'menu' && race.phase !== 'results') return null
  const profiles = Object.values(SHIP_PROFILES)

  return (
    <div className="menu-shell" data-testid="main-menu">
      <div className="menu-panel">
        <div className="brand">NEON DRIFT</div>
        <div className="menu-meta">Browser-native 3D port · Neon Oval · Solo pack</div>

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
          <span>TRACK</span>
          <strong>{race.track.name}</strong>
          <small>{race.track.description}</small>
        </div>

        <button className="start-button" onClick={onStart} type="button" data-testid="start-race">
          START RACE
        </button>
      </div>
    </div>
  )
}

