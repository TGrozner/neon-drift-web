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

const canvasPixelStats = async (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.game-canvas')
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return { averageLuma: 0, hotPixelRatio: 1, litPixelRatio: 0, maxChannel: 0 }
    }
    const image = new Image()
    image.src = canvas.toDataURL('image/png')
    await image.decode()
    const probe = document.createElement('canvas')
    probe.width = 64
    probe.height = 64
    const context = probe.getContext('2d')
    if (!context) return { averageLuma: 0, hotPixelRatio: 1, litPixelRatio: 0, maxChannel: 0 }
    context.drawImage(image, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    let lumaTotal = 0
    let hotPixels = 0
    let litPixels = 0
    let maxChannel = 0
    const pixelCount = pixels.length / 4
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      maxChannel = Math.max(maxChannel, r, g, b)
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
      lumaTotal += luma
      if (luma > 180) litPixels += 1
      if (Math.max(r, g, b) > 248 && luma > 215) hotPixels += 1
    }
    return {
      averageLuma: lumaTotal / pixelCount,
      hotPixelRatio: hotPixels / pixelCount,
      litPixelRatio: litPixels / pixelCount,
      maxChannel,
    }
  })

const hudSpeed = async (page: import('@playwright/test').Page) =>
  Number.parseInt((await page.locator('.speed-readout').textContent()) ?? '0', 10)

const pressedKeyCount = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const debugWindow = window as Window & typeof globalThis & {
      __NEON_INPUT_STATE__?: { pressedKeyCount?: number }
    }
    return debugWindow.__NEON_INPUT_STATE__?.pressedKeyCount ?? 0
  })

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

test('plays s&box menu feedback cues', async ({ page }) => {
  await installAudioSpy(page)
  await goToGame(page)
  await page.getByRole('button', { name: /Swift/ }).click()
  await page.getByRole('button', { name: /Heavy/ }).hover()
  await page.getByRole('button', { name: /Public Game Online/ }).click()

  const audioEvents = await page.evaluate(() => {
    const audioWindow = window as Window & typeof globalThis & { __neonAudioEvents: AudioSpyEvent[] }
    return audioWindow.__neonAudioEvents
  })
  const played = audioEvents.filter((event) => event.type === 'play').map((event) => event.src)

  expect(played.some((src) => src.includes('menu_forward.wav'))).toBe(true)
  expect(played.some((src) => src.includes('menu_hover.wav'))).toBe(true)
  expect(played.some((src) => src.includes('menu_deny.wav'))).toBe(true)
  expect(audioEvents.some((event) =>
    event.type === 'playbackRate' &&
    event.src.includes('menu_deny.wav') &&
    Math.abs((event.value ?? 0) - 0.66) < 0.01,
  )).toBe(true)
})

test('only exposes the tutorial circuit as playable track', async ({ page }) => {
  await goToGame(page)
  await expect(page.locator('.menu-meta')).toContainText('Tutorial Circuit')
  await expect(page.locator('.track-option')).toHaveCount(1)
  await expect(page.locator('.track-option')).toContainText('Tutorial Circuit')
  await expect(page.getByRole('button', { name: /Neon Oval/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Inversion Ribbon/ })).toHaveCount(0)
})

test('replays the tutorial on the dedicated tutorial circuit', async ({ page }) => {
  await goToGame(page)
  await expect(page.locator('.menu-meta')).toContainText('Tutorial Circuit')
  await expect(page.locator('.track-option.selected .track-tag')).toContainText('Training')
  await expect(page.getByTestId('tutorial')).toContainText('Pick a session')
  await expect(page.getByTestId('tutorial')).toContainText('1/9')
  await page.getByTestId('start-race').click()
  await expect(page.getByTestId('tutorial')).toContainText('Launch clean')
  await expect(page.getByTestId('tutorial')).toContainText('2/9')
  await focusRace(page)
  await holdThrottle(page)
  await page.waitForTimeout(4200)
  await expectMoving(page)
  await page.getByRole('button', { name: 'OK' }).click()
  await focusRace(page)
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
  await expectMoving(page)
  await expect.poll(async () => (
    await page.locator('.event-strip span').allTextContents()
  ).includes('BOOST'), { timeout: 15_000 }).toBe(true)
  await expect(page.getByTestId('mobile-race-strip')).toBeVisible()
  await expect.poll(() => elementsHaveNoVisibleOverlap(page, '.event-strip', '.airbrake-charge')).toBe(true)
  await expect.poll(() => elementsHaveNoVisibleOverlap(page, '.event-strip, .airbrake-charge', '.touch-controls')).toBe(true)
  await expect.poll(() => elementsHaveNoVisibleOverlap(page, '[data-testid="mobile-race-strip"]', '.hud-race, .touch-controls, .tutorial')).toBe(true)
  await page.keyboard.up('Shift')
  await releaseThrottle(page)
})

