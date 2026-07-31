import { create } from 'zustand'

export type DialogTone = 'default' | 'danger'

export interface DialogRequest {
  kind: 'alert' | 'confirm'
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

interface DialogState {
  request: DialogRequest | null
  resolve: ((value: boolean) => void) | null
}

export const useDialogStore = create<DialogState>(() => ({ request: null, resolve: null }))

type DialogOptions = Omit<DialogRequest, 'kind' | 'message'>

export function confirmDialog(message: string, options?: DialogOptions) {
  return new Promise<boolean>((resolve) => {
    useDialogStore.setState({ request: { kind: 'confirm', message, ...options }, resolve })
  })
}

export function alertDialog(message: string, options?: DialogOptions) {
  return new Promise<void>((resolve) => {
    useDialogStore.setState({ request: { kind: 'alert', message, ...options }, resolve: () => resolve() })
  })
}
