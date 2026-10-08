<script setup lang="ts">
import { AnnotationLayer, TextLayer, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CircleAlert, LoaderCircle } from 'lucide-vue-next'
import type { PagedDocument } from '../domain/document'

const props = defineProps<{
  document: PagedDocument
  pageNumber: number
  scale: number
  rotation: number
  highlightQuery: string
  highlightOccurrence: number
}>()

const emit = defineEmits<{
  rendered: [effectiveScale: number, documentId: string, pageNumber: number]
  position: [ratio: number]
  error: [error: Error]
  manualInteraction: []
}>()

const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const textLayerElement = ref<HTMLElement>()
const annotationLayerElement = ref<HTMLDivElement>()
const loading = ref(true)
const pageReady = ref(false)
const renderError = ref<Error>()
const pageLabel = ref('')
let renderTask: RenderTask | undefined
let textLayer: TextLayer | undefined
let annotationLayer: AnnotationLayer | undefined
let renderSequence = 0
let positionFrame: number | undefined
let layoutFrame: number | undefined
let resolveLayoutFrame: (() => void) | undefined

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function clearRenderedPage() {
  const targetCanvas = canvas.value
  if (targetCanvas) {
    targetCanvas.width = 0
    targetCanvas.height = 0
    targetCanvas.style.removeProperty('width')
    targetCanvas.style.removeProperty('height')
  }

  const textContainer = textLayerElement.value
  if (textContainer) {
    textContainer.replaceChildren()
    textContainer.style.removeProperty('width')
    textContainer.style.removeProperty('height')
    textContainer.style.removeProperty('--scale-factor')
  }

  annotationLayer?.destroy()
  annotationLayer = undefined
  annotationLayerElement.value?.replaceChildren()
}

function cancelLayoutFrame() {
  if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame)
  layoutFrame = undefined
  const resolve = resolveLayoutFrame
  resolveLayoutFrame = undefined
  resolve?.()
}

function waitForLayoutFrame(): Promise<void> {
  cancelLayoutFrame()
  return new Promise((resolve) => {
    resolveLayoutFrame = resolve
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined
      resolveLayoutFrame = undefined
      resolve()
    })
  })
}

