import { useEffect } from 'react'
import { usePlayer } from '../store'

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
}

export function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const state = usePlayer.getState()
      const step = event.shiftKey ? 0.01 : 0.05

      switch (event.key.toLowerCase()) {
        case ' ':
          if (!state.selected) return
          event.preventDefault()
          window.dispatchEvent(new Event('griffin:toggle-play'))
          break
        case 'arrowleft':
          event.preventDefault()
          state.seekTo(Math.max(0, state.position - step))
          break
        case 'arrowright':
          event.preventDefault()
          state.seekTo(Math.min(1, state.position + step))
          break
        case 'home':
          event.preventDefault()
          state.seekTo(0)
          break
        case 'l':
          event.preventDefault()
          state.setLoopEnabled(!state.loopEnabled)
          break
        case 'a':
          event.preventDefault()
          state.setLoopStart(state.position)
          break
        case 'b':
          event.preventDefault()
          state.setLoopEnd(state.position)
          break
        case 'm':
          event.preventDefault()
          state.toggleMuteAll()
          break
        case '[':
          event.preventDefault()
          state.setTempo(Math.max(0.5, state.tempo - 0.05))
          break
        case ']':
          event.preventDefault()
          state.setTempo(Math.min(1.5, state.tempo + 0.05))
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
