import { describe, expect, it } from 'vitest'
import type { ReflowDocument } from '../src/domain/document'
import { searchDocument } from '../src/services/search'

function createDocument(texts: string[]): ReflowDocument {
  return {
    kind: 'reflow',
    meta: {
      id: 'search-document',
      title: 'Search',
      fileName: 'search.txt',
      format: 'txt',
      size: 10,
      lastModified: 1,
      openedAt: 1,
    },
    sections: texts.map((text, index) => ({
      id: `section-${index}`,
      title: `第 ${index + 1} 节`,
      html: `<p>${text}</p>`,
      text,
      wordCount: text.length,
    })),
    outline: [],
  }
}

describe('document search', () => {
  it('collects every match and preserves the total separately from rendering limits', async () => {
    const document = createDocument(['灵草和灵草', '第二株灵草'])
    const result = await searchDocument(document, '灵草', new AbortController().signal)

    expect(result.total).toBe(3)
    expect(result.hits).toHaveLength(3)
    expect(result.hits.map((hit) => hit.label)).toEqual(['第 1 节', '第 1 节', '第 2 节'])
  })

  it('normalizes full-width Latin characters and case', async () => {
    const result = await searchDocument(
      createDocument(['ＡＢＣ abc']),
      'AbC',
      new AbortController().signal,
    )
    expect(result.total).toBe(2)
  })

  it('reports the exact total when only the first 5000 hits are retained', async () => {
    const result = await searchDocument(
      createDocument(['a'.repeat(5002)]),
      'a',
      new AbortController().signal,
    )
    expect(result.total).toBe(5002)
    expect(result.hits).toHaveLength(5000)
    expect(result.collected).toBe(5000)
  })

  it('honors cancellation before scanning', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(searchDocument(createDocument(['正文']), '正文', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
