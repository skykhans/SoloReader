import type {
  DocumentAdapter,
  DocumentFormat,
  ReaderDocument,
} from '../domain/document'
import { createDocumentMeta, getFileExtension } from '../utils/document-file'
import { DocumentFormatError } from './errors'
import { DocxDocumentAdapter } from './docx'
import { EpubDocumentAdapter } from './epub'
import { HtmlDocumentAdapter } from './html'
import { MarkdownDocumentAdapter } from './markdown'
import { PdfDocumentAdapter } from './pdf'
import { RtfDocumentAdapter } from './rtf'
import { TxtDocumentAdapter } from './txt'

export class DocumentAdapterRegistry {
  private readonly adapters: readonly DocumentAdapter[]

  constructor(adapters: readonly DocumentAdapter[]) {
    const formats = new Set<DocumentFormat>()
    const extensions = new Set<string>()

    for (const adapter of adapters) {
      if (formats.has(adapter.format)) {
        throw new Error(`文档适配器格式重复：${adapter.format}`)
      }
      formats.add(adapter.format)

      for (const extension of adapter.extensions) {
        const normalized = extension.toLowerCase()
        if (extensions.has(normalized)) {
          throw new Error(`文档适配器扩展名重复：${normalized}`)
        }
        extensions.add(normalized)
      }
    }
    this.adapters = [...adapters]
  }

  find(file: File): DocumentAdapter {
    const matches = this.adapters.filter((adapter) => adapter.supports(file))
    if (matches.length === 0) {
      const extension = getFileExtension(file.name)
      throw new DocumentFormatError(`不支持“${extension || '无扩展名'}”格式的文档`)
    }
    if (matches.length > 1) {
      throw new Error(`文件“${file.name}”匹配了多个文档适配器`)
    }
    return matches[0]
  }

  async open(file: File): Promise<ReaderDocument> {
    const adapter = this.find(file)
    const meta = await createDocumentMeta(file, adapter.format)
    return adapter.open(file, meta)
  }
}

export const documentAdapterRegistry = new DocumentAdapterRegistry([
  new TxtDocumentAdapter(),
  new MarkdownDocumentAdapter(),
  new HtmlDocumentAdapter(),
  new RtfDocumentAdapter(),
  new EpubDocumentAdapter(),
  new DocxDocumentAdapter(),
  new PdfDocumentAdapter(),
])
