import { expect, test, type Page } from '@playwright/test'

type AudioSpyEvent = {
  type: 'create' | 'play' | 'pause' | 'volume' | 'playbackRate'
  src: string
  value?: number
  loop?: boolean
}

const tutorialStorageKey = 'neon_drift_web.tutorial.v1.complete'

const canvasHasNonBlankPixels = async (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas')
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    await image.decode()
    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = 32
    const context = probe.getContext('2d')
    if (!context) return false
    context.drawImage(image, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      if (r + g + b > 18) return true
    }
    return false
  })

const hudSpeed = async (page: import('@playwright/test').Page) =>
  Number.parseInt((await page.locator('.speed-readout').textContent()) ?? '0', 10)

const goToGame = async (page: Page, { tutorialComplete = true } = {}) => {
  if (tutorialComplete) {
    await page.addInitScript((key) => localStorage.setItem(key, 'true'), tutorialStorageKey)
  }
  await page.goto('./?e2e=1')
}

const focusRace = async (page: Page) => {
  await page.locator('canvas.game-canvas').click({ force: true, position: { x: 16, y: 16 } })
}

const holdThrottle = async (page: Page) => {
  await page.keyboard.down('w')
  await page.keyboard.down('ArrowUp')
}

const releaseThrottle = async (page: Page) => {
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up('w')
}

const expectMoving = async (page: Page) => {
  await expect.poll(() => hudSpeed(page), { timeout: 15_000 }).toBeGreaterThan(0)
}

const installAudioSpy = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    type AudioSpyWindow = Window & typeof globalThis & { __neonAudioEvents: AudioSpyEvent[] }
    const audioWindow = window as AudioSpyWindow
    audioWindow.__neonAudioEvents = []

    class FakeAudio {
      readonly src: string
      loop = false
      currentTime = 0
      private currentVolume = 1
      private currentPlaybackRate = 1

      constructor(src = '') {
        this.src = src
        audioWindow.__neonAudioEvents.push({ type: 'create', src })
      }

      get volume() {
        return this.currentVolume
      }

      set volume(value: number) {
        this.currentVolume = value
        audioWindow.__neonAudioEvents.push({ type: 'volume', src: this.src, value, loop: this.loop })
      }

      get playbackRate() {
        return this.currentPlaybackRate
      }

      set playbackRate(value: number) {
        this.currentPlaybackRate = value
        audioWindow.__neonAudioEvents.push({ type: 'playbackRate', src: this.src, value, loop: this.loop })
      }

      play() {
        audioWindow.__neonAudioEvents.push({ type: 'play', src: this.src, loop: this.loop })
        return Promise.resolve()
      }

      pause() {
        audioWindow.__neonAudioEvents.push({ type: 'pause', src: this.src, loop: this.loop })
      }
    }

    audioWindow.Audio = FakeAudio as unknown as typeof Audio
  })
}

const menuHasNoChoiceOverlap = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const visibleRect = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)

    const tracks = visibleRect('.track-option')
    const ships = visibleRect('.ship-card')
    return tracks.every((track) =>
      ships.every((ship) => {
        const horizontal = Math.min(track.right, ship.right) - Math.max(track.left, ship.left)
        const vertical = Math.min(track.bottom, ship.bottom) - Math.max(track.top, ship.top)
        return horizontal <= 0 || vertical <= 0
      }),
    )
  })

const elementsHaveNoVisibleOverlap = async (
  page: import('@playwright/test').Page,
  firstSelector: string,
  secondSelector: string,
) =>
  page.evaluate(
    ([first, second]) => {
      const visibleRects = (selector: string) =>
        [...document.querySelectorAll<HTMLElement>(selector)]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)

      const firstRects = visibleRects(first)
      const secondRects = visibleRects(second)
      return firstRects.every((firstRect) =>
        secondRects.every((secondRect) => {
          const horizontal = Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left)
          const vertical = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top)
          return horizontal <= 0 || vertical <= 0
        }),
      )
    },
    [firstSelector, secondSelector],
  )

test('lays out the menu choices without overlap', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await goToGame(page)
    await expect(page.getByTestId('main-menu')).toBeVisible()
    await expect.poll(() => menuHasNoChoiceOverlap(page)).toBe(true)
    await expect.poll(() => elementsHaveNoVisibleOverlap(page, '.start-button', '.track-option, .ship-card')).toBe(true)
    if (viewport.width <= 820) {
      await expect(page.getByTestId('start-race')).toBeInViewport()
      await page.locator('.menu-panel').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect.poll(() => elementsHaveNoVisibleOverlap(page, '.start-button', '.track-option, .ship-card')).toBe(true)
    }
  }
})

test('advances the tutorial after acknowledged launch telemetry changes', async ({ page }) => {
  await page.addInitScript((key) => localStorage.removeItem(key), tutorialStorageKey)
  await goToGame(page, { tutorialComplete: false })
  await page.getByTestId('start-race').click()
  await expect(page.getByTestId('tutorial')).toContainText('Launch clean')
  await expect(page.getByTestId('tutorial')).toContainText('1/8')
  await page.getByRole('button', { name: 'OK' }).click()
  await focusRace(page)
  await holdThrottle(page)
  await page.waitForTimeout(4200)
  await expectMoving(page)
  await expect(page.getByTestId('tutorial')).toContainText('Thrust and steer')
  await releaseThrottle(page)
})

