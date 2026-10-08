<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { FileWarning, LoaderCircle } from 'lucide-vue-next'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import EmptyReader from './components/EmptyReader.vue'
import NavigationDrawer, { type NavigationTab } from './components/NavigationDrawer.vue'
import PasswordDialog from './components/PasswordDialog.vue'
import PdfReader from './components/PdfReader.vue'
import ReaderFooter from './components/ReaderFooter.vue'
import ReaderToolbar from './components/ReaderToolbar.vue'
import ReflowReader from './components/ReflowReader.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import { PdfDocumentAdapter } from './adapters/pdf'
import { PdfPasswordError } from './adapters/errors'
import { documentAdapterRegistry } from './adapters/registry'
import { defaultReaderSettings, fileAccept } from './domain/defaults'
import type {
  BookmarkRecord,
  OutlineItem,
  ReaderDocument,
  ReaderLocator,
  ReaderSettings,
  SearchHit,
} from './domain/document'
import { searchDocument } from './services/search'
import { selectDesktopDocument, saveDesktopPdf } from './services/desktop'
import { printDesktopPdf, disposeDesktopPrint } from './services/desktop-print'
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
  saveDocument,
  savePosition,
  saveReaderSettings,
} from './storage'
import { createDocumentMeta } from './utils/document-file'

const fileInput = ref<HTMLInputElement>()
const reflowReader = ref<InstanceType<typeof ReflowReader>>()
const pdfReader = ref<InstanceType<typeof PdfReader>>()
const currentDocument = shallowRef<ReaderDocument | null>(null)
const currentFile = ref<File | null>(null)
const recentDocuments = ref<Awaited<ReturnType<typeof getRecentDocuments>>>([])
const bookmarks = ref<BookmarkRecord[]>([])
const settings = ref<ReaderSettings>({ ...defaultReaderSettings })
const currentSectionIndex = ref(0)
const currentPage = ref(1)
const pdfScale = ref(1.2)
const pdfRotation = ref(0)
const currentLocator = ref<ReaderLocator>()
const restoreLocator = ref<ReaderLocator>()
const readingProgress = ref(0)
const navigationOpen = ref(false)
const settingsOpen = ref(false)
const navigationTab = ref<NavigationTab>('outline')
const fullscreen = ref(false)
const loading = ref(false)
const loadingMessage = ref('正在打开文档')
const draggingFile = ref(false)
const autoScrolling = ref(false)
const searchQuery = ref('')
const searchHits = ref<SearchHit[]>([])
const searchTotal = ref(0)
const searchVisibleCount = ref(80)
const searchStatus = ref('输入关键词搜索全文')
const searching = ref(false)
const activeSearchHit = ref<SearchHit>()
const passwordDialogOpen = ref(false)
const passwordMessage = ref('该 PDF 需要密码才能打开')
const passwordBusy = ref(false)
const pendingPasswordFile = ref<File>()
const toastMessage = ref('')
const toastVisible = ref(false)

let toastTimer = 0
let positionTimer = 0
let autoScrollFrame = 0
let autoScrollTimestamp = 0
let activeOpenToken = 0
let searchController: AbortController | undefined
let searchGeneration = 0
let drawerReturnFocus: HTMLElement | null = null
let passwordReturnFocus: HTMLElement | null = null
let bookmarkBusy = false
let desktopCloseListener: UnlistenFn | undefined
let desktopClosing = false
const destroyedPdfTasks = new WeakSet<object>()

interface PendingPdfRestore {
  documentId: string
  page: number
  ratio?: number
}

let pendingPdfRestore: PendingPdfRestore | undefined

const reflowDocument = computed(() => currentDocument.value?.kind === 'reflow' ? currentDocument.value : null)
const pagedDocument = computed(() => currentDocument.value?.kind === 'paged' ? currentDocument.value : null)
const currentSection = computed(() => reflowDocument.value?.sections[currentSectionIndex.value])
const hasDocument = computed(() => currentDocument.value !== null)
const isPdf = computed(() => currentDocument.value?.kind === 'paged')
const backgroundInert = computed(() => (
  navigationOpen.value
  || settingsOpen.value
  || passwordDialogOpen.value
  || loading.value
))

const currentTitle = computed(() => currentDocument.value?.meta.title ?? '知页阅读器')
const currentSubtitle = computed(() => {
  if (!currentDocument.value) return '本地文档阅读器'
  if (currentDocument.value.kind === 'paged') return `第 ${currentPage.value} 页`
  return currentSection.value?.title ?? ''
})

const zoomLabel = computed(() => currentDocument.value?.kind === 'paged'
  ? `${Math.round(pdfScale.value * 100)}%`
  : `${Math.round((settings.value.fontSize / defaultReaderSettings.fontSize) * 100)}%`)
const zoomOutDisabled = computed(() => !hasDocument.value || (
  isPdf.value
    ? pdfScale.value <= 0.5
    : settings.value.fontSize <= 14
))
const zoomInDisabled = computed(() => !hasDocument.value || (
  isPdf.value
    ? pdfScale.value >= 4
    : settings.value.fontSize >= 32
))

