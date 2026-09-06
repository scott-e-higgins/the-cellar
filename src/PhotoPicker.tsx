import { useState } from 'react'

export const CELLAR_PHOTO_ACCEPT = 'image/*'

export function PhotoPicker({ name = 'photo', label, hint = 'Take Photo or Choose from Photos', required = false }: { name?: string; label: string; hint?: string; required?: boolean }) {
  const [fileName, setFileName] = useState('')
  return <label className="photo-picker"><span className="photo-picker-icon" aria-hidden="true">📷</span><span><strong>{label}</strong><small>{fileName || hint}</small></span><input name={name} type="file" accept={CELLAR_PHOTO_ACCEPT} required={required} onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? '')} /></label>
}
