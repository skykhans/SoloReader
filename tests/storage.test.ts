import 'fake-indexeddb/auto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { defaultReaderSettings } from '../src/domain/defaults'
import type {
  BookmarkRecord,
  DocumentMeta,
  PositionRecord,
  ReaderSettings,
  StoredDocument,
} from '../src/domain/document'
import { getReaderDatabase } from '../src/storage/database'
import {
  addBookmark,
  clearReaderSettings,
  deleteBookmark,
  deleteDocument,
  getBookmarks,
  getDocument,
  getPosition,
  getRecentDocuments,
  loadReaderSettings,
  readerSettingsRanges,
  saveDocument,
  savePosition,
  saveReaderSettings,
  SETTINGS_STORAGE_KEY,
  validateReaderSettings,
} from '../src/storage'

function createMeta(id: string, openedAt: number): DocumentMeta {
  return {
    id,
    title: `Book ${id}`,
    fileName: `${id}.txt`,
    format: 'txt',
    size: 4,
    lastModified: 100,
    openedAt,
  }
}

function createDocument(id: string, openedAt: number): StoredDocument {
  return {
    meta: createMeta(id, openedAt),
    blob: new Blob([id], { type: 'text/plain' }),
  }
}

async function clearDatabase(): Promise<void> {
  const database = await getReaderDatabase()
  const transaction = database.transaction(['documents', 'positions', 'bookmarks'], 'readwrite')
  await Promise.all([
    transaction.objectStore('documents').clear(),
    transaction.objectStore('positions').clear(),
    transaction.objectStore('bookmarks').clear(),
  ])
  await transaction.done
}

describe('reader IndexedDB storage', () => {
  beforeEach(() => clearDatabase())

  afterAll(async () => {
    const database = await getReaderDatabase()
    database.close()
  })

  it('persists and retrieves the original document Blob', async () => {
    const source = createDocument('stored', 10)

    await saveDocument(source)

    const stored = await getDocument('stored')
    expect(stored?.meta).toEqual(source.meta)
    expect(stored?.blob).toBeInstanceOf(Blob)
    expect(await stored?.blob.text()).toBe('stored')
  })

  it('returns recent document metadata in descending opened order and honors the limit', async () => {
    await Promise.all([
      saveDocument(createDocument('old', 10)),
      saveDocument(createDocument('newest', 30)),
      saveDocument(createDocument('middle', 20)),
    ])

    expect((await getRecentDocuments(2)).map(({ id }) => id)).toEqual(['newest', 'middle'])
    expect(await getRecentDocuments(0)).toEqual([])
    await expect(getRecentDocuments(-1)).rejects.toThrow(RangeError)
    await expect(getRecentDocuments(1.5)).rejects.toThrow(RangeError)
  })

  it('saves and replaces a document reading position', async () => {
    const first: PositionRecord = {
      documentId: 'positioned',
      locator: { kind: 'reflow', sectionId: 'chapter-1', ratio: 0.25 },
      updatedAt: 10,
    }
    const latest: PositionRecord = {
      documentId: 'positioned',
      locator: { kind: 'reflow', sectionId: 'chapter-2', ratio: 0.75 },
      updatedAt: 20,
    }

    await savePosition(first)
    await savePosition(latest)

    expect(await getPosition('positioned')).toEqual(latest)
    expect(await getPosition('missing')).toBeUndefined()
  })

  it('adds, lists and deletes bookmarks independently for each document', async () => {
    const bookmarks: BookmarkRecord[] = [
      {
        id: 'first',
        documentId: 'book-a',
        label: 'First',
        excerpt: 'Excerpt one',
        locator: { kind: 'reflow', sectionId: 'one', ratio: 0.1 },
        createdAt: 10,
      },
      {
        id: 'second',
        documentId: 'book-a',
        label: 'Second',
        excerpt: 'Excerpt two',
        locator: { kind: 'reflow', sectionId: 'two', ratio: 0.2 },
        createdAt: 20,
      },
      {
        id: 'other',
        documentId: 'book-b',
        label: 'Other',
        excerpt: 'Other book',
        locator: { kind: 'paged', page: 2, ratio: 0.5, scale: 1, rotation: 0 },
        createdAt: 30,
      },
    ]

    await Promise.all(bookmarks.map((bookmark) => addBookmark(bookmark)))

    expect((await getBookmarks('book-a')).map(({ id }) => id)).toEqual(['second', 'first'])
    await deleteBookmark('second')
    expect((await getBookmarks('book-a')).map(({ id }) => id)).toEqual(['first'])
    expect((await getBookmarks('book-b')).map(({ id }) => id)).toEqual(['other'])
  })

  it('surfaces duplicate bookmark errors', async () => {
    const bookmark: BookmarkRecord = {
      id: 'duplicate',
      documentId: 'book-a',
      label: 'Duplicate',
      excerpt: '',
      locator: { kind: 'reflow', sectionId: 'one', ratio: 0 },
      createdAt: 10,
    }

    await addBookmark(bookmark)
    await expect(addBookmark(bookmark)).rejects.toMatchObject({ name: 'ConstraintError' })
  })

  it('deletes a document and its related position and bookmarks atomically', async () => {
    await Promise.all([
      saveDocument(createDocument('deleted', 10)),
      saveDocument(createDocument('kept', 20)),
    ])
    await savePosition({
      documentId: 'deleted',
      locator: { kind: 'reflow', sectionId: 'one', ratio: 0 },
      updatedAt: 10,
    })
    await addBookmark({
      id: 'deleted-mark',
      documentId: 'deleted',
      label: 'Deleted',
      excerpt: '',
      locator: { kind: 'reflow', sectionId: 'one', ratio: 0 },
      createdAt: 10,
    })
    await addBookmark({
      id: 'kept-mark',
      documentId: 'kept',
      label: 'Kept',
      excerpt: '',
      locator: { kind: 'reflow', sectionId: 'one', ratio: 0 },
      createdAt: 10,
    })

    await deleteDocument('deleted')

    expect(await getDocument('deleted')).toBeUndefined()
    expect(await getPosition('deleted')).toBeUndefined()
    expect(await getBookmarks('deleted')).toEqual([])
    expect(await getDocument('kept')).toBeDefined()
    expect((await getBookmarks('kept')).map(({ id }) => id)).toEqual(['kept-mark'])
  })
})

