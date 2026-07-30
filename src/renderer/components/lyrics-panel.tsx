import { useEffect, useRef, useState } from 'react'
import type { LyricsLine } from '../../shared/types'
import { api } from '../api'
import { usePlayer } from '../store'

export function LyricsPanel() {
  const { selected, position, setTracks, replaceSelected } = usePlayer()
  const input = useRef<HTMLInputElement>(null)
  const [lines, setLines] = useState<LyricsLine[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (selected) void api.lyrics.get(selected.id).then(setLines) }, [selected?.id])
  if (!selected) return null

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.lyrics.update(selected.id, lines)
      setTracks(usePlayer.getState().tracks.map((track) => track.id === updated.id ? updated : track))
      replaceSelected(updated)
    } finally { setSaving(false) }
  }
  const updateText = (text: string) => {
    const values = text.split(/\r?\n/)
    const step = 1 / Math.max(1, values.length)
    setLines(values.map((textLine, index) => ({ id: lines[index]?.id ?? `line-${index + 1}`, text: textLine, start: index * step, end: (index + 1) * step })))
  }
  const importLyrics = async (file?: File) => {
    if (!file) return
    updateText(await file.text())
  }
  const current = lines.find((line) => position >= line.start && position < line.end)
  return <section className="panel lyrics-panel"><div className="section-heading"><div><span className="eyebrow">LETRAS</span><h2>{current?.text || 'Nenhuma linha sincronizada'}</h2></div><div className="lyrics-actions"><button className="secondary-button" onClick={() => input.current?.click()}>Importar .txt</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar letra'}</button></div></div><input ref={input} hidden type="file" accept="text/plain,.txt" onChange={(event) => void importLyrics(event.target.files?.[0])} /><textarea className="lyrics-editor" value={lines.map((line) => line.text).join('\n')} placeholder="Cole ou digite uma linha por vez…" onChange={(event) => updateText(event.target.value)} /><small className="lyrics-help">As linhas são distribuídas automaticamente pela duração da faixa.</small></section>
}
