export function restoredManagementStack<T>(overlay?: { type?: string; stack?: T[]; underlayStack?: T[] } | null): T[] {
  if (overlay?.type === 'management') return overlay.stack ?? []
  if (overlay?.type === 'action') return overlay.underlayStack ?? []
  return []
}
