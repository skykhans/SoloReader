import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NavigationDrawer from '../src/components/NavigationDrawer.vue'
import type {
  BookmarkRecord,
  PagedDocument,
  ReaderDocument,
  ReaderLocator,
  ReaderSettings,
  ReflowDocument,
  SearchHit,
  StoredDocument,
} from '../src/domain/document'
import type { SearchResultSet } from '../src/services/search'

const mocks = vi.hoisted(() => ({
  openDocument: vi.fn(),
  openPdfWithPassword: vi.fn(),
  searchDocument: vi.fn(),
  addBookmark: vi.fn(),
  clearReaderSettings: vi.fn(),
  deleteBookmark: vi.fn(),
  deleteDocument: vi.fn(),
  getBookmarks: vi.fn(),
  getDocument: vi.fn(),
  getPosition: vi.fn(),
  getRecentDocuments: vi.fn(),
  loadReaderSettings: vi.fn(),
  saveDocument: vi.fn(),
  savePosition: vi.fn(),
  saveReaderSettings: vi.fn(),
}))

const pdfHarness = vi.hoisted(() => ({
  ratio: 0,
  restoreScroll: vi.fn<(ratio: number) => void>(),
  getScrollRatio: vi.fn<() => number>(),
}))

vi.mock('../src/adapters/registry', () => ({
  documentAdapterRegistry: { open: mocks.openDocument },
}))

vi.mock('../src/adapters/pdf', () => ({
  PdfDocumentAdapter: class {
    openWithPassword(...args: unknown[]) {
      return mocks.openPdfWithPassword(...args)
    }
  },
}))

vi.mock('../src/components/PdfReader.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'PdfReaderTestDouble',
      inheritAttrs: false,
      props: {
        document: {
          type: Object as PropType<PagedDocument>,
          required: true,
        },
        pageNumber: { type: Number, required: true },
      },
      emits: ['rendered', 'position', 'error', 'manualInteraction'],
      setup(props, { expose }) {
        expose({
          getScrollRatio: () => pdfHarness.getScrollRatio(),
          restoreScroll: (ratio: number) => pdfHarness.restoreScroll(ratio),
          fitWidth: () => 1,
          hasHorizontalOverflow: () => false,
          scrollHorizontally: () => undefined,
          scrollPage: () => undefined,
          focus: () => undefined,
        })
        return () => h('div', {
          'data-testid': 'pdf-reader',
          'data-document-id': props.document.meta.id,
          'data-page': String(props.pageNumber),
        })
      },
    }),
  }
})

vi.mock('../src/services/search', () => ({
  searchDocument: mocks.searchDocument,
}))

vi.mock('../src/storage', () => ({
  addBookmark: mocks.addBookmark,
  clearReaderSettings: mocks.clearReaderSettings,
  deleteBookmark: mocks.deleteBookmark,
  deleteDocument: mocks.deleteDocument,
  getBookmarks: mocks.getBookmarks,
  getDocument: mocks.getDocument,
  getPosition: mocks.getPosition,
  getRecentDocuments: mocks.getRecentDocuments,
  loadReaderSettings: mocks.loadReaderSettings,
  saveDocument: mocks.saveDocument,
  savePosition: mocks.savePosition,
  saveReaderSettings: mocks.saveReaderSettings,
}))

import App from '../src/App.vue'

const defaultSettings: ReaderSettings = {
  theme: 'light',
  fontFamily: 'kai',
  fontSize: 19,
  lineHeight: 1.9,
  contentWidth: 760,
  paragraphGap: 0.9,
  indent: true,
  autoScrollSpeed: 34,
}

const reflowHarness = {
  locator: undefined as ReaderLocator | undefined,
  restore: vi.fn(),
}

const ReflowReaderStub = defineComponent({
  name: 'ReflowReaderStub',
  inheritAttrs: false,
  props: {
    section: {
      type: Object as PropType<ReflowDocument['sections'][number]>,
      required: true,
    },
  },
  emits: ['position', 'manualInteraction'],
  setup(props, { expose }) {
    expose({
      getLocator: () => reflowHarness.locator ?? {
        kind: 'reflow',
        sectionId: props.section.id,
        ratio: 0,
      },
      restore: (locator?: ReaderLocator) => reflowHarness.restore(locator),
      scrollByPixels: () => undefined,
      scrollPage: () => undefined,
      atEnd: () => false,
      focus: () => undefined,
    })
    return () => h('div', {
      'data-testid': 'reflow-reader',
      'data-section-id': props.section.id,
    })
  },
})

