import {
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  DocumentAdapter,
  DocumentMeta,
  OutlineItem,
  ReaderDocument,
} from '../domain/document'
import { assertPdfSignature } from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'
import { DocumentParseError, PdfPasswordError } from './errors'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfOutline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
type PdfOutlineItem = PdfOutline[number]

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

async function destroyAfterFailure(
  loadingTask: PDFDocumentLoadingTask,
  originalError: unknown,
): Promise<never> {
  try {
    await loadingTask.destroy()
  } catch (destroyError) {
    throw new AggregateError(
      [asError(originalError), asError(destroyError)],
      'PDF 打开失败，且解析任务清理失败',
    )
  }
  throw originalError
}

async function outlineTarget(
  pdf: PDFDocumentProxy,
  item: PdfOutlineItem,
): Promise<string | number | null> {
  let destination = item.dest
  if (typeof destination === 'string') {
    const resolved = await pdf.getDestination(destination)
    if (!resolved) return null
    destination = resolved
  }

  if (!Array.isArray(destination) || destination.length === 0) {
    return null
  }

  if (typeof destination[0] === 'number') {
    return destination[0] + 1
  }

  const reference = destination[0] as Parameters<PDFDocumentProxy['getPageIndex']>[0]
  if (typeof reference === 'number') return reference + 1
  return (await pdf.getPageIndex(reference)) + 1
}

async function extractOutline(pdf: PDFDocumentProxy): Promise<OutlineItem[]> {
  const source = await pdf.getOutline()
  if (!source) return []

  const result: OutlineItem[] = []
  let sequence = 0

  const walk = async (items: PdfOutline, level: number): Promise<void> => {
    for (const item of items) {
      const title = item.title.trim()
      const target = await outlineTarget(pdf, item)
      const hasNavigableEntry = Boolean(title) && target !== null
      if (hasNavigableEntry) {
        sequence += 1
        result.push({
          id: `outline-pdf-${String(sequence).padStart(6, '0')}`,
          title,
          level,
          target,
        })
      }
      if (item.items.length > 0) {
        await walk(item.items, hasNavigableEntry ? level + 1 : level)
      }
    }
  }

  await walk(source, 1)
  return result
}

export class PdfDocumentAdapter implements DocumentAdapter {
  readonly format = 'pdf' as const
  readonly extensions = ['.pdf'] as const

  supports(file: File): boolean {
    return file.name.toLowerCase().endsWith('.pdf')
  }

  open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    return this.openWithPassword(file, meta)
  }

  async openWithPassword(
    file: File,
    meta: DocumentMeta,
    password?: string,
  ): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const bytes = new Uint8Array(await file.arrayBuffer())
    assertPdfSignature(bytes)

    const loadingTask = getDocument({
      data: bytes,
      password,
    })
    let rejectPassword!: (error: PdfPasswordError) => void
    const passwordFailure = new Promise<never>((_resolve, reject) => {
      rejectPassword = reject
    })
    loadingTask.onPassword = (_updatePassword: (value: string) => void, reason: number) => {
      rejectPassword(
        new PdfPasswordError(
          reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required',
        ),
      )
    }
    const pdf = await Promise.race([loadingTask.promise, passwordFailure]).catch(async (error) => {
      try {
        await loadingTask.destroy()
      } catch (destroyError) {
        throw new AggregateError(
          [asError(error), asError(destroyError)],
          'PDF 打开失败，且解析任务清理失败',
        )
      }
      if (error instanceof PdfPasswordError) throw error
      throw new DocumentParseError(`无法打开 PDF：${asError(error).message}`, {
        cause: asError(error),
      })
    })

    const outline = await extractOutline(pdf).catch((error) =>
      destroyAfterFailure(loadingTask, error),
    )

    return {
      kind: 'paged',
      meta,
      loadingTask,
      pdf,
      pageCount: pdf.numPages,
      outline,
      pageTextCache: new Map<number, string>(),
    }
  }
}