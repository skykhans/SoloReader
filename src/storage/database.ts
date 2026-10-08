import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { BookmarkRecord, PositionRecord, StoredDocument } from '../domain/document'

const DATABASE_NAME = 'universal-reader'
const DATABASE_VERSION = 1

interface ReaderDatabaseSchema extends DBSchema {
  documents: {
    key: string
    value: StoredDocument
    indexes: { 'by-opened-at': number }
  }
  positions: {
    key: string
    value: PositionRecord
  }
  bookmarks: {
    key: string
    value: BookmarkRecord
    indexes: { 'by-document-id': string }
  }
}

let databasePromise: Promise<IDBPDatabase<ReaderDatabaseSchema>> | undefined

export function getReaderDatabase(): Promise<IDBPDatabase<ReaderDatabaseSchema>> {
  databasePromise ??= openDB<ReaderDatabaseSchema>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      const documents = database.createObjectStore('documents', { keyPath: 'meta.id' })
      documents.createIndex('by-opened-at', 'meta.openedAt')

      database.createObjectStore('positions', { keyPath: 'documentId' })

      const bookmarks = database.createObjectStore('bookmarks', { keyPath: 'id' })
      bookmarks.createIndex('by-document-id', 'documentId')
    },
  })

  return databasePromise
}
