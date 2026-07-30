export function formatDuration(seconds = 0): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