const mountedWrappers = new Set<VueWrapper>()

function createReflowDocument(id: string): ReflowDocument {
  return {
    kind: 'reflow',
    meta: {
      id,
      title: '文档 ' + id,
      fileName: id + '.txt',
      format: 'txt',
      size: 7,
      lastModified: 1,
      openedAt: 1,
    },
    sections: [{
      id: id + '-section',
      title: '章节 ' + id,
      html: '<p>' + id + '</p>',
      text: id + ' 正文',
      wordCount: 5,
    }],
    outline: [],
  }
}

function createPagedDocument(id: string) {
  const destroy = vi.fn(async () => undefined)
  const document: PagedDocument = {
    kind: 'paged',
    meta: {
      id,
      title: 'PDF ' + id,
      fileName: id + '.pdf',
      format: 'pdf',
      size: 7,
      lastModified: 1,
      openedAt: 1,
    },
    loadingTask: { destroy } as unknown as PagedDocument['loadingTask'],
    pdf: {} as unknown as PagedDocument['pdf'],
    pageCount: 4,
    outline: [],
    pageTextCache: new Map(),
  }
  return { document, destroy }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mountApp(): VueWrapper {
  const wrapper = mount(App, {
    global: {
      stubs: {
        EmptyReader: true,
        PasswordDialog: true,
        ReflowReader: ReflowReaderStub,
        SettingsDrawer: true,
      },
    },
  })
  mountedWrappers.add(wrapper)
  return wrapper
}

async function selectFile(wrapper: VueWrapper, file: File): Promise<void> {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  })
  await input.trigger('change')
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  vi.useRealTimers()
  Object.values(mocks).forEach((mock) => mock.mockReset())
  pdfHarness.ratio = 0
  pdfHarness.restoreScroll.mockReset()
  pdfHarness.restoreScroll.mockImplementation((ratio) => {
    pdfHarness.ratio = ratio
  })
  pdfHarness.getScrollRatio.mockReset()
  pdfHarness.getScrollRatio.mockImplementation(() => pdfHarness.ratio)
  reflowHarness.locator = undefined
  reflowHarness.restore.mockReset()

  mocks.getPosition.mockResolvedValue(undefined)
  mocks.getBookmarks.mockResolvedValue([])
  mocks.getRecentDocuments.mockResolvedValue([])
  mocks.getDocument.mockResolvedValue(undefined)
  mocks.loadReaderSettings.mockReturnValue({ ...defaultSettings })
  mocks.addBookmark.mockResolvedValue(undefined)
  mocks.deleteBookmark.mockResolvedValue(undefined)
  mocks.deleteDocument.mockResolvedValue(undefined)
  mocks.saveDocument.mockResolvedValue(undefined)
  mocks.savePosition.mockResolvedValue(undefined)
})

afterEach(async () => {
  for (const wrapper of mountedWrappers) wrapper.unmount()
  mountedWrappers.clear()
  await flushPromises()
  vi.useRealTimers()
})

