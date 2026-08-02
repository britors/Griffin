import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { playerSnapshot, usePlayer } from '../store'
import { alertDialog, confirmDialog, promptDialog } from './dialog-store'
import { errorMessage } from '../error-message'
import type { Project, ProjectFolder } from '../../shared/types'

export function ProjectPicker() {
  const { projects, folders, activeProjectId, setTracks, setProjects, setFolders, setActiveProject, applyPlayerState, applySnapshot } = usePlayer()
  const loaded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

  const refresh = async () => {
    const [nextProjects, nextFolders] = await Promise.all([api.projects.list(), api.projects.listFolders()])
    setProjects(nextProjects)
    setFolders(nextFolders)
    return { nextProjects, nextFolders }
  }

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void (async () => {
      try {
        const { nextProjects, nextFolders } = await refresh()
        if (nextProjects.length > 0) return
        const created = await api.projects.create('Meu projeto')
        setProjects([created])
        setFolders(nextFolders)
        setActiveProject(created.id)
      } catch (reason) {
        await alertDialog(errorMessage(reason, 'Não foi possível carregar os projetos.'))
      }
    })()
  }, [])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    try { await operation() } catch (reason) { await alertDialog(errorMessage(reason, 'Não foi possível atualizar o projeto.')) } finally { setBusy(false) }
  }

  const createProject = async () => {
    const name = (await promptDialog('Digite o nome do projeto.', 'Novo projeto', { confirmLabel: 'Criar projeto', inputLabel: 'Nome do projeto' }))?.trim()
    if (!name) return
    await run(async () => {
      const project = await api.projects.create(name)
      const placed = selectedFolderId ? await api.projects.move(project.id, selectedFolderId) : project
      const { nextProjects, nextFolders } = await refresh()
      setProjects(nextProjects)
      setFolders(nextFolders)
      setActiveProject(placed.id)
    })
  }

  const createFolder = async () => {
    const name = (await promptDialog('Digite o nome da pasta.', 'Nova pasta', { confirmLabel: 'Criar pasta', inputLabel: 'Nome da pasta' }))?.trim()
    if (!name) return
    await run(async () => {
      const folder = await api.projects.createFolder(name, selectedFolderId)
      setFolders([...folders, folder])
      setSelectedFolderId(folder.id)
    })
  }

  const renameProject = async () => {
    const current = projects.find((project) => project.id === activeProjectId)
    const name = current && (await promptDialog('Digite o novo nome do projeto.', current.name, { confirmLabel: 'Renomear projeto', inputLabel: 'Nome do projeto' }))?.trim()
    if (!current || !name || name === current.name) return
    await run(async () => {
      const updated = await api.projects.rename(current.id, name)
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    })
  }

  const removeProject = async () => {
    const current = projects.find((project) => project.id === activeProjectId)
    if (!current || !(await confirmDialog(`Remover o projeto “${current.name}”?`, { confirmLabel: 'Remover', tone: 'danger' }))) return
    await run(async () => {
      await api.projects.remove(current.id)
      const remaining = projects.filter((project) => project.id !== current.id)
      setProjects(remaining)
      setActiveProject(remaining[0]?.id ?? null)
    })
  }

  const renameFolder = async (folder: ProjectFolder) => {
    const name = (await promptDialog('Digite o novo nome da pasta.', folder.name, { confirmLabel: 'Renomear pasta', inputLabel: 'Nome da pasta' }))?.trim()
    if (!name || name === folder.name) return
    await run(async () => {
      const updated = await api.projects.renameFolder(folder.id, name)
      setFolders(folders.map((item) => item.id === updated.id ? updated : item))
    })
  }

  const removeFolder = async (folder: ProjectFolder) => {
    if (!(await confirmDialog(`Remover a pasta “${folder.name}”? Os projetos serão movidos para a pasta pai.`, { confirmLabel: 'Remover', tone: 'danger' }))) return
    await run(async () => {
      await api.projects.removeFolder(folder.id)
      setFolders(folders.filter((item) => item.id !== folder.id))
      setProjects(projects.map((project) => project.folderId === folder.id ? { ...project, folderId: folder.parentId } : project))
      if (selectedFolderId === folder.id) setSelectedFolderId(folder.parentId)
    })
  }

  const moveProject = async () => {
    if (!activeProjectId) return
    await run(async () => {
      const updated = await api.projects.move(activeProjectId, selectedFolderId)
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    })
  }

  const saveSnapshot = async () => {
    if (!activeProjectId) return
    const name = (await promptDialog('Digite o nome do snapshot.', `Versão ${new Date().toLocaleString('pt-BR')}`, { confirmLabel: 'Salvar snapshot', inputLabel: 'Nome do snapshot' }))?.trim()
    if (!name) return
    await run(async () => {
      const updated = await api.projects.createSnapshot(activeProjectId, name, playerSnapshot(usePlayer.getState()))
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    })
  }

  const restoreSnapshot = async (snapshotId: string) => {
    if (!activeProjectId) return
    await run(async () => applySnapshot(await api.projects.restoreSnapshot(activeProjectId, snapshotId)))
  }

  const removeSnapshot = async (snapshotId: string) => {
    if (!activeProjectId || !(await confirmDialog('Remover este snapshot?', { confirmLabel: 'Remover', tone: 'danger' }))) return
    await run(async () => {
      const updated = await api.projects.removeSnapshot(activeProjectId, snapshotId)
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
    })
  }

  const saveProject = async (saveAs = false) => {
    if (!activeProjectId) return
    await run(async () => {
      const current = projects.find((project) => project.id === activeProjectId)
      const updated = await (saveAs || !current?.filePath ? api.projects.saveAs(activeProjectId) : api.projects.save(activeProjectId))
      if (!updated) return
      setProjects(projects.map((project) => project.id === updated.id ? updated : project))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    })
  }

  const openProject = async () => {
    await run(async () => {
      const opened = await api.projects.open()
      if (!opened) return
      const [nextTracks] = await Promise.all([api.library.list(), refresh()])
      setTracks(nextTracks)
      setActiveProject(opened.project.id)
      if (opened.project.playerState) applyPlayerState(opened.project.playerState)
      if (opened.missingTracks.length > 0) {
        await alertDialog(`Projeto aberto, mas estas bibliotecas não foram encontradas:\n\n${opened.missingTracks.join('\n')}`)
      }
    })
  }

  const snapshots = projects.find((project) => project.id === activeProjectId)?.snapshots ?? []
  const current = projects.find((project) => project.id === activeProjectId)
  const dirty = Boolean(current && (!current.filePath || current.fileSavedAt !== current.updatedAt || folders.some((folder) => folder.updatedAt > (current.fileSavedAt ?? ''))))
  const projectsIn = (folderId: string | null) => projects.filter((project) => (project.folderId ?? null) === folderId)
  const foldersIn = (parentId: string | null) => folders.filter((folder) => folder.parentId === parentId)

  const renderProject = (project: Project) => <button className={`project-tree-project ${project.id === activeProjectId ? 'active' : ''}`} key={project.id} onClick={() => setActiveProject(project.id)} disabled={busy}>
    <span>♪</span><strong>{project.name}</strong>{project.filePath && <small>✓</small>}
  </button>

  const renderFolder = (folder: ProjectFolder): ReactNode => <div className="project-tree-folder" key={folder.id}>
    <div className={`project-tree-folder-row ${selectedFolderId === folder.id ? 'active' : ''}`}>
      <button onClick={() => setSelectedFolderId(folder.id)} disabled={busy}><span>▸</span><strong>{folder.name}</strong></button>
      <span><button title="Renomear pasta" onClick={() => void renameFolder(folder)} disabled={busy}>✎</button><button title="Remover pasta" onClick={() => void removeFolder(folder)} disabled={busy}>×</button></span>
    </div>
    <div className="project-tree-children">{projectsIn(folder.id).map(renderProject)}{foldersIn(folder.id).map(renderFolder)}</div>
  </div>

  return <section className="project-picker" aria-label="Projetos">
    <div className="project-picker-heading"><span>PROJETOS · {current?.name ?? 'nenhum projeto'}</span><span className={`project-file-status ${dirty ? 'dirty' : ''}`}>{current?.filePath ? (dirty ? 'ALTERAÇÕES NÃO SALVAS' : 'ARQUIVO .GFN') : 'NÃO SALVO'}</span></div>
    <div className="project-toolbar">
      <button disabled={busy} onClick={() => void createProject()}>＋ Projeto</button><button disabled={busy} onClick={() => void createFolder()}>＋ Pasta</button><button disabled={busy} onClick={() => void openProject()}>Abrir .gfn</button><button disabled={busy || !activeProjectId} onClick={() => void saveProject()}>Salvar</button><button disabled={busy || !activeProjectId} onClick={() => void saveProject(true)}>Salvar como</button>
    </div>
    <div className="project-tree" role="tree">
      {projectsIn(null).map(renderProject)}
      {foldersIn(null).map(renderFolder)}
      {projects.length === 0 && <small className="project-tree-empty">Nenhum projeto criado.</small>}
    </div>
    <div className="project-picker-actions"><button disabled={busy || !activeProjectId} onClick={() => void renameProject()}>Renomear</button><button disabled={busy || !activeProjectId} onClick={() => void moveProject()}>Mover para pasta selecionada</button><button disabled={busy || !activeProjectId} onClick={() => void removeProject()}>Remover</button></div>
    {saved && <small className="project-saved" role="status">Projeto .gfn salvo</small>}
    {selectedFolderId && <small className="project-selection">Pasta selecionada: {folders.find((folder) => folder.id === selectedFolderId)?.name}</small>}
    <div className="snapshot-heading"><span>SNAPSHOTS</span><button title="Salvar snapshot" aria-label="Salvar snapshot" disabled={busy || !activeProjectId} onClick={() => void saveSnapshot()}>＋</button></div>
    {snapshots.length > 0 && <div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><button disabled={busy} title={`Restaurar ${snapshot.name}`} onClick={() => void restoreSnapshot(snapshot.id)}><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleDateString('pt-BR')} · {Math.round(snapshot.player.tempo * 100)}% · {snapshot.player.pitch > 0 ? '+' : ''}{snapshot.player.pitch} st</small></button><button disabled={busy} aria-label={`Remover ${snapshot.name}`} title="Remover snapshot" onClick={() => void removeSnapshot(snapshot.id)}>×</button></div>)}</div>}
  </section>
}
