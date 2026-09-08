// Retain originals for unsupported formats, small images and failed decodes.
// Never enlarge an image. Keep a readable 2560px long edge for labels/memories.
export async function optimizePhoto(file: File): Promise<File> {
 if(file.size<2*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type) || typeof createImageBitmap!=='function')return file
 let bitmap:ImageBitmap|undefined
 try {
  bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
  const scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
  const ctx=canvas.getContext('2d');if(!ctx)return file
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9))
  return blob && blob.size<file.size ? new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified}) : file
 }catch{return file}finally{bitmap?.close()}
}
