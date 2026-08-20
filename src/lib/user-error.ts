export function userError(error: unknown, fallback = 'That could not be completed. Please try again.') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return fallback
  if (/failed to fetch|network|load failed|offline/i.test(message)) return 'The connection was interrupted. Check your connection and try again.'
  if (/schema cache|relation .* does not exist|function .* does not exist/i.test(message)) return 'The Cellar is temporarily unavailable while its data connection updates. Please try again shortly.'
  if (/payload too large|file size|too large/i.test(message)) return 'That file is too large. Choose a file smaller than 20 MB.'
  if (/jwt|session|not authenticated|unauthorized/i.test(message)) return 'Your sign-in has expired. Sign in again, then retry.'
  if (/row-level security|permission denied|forbidden/i.test(message)) return 'Your account does not have permission to make that change.'
  return message
}

export function validatePhoto(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That photo is too large. Choose a photo smaller than 20 MB.')
  const supportedExtension = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  if (file.type && !file.type.startsWith('image/') && !supportedExtension) throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo.')
}