const activeTarget = computed<string | number>(() => {
  if (currentDocument.value?.kind === 'paged') return currentPage.value
  const locator = currentLocator.value
  return locator?.kind === 'reflow' && locator.anchorId
    ? locator.anchorId
    : currentSection.value?.id ?? ''
})

const footerTitle = computed(() => currentSubtitle.value)
const footerStatus = computed(() => {
  if (!currentDocument.value) return ''
  if (currentDocument.value.kind === 'paged') {
    return `${currentPage.value} / ${currentDocument.value.pageCount} · ${Math.round(readingProgress.value)}%`
  }
  return `${currentSectionIndex.value + 1} / ${currentDocument.value.sections.length} · ${Math.round(readingProgress.value)}%`
})

const previousDisabled = computed(() => {
  if (!currentDocument.value) return true
  return currentDocument.value.kind === 'paged' ? currentPage.value <= 1 : currentSectionIndex.value <= 0
})

const nextDisabled = computed(() => {
  if (!currentDocument.value) return true
  return currentDocument.value.kind === 'paged'
    ? currentPage.value >= currentDocument.value.pageCount
    : currentSectionIndex.value >= currentDocument.value.sections.length - 1
})

function findNearbyBookmark(locator: ReaderLocator): BookmarkRecord | undefined {
  return bookmarks.value.find((bookmark) => {
    if (bookmark.locator.kind !== locator.kind) return false
    if (locator.kind === 'paged' && bookmark.locator.kind === 'paged') {
      return bookmark.locator.page === locator.page && Math.abs(bookmark.locator.ratio - locator.ratio) < 0.02
    }
    if (locator.kind === 'reflow' && bookmark.locator.kind === 'reflow') {
      return bookmark.locator.sectionId === locator.sectionId && Math.abs(bookmark.locator.ratio - locator.ratio) < 0.02
    }
    return false
  })
}

const nearbyBookmark = computed(() => currentLocator.value
  ? findNearbyBookmark(currentLocator.value)
  : undefined)

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function notify(message: string) {
  window.clearTimeout(toastTimer)
  toastMessage.value = message
  toastVisible.value = true
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 2600)
}

function cancelSearch(status?: string) {
  searchGeneration += 1
  const controller = searchController
  searchController = undefined
  controller?.abort()
  searching.value = false
  if (status) searchStatus.value = status
}

function livePdfRatio(): number {
  const document = pagedDocument.value
  if (!document) return 0
  const pending = pendingPdfRestore
  if (
    pending?.documentId === document.meta.id
    && pending.page === currentPage.value
    && pending.ratio !== undefined
  ) {
    return pending.ratio
  }
  return pdfReader.value?.getScrollRatio()
    ?? (currentLocator.value?.kind === 'paged' ? currentLocator.value.ratio : 0)
}

function setPdfPosition(ratio: number) {
  const document = pagedDocument.value
  if (!document) return
  const safeRatio = Math.max(0, Math.min(1, ratio))
  currentLocator.value = {
    kind: 'paged',
    page: currentPage.value,
    ratio: safeRatio,
    scale: pdfScale.value,
    rotation: pdfRotation.value,
  }
  readingProgress.value = ((currentPage.value - 1 + safeRatio) / document.pageCount) * 100
  schedulePositionSave()
}

function queuePdfRestore(ratio?: number) {
  const document = pagedDocument.value
  if (!document) return
  pendingPdfRestore = { documentId: document.meta.id, page: currentPage.value, ratio }
  if (ratio !== undefined) setPdfPosition(ratio)
}

function currentLiveLocator(): ReaderLocator | undefined {
  const document = currentDocument.value
  if (document?.kind === 'reflow') {
    return reflowReader.value?.getLocator() ?? currentLocator.value
  }
  if (document?.kind === 'paged') {
    return {
      kind: 'paged',
      page: currentPage.value,
      ratio: livePdfRatio(),
      scale: pdfScale.value,
      rotation: pdfRotation.value,
    }
  }
  return undefined
}

async function reloadRecentDocuments() {
  try {
    recentDocuments.value = await getRecentDocuments(24)
  } catch (error) {
    notify(`无法读取书库：${asError(error).message}`)
  }
}

async function destroyDocument(document: ReaderDocument | null) {
  if (document?.kind !== 'paged' || destroyedPdfTasks.has(document.loadingTask)) return
  destroyedPdfTasks.add(document.loadingTask)
  try {
    await document.loadingTask.destroy()
  } catch (error) {
    notify(`PDF 资源清理失败：${asError(error).message}`)
  }
}

async function openFilePicker() {
  passwordReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  if (isTauri()) {
    try {
      const file = await selectDesktopDocument()
      if (file) await openFile(file)
    } catch (error) {
      notify(`无法读取文档：${asError(error).message}`)
    }
  } else {
    fileInput.value?.click()
  }
}

