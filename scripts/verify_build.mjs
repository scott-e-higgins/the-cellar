import { readFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'

const html = await readFile('dist/index.html', 'utf8')
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'))
const css = await readFile((await import('node:path')).join('dist', htmlAsset(html, 'css')), 'utf8')

function htmlAsset(source, extension) {
  const match = source.match(new RegExp(`(?:href|src)="([^"]+\\.${extension})"`))
  if (!match) throw new Error(`No ${extension} asset found in built HTML`)
  return match[1].replace(/^\.\//, '')
}

if (manifest.display !== 'standalone') throw new Error('PWA must use standalone display mode')
if (!manifest.icons?.some((icon) => icon.sizes === '192x192')) throw new Error('Missing 192px PWA icon')
if (!manifest.icons?.some((icon) => icon.sizes === '512x512')) throw new Error('Missing 512px PWA icon')
if (!css.includes('safe-area-inset-bottom')) throw new Error('Bottom navigation is not safe-area aware')
if (!css.includes('prefers-reduced-motion')) throw new Error('Reduced-motion support is missing')
if (!html.includes('theme-color')) throw new Error('Theme color metadata is missing')
await Promise.all(['dist/sw.js','dist/icon-192.png','dist/icon-512.png'].map(stat))
console.log('PWA build verification passed')