async function renderPage() {
  const sequence = ++renderSequence
  const activeDocument = props.document
  const documentId = activeDocument.meta.id
  const pageNumber = props.pageNumber
  const requestedScale = props.scale
  const rotation = props.rotation

  cancelLayoutFrame()
  renderTask?.cancel()
  textLayer?.cancel()
  renderTask = undefined
  textLayer = undefined
  loading.value = true
  pageReady.value = false
  renderError.value = undefined
  pageLabel.value = `第 ${pageNumber} 页`
  clearRenderedPage()

  try {
    const page: PDFPageProxy = await activeDocument.pdf.getPage(pageNumber)
    if (sequence !== renderSequence) return
    await nextTick()
    if (sequence !== renderSequence) return

    const effectiveScale = Math.max(0.5, Math.min(4, requestedScale))
    const pageViewport = page.getViewport({ scale: effectiveScale, rotation })
    const targetCanvas = canvas.value
    const textContainer = textLayerElement.value
    const annotationContainer = annotationLayerElement.value
    if (!targetCanvas || !textContainer || !annotationContainer) {
      throw new Error('PDF 页面渲染区域未挂载')
    }

    const outputScale = window.devicePixelRatio || 1
    targetCanvas.width = Math.floor(pageViewport.width * outputScale)
    targetCanvas.height = Math.floor(pageViewport.height * outputScale)
    targetCanvas.style.width = `${Math.floor(pageViewport.width)}px`
    targetCanvas.style.height = `${Math.floor(pageViewport.height)}px`

    textContainer.replaceChildren()
    textContainer.style.width = `${Math.floor(pageViewport.width)}px`
    textContainer.style.height = `${Math.floor(pageViewport.height)}px`
    textContainer.style.setProperty('--scale-factor', String(effectiveScale))
    annotationContainer.replaceChildren()
    annotationContainer.style.width = `${Math.floor(pageViewport.width)}px`
    annotationContainer.style.height = `${Math.floor(pageViewport.height)}px`

    renderTask = page.render({
      canvas: targetCanvas,
      viewport: pageViewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    })

    textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textContainer,
      viewport: pageViewport,
    })

    const annotations = await page.getAnnotations({ intent: 'display' })
    const linkService = {
      addLinkAttributes(link: HTMLAnchorElement, url: string, target?: string) {
        link.href = url
        if (target) link.target = target
        link.rel = 'noopener noreferrer'
      },
      navigateTo() {},
      getDestinationHash() { return '' },
      executeNamedAction() {},
    }
    annotationLayer = new AnnotationLayer({
      div: annotationContainer,
      page,
      viewport: pageViewport.clone({ dontFlip: true }),
      linkService: linkService as never,
      annotationStorage: activeDocument.pdf.annotationStorage,
      accessibilityManager: null,
      annotationCanvasMap: new Map(),
      annotationEditorUIManager: null,
      structTreeLayer: undefined,
      commentManager: undefined,
    })

    await Promise.all([
      renderTask.promise,
      textLayer.render(),
      annotationLayer.render({
        annotations,
        viewport: pageViewport.clone({ dontFlip: true }),
        div: annotationContainer,
        page,
        linkService: linkService as never,
        renderForms: false,
        enableScripting: false,
      }),
    ])
    if (sequence !== renderSequence) return
    renderTask = undefined
    textLayer = undefined

    const pageText = await page.getTextContent()
    if (sequence !== renderSequence) return
    const plainText = pageText.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    activeDocument.pageTextCache.set(pageNumber, plainText)
    pageLabel.value = pageViewport.rotation % 360 !== 0
      ? `第 ${pageNumber} 页，旋转页面`
      : `第 ${pageNumber} 页`
    pageReady.value = true
    loading.value = false
    await nextTick()
    highlightText(props.highlightQuery, props.highlightOccurrence)
    await waitForLayoutFrame()
    if (sequence !== renderSequence) return
    emit('rendered', effectiveScale, documentId, pageNumber)
  } catch (error) {
    const parsed = asError(error)
    if (parsed.name === 'RenderingCancelledException') return
    if (sequence !== renderSequence) return
    clearRenderedPage()
    pageReady.value = false
    loading.value = false
    renderError.value = parsed
    emit('error', parsed)
  }
}

interface NormalizedTextUnit {
  span: HTMLElement
  start: number
  end: number
}

function clearHighlights() {
  const root = textLayerElement.value
  if (!root) return
  for (const mark of Array.from(root.querySelectorAll('mark.pdf-search-hit'))) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  }
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
    span.classList.remove('pdf-search-hit')
    span.normalize()
  }
}

function highlightText(query: string, occurrence: number) {
  clearHighlights()
  if (!pageReady.value) return
  const root = textLayerElement.value
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase()
  if (!root || !needle) return

  const spans = Array.from(root.querySelectorAll<HTMLElement>('span'))
  let haystack = ''
  const units: Array<NormalizedTextUnit | undefined> = []

  spans.forEach((span, spanIndex) => {
    if (spanIndex > 0) {
      haystack += ' '
      units.push(undefined)
    }
    const raw = span.textContent ?? ''
    let offset = 0
    for (const character of raw) {
      const normalized = character.normalize('NFKC').toLocaleLowerCase()
      for (let index = 0; index < normalized.length; index += 1) {
        haystack += normalized[index]
        units.push({ span, start: offset, end: offset + character.length })
      }
      offset += character.length
    }
  })

  let matchStart = -1
  let searchOffset = 0
  for (let index = 0; index <= occurrence; index += 1) {
    matchStart = haystack.indexOf(needle, searchOffset)
    if (matchStart < 0) return
    searchOffset = matchStart + Math.max(1, needle.length)
  }

  const segments = new Map<HTMLElement, { start: number; end: number }>()
  for (let index = matchStart; index < matchStart + needle.length; index += 1) {
    const unit = units[index]
    if (!unit) continue
    const existing = segments.get(unit.span)
    if (existing) {
      existing.start = Math.min(existing.start, unit.start)
      existing.end = Math.max(existing.end, unit.end)
    } else {
      segments.set(unit.span, { start: unit.start, end: unit.end })
    }
  }

  let firstMark: HTMLElement | undefined
  for (const [span, segment] of segments) {
    const textNode = span.firstChild
    if (!(textNode instanceof Text)) continue
    const range = document.createRange()
    range.setStart(textNode, segment.start)
    range.setEnd(textNode, segment.end)
    const mark = document.createElement('mark')
    mark.className = 'pdf-search-hit'
    range.surroundContents(mark)
    firstMark ??= mark
  }
  firstMark?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
}
function getScrollRatio(): number {
  const element = viewport.value
  if (!element || element.scrollHeight <= element.clientHeight) return 0
  return Math.max(0, Math.min(1, element.scrollTop / (element.scrollHeight - element.clientHeight)))
}

