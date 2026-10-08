import type {
  BookmarkRecord,
  DocumentMeta,
  PositionRecord,
  StoredDocument,
} from '../domain/document'
import { getReaderDatabase } from './database'

export async function saveDocument(document: StoredDocument): Promise<void> {
  const database = await getReaderDatabase()
  await database.put('documents', document)
}

export async function getDocument(documentId: string): Promise<StoredDocument | undefined> {
  const database = await getReaderDatabase()
  return database.get('documents', documentId)
}

export async function getRecentDocuments(limit = 20): Promise<DocumentMeta[]> {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('Recent document limit must be a non-negative integer')
  }
  if (limit === 0) {
    return []
  }

  const database = await getReaderDatabase()
  const index = database.transaction('documents').store.index('by-opened-at')
  const result: DocumentMeta[] = []
  let cursor = await index.openCursor(null, 'prev')

  while (cursor && result.length < limit) {
    result.push(cursor.value.meta)
    cursor = await cursor.continue()
  }

  return result
}

export async function deleteDocument(documentId: string): Promise<void> {
  const database = await getReaderDatabase()
  const transaction = database.transaction(['documents', 'positions', 'bookmarks'], 'readwrite')
  const bookmarks = transaction.objectStore('bookmarks')
  const bookmarkIds = await bookmarks.index('by-document-id').getAllKeys(documentId)

  await Promise.all([
    transaction.objectStore('documents').delete(documentId),
    transaction.objectStore('positions').delete(documentId),
    ...bookmarkIds.map((bookmarkId) => bookmarks.delete(bookmarkId)),
  ])
  await transaction.done
}

export async function savePosition(position: PositionRecord): Promise<void> {
  const database = await getReaderDatabase()
  await database.put('positions', position)
}

export async function getPosition(documentId: string): Promise<PositionRecord | undefined> {
  const database = await getReaderDatabase()
  return database.get('positions', documentId)
}

export async function addBookmark(bookmark: BookmarkRecord): Promise<void> {
  const database = await getReaderDatabase()
  await database.add('bookmarks', bookmark)
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const database = await getReaderDatabase()
  await database.delete('bookmarks', bookmarkId)
}

export async function getBookmarks(documentId: string): Promise<BookmarkRecord[]> {
  const database = await getReaderDatabase()
  const bookmarks = await database.getAllFromIndex('bookmarks', 'by-document-id', documentId)
  return bookmarks.sort((left, right) => right.createdAt - left.createdAt)
}
