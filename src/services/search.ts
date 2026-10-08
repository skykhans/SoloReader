import type { PagedDocument, ReaderDocument, SearchHit } from '../domain/document'

export interface SearchResultSet {
  hits: SearchHit[]
  total: number
  collected: number
}

export interface SearchProgress {
  completed: number
  total: number
}

const MAX_COLLECTED_HITS = 5000

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 34)
  const end = Math.min(text.length, at + length + 54)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('搜索已取消', 'AbortError')
}

async function pageText(document: PagedDocument, pageNumber: number, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  const cached = document.pageTextCache.get(pageNumber)
  if (cached !== undefined) return cached

  const page = await document.pdf.getPage(pageNumber)
  throwIfAborted(signal)
  const content = await page.getTextContent()
  throwIfAborted(signal)
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  document.pageTextCache.set(pageNumber, text)
  return text
}

function findMatches(text: string, query: string): number[] {
  const haystack = normalized(text)
  const needle = normalized(query)
  const positions: number[] = []
  let offset = 0

  while (offset <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, offset)
    if (found < 0) break
    positions.push(found)
    offset = found + Math.max(1, needle.length)
  }
  return positions
}

export async function searchDocument(
  document: ReaderDocument,
  query: string,
  signal: AbortSignal,
  onProgress?: (progress: SearchProgress) => void,
): Promise<SearchResultSet> {
  const cleanQuery = query.trim()
  if (!cleanQuery) return { hits: [], total: 0, collected: 0 }

  const hits: SearchHit[] = []
  let total = 0

  if (document.kind === 'reflow') {
    for (let sectionIndex = 0; sectionIndex < document.sections.length; sectionIndex += 1) {
      throwIfAborted(signal)
      const section = document.sections[sectionIndex]
      const matches = findMatches(section.text, cleanQuery)
      total += matches.length

      for (const [occurrence, position] of matches.entries()) {
        if (hits.length >= MAX_COLLECTED_HITS) break
        hits.push({
          id: `search-${section.id}-${position}`,
          label: section.title,
          snippet: snippet(section.text, position, cleanQuery.length),
          locator: {
            kind: 'reflow',
            sectionId: section.id,
            ratio: section.text.length ? position / section.text.length : 0,
          },
          query: cleanQuery,
          occurrence,
        })
      }

      onProgress?.({ completed: sectionIndex + 1, total: document.sections.length })
      if (sectionIndex % 20 === 19) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      throwIfAborted(signal)
    }
  } else {
    for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
      throwIfAborted(signal)
      const text = await pageText(document, pageNumber, signal)
      throwIfAborted(signal)
      const matches = findMatches(text, cleanQuery)
      total += matches.length

      for (const [occurrence, position] of matches.entries()) {
        if (hits.length >= MAX_COLLECTED_HITS) break
        hits.push({
          id: `search-page-${pageNumber}-${position}`,
          label: `第 ${pageNumber} 页`,
          snippet: snippet(text, position, cleanQuery.length),
          locator: {
            kind: 'paged',
            page: pageNumber,
            ratio: 0,
            scale: 1.2,
            rotation: 0,
          },
          query: cleanQuery,
          occurrence,
        })
      }

      onProgress?.({ completed: pageNumber, total: document.pageCount })
      if (pageNumber % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      throwIfAborted(signal)
    }
  }

  throwIfAborted(signal)
  return { hits, total, collected: hits.length }
}