async function commitDocument(candidate: ReaderDocument, file: File, token: number) {
  let adopted = false

  try {
    if (token !== activeOpenToken) return
    await flushPosition()
    if (token !== activeOpenToken) return

    const [savedPosition, savedBookmarks] = await Promise.all([
      getPosition(candidate.meta.id),
      getBookmarks(candidate.meta.id),
    ])
    if (token !== activeOpenToken) return

    const previous = currentDocument.value
    const savedLocator = savedPosition?.locator
    cancelSearch()
    pendingPdfRestore = undefined
    activeSearchHit.value = undefined
    bookmarks.value = savedBookmarks
    searchHits.value = []
    searchTotal.value = 0
    searchStatus.value = '输入关键词搜索全文'
    currentDocument.value = candidate
    currentFile.value = file
    adopted = true
    passwordReturnFocus = null

    if (candidate.kind === 'reflow') {
      const saved = savedLocator?.kind === 'reflow' ? savedLocator : undefined
      const sectionIndex = saved
        ? candidate.sections.findIndex((section) => section.id === saved.sectionId)
        : 0
      currentSectionIndex.value = sectionIndex >= 0 ? sectionIndex : 0
      restoreLocator.value = saved
      currentLocator.value = saved ?? {
        kind: 'reflow',
        sectionId: candidate.sections[currentSectionIndex.value].id,
        ratio: 0,
      }
      readingProgress.value = (
        (currentSectionIndex.value + (currentLocator.value.ratio ?? 0))
        / candidate.sections.length
      ) * 100
    } else {
      const saved = savedLocator?.kind === 'paged' ? savedLocator : undefined
      const savedRatio = Math.max(0, Math.min(1, saved?.ratio ?? 0))
      const normalizedRotation = ((saved?.rotation ?? 0) % 360 + 360) % 360
      currentPage.value = Math.max(1, Math.min(candidate.pageCount, saved?.page ?? 1))
      pdfScale.value = Math.max(0.5, Math.min(4, saved?.scale ?? 1.2))
      pdfRotation.value = normalizedRotation % 90 === 0 ? normalizedRotation : 0
      restoreLocator.value = undefined
      currentLocator.value = {
        kind: 'paged',
        page: currentPage.value,
        ratio: savedRatio,
        scale: pdfScale.value,
        rotation: pdfRotation.value,
      }
      readingProgress.value = ((currentPage.value - 1 + savedRatio) / candidate.pageCount) * 100
      pendingPdfRestore = {
        documentId: candidate.meta.id,
        page: currentPage.value,
        ratio: savedRatio,
      }
    }

    globalThis.document.title = `${candidate.meta.title} - 知页阅读器`
    navigationOpen.value = false
    settingsOpen.value = false
    loading.value = false
    await nextTick()
    if (candidate.kind === 'reflow') reflowReader.value?.restore(restoreLocator.value)
    await destroyDocument(previous)

    try {
      await saveDocument({ meta: candidate.meta, blob: file })
      await reloadRecentDocuments()
    } catch (error) {
      notify(`文档已打开，但无法写入书库：${asError(error).message}`)
    }
  } finally {
    if (!adopted) await destroyDocument(candidate)
  }
}
async function openFile(file: File) {
  if (file.size === 0) {
    notify('文件为空，无法打开')
    return
  }

  const token = ++activeOpenToken
  stopAutoScroll()
  cancelSearch()
  pendingPdfRestore = undefined
  if (passwordDialogOpen.value) {
    passwordDialogOpen.value = false
    passwordBusy.value = false
    pendingPasswordFile.value = undefined
  }
  loading.value = true
  loadingMessage.value = `正在打开 ${file.name}`

  try {
    const parsed = await documentAdapterRegistry.open(file)
    await commitDocument(parsed, file, token)
  } catch (error) {
    if (token !== activeOpenToken) return
    loading.value = false
    if (error instanceof PdfPasswordError) {
      if (!passwordReturnFocus) {
        passwordReturnFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      }
      pendingPasswordFile.value = file
      passwordMessage.value = error.message
      navigationOpen.value = false
      settingsOpen.value = false
      passwordDialogOpen.value = true
      return
    }
    notify(`无法打开文档：${asError(error).message}`)
  }
}

function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void openFile(file)
}

function handleDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  draggingFile.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(event: DragEvent) {
  if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return
  draggingFile.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  draggingFile.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length !== 1) {
    notify('一次请选择一个文档')
    return
  }
  void openFile(files[0])
}

async function submitPassword(password: string) {
  const file = pendingPasswordFile.value
  if (!file) return
  const token = ++activeOpenToken
  passwordBusy.value = true
  try {
    const adapter = new PdfDocumentAdapter()
    const meta = await createDocumentMeta(file, 'pdf')
    const parsed = await adapter.openWithPassword(file, meta, password)
    if (token !== activeOpenToken) {
      await destroyDocument(parsed)
      return
    }
    passwordDialogOpen.value = false
    pendingPasswordFile.value = undefined
    await commitDocument(parsed, file, token)
    passwordReturnFocus = null
    await nextTick()
    if (currentDocument.value?.kind === 'paged') pdfReader.value?.focus()
  } catch (error) {
    if (token !== activeOpenToken) return
    if (error instanceof PdfPasswordError) passwordMessage.value = error.message
    else {
      passwordDialogOpen.value = false
      const returnFocus = passwordReturnFocus
      passwordReturnFocus = null
      nextTick(() => returnFocus?.focus())
      notify(`无法打开 PDF：${asError(error).message}`)
    }
  } finally {
    if (token === activeOpenToken) passwordBusy.value = false
  }
}

