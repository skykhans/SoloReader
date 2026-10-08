import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { supportedExtensions } from '../domain/defaults'

export async function selectDesktopDocument(): Promise<File | null> {
  const path = await open({
    title: '打开文档',
    multiple: false,
    directory: false,
    filters: [{ name: '阅读文档', extensions: supportedExtensions.map((extension) => extension.slice(1)) }],
  })
  if (path === null) return null
  const bytes = await readFile(path)
  const fileName = path.split(/[\\/]/).at(-1)
  if (!fileName) throw new Error('所选文件没有有效文件名')
  return new File([new Uint8Array(bytes)], fileName)
}

export async function saveDesktopPdf(file: File): Promise<void> {
  const path = await save({
    title: '保存 PDF',
    defaultPath: file.name,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  })
  if (path === null) return
  await writeFile(path, new Uint8Array(await file.arrayBuffer()))
}
