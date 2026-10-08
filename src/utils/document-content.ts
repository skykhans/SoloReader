import DOMPurify from 'dompurify'
import type { DocumentFormat, ReflowSection } from '../domain/document'
import { DocumentEncodingError, DocumentFormatError } from '../adapters/errors'

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const SAFE_TAGS = [
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
] as const

const SAFE_ATTRIBUTES = [
  'alt',
  'colspan',
  'datetime',
  'decoding',
  'dir',
  'height',
  'href',
  'id',
  'lang',
  'loading',
  'reversed',
  'rowspan',
  'span',
  'start',
  'title',
  'width',
  'src',
] as const

const SAFE_DATA_IMAGE = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i
const SAFE_LINK = /^(?:https?:|mailto:|tel:)/i

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function assertNotBinary(bytes: Uint8Array): void {
  const sample = bytes.subarray(0, Math.min(bytes.length, 65_536))
  let controlBytes = 0

  for (const byte of sample) {
    if (byte === 0) {
      throw new DocumentEncodingError('文件包含 NUL 字节，不是受支持的纯文本编码')
    }
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlBytes += 1
    }
  }

  if (sample.length > 0 && controlBytes / sample.length > 0.02) {
    throw new DocumentEncodingError('文件包含过多二进制控制字节，无法按文本打开')
  }
}

function decode(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}

export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'gb18030'
}

export function decodeText(bytes: Uint8Array): DecodedText {
  if (hasPrefix(bytes, [0xff, 0xfe]) || hasPrefix(bytes, [0xfe, 0xff])) {
    throw new DocumentEncodingError('暂不支持 UTF-16 文本，请先转换为 UTF-8 或 GB18030')
  }

  assertNotBinary(bytes)

  if (hasPrefix(bytes, UTF8_BOM)) {
    try {
      return { text: decode(bytes.subarray(UTF8_BOM.length), 'utf-8'), encoding: 'utf-8' }
    } catch (error) {
      throw new DocumentEncodingError('UTF-8 BOM 文件包含无效字节序列', {
        cause: asError(error),
      })
    }
  }

  let utf8Error: Error
  try {
    return { text: decode(bytes, 'utf-8'), encoding: 'utf-8' }
  } catch (error) {
    utf8Error = asError(error)
  }

  try {
    return { text: decode(bytes, 'gb18030'), encoding: 'gb18030' }
  } catch (error) {
    throw new DocumentEncodingError('文本既不是严格 UTF-8，也不是有效 GB18030 编码', {
      cause: new AggregateError([utf8Error, asError(error)], '文本编码检测失败'),
    })
  }
}

export async function readTextFile(file: File): Promise<DecodedText> {
  return decodeText(new Uint8Array(await file.arrayBuffer()))
}

export function assertHtmlSignature(source: string | Uint8Array): void {
  const text = typeof source === 'string' ? source : decodeText(source).text
  const sample = text.slice(0, 8192)
  if (!/<(?:!doctype\s+html|html|head|body|title|meta|article|main)(?:\s|>)/i.test(sample)) {
    throw new DocumentFormatError('文件内容缺少可识别的 HTML 文档标记')
  }
}

export function assertPdfSignature(bytes: Uint8Array): void {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024))
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]
  let matched = false

  for (let offset = 0; offset <= sample.length - signature.length; offset += 1) {
    if (signature.every((byte, index) => sample[offset + index] === byte)) {
      matched = true
      break
    }
  }

  if (!matched) {
    throw new DocumentFormatError('文件内容缺少 PDF 签名（%PDF-）')
  }
}

export function normalizeText(text: string): string {
  return text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isSafeLink(href: string): boolean {
  return href.startsWith('#') || SAFE_LINK.test(href)
}

export interface SanitizeHtmlOptions {
  wholeDocument?: boolean
}

export function sanitizeReflowHtml(dirtyHtml: string, options: SanitizeHtmlOptions = {}): string {
  const allowedTags = options.wholeDocument
    ? ['html', 'head', 'title', 'body', ...SAFE_TAGS]
    : [...SAFE_TAGS]

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const attribute = data.attrName.toLowerCase()
    const value = data.attrValue.trim()
    if (attribute === 'src') {
      data.keepAttr = node.nodeName.toLowerCase() === 'img' && SAFE_DATA_IMAGE.test(value)
    } else if (attribute === 'href') {
      data.keepAttr = isSafeLink(value)
    }
  })

  const sanitized = (() => {
    try {
      return DOMPurify.sanitize(dirtyHtml, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: [...SAFE_ATTRIBUTES],
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: [
          'audio',
          'base',
          'button',
          'canvas',
          'embed',
          'form',
          'frame',
          'frameset',
          'iframe',
          'input',
          'link',
          'math',
          'meta',
          'object',
          'script',
          'select',
          'source',
          'style',
          'svg',
          'textarea',
          'video',
        ],
        FORBID_ATTR: [
          'action',
          'background',
          'formaction',
          'integrity',
          'nonce',
          'ping',
          'poster',
          'srcdoc',
          'srcset',
          'style',
          'usemap',
          'xlink:href',
        ],
        WHOLE_DOCUMENT: options.wholeDocument === true,
      })
    } finally {
      DOMPurify.removeHook('uponSanitizeAttribute')
    }
  })()

  const parsed = new DOMParser().parseFromString(String(sanitized), 'text/html')
  for (const image of parsed.querySelectorAll('img')) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (!SAFE_DATA_IMAGE.test(source)) {
      image.remove()
      continue
    }
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
  }

  for (const anchor of parsed.querySelectorAll('a')) {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (!isSafeLink(href)) {
      anchor.removeAttribute('href')
      continue
    }
    if (!href.startsWith('#')) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }

  if (options.wholeDocument) {
    return `<!doctype html>${parsed.documentElement.outerHTML}`
  }
  return parsed.body.innerHTML
}

export function htmlText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function countWords(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length
}

export function sectionId(format: DocumentFormat, index: number): string {
  return `section-${format}-${String(index + 1).padStart(6, '0')}`
}

export function makeReflowSection(id: string, title: string, html: string): ReflowSection {
  const text = htmlText(html)
  return {
    id,
    title,
    html,
    text,
    wordCount: countWords(text),
  }
}
