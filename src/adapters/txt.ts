import type {
  DocumentAdapter,
  DocumentMeta,
  OutlineItem,
  ReaderDocument,
  ReflowSection,
} from '../domain/document'
import { assertFileExtension } from '../utils/document-file'
import {
  escapeHtml,
  makeReflowSection,
  normalizeText,
  readTextFile,
  sanitizeReflowHtml,
  sectionId,
} from '../utils/document-content'

const CHAPTER_HEADING = /^(?:第[零〇一二两三四五六七八九十百千万0-9]+[章节回卷部篇集]|卷[零〇一二两三四五六七八九十百千万0-9]+|chapter\s+[0-9ivxlcdm]+)[\s：:、.]?.{0,72}$/i

interface TextPart {
  title: string
  lines: string[]
  isChapter: boolean
}

function splitText(text: string, documentTitle: string): TextPart[] {
  const lines = normalizeText(text).split('\n')
  const parts: TextPart[] = []
  let current: TextPart = { title: documentTitle, lines: [], isChapter: false }

  for (const line of lines) {
    const candidate = line.trim()
    if (candidate && CHAPTER_HEADING.test(candidate)) {
      if (current.lines.some((item) => item.trim()) || current.isChapter) {
        parts.push(current)
      }
      current = { title: candidate, lines: [], isChapter: true }
      continue
    }
    current.lines.push(line)
  }

  if (current.lines.some((item) => item.trim()) || current.isChapter || parts.length === 0) {
    parts.push(current)
  }
  return parts
}

function textPartHtml(part: TextPart): string {
  const heading = part.isChapter ? `<h2>${escapeHtml(part.title)}</h2>` : ''
  const paragraphs = part.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
  return sanitizeReflowHtml(`${heading}${paragraphs}`)
}

export class TxtDocumentAdapter implements DocumentAdapter {
  readonly format = 'txt' as const
  readonly extensions = ['.txt'] as const

  supports(file: File): boolean {
    return this.extensions.some((extension) => file.name.toLowerCase().endsWith(extension))
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const { text } = await readTextFile(file)
    const parts = splitText(text, meta.title)
    const sections: ReflowSection[] = []
    const outline: OutlineItem[] = []

    parts.forEach((part, index) => {
      const id = sectionId(this.format, index)
      sections.push(makeReflowSection(id, part.title, textPartHtml(part)))
      if (part.isChapter || parts.length === 1) {
        outline.push({
          id: `outline-txt-${String(outline.length + 1).padStart(6, '0')}`,
          title: part.title,
          level: 1,
          target: id,
        })
      }
    })

    return { kind: 'reflow', meta, sections, outline }
  }
}
