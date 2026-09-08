import { optimizePhoto } from './photo-optimize'
import type { supabase } from './supabase'
import { createUniqueId } from './unique-id'
import { validatePhoto } from './user-error'

// A task owns one immutable photo ID/path, even after a lost response.
// Retrying this task cannot create another photo or mutate its parent record.
export function createPhotoUpload(client: NonNullable<typeof supabase>, file: File, householdId: string, folder: string, parent: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  validatePhoto(file)
  const id = createUniqueId()
  const path = `${householdId}/${folder}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  let uploaded = false
  let prepared: Promise<File> | undefined
  return async () => {
    const image = await (prepared ??= optimizePhoto(file))
    if (!uploaded) {
      const result = await client.storage.from('cellar-photos').upload(path, image, { contentType: image.type, upsert: false })
      // A previous attempt may have uploaded successfully but lost its response.
      if (result.error) {
        const exists = String(result.error.statusCode) === '409'
          || ['ResourceAlreadyExists', 'KeyAlreadyExists', 'Duplicate'].includes(String((result.error as { code?: string }).code))
          || result.error.message === 'The resource already exists'
        if (!exists) throw result.error
      }
      uploaded = true
    }
    const result = await client.from('photos').upsert({ id, household_id: householdId, ...parent, ...metadata, storage_path: path, original_filename: file.name, mime_type: image.type, file_size_bytes: image.size }, { onConflict: 'id', ignoreDuplicates: true })
    if (result.error) throw result.error
  }
}
