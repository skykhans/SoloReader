import type { DocumentAdapter, DocumentMeta, OutlineItem, ReaderDocument } from '../domain/document'
import { DocumentFormatError, DocumentParseError } from './errors'
import { makeReflowSection, sanitizeReflowHtml, sectionId } from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'
import { readZipEntries } from '../utils/zip'

const textDecoder = new TextDecoder('utf-8', { fatal: true })

function decode(bytes: Uint8Array, name: string): string {
  try {
    return textDecoder.decode(bytes)
  } catch (error) {
    throw new DocumentParseError(`无法读取 EPUB 文件：${name}`, { cause: error })
  }
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function resolvePath(base: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#', 1)[0].split('?', 1)[0])
  return normalizePath(`${base}/${cleanHref}`)
}

function elementsByName(document: Document, name: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter((element) => element.localName === name)
}

function createOutline(root: Element, target: string, sequence: { value: number }): OutlineItem[] {
  const outline: OutlineItem[] = []
  for (const heading of Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
    const title = heading.textContent?.trim()
    if (!title) continue
    sequence.value += 1
    const anchorId = `heading-epub-${String(sequence.value).padStart(6, '0')}`
    heading.id = anchorId
    outline.push({
      id: `outline-epub-${String(sequence.value).padStart(6, '0')}`,
      title,
      level: Number.parseInt(heading.tagName.slice(1), 10),
      target,
      anchorId,
    })
  }
  return outline
}

export class EpubDocumentAdapter implements DocumentAdapter {
  readonly format = 'epub' as const
  readonly extensions = ['.epub'] as const

  supports(file: File): boolean {
    return file.name.toLowerCase().endsWith('.epub')
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const entries = await readZipEntries(file)
    const containerBytes = entries.get('META-INF/container.xml')
    if (!containerBytes) throw new DocumentFormatError('EPUB 缺少 META-INF/container.xml')

    const container = new DOMParser().parseFromString(decode(containerBytes, 'META-INF/container.xml'), 'application/xml')
    const rawOpfPath = elementsByName(container, 'rootfile')[0]?.getAttribute('full-path')
    const opfPath = rawOpfPath ? normalizePath(rawOpfPath) : undefined
    if (!opfPath) throw new DocumentFormatError('EPUB 缺少 OPF 根文件')
    const opfBytes = entries.get(opfPath)
    if (!opfBytes) throw new DocumentFormatError(`EPUB 找不到 OPF 文件：${opfPath}`)

    const opf = new DOMParser().parseFromString(decode(opfBytes, opfPath), 'application/xml')
    const basePath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
    const manifest = new Map<string, { path: string; mediaType: string }>()
    for (const item of elementsByName(opf, 'item')) {
      const id = item.getAttribute('id')
      const href = item.getAttribute('href')
      if (id && href) manifest.set(id, {
        path: resolvePath(basePath, href),
        mediaType: item.getAttribute('media-type') ?? '',
      })
    }

    const sections = []
    const outline: OutlineItem[] = []
    const headingSequence = { value: 0 }
    const spine = elementsByName(opf, 'itemref')
    for (const itemRef of spine) {
      const idref = itemRef.getAttribute('idref')
      const item = idref ? manifest.get(idref) : undefined
      if (!item || !['application/xhtml+xml', 'text/html'].includes(item.mediaType)) continue
      const chapterBytes = entries.get(item.path)
      if (!chapterBytes) continue

      const safeDocument = sanitizeReflowHtml(decode(chapterBytes, item.path), { wholeDocument: true })
      const parsed = new DOMParser().parseFromString(safeDocument, 'text/html')
      const root = parsed.querySelector('article') ?? parsed.querySelector('main') ?? parsed.body
      const id = sectionId(this.format, sections.length)
      outline.push(...createOutline(root, id, headingSequence))
      const title = root.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim()
        || item.path.split('/').at(-1)?.replace(/\.[^.]+$/, '')
        || meta.title
      sections.push(makeReflowSection(id, title, sanitizeReflowHtml(root.innerHTML)))
    }

    if (!sections.length) throw new DocumentParseError('EPUB 没有可阅读的正文章节')
    const title = elementsByName(opf, 'title')[0]?.textContent?.trim() || meta.title
    return {
      kind: 'reflow',
      meta: { ...meta, title },
      sections,
      outline: outline.length ? outline : [{ id: 'outline-epub-000001', title, level: 1, target: sections[0].id }],
    }
  }
}
