import { useCallback, useEffect, useRef, useState } from 'react'
import { FIXED_DT, MAX_ACCUMULATED_TIME, type ShipProfileId } from '../../shared/constants'
import { type VehicleInput } from '../../shared/physics'
import {
  createRaceState,
  goToMenu,
  startRace,
  updateRace,
  type RaceState,
} from '../../shared/race'
import type { TrackId } from '../../shared/track'

type KeyState = {
  throttle: number
  steer: number
  boost: boolean
  airbrake: boolean
  reset: boolean
}

export type TouchState = KeyState & {
  left: boolean
  right: boolean
}

export type TouchCommand = 'left' | 'right' | 'throttle' | 'boost' | 'airbrake'

const createKeyState = (): KeyState => ({
  throttle: 0,
  steer: 0,
  boost: false,
  airbrake: false,
  reset: false,
})

export const createTouchState = (): TouchState => ({
  ...createKeyState(),
  left: false,
  right: false,
})

const normalizeKey = (event: KeyboardEvent): string =>
  event.key.length === 1 ? event.key.toLowerCase() : event.key

const hasAny = (keys: Set<string>, values: string[]): boolean =>
  values.some((value) => keys.has(value))

const STEER_LEFT = 1
const STEER_RIGHT = -1
const REACT_PUBLISH_INTERVAL_MS = 50

export const applyTouchCommand = (
  touch: TouchState,
  command: TouchCommand,
  active: boolean,
): void => {
  if (command === 'left') touch.left = active
  if (command === 'right') touch.right = active
  if (command === 'throttle') touch.throttle = active ? 1 : 0
  if (command === 'boost') touch.boost = active
  if (command === 'airbrake') touch.airbrake = active
  touch.steer = (touch.left ? STEER_LEFT : 0) + (touch.right ? STEER_RIGHT : 0)
}

export const applyTouchSteer = (touch: TouchState, steer: number): void => {
  touch.left = false
  touch.right = false
  touch.steer = Math.max(-1, Math.min(1, steer))
}

const keyInput = (keys: Set<string>): KeyState => ({
  throttle:
    (hasAny(keys, ['KeyW', 'ArrowUp', 'w', 'z']) ? 1 : 0) +
    (hasAny(keys, ['KeyS', 'ArrowDown', 's']) ? -1 : 0),
  steer:
    (hasAny(keys, ['KeyA', 'ArrowLeft', 'a', 'q']) ? STEER_LEFT : 0) +
    (hasAny(keys, ['KeyD', 'ArrowRight', 'd']) ? STEER_RIGHT : 0),
  boost: hasAny(keys, ['ShiftLeft', 'ShiftRight', 'Shift']),
  airbrake: hasAny(keys, ['Space', ' ']),
  reset: hasAny(keys, ['KeyR', 'r']),
})

const mergeInput = (keyboard: KeyState, touch: KeyState): VehicleInput => ({
  throttle: Math.max(-1, Math.min(1, keyboard.throttle + touch.throttle)),
  steer: Math.max(-1, Math.min(1, keyboard.steer + touch.steer)),
  boost: keyboard.boost || touch.boost,
  airbrake: keyboard.airbrake || touch.airbrake,
  reset: keyboard.reset || touch.reset,
})

export const useNeonGame = () => {
  const [view, setView] = useState(() => ({ race: createRaceState(), version: 0 }))
  const raceRef = useRef<RaceState>(view.race)
  const pressedKeysRef = useRef(new Set<string>())
  const touchRef = useRef<TouchState>(createTouchState())
  const lastTimeRef = useRef<number | null>(null)
  const accumulatorRef = useRef(0)
  const nextPublishTimeRef = useRef(0)
  const lastPublishedPhaseRef = useRef(view.race.phase)

  useEffect(() => {
    const clearInputState = () => {
      pressedKeysRef.current.clear()
      touchRef.current = createTouchState()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearInputState()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      pressedKeysRef.current.add(event.code)
      pressedKeysRef.current.add(normalizeKey(event))
      if (
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) ||
        [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.code)
      pressedKeysRef.current.delete(normalizeKey(event))
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInputState)
    window.addEventListener('pagehide', clearInputState)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInputState)
      window.removeEventListener('pagehide', clearInputState)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time
      lastTimeRef.current = time
      const frameDt = Math.min(MAX_ACCUMULATED_TIME, (time - last) / 1000)
      accumulatorRef.current += frameDt
      let stepped = false
      while (accumulatorRef.current >= FIXED_DT) {
        const input = mergeInput(keyInput(pressedKeysRef.current), touchRef.current)
        updateRace(raceRef.current, input, FIXED_DT)
        accumulatorRef.current -= FIXED_DT
        if (touchRef.current.reset) touchRef.current.reset = false
        stepped = true
      }
      const phaseChanged = raceRef.current.phase !== lastPublishedPhaseRef.current
      if (stepped && (phaseChanged || time >= nextPublishTimeRef.current)) {
        lastPublishedPhaseRef.current = raceRef.current.phase
        nextPublishTimeRef.current = time + REACT_PUBLISH_INTERVAL_MS
        setView((current) => ({
          race: raceRef.current,
          version: (current.version + 1) % 1_000_000,
        }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const start = useCallback((profileId: ShipProfileId, trackId: TrackId) => {
    raceRef.current = startRace(profileId, trackId)
    lastPublishedPhaseRef.current = raceRef.current.phase
    nextPublishTimeRef.current = 0
    pressedKeysRef.current.clear()
    touchRef.current = createTouchState()
    setView((current) => ({
      race: raceRef.current,
      version: (current.version + 1) % 1_000_000,
    }))
  }, [])

  const setTouch = useCallback((command: TouchCommand, active: boolean) => {
    applyTouchCommand(touchRef.current, command, active)
  }, [])

  const setTouchSteer = useCallback((steer: number) => {
    applyTouchSteer(touchRef.current, steer)
  }, [])

  const reset = useCallback(() => {
    touchRef.current.reset = true
  }, [])

  const menu = useCallback(() => {
    goToMenu(raceRef.current)
    lastPublishedPhaseRef.current = raceRef.current.phase
    nextPublishTimeRef.current = 0
    pressedKeysRef.current.clear()
    touchRef.current = createTouchState()
    setView((current) => ({
      race: raceRef.current,
      version: (current.version + 1) % 1_000_000,
    }))
  }, [])

  return {
    race: view.race,
    raceRef,
    start,
    menu,
    setTouch,
    setTouchSteer,
    reset,
    version: view.version,
  }
}
