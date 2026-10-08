import type {
  DocumentAdapter,
  DocumentMeta,
  OutlineItem,
  ReaderDocument,
  ReflowSection,
} from '../domain/document'
import { Readability } from '@mozilla/readability'
import {
  assertHtmlSignature,
  decodeText,
  makeReflowSection,
  sanitizeReflowHtml,
  sectionId,
} from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

interface HtmlGroup {
  nodes: Node[]
  title: string
}

function headingLevel(element: Element): number {
  return Number.parseInt(element.tagName.slice(1), 10)
}

function splitRoot(root: Element, documentTitle: string): HtmlGroup[] {
  const groups: HtmlGroup[] = []
  let current: HtmlGroup = {
    nodes: [],
    title: documentTitle,
  }

  for (const node of Array.from(root.childNodes)) {
    if (node instanceof Element && node.matches(HEADING_SELECTOR)) {
      if (current.nodes.length > 0) {
        groups.push(current)
      }
      current = {
        nodes: [],
        title: node.textContent?.trim() || documentTitle,
      }
    }
    current.nodes.push(node.cloneNode(true))
  }

  if (current.nodes.length > 0 || groups.length === 0) {
    groups.push(current)
  }
  return groups
}

export class HtmlDocumentAdapter implements DocumentAdapter {
  readonly format = 'html' as const
  readonly extensions = ['.html', '.htm'] as const

  supports(file: File): boolean {
    const fileName = file.name.toLowerCase()
    return this.extensions.some((extension) => fileName.endsWith(extension))
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { text } = decodeText(bytes)
    assertHtmlSignature(text)
    const safeDocument = sanitizeReflowHtml(text, { wholeDocument: true })
    const parsed = new DOMParser().parseFromString(safeDocument, 'text/html')
    const readabilityResult = new Readability(parsed).parse()
    const extractedDocument = readabilityResult?.content
      ? new DOMParser().parseFromString(sanitizeReflowHtml(readabilityResult.content), 'text/html')
      : parsed
    const root = extractedDocument.querySelector('article')
      ?? extractedDocument.querySelector('main')
      ?? extractedDocument.body
    const extractedTitle = readabilityResult?.title?.trim()
      || parsed.title.trim()
      || root.querySelector('h1')?.textContent?.trim()
    const documentTitle = extractedTitle || meta.title
    const groups = splitRoot(root, documentTitle)
    const sections: ReflowSection[] = []
    const outline: OutlineItem[] = []
    let headingIndex = 0

    groups.forEach((group, index) => {
      const container = parsed.createElement('div')
      container.append(...group.nodes)
      const id = sectionId(this.format, index)

      for (const heading of container.querySelectorAll(HEADING_SELECTOR)) {
        headingIndex += 1
        heading.id = `heading-html-${String(headingIndex).padStart(6, '0')}`
        const title = heading.textContent?.trim()
        if (title) {
          outline.push({
            id: `outline-html-${String(outline.length + 1).padStart(6, '0')}`,
            title,
            level: headingLevel(heading),
            target: id,
            anchorId: heading.id,
          })
        }
      }

      const html = sanitizeReflowHtml(container.innerHTML)
      sections.push(makeReflowSection(id, group.title, html))
    })

    if (outline.length === 0) {
      outline.push({
        id: 'outline-html-000001',
        title: documentTitle,
        level: 1,
        target: sections[0].id,
      })
    }

    return {
      kind: 'reflow',
      meta: { ...meta, title: documentTitle },
      sections,
      outline,
    }
  }
}
