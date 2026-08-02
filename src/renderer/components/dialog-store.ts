import { create } from 'zustand'

export type DialogTone = 'default' | 'danger'

export interface DialogRequest {
  kind: 'alert' | 'confirm' | 'prompt'
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
  defaultValue?: string
  placeholder?: string
  inputLabel?: string
}

interface DialogState {
  request: DialogRequest | null
  resolve: ((value: boolean | string | null) => void) | null
}

export const useDialogStore = create<DialogState>(() => ({ request: null, resolve: null }))

type DialogOptions = Omit<DialogRequest, 'kind' | 'message'>

export function confirmDialog(message: string, options?: DialogOptions) {
  return new Promise<boolean>((resolve) => {
    useDialogStore.setState({ request: { kind: 'confirm', message, ...options }, resolve: (value) => resolve(value === true) })
  })
}

export function alertDialog(message: string, options?: DialogOptions) {
  return new Promise<void>((resolve) => {
    useDialogStore.setState({ request: { kind: 'alert', message, ...options }, resolve: () => resolve() })
  })
}

export function promptDialog(message: string, defaultValue = '', options?: DialogOptions) {
  return new Promise<string | null>((resolve) => {
    useDialogStore.setState({ request: { kind: 'prompt', message, defaultValue, ...options }, resolve: (value) => resolve(typeof value === 'string' ? value : null) })
  })
}
