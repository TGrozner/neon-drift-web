import { useEffect, useState } from 'react'
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

const MOBILE_MENU_QUERY = '(max-width: 820px)'
const MOBILE_MENU_STEPS = ['track', 'ship', 'ready'] as const

type MobileMenuStep = typeof MOBILE_MENU_STEPS[number]

const mobileMenuStepLabel: Record<MobileMenuStep, string> = {
  track: 'Track',
  ship: 'Ship',
  ready: 'Ready',
}

const mobileMenuStepIndex = (step: MobileMenuStep): number => MOBILE_MENU_STEPS.indexOf(step)

const mobileMenuMatches = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(MOBILE_MENU_QUERY).matches

export function MenuPanel({
  race,
  selectedProfile,
  selectedTrack,
  onSelectProfile,
  onSelectTrack,
  onMenuCue,
  onStart,
}: Props) {
  const [mobileMenu, setMobileMenu] = useState(mobileMenuMatches)
  const [mobileStep, setMobileStep] = useState<MobileMenuStep>('track')

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(MOBILE_MENU_QUERY)
    const updateMobileMenu = () => setMobileMenu(media.matches)
    updateMobileMenu()
    media.addEventListener('change', updateMobileMenu)
    return () => media.removeEventListener('change', updateMobileMenu)
  }, [])

  if (race.phase !== 'menu') return null
  const profiles = Object.values(SHIP_PROFILES)
  const activeTrack = TRACKS.find((track) => track.id === selectedTrack) ?? race.track
  const activeProfile = profiles.find((profile) => profile.id === selectedProfile) ?? profiles[0]
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
  const setMobileStepWithCue = (step: MobileMenuStep) => {
    if (step !== mobileStep) onMenuCue('forward')
    setMobileStep(step)
  }
  const nextMobileStep = () => {
    const nextStep = MOBILE_MENU_STEPS[Math.min(MOBILE_MENU_STEPS.length - 1, mobileMenuStepIndex(mobileStep) + 1)]
    setMobileStepWithCue(nextStep)
  }
  const previousMobileStep = () => {
    const previousStep = MOBILE_MENU_STEPS[Math.max(0, mobileMenuStepIndex(mobileStep) - 1)]
    setMobileStepWithCue(previousStep)
  }

  const trackOptions = (
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
  )

  const shipOptions = (
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
  )

  const mobileStepContent = () => {
    if (mobileStep === 'track') {
      return (
        <div className="menu-section mobile-menu-step" data-testid="mobile-menu-step-track">
          <span>TRACK</span>
          {trackOptions}
        </div>
      )
    }
    if (mobileStep === 'ship') {
      return (
        <div className="menu-section mobile-menu-step" data-testid="mobile-menu-step-ship">
          <span>SHIP</span>
          {shipOptions}
        </div>
      )
    }
    return (
      <div className="menu-section mobile-menu-step mobile-ready-step" data-testid="mobile-menu-step-ready">
        <span>READY</span>
        <div className="mobile-ready-card">
          <small>Track</small>
          <strong>{activeTrack.name}</strong>
        </div>
        <div className="mobile-ready-card">
          <small>Ship</small>
          <strong>{activeProfile.label}</strong>
        </div>
        <div className="mobile-ready-card">
          <small>Mode</small>
          <strong>Solo vs Bots</strong>
        </div>
      </div>
    )
  }

  if (mobileMenu) {
    return (
      <div className="menu-shell" data-testid="main-menu">
        <div className="menu-panel mobile-menu-panel">
          <div className="brand">NEON DRIFT</div>
          <div className="menu-meta">Solo vs Bots · {activeTrack.name} · Source-audited web port</div>

          <div className="mobile-menu-flow" data-testid="mobile-menu-flow">
            <div className="mobile-menu-tabs" aria-label="Race setup steps">
              {MOBILE_MENU_STEPS.map((step) => (
                <button
                  aria-current={step === mobileStep ? 'step' : undefined}
                  className={step === mobileStep ? 'mobile-menu-tab selected' : 'mobile-menu-tab'}
                  key={step}
                  onClick={() => setMobileStepWithCue(step)}
                  onPointerEnter={() => onMenuCue('hover')}
                  type="button"
                >
                  <span>{mobileMenuStepIndex(step) + 1}</span>
                  {mobileMenuStepLabel[step]}
                </button>
              ))}
            </div>

            {mobileStepContent()}

            <div className="mobile-menu-nav">
              <button
                className="mobile-menu-back"
                disabled={mobileStep === 'track'}
                onClick={previousMobileStep}
                onPointerEnter={() => onMenuCue('hover')}
                type="button"
              >
                BACK
              </button>
              {mobileStep === 'ready' ? (
                <button className="start-button mobile-start-button" onClick={startRace} onPointerEnter={() => onMenuCue('hover')} type="button" data-testid="start-race">
                  START RACE
                </button>
              ) : (
                <button className="mobile-menu-next" onClick={nextMobileStep} onPointerEnter={() => onMenuCue('hover')} type="button" data-testid="mobile-menu-next">
                  NEXT
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="menu-shell" data-testid="main-menu">
      <div className="menu-panel">
        <div className="brand">NEON DRIFT</div>
        <div className="menu-meta">Solo vs Bots · {activeTrack.name} · Source-audited web port</div>

        <button className="start-button desktop-start-button" onClick={startRace} onPointerEnter={() => onMenuCue('hover')} type="button" data-testid="start-race">
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
          {trackOptions}
        </div>

        <div className="menu-section">
          <span>SHIP</span>
          {shipOptions}
        </div>

      </div>
    </div>
  )
}