function cancelPassword() {
  activeOpenToken += 1
  pendingPasswordFile.value = undefined
  passwordDialogOpen.value = false
  passwordBusy.value = false
  const returnFocus = passwordReturnFocus
  passwordReturnFocus = null
  nextTick(() => returnFocus?.focus())
}

async function openRecent(documentId: string) {
  try {
    const stored = await getDocument(documentId)
    if (!stored) {
      notify('书库中没有找到该文档')
      await reloadRecentDocuments()
      return
    }
    const file = new File([stored.blob], stored.meta.fileName, {
      type: stored.blob.type,
      lastModified: stored.meta.lastModified,
    })
    await openFile(file)
  } catch (error) {
    notify(`无法从书库打开文档：${asError(error).message}`)
  }
}

async function removeRecent(documentId: string) {
  const openedDocument = currentDocument.value?.meta.id === documentId
    ? currentDocument.value
    : null
  if (openedDocument) await flushPosition()

  try {
    await deleteDocument(documentId)
  } catch (error) {
    notify(`无法移除文档：${asError(error).message}`)
    return
  }

  if (openedDocument && currentDocument.value === openedDocument) {
    activeOpenToken += 1
    stopAutoScroll()
    cancelSearch()
    pendingPdfRestore = undefined
    currentDocument.value = null
    currentFile.value = null
    currentLocator.value = undefined
    restoreLocator.value = undefined
    activeSearchHit.value = undefined
    bookmarks.value = []
    readingProgress.value = 0
    navigationOpen.value = false
    settingsOpen.value = false
    globalThis.document.title = '知页阅读器'
    await destroyDocument(openedDocument)
  }

  await reloadRecentDocuments()
  notify('已从书库移除')
}
function handlePosition(locator: ReaderLocator, sectionPercent: number) {
  if (currentDocument.value?.kind !== 'reflow' || locator.kind !== 'reflow') return
  currentLocator.value = locator
  readingProgress.value = (
    (currentSectionIndex.value + sectionPercent / 100)
    / currentDocument.value.sections.length
  ) * 100
  schedulePositionSave()
}

function handlePdfPosition(ratio: number) {
  const document = pagedDocument.value
  if (!document) return
  if (
    pendingPdfRestore?.documentId === document.meta.id
    && pendingPdfRestore.page === currentPage.value
    && pendingPdfRestore.ratio !== undefined
  ) {
    return
  }
  setPdfPosition(ratio)
}

function handlePdfRendered(
  effectiveScale: number,
  documentId: string,
  pageNumber: number,
) {
  const document = pagedDocument.value
  if (
    !document
    || document.meta.id !== documentId
    || currentPage.value !== pageNumber
  ) {
    return
  }

  pdfScale.value = effectiveScale
  const pending = pendingPdfRestore
  if (pending?.documentId === documentId && pending.page === pageNumber) {
    pendingPdfRestore = undefined
    if (pending.ratio !== undefined) pdfReader.value?.restoreScroll(pending.ratio)
  }
  setPdfPosition(pdfReader.value?.getScrollRatio() ?? 0)
}

function handlePdfManualInteraction() {
  pendingPdfRestore = undefined
  stopAutoScroll()
}

function schedulePositionSave() {
  window.clearTimeout(positionTimer)
  positionTimer = window.setTimeout(() => void flushPosition(), 420)
}

async function flushPosition() {
  window.clearTimeout(positionTimer)
  const documentId = currentDocument.value?.meta.id
  const locator = currentLiveLocator()
  if (!documentId || !locator) return
  currentLocator.value = locator
  try {
    await savePosition({ documentId, locator, updatedAt: Date.now() })
  } catch (error) {
    notify(`无法保存阅读进度：${asError(error).message}`)
  }
}
function stopAutoScroll(showMessage = false) {
  if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = 0
  autoScrollTimestamp = 0
  const wasActive = autoScrolling.value
  autoScrolling.value = false
  if (showMessage && wasActive) notify('已停止自动滚动')
}

function autoScrollStep(timestamp: number) {
  if (!autoScrolling.value) return
  if (!autoScrollTimestamp) autoScrollTimestamp = timestamp
  const delta = (timestamp - autoScrollTimestamp) * settings.value.autoScrollSpeed / 1000
  autoScrollTimestamp = timestamp
  if (reflowReader.value?.atEnd()) {
    stopAutoScroll()
    notify('已到本节末尾')
    return
  }
  reflowReader.value?.scrollByPixels(delta)
  autoScrollFrame = requestAnimationFrame(autoScrollStep)
}

function toggleAutoScroll() {
  if (!currentSection.value) return
  if (autoScrolling.value) {
    stopAutoScroll(true)
    return
  }
  autoScrolling.value = true
  autoScrollTimestamp = 0
  autoScrollFrame = requestAnimationFrame(autoScrollStep)
  notify('开始自动滚动')
}