describe('App critical interactions', () => {
  it('does not let an old search overwrite the new document after switching files', async () => {
    const first = createReflowDocument('first')
    const second = createReflowDocument('second')
    const pendingSearch = deferred<SearchResultSet>()
    mocks.openDocument
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    mocks.searchDocument.mockReturnValueOnce(pendingSearch.promise)

    const wrapper = mountApp()
    await selectFile(wrapper, new File(['first'], first.meta.fileName))

    const navigation = wrapper.getComponent(NavigationDrawer)
    navigation.vm.$emit('changeTab', 'search')
    navigation.vm.$emit('updateSearchQuery', '正文')
    await nextTick()
    navigation.vm.$emit('search')
    await nextTick()

    expect(mocks.searchDocument).toHaveBeenCalledTimes(1)
    const oldSignal = mocks.searchDocument.mock.calls[0][2] as AbortSignal
    expect(oldSignal.aborted).toBe(false)

    await selectFile(wrapper, new File(['second'], second.meta.fileName))
    expect(oldSignal.aborted).toBe(true)

    pendingSearch.resolve({
      hits: [{
        id: 'stale-hit',
        label: first.sections[0].title,
        snippet: '过期结果',
        locator: { kind: 'reflow', sectionId: first.sections[0].id, ratio: 0 },
        query: '正文',
        occurrence: 0,
      }],
      total: 1,
      collected: 1,
    })
    await flushPromises()

    const currentDocument = navigation.props('document') as ReaderDocument
    expect(currentDocument.meta.id).toBe(second.meta.id)
    expect(navigation.props('searchHits')).toEqual([])
    expect(navigation.props('searching')).toBe(false)
    expect(navigation.props('searchStatus')).toBe('输入关键词搜索全文')
  })

  it('restores a PDF ratio only after the matching page renders and then tracks scrolling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { document } = createPagedDocument('positioned')
    mocks.openDocument.mockResolvedValueOnce(document)
    mocks.getPosition.mockResolvedValueOnce({
      documentId: document.meta.id,
      locator: { kind: 'paged', page: 2, ratio: 0.65, scale: 1.5, rotation: 90 },
      updatedAt: 1,
    })

    const wrapper = mountApp()
    await selectFile(wrapper, new File(['pdf'], document.meta.fileName))
    const pdf = wrapper.getComponent({ name: 'PdfReaderTestDouble' })

    expect(pdf.props('pageNumber')).toBe(2)
    expect(pdfHarness.restoreScroll).not.toHaveBeenCalled()
    expect(wrapper.get('.footer-status span').text()).toBe('2 / 4 · 41%')

    pdf.vm.$emit('position', 0.2)
    await nextTick()
    expect(wrapper.get('.footer-status span').text()).toBe('2 / 4 · 41%')

    pdf.vm.$emit('rendered', 1.5, document.meta.id, 2)
    await nextTick()
    expect(pdfHarness.restoreScroll).toHaveBeenCalledOnce()
    expect(pdfHarness.restoreScroll).toHaveBeenCalledWith(0.65)

    pdfHarness.ratio = 0.8
    pdf.vm.$emit('position', 0.8)
    await nextTick()
    expect(wrapper.get('.footer-status span').text()).toBe('2 / 4 · 45%')

    vi.advanceTimersByTime(421)
    await flushPromises()
    expect(mocks.savePosition).toHaveBeenLastCalledWith(expect.objectContaining({
      documentId: document.meta.id,
      locator: {
        kind: 'paged',
        page: 2,
        ratio: 0.8,
        scale: 1.5,
        rotation: 90,
      },
    }))
  })

  it('destroys a candidate PDF exactly once when commit fails before adoption', async () => {
    const { document, destroy } = createPagedDocument('failed-candidate')
    mocks.openDocument.mockResolvedValueOnce(document)
    mocks.getPosition.mockRejectedValueOnce(new Error('位置读取失败'))

    const wrapper = mountApp()
    await selectFile(wrapper, new File(['pdf'], document.meta.fileName))

    expect(wrapper.find('[data-testid="pdf-reader"]').exists()).toBe(false)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('deletes the captured bookmark id when the live locator changes during deletion', async () => {
    const document = createReflowDocument('bookmark-document')
    const initialLocator: ReaderLocator = {
      kind: 'reflow',
      sectionId: document.sections[0].id,
      ratio: 0.1,
    }
    const bookmark: BookmarkRecord = {
      id: 'captured-bookmark',
      documentId: document.meta.id,
      label: document.sections[0].title,
      excerpt: '书签摘录',
      locator: initialLocator,
      createdAt: 1,
    }
    const pendingDelete = deferred<void>()
    reflowHarness.locator = initialLocator
    mocks.openDocument.mockResolvedValueOnce(document)
    mocks.getPosition.mockResolvedValueOnce({
      documentId: document.meta.id,
      locator: initialLocator,
      updatedAt: 1,
    })
    mocks.getBookmarks.mockResolvedValueOnce([bookmark])
    mocks.deleteBookmark.mockReturnValueOnce(pendingDelete.promise)

    const wrapper = mountApp()
    await selectFile(wrapper, new File(['book'], document.meta.fileName))
    const removeButton = wrapper.get('button[aria-label="移除当前位置书签"]')

    await removeButton.trigger('click')
    expect(mocks.deleteBookmark).toHaveBeenCalledOnce()
    expect(mocks.deleteBookmark).toHaveBeenCalledWith(bookmark.id)

    const changedLocator: ReaderLocator = {
      kind: 'reflow',
      sectionId: document.sections[0].id,
      ratio: 0.9,
    }
    reflowHarness.locator = changedLocator
    wrapper.getComponent(ReflowReaderStub).vm.$emit('position', changedLocator, 90)
    await nextTick()

    pendingDelete.resolve()
    await flushPromises()

    expect(mocks.deleteBookmark).toHaveBeenCalledWith(bookmark.id)
    expect(wrapper.getComponent(NavigationDrawer).props('bookmarks')).toEqual([])
  })
})
