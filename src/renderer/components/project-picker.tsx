import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'

export function ProjectPicker() {
  const { projects, activeProjectId, setProjects, setActiveProject } = usePlayer()
  const loaded = useRef(false)
  const [busy, setBusy] = useState(false)

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

  return <section className="project-picker" aria-label="Projetos">
    <div className="project-picker-heading"><span>PROJETO ATUAL</span><button title="Criar projeto" aria-label="Criar projeto" disabled={busy} onClick={() => void createProject()}>＋</button></div>
    <select value={activeProjectId ?? ''} disabled={busy || projects.length === 0} onChange={(event) => setActiveProject(event.target.value)}>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    <div className="project-picker-actions">
      <button disabled={busy || projects.length === 0} onClick={() => void renameProject()}>Renomear</button>
      <button disabled={busy || projects.length < 2} onClick={() => void removeProject()}>Remover</button>
    </div>
  </section>
}