function navigateRelative(delta: -1 | 1) {
  const document = currentDocument.value
  if (!document) return
  stopAutoScroll()
  void flushPosition()
  activeSearchHit.value = undefined

  if (document.kind === 'reflow') {
    const next = currentSectionIndex.value + delta
    if (next < 0 || next >= document.sections.length) return
    currentSectionIndex.value = next
    restoreLocator.value = { kind: 'reflow', sectionId: document.sections[next].id, ratio: 0 }
    currentLocator.value = restoreLocator.value
    readingProgress.value = (next / document.sections.length) * 100
    return
  }

  const next = currentPage.value + delta
  if (next < 1 || next > document.pageCount) return
  currentPage.value = next
  queuePdfRestore(0)
}

function navigateTo(locator: ReaderLocator, searchHit?: SearchHit) {
  const document = currentDocument.value
  if (!document || document.kind !== locator.kind) return
  stopAutoScroll()
  activeSearchHit.value = searchHit

  if (document.kind === 'reflow' && locator.kind === 'reflow') {
    const index = document.sections.findIndex((section) => section.id === locator.sectionId)
    if (index < 0) {
      notify('定位对应的章节已经不存在')
      return
    }
    currentSectionIndex.value = index
    restoreLocator.value = locator
    currentLocator.value = locator
    readingProgress.value = ((index + locator.ratio) / document.sections.length) * 100
    nextTick(() => reflowReader.value?.restore(locator))
  } else if (document.kind === 'paged' && locator.kind === 'paged') {
    const page = Math.max(1, Math.min(document.pageCount, locator.page))
    const scale = Math.max(0.5, Math.min(4, locator.scale))
    const normalizedRotation = ((locator.rotation % 360) + 360) % 360
    const rotation = normalizedRotation % 90 === 0 ? normalizedRotation : 0
    const requiresRender = page !== currentPage.value
      || scale !== pdfScale.value
      || rotation !== pdfRotation.value
    const ratio = searchHit ? livePdfRatio() : Math.max(0, Math.min(1, locator.ratio))

    currentPage.value = page
    pdfScale.value = scale
    pdfRotation.value = rotation
    restoreLocator.value = undefined
    setPdfPosition(ratio)

    if (requiresRender) {
      pendingPdfRestore = {
        documentId: document.meta.id,
        page,
        ratio: searchHit ? undefined : ratio,
      }
    } else if (!searchHit) {
      nextTick(() => {
        if (currentDocument.value?.meta.id !== document.meta.id || currentPage.value !== page) return
        pdfReader.value?.restoreScroll(ratio)
        setPdfPosition(ratio)
      })
    }
  }
  closeNavigation()
}

function navigateOutline(item: OutlineItem) {
  if (currentDocument.value?.kind === 'reflow' && typeof item.target === 'string') {
    navigateTo({
      kind: 'reflow',
      sectionId: item.target,
      ratio: 0,
      anchorId: item.anchorId,
    })
  } else if (currentDocument.value?.kind === 'paged' && typeof item.target === 'number') {
    navigateTo({
      kind: 'paged',
      page: item.target,
      ratio: 0,
      scale: pdfScale.value,
      rotation: pdfRotation.value,
    })
  }
}
function jumpTo(value: number) {
  const document = currentDocument.value
  if (!document) return
  if (document.kind === 'reflow') {
    if (value > document.sections.length) return notify(`请输入 1-${document.sections.length} 的章节序号`)
    navigateTo({ kind: 'reflow', sectionId: document.sections[value - 1].id, ratio: 0 })
  } else {
    if (value > document.pageCount) return notify(`请输入 1-${document.pageCount} 的页码`)
    navigateTo({ kind: 'paged', page: value, ratio: 0, scale: pdfScale.value, rotation: pdfRotation.value })
  }
}

async function runSearch() {
  const document = currentDocument.value
  const query = searchQuery.value.trim()
  if (!document) return
  if (!query) {
    cancelSearch('请输入搜索关键词')
    return
  }

  cancelSearch()
  const generation = searchGeneration
  const documentId = document.meta.id
  const controller = new AbortController()
  searchController = controller
  searching.value = true
  searchHits.value = []
  searchTotal.value = 0
  searchVisibleCount.value = 80
  searchStatus.value = '正在建立搜索结果…'

  const isCurrentSearch = () => (
    generation === searchGeneration
    && controller === searchController
    && !controller.signal.aborted
    && currentDocument.value?.meta.id === documentId
  )

  try {
    const result = await searchDocument(document, query, controller.signal, ({ completed, total }) => {
      if (!isCurrentSearch()) return
      searchStatus.value = `正在搜索 ${completed} / ${total}`
    })
    if (!isCurrentSearch()) return
    searchHits.value = result.hits
    searchTotal.value = result.total
    if (
      result.total === 0
      && document.kind === 'paged'
      && [...document.pageTextCache.values()].every((text) => !text)
    ) {
      searchStatus.value = '此 PDF 没有可搜索文本'
    } else {
      searchStatus.value = result.total ? `找到 ${result.total} 处匹配` : '没有找到相关内容'
    }
  } catch (error) {
    if (isCurrentSearch() && asError(error).name !== 'AbortError') {
      searchStatus.value = `搜索失败：${asError(error).message}`
    }
  } finally {
    if (generation === searchGeneration && controller === searchController) {
      searchController = undefined
      searching.value = false
    }
  }
}

