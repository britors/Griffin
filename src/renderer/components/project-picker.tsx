import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { playerSnapshot, usePlayer } from '../store'

export function ProjectPicker() {
  const { projects, activeProjectId, setProjects, setActiveProject, applySnapshot } = usePlayer()
  const loaded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void (async () => {
      const existing = await api.projects.list()
      if (existing.length > 0) {
        setProjects(existing)
        return
      }
      const created = await api.projects.create('Meu projeto')
      setProjects([created])
      setActiveProject(created.id)
    })()
  }, [setActiveProject, setProjects])

  const createProject = async () => {
    const name = window.prompt('Nome do projeto', 'Novo projeto')?.trim()
    if (!name) return
    setBusy(true)
    try {
      const project = await api.projects.create(name)
      setProjects([...projects, project])
      setActiveProject(project.id)
    } finally { setBusy(false) }
  }

  const renameProject = async () => {
    const current = projects.find((project) => project.id === activeProjectId)
    if (!current) return
    const name = window.prompt('Novo nome do projeto', current.name)?.trim()
    if (!name || name === current.name) return
    setBusy(true)
    try {
      const updated = await api.projects.rename(current.id, name)
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    } finally { setBusy(false) }
  }

  const removeProject = async () => {
    const current = projects.find((project) => project.id === activeProjectId)
    if (!current || projects.length === 1 || !window.confirm(`Remover o projeto “${current.name}”?`)) return
    setBusy(true)
    try {
      await api.projects.remove(current.id)
      const remaining = projects.filter((project) => project.id !== current.id)
      setProjects(remaining)
      setActiveProject(remaining[0]?.id ?? null)
    } finally { setBusy(false) }
  }

  const saveSnapshot = async () => {
    const current = projects.find((project) => project.id === activeProjectId)
    const name = window.prompt('Nome do snapshot', `Versão ${new Date().toLocaleString('pt-BR')}`)?.trim()
    if (!current || !name) return
    setBusy(true)
    try {
      const updated = await api.projects.createSnapshot(current.id, name, playerSnapshot(usePlayer.getState()))
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    } finally { setBusy(false) }
  }

  const saveProject = async () => {
    if (!activeProjectId) return
    setBusy(true)
    setSaved(false)
    try {
      const updated = await api.projects.updatePlayerState(activeProjectId, playerSnapshot(usePlayer.getState()))
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } finally { setBusy(false) }
  }

  const restoreSnapshot = async (snapshotId: string) => {
    if (!activeProjectId) return
    setBusy(true)
    try { applySnapshot(await api.projects.restoreSnapshot(activeProjectId, snapshotId)) } finally { setBusy(false) }
  }

  const removeSnapshot = async (snapshotId: string) => {
    if (!activeProjectId || !window.confirm('Remover este snapshot?')) return
    setBusy(true)
    try {
      const updated = await api.projects.removeSnapshot(activeProjectId, snapshotId)
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    } finally { setBusy(false) }
  }

  const snapshots = projects.find((project) => project.id === activeProjectId)?.snapshots ?? []

  return <section className="project-picker" aria-label="Projetos">
    <div className="project-picker-heading"><span>PROJETO ATUAL</span><button title="Criar projeto" aria-label="Criar projeto" disabled={busy} onClick={() => void createProject()}>＋</button></div>
    <select value={activeProjectId ?? ''} disabled={busy || projects.length === 0} onChange={(event) => setActiveProject(event.target.value)}>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    <div className="project-picker-actions">
      <button disabled={busy || projects.length === 0} onClick={() => void saveProject()}>Salvar</button>
      <button disabled={busy || projects.length === 0} onClick={() => void renameProject()}>Renomear</button>
      <button disabled={busy || projects.length < 2} onClick={() => void removeProject()}>Remover</button>
    </div>
    {saved && <small className="project-saved" role="status">Projeto salvo</small>}
    <div className="snapshot-heading"><span>SNAPSHOTS</span><button title="Salvar snapshot" aria-label="Salvar snapshot" disabled={busy || projects.length === 0} onClick={() => void saveSnapshot()}>＋</button></div>
    {snapshots.length > 0 && <div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><button disabled={busy} title={`Restaurar ${snapshot.name}`} onClick={() => void restoreSnapshot(snapshot.id)}><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleDateString('pt-BR')} · {Math.round(snapshot.player.tempo * 100)}% · {snapshot.player.pitch > 0 ? '+' : ''}{snapshot.player.pitch} st</small></button><button disabled={busy} aria-label={`Remover ${snapshot.name}`} title="Remover snapshot" onClick={() => void removeSnapshot(snapshot.id)}>×</button></div>)}</div>}
  </section>
}
