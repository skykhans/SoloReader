import type { ReaderSettings } from './document'

export const defaultReaderSettings: ReaderSettings = {
  theme: 'light',
  fontFamily: 'kai',
  fontSize: 19,
  lineHeight: 1.9,
  contentWidth: 760,
  paragraphGap: 0.9,
  indent: true,
  autoScrollSpeed: 34,
}

export const supportedExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.rtf', '.epub', '.docx', '.pdf'] as const

export const fileAccept = '.txt,.md,.markdown,.html,.htm,.rtf,.epub,.docx,.pdf,text/plain,text/markdown,text/html,application/rtf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf'