function cancelSearchFromNavigation() {
  if (searching.value) cancelSearch('搜索已取消')
}

function openSearchHit(hit: SearchHit) {
  const locator = hit.locator.kind === 'paged'
    ? {
        ...hit.locator,
        scale: pdfScale.value,
        rotation: pdfRotation.value,
      }
    : hit.locator
  navigateTo(locator, hit)
}
function bookmarkExcerpt(locator: ReaderLocator): string {
  if (locator.kind === 'paged') return `PDF 第 ${locator.page} 页`
  const section = reflowDocument.value?.sections.find((item) => item.id === locator.sectionId)
  if (!section?.text) return '正文位置'
  const at = Math.floor(section.text.length * locator.ratio)
  return section.text.slice(Math.max(0, at - 16), Math.min(section.text.length, at + 42)).replace(/\s+/g, ' ')
}

async function toggleBookmark() {
  if (bookmarkBusy) return
  const document = currentDocument.value
  const locator = currentLiveLocator()
  if (!document || !locator) return
  currentLocator.value = locator
  const existing = findNearbyBookmark(locator)
  bookmarkBusy = true

  try {
    if (existing) {
      await deleteBookmark(existing.id)
      bookmarks.value = bookmarks.value.filter((item) => item.id !== existing.id)
      notify('已删除当前位置书签')
      return
    }

    const record: BookmarkRecord = {
      id: crypto.randomUUID(),
      documentId: document.meta.id,
      label: currentSubtitle.value,
      excerpt: bookmarkExcerpt(locator),
      locator,
      createdAt: Date.now(),
    }
    await addBookmark(record)
    bookmarks.value = [record, ...bookmarks.value]
    notify('已保存当前位置书签')
  } catch (error) {
    notify(`无法更新书签：${asError(error).message}`)
  } finally {
    bookmarkBusy = false
  }
}
async function removeBookmark(bookmarkId: string) {
  try {
    await deleteBookmark(bookmarkId)
    bookmarks.value = bookmarks.value.filter((item) => item.id !== bookmarkId)
    notify('已删除书签')
  } catch (error) {
    notify(`无法删除书签：${asError(error).message}`)
  }
}

function openNavigation(tab: NavigationTab = 'outline') {
  drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  navigationTab.value = currentDocument.value ? tab : 'library'
  navigationOpen.value = true
  settingsOpen.value = false
  stopAutoScroll()
}

function closeNavigation() {
  navigationOpen.value = false
  nextTick(() => drawerReturnFocus?.focus())
}

function openSettings() {
  drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  settingsOpen.value = true
  navigationOpen.value = false
  stopAutoScroll()
}

function closeSettings() {
  settingsOpen.value = false
  nextTick(() => drawerReturnFocus?.focus())
}

function updateSetting(key: keyof ReaderSettings, value: ReaderSettings[keyof ReaderSettings]) {
  const next = { ...settings.value, [key]: value } as ReaderSettings
  try {
    saveReaderSettings(next)
    settings.value = next
  } catch (error) {
    notify(`无法保存阅读设置：${asError(error).message}`)
  }
}

function applyPdfView(scale: number, rotation: number) {
  const document = pagedDocument.value
  const ratio = livePdfRatio()
  const nextScale = Math.max(0.5, Math.min(4, Number(scale.toFixed(2))))
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const nextRotation = normalizedRotation % 90 === 0 ? normalizedRotation : 0
  const changed = nextScale !== pdfScale.value || nextRotation !== pdfRotation.value
  pdfScale.value = nextScale
  pdfRotation.value = nextRotation

  if (!document) return
  setPdfPosition(ratio)
  if (changed) {
    pendingPdfRestore = {
      documentId: document.meta.id,
      page: currentPage.value,
      ratio,
    }
  }
}

function resetSettings() {
  try {
    clearReaderSettings()
    settings.value = { ...defaultReaderSettings }
    applyPdfView(1.2, 0)
    notify('已恢复默认设置')
  } catch (error) {
    notify(`无法重置阅读设置：${asError(error).message}`)
  }
}

function updatePdfScale(value: number) {
  applyPdfView(value, pdfRotation.value)
}

function fitPdfWidth() {
  applyPdfView(pdfReader.value?.fitWidth() ?? pdfScale.value, pdfRotation.value)
}

function rotatePdf() {
  applyPdfView(pdfScale.value, pdfRotation.value + 90)
}

function zoomDocument(delta: -1 | 1) {
  if (!currentDocument.value) return
  if (isPdf.value) {
    updatePdfScale(pdfScale.value + delta * 0.1)
  } else {
    updateSetting('fontSize', settings.value.fontSize + delta)
  }
}

