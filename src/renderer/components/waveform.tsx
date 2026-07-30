import { useEffect, useRef } from 'react'
import { usePlayer } from '../store'

export function Waveform() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const position = usePlayer((state) => state.position)
  const seekTo = usePlayer((state) => state.seekTo)
  useEffect(() => {
    const element = canvas.current; if (!element) return
    const ctx = element.getContext('2d'); if (!ctx) return
    const width = element.width = element.clientWidth * 2; const height = element.height = element.clientHeight * 2
    ctx.scale(2, 2); const w = width / 2; const h = height / 2
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#284569'; ctx.lineWidth = 1
    for (let x = 0; x < w; x += 6) { const amp = 7 + Math.abs(Math.sin(x * 0.043)) * 18 + Math.abs(Math.sin(x * 0.13)) * 9; ctx.beginPath(); ctx.moveTo(x, h / 2 - amp); ctx.lineTo(x, h / 2 + amp); ctx.stroke() }
    ctx.fillStyle = '#d4a531'; ctx.fillRect(position * w - 1, 0, 2, h)
  }, [position])
  return <div className="waveform" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); seekTo(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))) }}><canvas ref={canvas} /><div className="wave-labels"><span>0:00</span><span>1:12</span><span>2:24</span><span>3:36</span></div></div>
}
