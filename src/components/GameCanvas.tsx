import { useEffect, useRef, type MutableRefObject } from 'react'
import type { RaceState } from '../../shared/race'
import { neonDiagnostics, summarizeRenderStats } from '../diagnostics/neonDiagnostics'
import { NeonRenderer } from '../render/renderer'

type Props = {
  raceRef: MutableRefObject<RaceState>
}

type RenderStatsWindow = Window & typeof globalThis & {
  __NEON_RENDER_STATS?: unknown
}

export function GameCanvas({ raceRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<NeonRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const renderer = new NeonRenderer(canvas)
    const renderStatsWindow = window as RenderStatsWindow
    rendererRef.current = renderer
    neonDiagnostics.log('renderer', 'mounted', {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      track: raceRef.current.track.id,
      phase: raceRef.current.phase,
    })

    let raf = 0
    let lastRenderTime: number | null = null
    const render = (time: number) => {
      renderer.update(raceRef.current)
      if (lastRenderTime !== null) {
        neonDiagnostics.recordFrame(time - lastRenderTime, {
          phase: raceRef.current.phase,
          track: raceRef.current.track.id,
          render: summarizeRenderStats(renderStatsWindow.__NEON_RENDER_STATS),
        })
      }
      lastRenderTime = time
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
      rendererRef.current = null
      neonDiagnostics.log('renderer', 'unmounted')
    }
  }, [raceRef])

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Neon Drift 3D race view" />
}