function handleScroll() {
  if (positionFrame !== undefined) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = undefined
    emit('position', getScrollRatio())
  })
}

function fitWidth(): number {
  const element = viewport.value
  const targetCanvas = canvas.value
  if (!element || !targetCanvas || !targetCanvas.offsetWidth) return props.scale
  const viewportStyle = getComputedStyle(element)
  const available = element.clientWidth
    - Number.parseFloat(viewportStyle.paddingLeft)
    - Number.parseFloat(viewportStyle.paddingRight)
  return Math.max(0.5, Math.min(4, props.scale * available / targetCanvas.offsetWidth))
}

watch(
  () => [props.document.meta.id, props.pageNumber, props.scale, props.rotation],
  renderPage,
  { immediate: true },
)
watch(
  () => [props.highlightQuery, props.highlightOccurrence] as const,
  ([query, occurrence]) => highlightText(query, occurrence),
)

onBeforeUnmount(() => {
  renderSequence += 1
  renderTask?.cancel()
  textLayer?.cancel()
  if (positionFrame !== undefined) cancelAnimationFrame(positionFrame)
  positionFrame = undefined
  cancelLayoutFrame()
})

defineExpose({
  fitWidth,
  getScrollRatio,
  restoreScroll(ratio: number) {
    const element = viewport.value
    if (element) {
      const safeRatio = Math.max(0, Math.min(1, ratio))
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight) * safeRatio
    }
  },
  scrollPage(direction: 1 | -1) {
    viewport.value?.scrollBy({ top: direction * (viewport.value.clientHeight * 0.86), behavior: 'smooth' })
  },
  hasHorizontalOverflow() {
    const element = viewport.value
    return Boolean(element && element.scrollWidth > element.clientWidth + 1)
  },
  scrollHorizontally(direction: 1 | -1) {
    viewport.value?.scrollBy({ left: direction * 72, behavior: 'smooth' })
  },
  focus() {
    viewport.value?.focus()
  },
})
</script>

<template>
  <div
    ref="viewport"
    class="pdf-viewport"
    tabindex="0"
    :aria-label="pageLabel || `第 ${pageNumber} 页`"
    @scroll.passive="handleScroll"
    @wheel.passive="$emit('manualInteraction')"
    @touchstart.passive="$emit('manualInteraction')"
    @pointerdown="$emit('manualInteraction')"
  >
    <div class="pdf-page" :aria-busy="loading">
      <canvas
        ref="canvas"
        :class="{ 'pdf-layer-hidden': !pageReady }"
        :aria-hidden="!pageReady"
        :aria-label="`PDF 第 ${pageNumber} 页画面`"
      />
      <div
        ref="textLayerElement"
        class="textLayer"
        :class="{ 'pdf-layer-hidden': !pageReady }"
        :aria-hidden="!pageReady"
        aria-label="PDF 文本层"
      />
      <div
        ref="annotationLayerElement"
        class="annotationLayer pdf-layer-hidden"
        :aria-hidden="!pageReady"
        aria-label="PDF 注释层"
      />
      <div v-if="loading" class="pdf-loading" role="status">
        <LoaderCircle class="spin" :size="24" />
        <span>正在渲染第 {{ pageNumber }} 页</span>
      </div>
      <div v-else-if="renderError" class="pdf-error" role="alert">
        <CircleAlert :size="26" />
        <strong>第 {{ pageNumber }} 页渲染失败</strong>
        <span>{{ renderError.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-layer-hidden {
  visibility: hidden;
}

.pdf-error {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 32px;
  background: #fff;
  color: #7c2525;
  text-align: center;
}

.pdf-error span {
  max-width: 34rem;
  color: #5d6260;
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