async function downloadCurrentDocument() {
  const file = currentFile.value
  if (!file) return
  if (isTauri()) {
    try {
      await saveDesktopPdf(file)
    } catch (error) {
      notify(`无法保存 PDF：${asError(error).message}`)
    }
    return
  }
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function printCurrentDocument() {
  const file = currentFile.value
  if (!file) return
  if (isTauri()) {
    const pdf = pagedDocument.value?.pdf
    if (!pdf || loading.value) return
    stopAutoScroll()
    loading.value = true
    try {
      await printDesktopPdf(pdf, (page, total) => {
        loadingMessage.value = `正在准备打印 ${page} / ${total}`
      })
    } catch (error) {
      notify(`无法打印 PDF：${asError(error).message}`)
    } finally {
      loading.value = false
    }
    return
  }
  const url = URL.createObjectURL(file)
  const printWindow = window.open(url, '_blank')
  if (!printWindow) {
    URL.revokeObjectURL(url)
    notify('浏览器阻止了打印窗口，请允许弹窗后重试')
    return
  }
  const print = () => {
    printWindow.focus()
    printWindow.print()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  printWindow.addEventListener('load', print, { once: true })
}
async function toggleFullscreen() {
  try {
    if (isTauri()) {
      const window = getCurrentWindow()
      const enabled = !await window.isFullscreen()
      await window.setFullscreen(enabled)
      fullscreen.value = enabled
      return
    }
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch (error) {
    notify(`无法切换全屏：${asError(error).message}`)
  }
}

function handleDesktopLink(event: MouseEvent) {
  if (!isTauri() || !(event.target instanceof Element)) return
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!anchor || !/^(https?:|mailto:|tel:)/i.test(anchor.getAttribute('href') ?? '')) return
  event.preventDefault()
  void openUrl(anchor.href).catch((error) => notify(`无法打开链接：${asError(error).message}`))
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const editing = Boolean(target && (target.matches('input,textarea,select,button') || target.isContentEditable))

  if (event.key === 'Escape') {
    if (passwordDialogOpen.value) cancelPassword()
    else if (navigationOpen.value) closeNavigation()
    else if (settingsOpen.value) closeSettings()
    else if (isTauri() && fullscreen.value) void toggleFullscreen()
    else stopAutoScroll(true)
    return
  }
  if (passwordDialogOpen.value || loading.value) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'o') {
    event.preventDefault()
    openFilePicker()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f' && currentDocument.value) {
    event.preventDefault()
    openNavigation('search')
    return
  }
  if (editing || event.ctrlKey || event.metaKey || event.altKey || !currentDocument.value) return

  if (autoScrolling.value) stopAutoScroll()
  if (
    isPdf.value
    && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    && pdfReader.value?.hasHorizontalOverflow()
  ) {
    event.preventDefault()
    pdfReader.value.scrollHorizontally(event.key === 'ArrowLeft' ? -1 : 1)
  } else if (event.key === 'ArrowLeft' && !previousDisabled.value) {
    event.preventDefault(); navigateRelative(-1)
  } else if (event.key === 'ArrowRight' && !nextDisabled.value) {
    event.preventDefault(); navigateRelative(1)
  } else if (event.key.toLocaleLowerCase() === 'm') {
    event.preventDefault(); void toggleBookmark()
  } else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
    event.preventDefault()
    if (isPdf.value) pdfReader.value?.scrollPage(1)
    else reflowReader.value?.scrollPage(1)
  } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
    event.preventDefault()
    if (isPdf.value) pdfReader.value?.scrollPage(-1)
    else reflowReader.value?.scrollPage(-1)
  }
}

function handleVisibilityChange() {
  if (!document.hidden) return
  stopAutoScroll()
  void flushPosition()
}

function handleFullscreenChange() {
  fullscreen.value = Boolean(document.fullscreenElement)
}

watch(
  () => settings.value.theme,
  (theme) => document.documentElement.setAttribute('data-theme', theme),
  { immediate: true },
)


onMounted(async () => {
  try {
    settings.value = loadReaderSettings()
  } catch (error) {
    clearReaderSettings()
    settings.value = { ...defaultReaderSettings }
    notify(`阅读设置已重置：${asError(error).message}`)
  }
  await reloadRecentDocuments()
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('click', handleDesktopLink)
  if (isTauri()) {
    try {
      const window = getCurrentWindow()
      desktopCloseListener = await window.onCloseRequested(async (event) => {
        event.preventDefault()
        if (desktopClosing) return
        desktopClosing = true
        stopAutoScroll()
        await flushPosition()
        try {
          await window.destroy()
        } catch (error) {
          desktopClosing = false
          notify(`无法关闭窗口：${asError(error).message}`)
        }
      })
    } catch (error) {
      notify(`无法初始化桌面窗口：${asError(error).message}`)
    }
  }
})

onBeforeUnmount(() => {
  activeOpenToken += 1
  cancelSearch()
  pendingPdfRestore = undefined
  stopAutoScroll()
  window.clearTimeout(positionTimer)
  window.clearTimeout(toastTimer)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('click', handleDesktopLink)
  desktopCloseListener?.()
  disposeDesktopPrint()
  void flushPosition()
  void destroyDocument(currentDocument.value)
})
</script>

