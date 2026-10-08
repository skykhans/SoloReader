import MarkdownIt from 'markdown-it'
import type {
  DocumentAdapter,
  DocumentMeta,
  OutlineItem,
  ReaderDocument,
  ReflowSection,
} from '../domain/document'
import {
  makeReflowSection,
  normalizeText,
  readTextFile,
  sanitizeReflowHtml,
  sectionId,
} from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
})

type MarkdownToken = ReturnType<MarkdownIt['parse']>[number]

interface MarkdownGroup {
  tokens: MarkdownToken[]
  title: string
  level: number
  hasHeading: boolean
}

function headingText(token: MarkdownToken | undefined): string {
  if (!token) return ''
  if (!token.children) return token.content.trim()
  return token.children
    .filter((child) => ['text', 'code_inline', 'html_inline'].includes(child.type))
    .map((child) => child.content)
    .join('')
    .trim()
}

function groupTokens(tokens: MarkdownToken[], documentTitle: string): MarkdownGroup[] {
  const groups: MarkdownGroup[] = []
  let current: MarkdownGroup = {
    tokens: [],
    title: documentTitle,
    level: 1,
    hasHeading: false,
  }

  tokens.forEach((token, index) => {
    if (token.type === 'heading_open') {
      if (current.tokens.length > 0) {
        groups.push(current)
      }
      const parsedLevel = Number.parseInt(token.tag.slice(1), 10)
      current = {
        tokens: [],
        title: headingText(tokens[index + 1]) || documentTitle,
        level: parsedLevel,
        hasHeading: true,
      }
    }
    current.tokens.push(token)
  })

  if (current.tokens.length > 0 || groups.length === 0) {
    groups.push(current)
  }
  return groups
}

export class MarkdownDocumentAdapter implements DocumentAdapter {
  readonly format = 'markdown' as const
  readonly extensions = ['.md', '.markdown'] as const

  supports(file: File): boolean {
    const fileName = file.name.toLowerCase()
    return this.extensions.some((extension) => fileName.endsWith(extension))
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const { text } = await readTextFile(file)
    const tokens = markdown.parse(normalizeText(text), {})
    const groups = groupTokens(tokens, meta.title)
    const sections: ReflowSection[] = []
    const outline: OutlineItem[] = []

    groups.forEach((group, index) => {
      const id = sectionId(this.format, index)
      const firstHeading = group.tokens.find((token) => token.type === 'heading_open')
      firstHeading?.attrSet('id', `heading-markdown-${String(index + 1).padStart(6, '0')}`)
      const rendered = markdown.renderer.render(group.tokens, markdown.options, {})
      sections.push(makeReflowSection(id, group.title, sanitizeReflowHtml(rendered)))
      if (group.hasHeading || groups.length === 1) {
        outline.push({
          id: `outline-markdown-${String(outline.length + 1).padStart(6, '0')}`,
          title: group.title,
          level: group.level,
          target: id,
        })
      }
    })

    return { kind: 'reflow', meta, sections, outline }
  }
}
