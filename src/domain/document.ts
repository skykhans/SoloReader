import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
export type DocumentKind = 'reflow' | 'paged'
export type DocumentFormat = 'txt' | 'markdown' | 'html' | 'rtf' | 'epub' | 'docx' | 'pdf'

export interface DocumentMeta {
  id: string
  title: string
  fileName: string
  format: DocumentFormat
  size: number
  lastModified: number
  openedAt: number
}

export interface OutlineItem {
  id: string
  title: string
  level: number
  target: string | number
  anchorId?: string
}

export interface ReflowSection {
  id: string
  title: string
  html: string
  text: string
  wordCount: number
}

export interface ReflowDocument {
  kind: 'reflow'
  meta: DocumentMeta
  sections: ReflowSection[]
  outline: OutlineItem[]
}

export interface PagedDocument {
  kind: 'paged'
  meta: DocumentMeta
  loadingTask: PDFDocumentLoadingTask
  pdf: PDFDocumentProxy
  pageCount: number
  outline: OutlineItem[]
  pageTextCache: Map<number, string>
}

export type ReaderDocument = ReflowDocument | PagedDocument
export type ReaderLocator =
  | { kind: 'reflow'; sectionId: string; ratio: number; anchorId?: string }
  | { kind: 'paged'; page: number; ratio: number; scale: number; rotation: number }

export interface SearchHit {
  id: string
  label: string
  snippet: string
  locator: ReaderLocator
  query: string
  occurrence: number
}

export interface BookmarkRecord {
  id: string
  documentId: string
  label: string
  excerpt: string
  locator: ReaderLocator
  createdAt: number
}

export interface PositionRecord {
  documentId: string
  locator: ReaderLocator
  updatedAt: number
}

export interface StoredDocument {
  meta: DocumentMeta
  blob: Blob
}

export interface ReaderSettings {
  theme: 'light' | 'paper' | 'green' | 'dark'
  fontFamily: 'serif' | 'kai' | 'sans'
  fontSize: number
  lineHeight: number
  contentWidth: number
  paragraphGap: number
  indent: boolean
  autoScrollSpeed: number
}

export interface DocumentAdapter {
  readonly format: DocumentFormat
  readonly extensions: readonly string[]
  supports(file: File): boolean
  open(file: File, meta: DocumentMeta): Promise<ReaderDocument>
}
