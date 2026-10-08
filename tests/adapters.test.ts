import { describe, expect, it, vi } from 'vitest'
import {
  DocumentAdapterRegistry,
  DocumentEncodingError,
  DocumentFormatError,
  HtmlDocumentAdapter,
  MarkdownDocumentAdapter,
  PdfDocumentAdapter,
  TxtDocumentAdapter,
} from '../src/adapters'
import type { DocumentFormat, DocumentMeta } from '../src/domain/document'
import { assertPdfSignature, decodeText } from '../src/utils/document-content'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PasswordResponses: {
    NEED_PASSWORD: 1,
    INCORRECT_PASSWORD: 2,
  },
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.test.mjs' }))

function meta(file: File, format: DocumentFormat): DocumentMeta {
  return {
    id: `test-${format}`,
    title: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    format,
    size: file.size,
    lastModified: file.lastModified,
    openedAt: 1,
  }
}

describe('文本编码', () => {
  it('识别 UTF-8 BOM 和严格 UTF-8', () => {
    const encoded = new TextEncoder().encode('正文')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded])
    expect(decodeText(bytes)).toEqual({ text: '正文', encoding: 'utf-8' })
    expect(decodeText(encoded)).toEqual({ text: '正文', encoding: 'utf-8' })
  })

  it('在 UTF-8 失败后严格解码 GB18030', () => {
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
    expect(decodeText(bytes)).toEqual({ text: '你好', encoding: 'gb18030' })
  })

  it('不会用替换字符吞掉无效编码', () => {
    expect(() => decodeText(new Uint8Array([0x81]))).toThrow(DocumentEncodingError)
  })
})

describe('TXT adapter', () => {
  it('按章节切分并为重复标题生成唯一内部 ID', async () => {
    const file = new File(
      ['序言\n第1章初见\n第一段\n第1章 初见\n第二段'],
      'novel.txt',
      { type: 'text/plain' },
    )
    const document = await new TxtDocumentAdapter().open(file, meta(file, 'txt'))
    expect(document.kind).toBe('reflow')
    if (document.kind !== 'reflow') return

    expect(document.sections.map((section) => section.title)).toEqual([
      'novel',
      '第1章初见',
      '第1章 初见',
    ])
    expect(new Set(document.sections.map((section) => section.id)).size).toBe(3)
    expect(new Set(document.outline.map((item) => item.id)).size).toBe(2)
  })
})

describe('Markdown adapter', () => {
  it('禁用原生 HTML，并净化危险 URL 和远程图片', async () => {
    const file = new File(
      ['# 标题\n<script>alert(1)</script>\n[x](javascript:alert(1))\n![remote](https://example.com/a.png)'],
      'notes.md',
      { type: 'text/markdown' },
    )
    const document = await new MarkdownDocumentAdapter().open(file, meta(file, 'markdown'))
    expect(document.kind).toBe('reflow')
    if (document.kind !== 'reflow') return

    const html = document.sections[0].html
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/href\s*=\s*["']javascript:/i)
    expect(html).not.toContain('https://example.com/a.png')
    expect(document.outline[0]).toMatchObject({ title: '标题', level: 1 })
  })
})

describe('HTML adapter', () => {
  it('优先提取 article，并移除脚本、事件、远程资源和危险 URL', async () => {
    const source = `<!doctype html><html><head><title>测试文档</title></head><body>
      <main><p>不应选中</p></main>
      <article onclick="alert(1)"><h1 id="same">正文</h1><p>保留内容</p>
      <img src="https://example.com/tracker.png"><a href="javascript:alert(1)">危险链接</a>
      <script>alert(1)</script></article></body></html>`
    const file = new File([source], 'article.html', { type: 'text/html' })
    const document = await new HtmlDocumentAdapter().open(file, meta(file, 'html'))
    expect(document.kind).toBe('reflow')
    if (document.kind !== 'reflow') return

    const html = document.sections.map((section) => section.html).join('')
    expect(document.meta.title).toBe('测试文档')
    expect(html).toContain('保留内容')
    expect(html).not.toContain('不应选中')
    expect(html).not.toMatch(/onclick|<script|tracker\.png|javascript:/i)
    expect(document.outline[0]).toMatchObject({ title: '正文', target: document.sections[0].id })
  })

  it('拒绝只有扩展名、没有 HTML 签名的文件', async () => {
    const file = new File(['普通文本'], 'fake.html', { type: 'text/html' })
    await expect(new HtmlDocumentAdapter().open(file, meta(file, 'html'))).rejects.toThrow(
      DocumentFormatError,
    )
  })
})

describe('PDF adapter', () => {
  it('校验 PDF 文件签名', async () => {
    expect(() => assertPdfSignature(new TextEncoder().encode('%PDF-1.7'))).not.toThrow()
    const file = new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' })
    await expect(new PdfDocumentAdapter().open(file, meta(file, 'pdf'))).rejects.toThrow(
      DocumentFormatError,
    )
  })
})

describe('DocumentAdapterRegistry', () => {
  it('拒绝未知扩展名和重复注册', () => {
    const txt = new TxtDocumentAdapter()
    const registry = new DocumentAdapterRegistry([txt])
    expect(() => registry.find(new File(['x'], 'book.epub'))).toThrow(DocumentFormatError)
    expect(() => new DocumentAdapterRegistry([txt, new TxtDocumentAdapter()])).toThrow(
      /格式重复/,
    )
  })
})
