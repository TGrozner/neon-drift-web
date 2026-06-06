import { useCallback, useEffect, useRef, useState } from 'react'
import { FIXED_DT, MAX_ACCUMULATED_TIME, type ShipProfileId } from '../../shared/constants'
import { type VehicleInput } from '../../shared/physics'
import {
  createRaceState,
  startRace,
  updateRace,
  type RaceState,
} from '../../shared/race'

type KeyState = {
  throttle: number
  steer: number
  boost: boolean
  airbrake: boolean
  reset: boolean
}

export type TouchCommand = 'left' | 'right' | 'throttle' | 'boost' | 'airbrake'

const createKeyState = (): KeyState => ({
  throttle: 0,
  steer: 0,
  boost: false,
  airbrake: false,
  reset: false,
})

const keyInput = (keys: Set<string>): KeyState => ({
  throttle: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + (keys.has('KeyS') || keys.has('ArrowDown') ? -1 : 0),
  steer: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + (keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0),
  boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  airbrake: keys.has('Space'),
  reset: keys.has('KeyR'),
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
  const touchRef = useRef<KeyState>(createKeyState())
  const lastTimeRef = useRef<number | null>(null)
  const accumulatorRef = useRef(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      pressedKeysRef.current.add(event.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.code)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time
      lastTimeRef.current = time
      const frameDt = Math.min(MAX_ACCUMULATED_TIME, (time - last) / 1000)
      accumulatorRef.current += frameDt
      while (accumulatorRef.current >= FIXED_DT) {
        const input = mergeInput(keyInput(pressedKeysRef.current), touchRef.current)
        updateRace(raceRef.current, input, FIXED_DT)
        accumulatorRef.current -= FIXED_DT
        if (touchRef.current.reset) touchRef.current.reset = false
      }
      setView((current) => ({
        race: raceRef.current,
        version: (current.version + 1) % 1_000_000,
      }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const start = useCallback((profileId: ShipProfileId) => {
    raceRef.current = startRace(profileId)
    pressedKeysRef.current.clear()
    touchRef.current = createKeyState()
    setView((current) => ({
      race: raceRef.current,
      version: (current.version + 1) % 1_000_000,
    }))
  }, [])

  const setTouch = useCallback((command: TouchCommand, active: boolean) => {
    const touch = touchRef.current
    if (command === 'left') touch.steer += active ? -1 : 1
    if (command === 'right') touch.steer += active ? 1 : -1
    if (command === 'throttle') touch.throttle = active ? 1 : 0
    if (command === 'boost') touch.boost = active
    if (command === 'airbrake') touch.airbrake = active
    touch.steer = Math.max(-1, Math.min(1, touch.steer))
  }, [])

  const reset = useCallback(() => {
    touchRef.current.reset = true
  }, [])

  return {
    race: view.race,
    start,
    setTouch,
    reset,
  }
}
