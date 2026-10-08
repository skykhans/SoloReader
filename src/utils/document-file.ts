import type { DocumentFormat, DocumentMeta } from '../domain/document'
import { DocumentFormatError } from '../adapters/errors'

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex < 0 ? '' : fileName.slice(dotIndex).toLowerCase()
}

export function assertFileExtension(file: File, extensions: readonly string[]): void {
  const extension = getFileExtension(file.name)
  if (!extensions.includes(extension)) {
    throw new DocumentFormatError(`文件扩展名“${extension || '无'}”与解析格式不匹配`)
  }
}

export function fileTitle(fileName: string): string {
  const extension = getFileExtension(fileName)
  const title = extension ? fileName.slice(0, -extension.length).trim() : fileName.trim()
  if (!title) {
    throw new DocumentFormatError('文件名中没有可用的文档标题')
  }
  return title
}

export async function hashFile(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法生成文档标识')
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createDocumentMeta(file: File, format: DocumentFormat): Promise<DocumentMeta> {
  const hash = await hashFile(file)
  return {
    id: `document-${format}-${hash}`,
    title: fileTitle(file.name),
    fileName: file.name,
    format,
    size: file.size,
    lastModified: file.lastModified,
    openedAt: Date.now(),
  }
}
