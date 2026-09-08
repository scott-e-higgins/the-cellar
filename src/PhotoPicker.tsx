import { useState, useEffect } from 'react'

export const CELLAR_PHOTO_ACCEPT = 'image/*'

export function PhotoPicker({ name = 'photo', label, hint = 'Take Photo or Choose from Photos', required = false }: { name?: string; label: string; hint?: string; required?: boolean }) {
  const [fileName, setFileName] = useState('')
  const [preview,setPreview]=useState('')
  const [selected,setSelected]=useState<File|null>(null)
  const [previewFailed,setPreviewFailed]=useState(false)
  useEffect(()=>{if(!selected||typeof URL.createObjectURL!=='function'){setPreview('');return};const url=URL.createObjectURL(selected);setPreview(url);setPreviewFailed(false);return()=>URL.revokeObjectURL(url)},[selected])
  return <label className="photo-picker"><span className="photo-picker-icon" aria-hidden="true">📷</span><span><strong>{label}</strong><small>{fileName || hint}</small></span><input name={name} type="file" accept={CELLAR_PHOTO_ACCEPT} required={required} onChange={(event) => {const file=event.currentTarget.files?.[0]??null;setSelected(file);setFileName(file?.name??'')}} />{preview&&!previewFailed&&<img className="selected-photo-preview" src={preview} alt="Selected photo preview" onError={()=>setPreviewFailed(true)} />}{previewFailed&&<small>Preview unavailable for this format. Your selected photo can still be uploaded.</small>}</label>
}
