import type { DocumentAdapter, DocumentMeta, OutlineItem, ReaderDocument } from '../domain/document'
import { makeReflowSection, normalizeText, readTextFile, sanitizeReflowHtml, sectionId } from '../utils/document-content'
import { assertFileExtension } from '../utils/document-file'

function parseRtf(source: string): string {
  let output = ''
  let skip = 0
  const groups: boolean[] = []
  let index = 0

  while (index < source.length) {
    const character = source[index]
    if (character === '{') {
      groups.push(skip > 0)
      index += 1
      continue
    }
    if (character === '}') {
      if (groups.pop()) skip -= 1
      index += 1
      continue
    }
    if (character !== '\\') {
      if (skip === 0) output += character
      index += 1
      continue
    }

    index += 1
    const escaped = source[index]
    if (escaped === '\\' || escaped === '{' || escaped === '}') {
      if (skip === 0) output += escaped
      index += 1
      continue
    }
    if (escaped === "'") {
      const hex = source.slice(index + 1, index + 3)
      if (skip === 0 && /^[0-9a-f]{2}$/i.test(hex)) output += String.fromCharCode(Number.parseInt(hex, 16))
      index += 3
      continue
    }
    if (escaped === '*') {
      skip += 1
      index += 1
      continue
    }

    const match = source.slice(index).match(/^([a-z]+)(-?\d+)? ?/i)
    if (!match) {
      index += 1
      continue
    }
    const word = match[1].toLowerCase()
    const number = match[2] ? Number.parseInt(match[2], 10) : undefined
    if (skip === 0) {
      if (word === 'par' || word === 'line') output += '\n'
      else if (word === 'tab') output += '\t'
      else if (word === 'u' && number !== undefined) {
        output += String.fromCharCode(number < 0 ? number + 65536 : number)
        if (source[index + match[0].length] === '?') index += 1
      }
    }
    index += match[0].length
  }

  return output
}

export class RtfDocumentAdapter implements DocumentAdapter {
  readonly format = 'rtf' as const
  readonly extensions = ['.rtf'] as const

  supports(file: File): boolean {
    return file.name.toLowerCase().endsWith('.rtf')
  }

  async open(file: File, meta: DocumentMeta): Promise<ReaderDocument> {
    assertFileExtension(file, this.extensions)
    const { text } = await readTextFile(file)
    const plainText = normalizeText(parseRtf(text)).trim()
    const html = sanitizeReflowHtml(plainText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`)
      .join(''))
    const id = sectionId(this.format, 0)
    const section = makeReflowSection(id, meta.title, html)
    const outline: OutlineItem[] = [{ id: 'outline-rtf-000001', title: meta.title, level: 1, target: id }]
    return { kind: 'reflow', meta, sections: [section], outline }
  }
}
