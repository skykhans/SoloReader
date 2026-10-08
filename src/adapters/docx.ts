import type { DocumentAdapter, DocumentMeta, OutlineItem, ReaderDocument } from '../domain/document'
import { DocumentFormatError, DocumentParseError } from './errors'
import { escapeHtml, makeReflowSection, sanitizeReflowHtml, sectionId } from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'
import { readZipEntries } from '../utils/zip'

function localName(element: Element): string {
  return element.localName || element.tagName.split(':').at(-1) || ''
}

function paragraphText(paragraph: Element): string {
  let result = ''
  for (const node of Array.from(paragraph.getElementsByTagName('*'))) {
    const name = localName(node)
    if (name === 't') result += node.textContent ?? ''
    else if (name === 'tab') result += '\t'
    else if (name === 'br' || name === 'cr') result += '\n'
  }
  return result
}

function paragraphStyle(paragraph: Element): string {
  const style = Array.from(paragraph.getElementsByTagName('*')).find((node) => localName(node) === 'pStyle')
  return style?.getAttribute('w:val') || style?.getAttribute('val') || ''
}

export class DocxDocumentAdapter implements DocumentAdapter {
  readonly format = 'docx' as const
  readonly extensions = ['.docx'] as const

  supports(file: File): boolean {
    return file.name.toLowerCase().endsWith('.docx')
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const entries = await readZipEntries(file)
    const documentBytes = entries.get('word/document.xml')
    if (!documentBytes) throw new DocumentFormatError('DOCX 缺少 word/document.xml')

    const source = new TextDecoder('utf-8', { fatal: true }).decode(documentBytes)
    const parsed = new DOMParser().parseFromString(source, 'application/xml')
    const paragraphs = Array.from(parsed.getElementsByTagName('*')).filter((element) => localName(element) === 'p')
    const sections: Array<{ title: string; paragraphs: string[]; level: number }> = []
    let current = { title: meta.title, paragraphs: [] as string[], level: 1 }
    for (const paragraph of paragraphs) {
      const text = paragraphText(paragraph).replace(/\s+/g, ' ').trim()
      if (!text) continue
      const style = paragraphStyle(paragraph)
      const heading = style.match(/^Heading([1-9])$/i)
      if (heading) {
        if (current.paragraphs.length) sections.push(current)
        current = { title: text, paragraphs: [], level: Number.parseInt(heading[1], 10) }
      } else {
        current.paragraphs.push(text)
      }
    }
    if (current.paragraphs.length || sections.length === 0) sections.push(current)
    if (!sections.some((section) => section.paragraphs.length)) {
      throw new DocumentParseError('DOCX 没有可阅读的正文')
    }

    const outline: OutlineItem[] = []
    const reflowSections = sections.map((section, index) => {
      const id = sectionId(this.format, index)
      const heading = section.title !== meta.title
        ? `<h${Math.min(6, Math.max(1, section.level))}>${escapeHtml(section.title)}</h${Math.min(6, Math.max(1, section.level))}>`
        : ''
      if (section.title !== meta.title) {
        outline.push({
          id: `outline-docx-${String(outline.length + 1).padStart(6, '0')}`,
          title: section.title,
          level: section.level,
          target: id,
        })
      }
      const html = sanitizeReflowHtml(`${heading}${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}`)
      return makeReflowSection(id, section.title, html)
    })
    const titleBytes = entries.get('docProps/core.xml')
    const titleDocument = titleBytes
      ? new DOMParser().parseFromString(new TextDecoder('utf-8').decode(titleBytes), 'application/xml')
      : undefined
    const title = titleDocument
      ? Array.from(titleDocument.getElementsByTagName('*')).find((element) => localName(element) === 'title')?.textContent?.trim()
      : undefined
    return {
      kind: 'reflow',
      meta: { ...meta, title: title || meta.title },
      sections: reflowSections,
      outline: outline.length ? outline : [{ id: 'outline-docx-000001', title: meta.title, level: 1, target: reflowSections[0].id }],
    }
  }
}
