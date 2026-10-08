import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  PagedDocument,
  ReaderSettings,
  ReflowDocument,
  ReflowSection,
} from '../src/domain/document'
import { defaultReaderSettings } from '../src/domain/defaults'

vi.mock('pdfjs-dist', () => ({
  AnnotationLayer: class {
    constructor(_options: unknown) {}
    async render(_options: unknown): Promise<void> {}
    destroy(): void {}
  },
  TextLayer: class {
    readonly #container: HTMLElement
    readonly #source: { spans?: string[] }

    constructor(options: {
      container: HTMLElement
      textContentSource: { spans?: string[] }
    }) {
      this.#container = options.container
      this.#source = options.textContentSource
    }

    async render(): Promise<void> {
      for (const text of this.#source.spans ?? []) {
        const span = document.createElement('span')
        span.textContent = text
        this.#container.append(span)
      }
    }

    cancel(): void {}
  },
}))

import NavigationDrawer from '../src/components/NavigationDrawer.vue'
import PasswordDialog from '../src/components/PasswordDialog.vue'
import PdfReader from '../src/components/PdfReader.vue'
import ReflowReader from '../src/components/ReflowReader.vue'
import SettingsDrawer from '../src/components/SettingsDrawer.vue'

const settings: ReaderSettings = { ...defaultReaderSettings }
const scrollIntoView = vi.fn()
const mountedWrappers: Array<{ unmount(): void }> = []
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
const originalCssEscape = globalThis.CSS?.escape

function tracked<T extends { unmount(): void }>(wrapper: T): T {
  mountedWrappers.push(wrapper)
  return wrapper
}

function section(html: string): ReflowSection {
  return {
    id: 'section-1',
    title: '第一章',
    html,
    text: '目标一，目标二，目标三',
    wordCount: 11,
  }
}

function reflowDocument(): ReflowDocument {
  return {
    kind: 'reflow',
    meta: {
      id: 'reflow-document',
      title: '测试文档',
      fileName: 'test.html',
      format: 'html',
      size: 100,
      lastModified: 1,
      openedAt: 1,
    },
    sections: [section('<p>正文</p>')],
    outline: [],
  }
}

function pagedDocument(spans: string[]): PagedDocument {
  const page = {
    getViewport: vi.fn(({ scale, rotation }: { scale: number; rotation: number }) => {
      const viewport = {
        width: 480 * scale,
        height: 640 * scale,
        rotation,
        clone: vi.fn(() => viewport),
      }
      return viewport
    }),
    render: vi.fn(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    })),
    streamTextContent: vi.fn(() => ({ spans })),
    getTextContent: vi.fn(async () => ({
      items: spans.map((text) => ({ str: text })),
    })),
    getAnnotations: vi.fn(async () => []),
  }

  return {
    kind: 'paged',
    meta: {
      id: 'pdf-document',
      title: 'PDF 测试',
      fileName: 'test.pdf',
      format: 'pdf',
      size: 100,
      lastModified: 1,
      openedAt: 1,
    },
    loadingTask: {},
    pdf: {
      getPage: vi.fn(async () => page),
    },
    pageCount: 1,
    outline: [],
    pageTextCache: new Map<number, string>(),
  } as unknown as PagedDocument
}

function focusableElements(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  )
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  if (!globalThis.CSS) {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: {},
    })
  }
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
  })
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
  scrollIntoView.mockClear()
})

afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    })
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
  if (originalCssEscape) {
    Object.defineProperty(globalThis.CSS, 'escape', {
      configurable: true,
      value: originalCssEscape,
    })
  } else {
    Reflect.deleteProperty(globalThis.CSS, 'escape')
  }
})

