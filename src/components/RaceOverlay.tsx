import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { getPlayer, type RaceState } from '../../shared/race'
import { neonDiagnostics } from '../diagnostics/neonDiagnostics'
import { formatRaceTime, runAssessment, statCardsFor } from './raceStatsView'

type Props = {
  race: RaceState
  onRestart: () => void
  onMenu: () => void
}

type FeedbackSource = 'text' | 'voice'

type FeedbackModeState = 'text' | 'voice'

type SpeechRecognitionEventLike = {
  resultIndex?: number
  results?: {
    length: number
    [index: number]: {
      isFinal?: boolean
      [index: number]: {
        transcript?: unknown
      }
    }
  }
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: { new (): SpeechRecognitionLike }
  webkitSpeechRecognition?: { new (): SpeechRecognitionLike }
}

type FeedbackLogPayload = {
  source: FeedbackSource
  track: string
  trackName: string
  position: number
  phase: string
  player: {
    id: string
    name: string
    lap: number
    eliminated: boolean
    finished: boolean
    finalPosition: number | null
    bestLapSeconds: number
    finishTime: number | null
  }
  race: {
    raceTime: number
    totalLaps: number
  }
  textLength: number
}

const getSpeechRecognition = (): { new (): SpeechRecognitionLike } | null => {
  if (typeof window === 'undefined') return null
  const speechAwareWindow = window as WindowWithSpeech
  return speechAwareWindow.SpeechRecognition ?? speechAwareWindow.webkitSpeechRecognition ?? null
}

const normalizeTranscript = (text: string): string => text.replace(/\s+/g, ' ').trim()

const extractTranscript = (event: unknown): string => {
  const speechEvent = event as SpeechRecognitionEventLike
  const results = speechEvent.results
  if (!results) return ''

  const resultCount = typeof results.length === 'number' ? results.length : 0

  let finalText = ''
  let interimText = ''
  for (let index = 0; index < resultCount; index += 1) {
    const result = results[index]
    const text = normalizeTranscript(typeof result?.[0]?.transcript === 'string' ? result[0].transcript : '')
    if (!text) continue
    if (result.isFinal) {
      finalText += `${finalText ? ' ' : ''}${text}`
    } else {
      interimText += `${interimText ? ' ' : ''}${text}`
    }
  }

  return (finalText || interimText).trim()
}

const buildFeedbackPayload = (race: RaceState, source: FeedbackSource, text: string): FeedbackLogPayload => {
  const player = getPlayer(race)
  const position = Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1)
  return {
    source,
    track: race.track.id,
    trackName: race.track.name,
    position,
    phase: race.phase,
    player: {
      id: player.id,
      name: player.name,
      lap: player.lap,
      eliminated: player.eliminated,
      finished: player.finished,
      finalPosition: player.finalPosition ?? null,
      bestLapSeconds: Math.round(player.bestLapSeconds * 100) / 100,
      finishTime: player.finished ? Math.round(player.finishTime * 100) / 100 : null,
    },
    race: {
      raceTime: Math.round(race.raceTime * 100) / 100,
      totalLaps: race.totalLaps,
    },
    textLength: text.length,
  }
}