describe('reader settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns an independent copy of defaults when no settings were saved', () => {
    const settings = loadReaderSettings()
    expect(settings).toEqual(defaultReaderSettings)
    expect(settings).not.toBe(defaultReaderSettings)
  })

  it('validates, persists, loads and clears complete settings', () => {
    const settings: ReaderSettings = {
      theme: 'dark',
      fontFamily: 'sans',
      fontSize: readerSettingsRanges.fontSize.max,
      lineHeight: readerSettingsRanges.lineHeight.min,
      contentWidth: readerSettingsRanges.contentWidth.max,
      paragraphGap: readerSettingsRanges.paragraphGap.min,
      indent: false,
      autoScrollSpeed: readerSettingsRanges.autoScrollSpeed.max,
    }

    saveReaderSettings(settings)
    expect(loadReaderSettings()).toEqual(settings)
    clearReaderSettings()
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['unknown theme', { ...defaultReaderSettings, theme: 'blue' }],
    ['unknown font', { ...defaultReaderSettings, fontFamily: 'comic' }],
    ['small font', { ...defaultReaderSettings, fontSize: readerSettingsRanges.fontSize.min - 1 }],
    ['large font', { ...defaultReaderSettings, fontSize: readerSettingsRanges.fontSize.max + 1 }],
    ['fractional font', { ...defaultReaderSettings, fontSize: 18.5 }],
    ['small line height', { ...defaultReaderSettings, lineHeight: readerSettingsRanges.lineHeight.min - 0.1 }],
    ['large line height', { ...defaultReaderSettings, lineHeight: readerSettingsRanges.lineHeight.max + 0.1 }],
    ['infinite line height', { ...defaultReaderSettings, lineHeight: Number.POSITIVE_INFINITY }],
    ['small width', { ...defaultReaderSettings, contentWidth: readerSettingsRanges.contentWidth.min - 1 }],
    ['large width', { ...defaultReaderSettings, contentWidth: readerSettingsRanges.contentWidth.max + 1 }],
    ['fractional width', { ...defaultReaderSettings, contentWidth: 700.5 }],
    ['small paragraph gap', { ...defaultReaderSettings, paragraphGap: readerSettingsRanges.paragraphGap.min - 0.1 }],
    ['large paragraph gap', { ...defaultReaderSettings, paragraphGap: readerSettingsRanges.paragraphGap.max + 0.1 }],
    ['invalid indent', { ...defaultReaderSettings, indent: 'yes' }],
    ['slow auto-scroll', { ...defaultReaderSettings, autoScrollSpeed: readerSettingsRanges.autoScrollSpeed.min - 1 }],
    ['fast auto-scroll', { ...defaultReaderSettings, autoScrollSpeed: readerSettingsRanges.autoScrollSpeed.max + 1 }],
    ['fractional auto-scroll', { ...defaultReaderSettings, autoScrollSpeed: 20.5 }],
    ['missing field', Object.fromEntries(Object.entries(defaultReaderSettings).filter(([key]) => key !== 'theme'))],
    ['unknown field', { ...defaultReaderSettings, extra: true }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateReaderSettings(value)).toThrow()
    expect(() => saveReaderSettings(value as ReaderSettings)).toThrow()
  })

  it('surfaces malformed and invalid persisted settings instead of replacing them', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{broken')
    expect(() => loadReaderSettings()).toThrow(SyntaxError)

    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...defaultReaderSettings, autoScrollSpeed: 0 }),
    )
    expect(() => loadReaderSettings()).toThrow(RangeError)
  })
})
