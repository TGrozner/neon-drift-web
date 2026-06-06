import { expect, test } from '@playwright/test'

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

test('starts a playable 3D race and renders canvas pixels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await expect(page.getByText('NEON DRIFT')).toBeVisible()
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)

  await page.getByTestId('start-race').click()
  await expect(page.getByTestId('race-toast')).toBeVisible()
  await page.keyboard.down('w')
  await page.keyboard.down('Shift')
  await page.keyboard.down('a')
  await page.waitForTimeout(3800)
  await page.keyboard.up('a')
  await page.keyboard.up('Shift')
  await page.keyboard.up('w')

  await expect(page.getByTestId('hud')).toContainText('POWER')
  await expect.poll(() => canvasHasNonBlankPixels(page)).toBe(true)
})