export function RaceOverlay({ race, onRestart, onMenu }: Props) {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState<FeedbackModeState>('text')
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechSupported = Boolean(getSpeechRecognition())

  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (!recognition) return
    try {
      recognition.stop()
    } catch {
      // ignore stop errors when cleaning up speech recognizer
    }
  }, [])

  const resetFeedbackForm = (): void => {
    setFeedbackOpen(false)
    setFeedbackMode('text')
    setFeedbackText('')
    setFeedbackMessage(null)
    setFeedbackError(null)
  }

  const stopDictation = (): void => {
    if (!recognitionRef.current) return
    try {
      recognitionRef.current.stop()
    } catch {
      // ignore stop errors when user interacts quickly
    } finally {
      recognitionRef.current = null
      setRecording(false)
    }
  }

  useEffect(() => {
    if (race.phase === 'finished' || race.phase === 'results') return
    const timer = window.setTimeout(() => {
      setFeedbackOpen(false)
      setFeedbackMode('text')
      setFeedbackText('')
      setFeedbackMessage(null)
      setFeedbackError(null)
      setFeedbackSubmitting(false)
      stopDictation()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [race.phase])

  const player = getPlayer(race)
  const playerEliminated = player.eliminated
  const playerPosition = Math.max(1, race.standings.findIndex((vehicle) => vehicle.id === player.id) + 1)

  const startDictation = (): void => {
    if (!speechSupported) {
      setFeedbackError('La saisie vocale n’est pas disponible dans ce navigateur.')
      return
    }

    const SpeechRecognitionCtor = getSpeechRecognition()
    if (!SpeechRecognitionCtor) {
      setFeedbackError('La saisie vocale n’est pas disponible sur ce navigateur.')
      return
    }

    stopDictation()
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'fr-FR'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      setRecording(true)
      setFeedbackMode('voice')
      setFeedbackMessage('Enregistrement vocal... parle normalement')
      setFeedbackError(null)
    }
    recognition.onresult = (event: unknown) => {
      const transcript = extractTranscript(event)
      if (!transcript) return
      setFeedbackText(transcript)
    }
    recognition.onerror = (event: unknown) => {
      const speechError = (event as { error?: string }).error
      setFeedbackError(`Erreur dictée vocale${speechError ? ` (${speechError})` : ''}`)
      stopDictation()
    }
    recognition.onend = () => {
      setRecording(false)
      setFeedbackMessage('Dictée terminée. Vérifie et valide ton texte.')
      if (recognitionRef.current === recognition) recognitionRef.current = null
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (error) {
      setFeedbackError(`Impossible de démarrer la dictée vocale. ${error instanceof Error ? error.message : 'Erreur inconnue.'}`)
      recognitionRef.current = null
      setRecording(false)
    }
  }

  const toggleFeedback = (): void => {
    if (feedbackOpen) {
      resetFeedbackForm()
      stopDictation()
      return
    }

    setFeedbackOpen(true)
    neonDiagnostics.log('feedback', 'opened', {
      track: race.track.id,
      phase: race.phase,
      playerEliminated,
      raceTime: Math.round(race.raceTime * 100) / 100,
      position: playerPosition,
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const normalized = feedbackText.trim()
    if (!normalized) {
      setFeedbackMessage('Ajoute un commentaire avant d’envoyer.')
      return
    }

    setFeedbackSubmitting(true)
    setFeedbackMessage('Envoi...')
    const payload = buildFeedbackPayload(race, feedbackMode, normalized)
    neonDiagnostics.log('feedback', 'submitted', {
      ...payload,
      text: normalized,
    })
    const synced = await neonDiagnostics.flushRemote()
    stopDictation()
    setFeedbackSubmitting(false)
    if (synced) {
      setFeedbackMessage('Feedback transmis.')
    } else {
      setFeedbackMessage('Feedback enregistré. Il partira dès que l’envoi sera possible.')
    }
    resetFeedbackForm()
    neonDiagnostics.log('feedback', 'submitted_remote_state', {
      synced,
      track: race.track.id,
      source: feedbackMode,
    })
  }

  const title = playerEliminated ? 'CRASH OUT' : race.phase === 'finished' ? 'FINISH' : 'RESULTS'
  const statCards = statCardsFor(race.runStats)
  const assessment = runAssessment(race.runStats, playerEliminated)
  const feedbackHint = recording
    ? 'Parle, je transforme en texte en live.'
    : 'Tu peux rédiger ou cliquer sur "dictée vocale".'

  if (race.phase !== 'finished' && race.phase !== 'results') return null

  return (
    <div className="race-overlay" data-testid="race-results">
      <div className="results-panel">
        <div className="results-header">
          <span>{title}</span>
          <strong>POS {Math.max(1, playerPosition)}/{race.vehicles.length}</strong>
        </div>
        <div className="results-track">{race.track.name}</div>
        {race.phase === 'finished' && (
          <div className="results-wait">
            {playerEliminated ? 'Run terminated.' : 'Compiling final timings...'}
          </div>
        )}
        {race.phase === 'results' && (
          <>
            <div className="results-summary">
              <span>{playerEliminated ? 'STATUS OUT' : `TIME ${formatRaceTime(player.finishTime)}`}</span>
              <span>BEST LAP {formatRaceTime(player.bestLapSeconds)}</span>
            </div>
            <div className="results-analysis" data-testid="run-analysis">
              {statCards.map((card) => (
                <div className={card.tone ? `analysis-card ${card.tone}` : 'analysis-card'} key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
            <div className="results-assessment">{assessment}</div>
            <div className="results-table">
              {race.standings.map((vehicle, index) => (
                <div className={vehicle.id === player.id ? 'result-row local' : 'result-row'} key={vehicle.id}>
                  <span>{index + 1}</span>
                  <span>{vehicle.name}</span>
                  <span>{vehicle.eliminated ? 'OUT' : vehicle.finished ? formatRaceTime(vehicle.finishTime) : `${Math.round(Math.abs(vehicle.forwardSpeed))}m/s`}</span>
                  <span>{vehicle.timePenalty > 0 ? `+${vehicle.timePenalty.toFixed(1)}` : '-'}</span>
                </div>
              ))}
            </div>
            <div className="results-feedback">
              <button
                type="button"
                onClick={toggleFeedback}
                className="results-feedback-trigger"
                data-testid="race-feedback-toggle"
                disabled={feedbackSubmitting}
              >
                FEEDBACK COURSE
              </button>
            </div>
          </>
        )}
        {race.phase === 'results' && (
          <div className="results-actions">
            <button type="button" onClick={onRestart} data-testid="retry-race">RETRY NOW</button>
            <button type="button" onClick={onMenu}>SETUP</button>
            {feedbackOpen && (
              <form className="results-feedback-panel" onSubmit={(event) => void handleSubmit(event)}>
                <label htmlFor="race-feedback-text" className="results-feedback-label">
                  Feedback de fin de course
                </label>
                <textarea
                  id="race-feedback-text"
                  className="results-feedback-textarea"
                  value={feedbackText}
                  onChange={(event) => {
                    setFeedbackText(event.currentTarget.value)
                    setFeedbackMode('text')
                  }}
                  placeholder="Décris ce que tu as ressenti pendant la course..."
                  rows={4}
                  maxLength={1200}
                />
                <div className="results-feedback-hint">{feedbackHint}</div>
                <div className="results-feedback-actions">
                  <button
                    type="button"
                    onClick={recording ? stopDictation : startDictation}
                    disabled={!speechSupported || feedbackSubmitting}
                  >
                    {recording ? 'STOPPER LA DICTÉE' : 'DICTÉE ORALE'}
                  </button>
                  <button type="button" onClick={toggleFeedback} disabled={feedbackSubmitting}>
                    ANNULER
                  </button>
                  <button type="submit" disabled={feedbackSubmitting || !feedbackText.trim()}>
                    {feedbackSubmitting ? 'ENVOI...' : 'ENVOYER'}
                  </button>
                </div>
                {!speechSupported && <p className="results-feedback-warning">La saisie vocale est indisponible.</p>}
                {feedbackError && <p className="results-feedback-error">{feedbackError}</p>}
                {feedbackMessage && <p className="results-feedback-status">{feedbackMessage}</p>}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
