import { useEffect, useRef } from 'react'
import type { RaceState } from '../../shared/race'
import { NeonRenderer } from '../render/renderer'

type Props = {
  race: RaceState
}

export function GameCanvas({ race }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<NeonRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    rendererRef.current = new NeonRenderer(canvas)
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.update(race)
  })

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Neon Drift 3D race view" />
}