<template>
  <div
    class="reader-app"
    :class="{ 'drawer-visible': navigationOpen || settingsOpen, 'file-dragging': draggingFile }"
    @dragenter="handleDragOver"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      tabindex="-1"
      aria-hidden="true"
      :accept="fileAccept"
      @change="handleFileSelection"
    />

    <ReaderToolbar
      :inert="backgroundInert"
      :title="currentTitle"
      :subtitle="currentSubtitle"
      :has-document="hasDocument"
      :bookmarked="Boolean(nearbyBookmark)"
      :auto-scrolling="autoScrolling"
      :is-pdf="isPdf"
      :fullscreen="fullscreen"
      :progress="readingProgress"
      :zoom-label="zoomLabel"
      :zoom-out-disabled="zoomOutDisabled"
      :zoom-in-disabled="zoomInDisabled"
      @open-navigation="openNavigation()"
      @open-file="openFilePicker"
      @open-library="openNavigation('library')"
      @toggle-bookmark="toggleBookmark"
      @toggle-auto-scroll="toggleAutoScroll"
      @open-settings="openSettings"
      @toggle-fullscreen="toggleFullscreen"
      @zoom-out="zoomDocument(-1)"
      @zoom-in="zoomDocument(1)"
      @download="downloadCurrentDocument"
      @print="printCurrentDocument"
    />

    <EmptyReader
      v-if="!currentDocument"
      :inert="backgroundInert"
      :recent-documents="recentDocuments"
      @open-file="openFilePicker"
      @open-recent="openRecent"
      @remove-recent="removeRecent"
    />
    <ReflowReader
      v-else-if="currentSection"
      :inert="backgroundInert"
      ref="reflowReader"
      :key="currentSection.id"
      :section="currentSection"
      :settings="settings"
      :restore-locator="restoreLocator"
      :highlight-query="activeSearchHit?.query ?? ''"
      :highlight-occurrence="activeSearchHit?.occurrence ?? 0"
      @position="handlePosition"
      @manual-interaction="stopAutoScroll()"
    />
    <PdfReader
      v-else-if="pagedDocument"
      :inert="backgroundInert"
      ref="pdfReader"
      :document="pagedDocument"
      :page-number="currentPage"
      :scale="pdfScale"
      :rotation="pdfRotation"
      :highlight-query="activeSearchHit?.query ?? ''"
      :highlight-occurrence="activeSearchHit?.occurrence ?? 0"
      @rendered="handlePdfRendered"
      @position="handlePdfPosition"
      @error="notify(`PDF 页面渲染失败：${$event.message}`)"
      @manual-interaction="handlePdfManualInteraction"
    />

    <ReaderFooter
      :inert="backgroundInert"
      :visible="hasDocument"
      :previous-disabled="previousDisabled"
      :next-disabled="nextDisabled"
      :title="footerTitle"
      :status="footerStatus"
      :previous-label="isPdf ? '上一页' : '上一章'"
      :next-label="isPdf ? '下一页' : '下一章'"
      @previous="navigateRelative(-1)"
      @next="navigateRelative(1)"
    />

    <div v-if="navigationOpen || settingsOpen" class="drawer-backdrop" @click="navigationOpen ? closeNavigation() : closeSettings()" />
    <NavigationDrawer
      :open="navigationOpen"
      :active-tab="navigationTab"
      :document="currentDocument"
      :active-target="activeTarget"
      :search-query="searchQuery"
      :search-hits="searchHits"
      :search-total="searchTotal"
      :search-visible-count="searchVisibleCount"
      :search-status="searchStatus"
      :searching="searching"
      :bookmarks="bookmarks"
      :recent-documents="recentDocuments"
      @close="closeNavigation"
      @change-tab="navigationTab = $event"
      @navigate-outline="navigateOutline"
      @jump="jumpTo"
      @update-search-query="searchQuery = $event"
      @search="runSearch"
      @cancel-search="cancelSearchFromNavigation"
      @open-search-hit="openSearchHit"
      @show-more-search="searchVisibleCount += 80"
      @open-bookmark="navigateTo($event.locator)"
      @delete-bookmark="removeBookmark"
      @open-recent="openRecent"
      @delete-recent="removeRecent"
    />
    <SettingsDrawer
      :open="settingsOpen"
      :settings="settings"
      :is-pdf="isPdf"
      :pdf-scale="pdfScale"
      :pdf-rotation="pdfRotation"
      @close="closeSettings"
      @update-setting="updateSetting"
      @reset="resetSettings"
      @update-pdf-scale="updatePdfScale"
      @fit-pdf-width="fitPdfWidth"
      @rotate-pdf="rotatePdf"
      @download="downloadCurrentDocument"
      @print="printCurrentDocument"
    />

    <div v-if="loading" class="loading-overlay" role="status" aria-live="polite">
      <LoaderCircle class="spin" :size="28" />
      <span>{{ loadingMessage }}</span>
    </div>
    <div v-if="draggingFile" class="drop-overlay" aria-hidden="true">
      <FileWarning :size="34" />
      <strong>打开此文档</strong>
    </div>
    <div class="reader-toast" :class="{ visible: toastVisible }" role="status" aria-live="polite">
      {{ toastMessage }}
    </div>

    <PasswordDialog
      :open="passwordDialogOpen"
      :file-name="pendingPasswordFile?.name ?? ''"
      :message="passwordMessage"
      :busy="passwordBusy"
      @submit="submitPassword"
      @cancel="cancelPassword"
    />
  </div>
</template>