test('keeps the mobile event strip clear of the airbrake charge meter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await goToGame(page)
  await page.getByTestId('start-race').click()
  await focusRace(page)
  await holdThrottle(page)
  await page.keyboard.down('Shift')
  await page.waitForTimeout(4200)
  await expectMoving(page)
  await expect(page.locator('.event-strip span').filter({ hasText: 'BOOST' }).first()).toBeVisible()
  await expect(page.getByTestId('mobile-race-strip')).toBeVisible()
  await expect.poll(() => elementsHaveNoVisibleOverlap(page, '.event-strip', '.airbrake-charge')).toBe(true)
  await expect.poll(() => elementsHaveNoVisibleOverlap(page, '[data-testid="mobile-race-strip"]', '.hud-race, .touch-controls, .tutorial')).toBe(true)
  await page.keyboard.up('Shift')
  await releaseThrottle(page)
})

test('drives with mobile touch throttle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await goToGame(page)
  await page.getByTestId('start-race').click()
  const throttle = page.getByLabel('Throttle')
  await throttle.dispatchEvent('pointerdown', { pointerId: 7, button: 0, isPrimary: true, pointerType: 'touch' })
  await expect(throttle).toHaveAttribute('aria-pressed', 'true')
  await throttle.dispatchEvent('pointerleave', { pointerId: 7, button: 0, isPrimary: true, pointerType: 'touch' })
  await expect(throttle).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(4200)
  await expect.poll(() => hudSpeed(page)).toBeGreaterThan(0)
  await throttle.dispatchEvent('pointerup', { pointerId: 7, button: 0, isPrimary: true, pointerType: 'touch' })
  await expect(throttle).toHaveAttribute('aria-pressed', 'false')
})

test('starts a playable 3D race and renders canvas pixels', async ({ page }) => {
  await goToGame(page)
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await expect(page.getByText('NEON DRIFT')).toBeVisible()
  await expect.poll(() => menuHasNoChoiceOverlap(page)).toBe(true)
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)

  await page.getByTestId('start-race').click()
  await focusRace(page)
  await expect(page.getByTestId('race-toast')).toBeVisible()
  await holdThrottle(page)
  await page.keyboard.down('Shift')
  await page.keyboard.down('q')
  await page.waitForTimeout(3800)
  await expectMoving(page)
  await page.keyboard.up('q')
  await page.keyboard.up('Shift')
  await releaseThrottle(page)

  await expect(page.getByTestId('hud')).toContainText('POWER')
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: {
        sourceShipCount?: number
        bloomStrength?: number
        gatePortalCount?: number
        padMarkerCount?: number
        trackEnvironmentInstances?: number
      }
    }).__NEON_RENDER_STATS
    return stats?.sourceShipCount ?? 0
  }), { timeout: 10_000 }).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { sourceShipCount?: number; bloomStrength?: number }
    }).__NEON_RENDER_STATS
    return stats?.bloomStrength ?? 0
  })).toBeGreaterThan(0.6)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { gatePortalCount?: number }
    }).__NEON_RENDER_STATS
    return stats?.gatePortalCount ?? 0
  })).toBe(8)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { padMarkerCount?: number; trackEnvironmentInstances?: number }
    }).__NEON_RENDER_STATS
    return (stats?.padMarkerCount ?? 0) > 0 && (stats?.trackEnvironmentInstances ?? 0) > 80
  })).toBe(true)
})

test('starts a playable source-authored inversion track', async ({ page }) => {
  await goToGame(page)
  await page.getByRole('button', { name: /Inversion Ribbon/ }).click()
  await expect(page.locator('.menu-meta')).toContainText('Inversion Ribbon')
  await page.getByTestId('start-race').click()
  await focusRace(page)
  await holdThrottle(page)
  await page.waitForTimeout(4300)
  await expectMoving(page)
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)
  await releaseThrottle(page)
})

test('keeps race audio synchronized with live race state', async ({ page }) => {
  await installAudioSpy(page)
  await goToGame(page)
  await page.getByTestId('start-race').click()
  await focusRace(page)
  await holdThrottle(page)
  await page.keyboard.down('Shift')
  await page.waitForTimeout(4200)
  await expectMoving(page)
  await page.keyboard.up('Shift')
  await releaseThrottle(page)

  const engineEvents = await page.evaluate(() => {
    const audioWindow = window as Window & typeof globalThis & { __neonAudioEvents: AudioSpyEvent[] }
    return audioWindow.__neonAudioEvents.filter((event) => event.src.includes('engine_loop.wav'))
  })
  expect(engineEvents.some((event) => event.type === 'play')).toBe(true)
  expect(engineEvents.some((event) => event.type === 'playbackRate' && (event.value ?? 0) > 0.8)).toBe(true)
})
