import { useEffect, useRef, type MutableRefObject } from 'react'
import type { RaceState } from '../../shared/race'
import { NeonRenderer } from '../render/renderer'

type Props = {
  raceRef: MutableRefObject<RaceState>
}

export function GameCanvas({ raceRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<NeonRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new NeonRenderer(canvas)
    rendererRef.current = renderer
    let raf = 0
    const render = () => {
      renderer.update(raceRef.current)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
      rendererRef.current = null
    }
  }, [raceRef])

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Neon Drift 3D race view" />
}