describe('ReflowReader', () => {
  it('在同一章节中只高亮指定序号的重复命中', async () => {
    const wrapper = tracked(mount(ReflowReader, {
      attachTo: document.body,
      props: {
        section: section('<p>目标一，目标二，目标三</p>'),
        settings,
        highlightQuery: '目标',
        highlightOccurrence: 1,
      },
    }))

    await flushPromises()
    let mark = wrapper.get('mark.reader-search-mark')
    expect(mark.text()).toBe('目标')
    expect(mark.element.previousSibling?.textContent).toBe('目标一，')

    await wrapper.setProps({ highlightOccurrence: 2 })
    await flushPromises()
    mark = wrapper.get('mark.reader-search-mark')
    expect(mark.element.previousSibling?.textContent).toBe('目标一，目标二，')
    expect(wrapper.findAll('mark.reader-search-mark')).toHaveLength(1)
  })

  it('优先按 HTML 标题 anchor 恢复阅读位置', async () => {
    const wrapper = tracked(mount(ReflowReader, {
      attachTo: document.body,
      props: {
        section: section('<h1 id="start">开头</h1><p>正文</p><h2 id="target-heading">目标标题</h2>'),
        settings,
        restoreLocator: {
          kind: 'reflow',
          sectionId: 'section-1',
          ratio: 0.9,
          anchorId: 'target-heading',
        },
        highlightQuery: '',
        highlightOccurrence: 0,
      },
    }))

    await flushPromises()
    const heading = wrapper.get('#target-heading').element
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(scrollIntoView.mock.instances[0]).toBe(heading)
  })
})

describe('PdfReader', () => {
  it('跨文本 span 高亮第 N 处命中，并按滚动位置发送比例', async () => {
    const wrapper = tracked(mount(PdfReader, {
      attachTo: document.body,
      props: {
        document: pagedDocument(['甲目标', '短句中目标', '短句乙']),
        pageNumber: 1,
        scale: 1.25,
        rotation: 0,
        highlightQuery: '目标 短句',
        highlightOccurrence: 1,
      },
    }))

    await vi.waitFor(() => {
      expect(wrapper.emitted('rendered')).toEqual([[1.25, 'pdf-document', 1]])
    })

    const spans = wrapper.findAll('.textLayer > span')
    expect(spans).toHaveLength(3)
    expect(spans[0].find('mark.pdf-search-hit').exists()).toBe(false)
    expect(spans[1].get('mark.pdf-search-hit').text()).toBe('目标')
    expect(spans[2].get('mark.pdf-search-hit').text()).toBe('短句')

    const viewport = wrapper.get('.pdf-viewport')
    Object.defineProperties(viewport.element, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    })
    viewport.element.scrollTop = 400
    await viewport.trigger('scroll')

    await vi.waitFor(() => {
      expect(wrapper.emitted('position')?.at(-1)).toEqual([0.5])
    })
  })
})

describe('NavigationDrawer', () => {
  it('搜索进行中提供取消操作并发送 cancelSearch', async () => {
    const wrapper = tracked(mount(NavigationDrawer, {
      props: {
        open: true,
        activeTab: 'search',
        document: reflowDocument(),
        activeTarget: 'section-1',
        searchQuery: '目标',
        searchHits: [],
        searchTotal: 0,
        searchVisibleCount: 50,
        searchStatus: '正在搜索',
        searching: true,
        bookmarks: [],
        recentDocuments: [],
      },
    }))

    await wrapper.get('button[aria-label="取消搜索"]').trigger('click')
    expect(wrapper.emitted('cancelSearch')).toEqual([[]])
  })
})

describe('SettingsDrawer', () => {
  it('Tab 与 Shift+Tab 在设置对话框内首尾循环', async () => {
    const wrapper = tracked(mount(SettingsDrawer, {
      attachTo: document.body,
      props: {
        open: true,
        settings,
        isPdf: false,
        pdfScale: 1.2,
        pdfRotation: 0,
      },
    }))

    await flushPromises()
    const dialog = wrapper.get('[role="dialog"]')
    const focusable = focusableElements(dialog.element)
    const first = focusable[0]
    const last = focusable.at(-1)
    expect(document.activeElement).toBe(first)
    expect(last).toBeDefined()

    first.focus()
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    last?.focus()
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })
})

describe('PasswordDialog', () => {
  it('打开后聚焦密码框，并让 Tab 与 Shift+Tab 首尾循环', async () => {
    const wrapper = tracked(mount(PasswordDialog, {
      attachTo: document.body,
      props: {
        open: false,
        fileName: 'protected.pdf',
        message: '请输入密码',
        busy: false,
      },
    }))

    await wrapper.setProps({ open: true })
    await flushPromises()
    const input = wrapper.get('input[aria-label="PDF 密码"]')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('secret')
    const dialog = wrapper.get('[role="dialog"]')
    const focusable = focusableElements(dialog.element)
    const first = focusable[0]
    const last = focusable.at(-1)
    expect(last).toBeDefined()

    first.focus()
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    last?.focus()
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })
})