test('drives with simplified mobile touch controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await goToGame(page)
  await page.getByTestId('start-race').click()
  await expect(page.getByTestId('tutorial')).toBeHidden()

  const steering = page.getByLabel('Steering pad')
  await expect(steering).toBeVisible()
  await expect(page.getByRole('button', { name: 'Boost' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Drift airbrake' })).toBeVisible()

  await page.waitForTimeout(4200)
  await expect.poll(() => hudSpeed(page)).toBeGreaterThan(0)

  const steeringBox = await steering.boundingBox()
  expect(steeringBox).not.toBeNull()
  await page.mouse.move(steeringBox!.x + steeringBox!.width * 0.86, steeringBox!.y + steeringBox!.height * 0.5)
  await page.mouse.down()
  await expect.poll(async () => Number(await steering.getAttribute('aria-valuenow'))).toBeLessThan(-45)
  await page.mouse.move(steeringBox!.x + steeringBox!.width * 0.14, steeringBox!.y + steeringBox!.height * 0.5)
  await expect.poll(async () => Number(await steering.getAttribute('aria-valuenow'))).toBeGreaterThan(45)
  await page.mouse.up()
  await expect(steering).toHaveAttribute('aria-valuenow', '0')

  const drift = page.getByRole('button', { name: 'Drift airbrake' })
  await drift.dispatchEvent('pointerdown', { pointerId: 8, button: 0, isPrimary: true, pointerType: 'touch' })
  await expect(drift).toHaveAttribute('aria-pressed', 'true')
  await drift.dispatchEvent('pointercancel', { pointerId: 8, button: 0, isPrimary: true, pointerType: 'touch' })
  await expect(drift).toHaveAttribute('aria-pressed', 'false')
})

test('clears held keyboard controls when the page loses focus', async ({ page }) => {
  await goToGame(page)
  await page.getByTestId('start-race').click()
  await focusRace(page)
  await page.keyboard.down('z')

  try {
    await expect.poll(() => pressedKeyCount(page)).toBeGreaterThan(0)
    await expect.poll(() => hudSpeed(page), { timeout: 15_000 }).toBeGreaterThan(120)

    await page.evaluate(() => window.dispatchEvent(new Event('blur')))

    await expect.poll(() => pressedKeyCount(page), { timeout: 2_000 }).toBe(0)
  } finally {
    await page.keyboard.up('z')
  }
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
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { boostLightningSegmentCount?: number; playerBoostLightningStrength?: number }
    }).__NEON_RENDER_STATS
    return (stats?.boostLightningSegmentCount ?? 0) >= 9 && (stats?.playerBoostLightningStrength ?? 0) > 0.12
  }), { timeout: 4_000 }).toBe(true)
  await page.keyboard.up('q')
  await page.keyboard.up('Shift')
  await releaseThrottle(page)

  await expect(page.getByTestId('hud')).toContainText('POWER')
  await expect(page.getByTestId('hud')).toContainText('INTEGRITY')
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)
  await expect.poll(async () => {
    const stats = await canvasPixelStats(page)
    return stats.hotPixelRatio
  }).toBeLessThan(0.22)
  await expect.poll(async () => {
    const stats = await canvasPixelStats(page)
    return stats.averageLuma
  }).toBeLessThan(165)
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
      __NEON_RENDER_STATS?: { sourceShipCount?: number; bloomStrength?: number; toneMappingExposure?: number }
    }).__NEON_RENDER_STATS
    return stats?.bloomStrength ?? 0
  })).toBeGreaterThan(0.25)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { bloomStrength?: number }
    }).__NEON_RENDER_STATS
    return stats?.bloomStrength ?? 0
  })).toBeLessThan(0.7)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { toneMappingExposure?: number }
    }).__NEON_RENDER_STATS
    return stats?.toneMappingExposure ?? 0
  })).toBeLessThan(1)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: { gatePortalCount?: number }
    }).__NEON_RENDER_STATS
    return stats?.gatePortalCount ?? 0
  })).toBe(8)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: {
        padMarkerCount?: number
        rainbowAccentColorCount?: number
        trackEnvironmentInstances?: number
        trackSpectacleDecorCount?: number
      }
    }).__NEON_RENDER_STATS
    return (
      (stats?.padMarkerCount ?? 0) > 0 &&
      (stats?.rainbowAccentColorCount ?? 0) >= 6 &&
      (stats?.trackEnvironmentInstances ?? 0) > 120 &&
      (stats?.trackSpectacleDecorCount ?? 0) > 120
    )
  })).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & typeof globalThis & {
      __NEON_RENDER_STATS?: {
        sourceTrackGateModelCount?: number
        sourceTrackGatePartModelCount?: number
        sourceTrackPadModelCount?: number
        sourceTrackStartLineModelCount?: number
        sourceTrackSlabModelCount?: number
        sourceTrackRailModelCount?: number
        sourceTrackKitLoaded?: boolean
      }
    }).__NEON_RENDER_STATS
    return {
      loaded: stats?.sourceTrackKitLoaded ?? false,
      gates: stats?.sourceTrackGateModelCount ?? 0,
      gateParts: stats?.sourceTrackGatePartModelCount ?? 0,
      pads: stats?.sourceTrackPadModelCount ?? 0,
      startLine: stats?.sourceTrackStartLineModelCount ?? 0,
      slabs: stats?.sourceTrackSlabModelCount ?? 0,
      rails: stats?.sourceTrackRailModelCount ?? 0,
    }
  }), { timeout: 15_000 }).toEqual({
    loaded: true,
    gates: 8,
    gateParts: 24,
    pads: 8,
    startLine: 1,
    slabs: 384,
    rails: 768,
  })
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
