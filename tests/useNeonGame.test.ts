import { describe, expect, it } from 'vitest'
import {
  isEditableTarget,
  shouldSuppressGameInputDefault,
} from '../src/hooks/useNeonGame'

const keyboardEventLike = (entry: { key: string; code: string; target: EventTarget | null }) =>
  entry as Parameters<typeof shouldSuppressGameInputDefault>[0]

describe('keyboard input suppression for gameplay controls', () => {
  it('does not suppress control defaults in editable text inputs', () => {
    const textarea = document.createElement('textarea')
    const input = document.createElement('input')

    const spaceInTextarea = shouldSuppressGameInputDefault(keyboardEventLike({ key: ' ', code: 'Space', target: textarea }))
    const spaceInInput = shouldSuppressGameInputDefault(keyboardEventLike({ key: ' ', code: 'Space', target: input }))

    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(input)).toBe(true)
    expect(spaceInTextarea).toBe(false)
    expect(spaceInInput).toBe(false)
  })

  it('still suppresses gameplay controls when focus is outside editable fields', () => {
    const spaceLike = shouldSuppressGameInputDefault(keyboardEventLike({ key: ' ', code: 'Space', target: document.body }))
    const up = shouldSuppressGameInputDefault(keyboardEventLike({ key: 'ArrowUp', code: 'ArrowUp', target: document.body }))
    const letterKey = shouldSuppressGameInputDefault(keyboardEventLike({ key: 'a', code: 'KeyA', target: document.body }))

    expect(spaceLike).toBe(true)
    expect(up).toBe(true)
    expect(letterKey).toBe(false)
  })
})
