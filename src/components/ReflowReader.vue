<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ReaderLocator, ReaderSettings, ReflowSection } from '../domain/document'

const props = defineProps<{
  section: ReflowSection
  settings: ReaderSettings
  restoreLocator?: ReaderLocator
  highlightQuery: string
  highlightOccurrence: number
}>()

const emit = defineEmits<{
  position: [locator: ReaderLocator, percent: number, anchorId?: string]
  manualInteraction: []
}>()

const viewport = ref<HTMLElement>()
const article = ref<HTMLElement>()
let scrollFrame = 0

const readerStyle = computed(() => ({
  '--content-width': `${props.settings.contentWidth}px`,
  '--reader-font-size': `${props.settings.fontSize}px`,
  '--reader-line-height': String(props.settings.lineHeight),
  '--paragraph-gap': `${props.settings.paragraphGap}em`,
}))

function currentAnchorId(element: HTMLElement): string | undefined {
  const headings = Array.from(article.value?.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]') ?? [])
  if (!headings.length) return undefined
  const viewportTop = element.getBoundingClientRect().top + 12
  let active: string | undefined
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > viewportTop) break
    active = heading.id
  }
  return active
}

function currentLocator(): ReaderLocator {
  const element = viewport.value
  if (!element) {
    return { kind: 'reflow', sectionId: props.section.id, ratio: 0 }
  }

  const ratio = element.scrollHeight <= element.clientHeight
    ? 0
    : element.scrollTop / (element.scrollHeight - element.clientHeight)

  return {
    kind: 'reflow',
    sectionId: props.section.id,
    ratio: Math.max(0, Math.min(1, ratio)),
  }
}
function reportPosition() {
  const locator = currentLocator()
  const percent = locator.kind === 'reflow' ? locator.ratio * 100 : 0
  emit('position', locator, percent, viewport.value ? currentAnchorId(viewport.value) : undefined)
}

function handleScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    reportPosition()
  })
}

function restore(locator?: ReaderLocator) {
  const element = viewport.value
  if (!element) return
  if (!locator || locator.kind !== 'reflow' || locator.sectionId !== props.section.id) {
    element.scrollTop = 0
    return
  }
  if (locator.anchorId && locator.ratio === 0) {
    const candidate = document.getElementById(locator.anchorId)
    const target = candidate instanceof HTMLElement && article.value?.contains(candidate)
      ? candidate
      : undefined
    if (target) {
      target.scrollIntoView({ block: 'start' })
      return
    }
  }
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight) * locator.ratio
}

function clearHighlights() {
  for (const mark of Array.from(article.value?.querySelectorAll('mark.reader-search-mark') ?? [])) {
    const parent = mark.parentNode
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
    parent?.normalize()
  }
}

interface NormalizedTextUnit {
  node: Text
  start: number
  end: number
}

function highlight(query: string, occurrence: number) {
  clearHighlights()
  const root = article.value
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase()
  if (!root || !needle) return

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let next = walker.nextNode()
  while (next) {
    if (next instanceof Text) textNodes.push(next)
    next = walker.nextNode()
  }

  let haystack = ''
  let pendingSpace: NormalizedTextUnit | undefined
  const units: NormalizedTextUnit[] = []
  for (const node of textNodes) {
    const content = node.data
    let offset = 0
    for (const character of content) {
      const unit = { node, start: offset, end: offset + character.length }
      if (/\s/u.test(character)) {
        if (haystack) pendingSpace = unit
      } else {
        if (pendingSpace) {
          haystack += ' '
          units.push(pendingSpace)
          pendingSpace = undefined
        }
        const normalized = character.normalize('NFKC').toLocaleLowerCase()
        for (let index = 0; index < normalized.length; index += 1) {
          haystack += normalized[index]
          units.push(unit)
        }
      }
      offset += character.length
    }
  }

  let matchStart = -1
  let searchOffset = 0
  for (let index = 0; index <= occurrence; index += 1) {
    matchStart = haystack.indexOf(needle, searchOffset)
    if (matchStart < 0) return
    searchOffset = matchStart + Math.max(1, needle.length)
  }

  const segments = new Map<Text, { start: number; end: number }>()
  for (let index = matchStart; index < matchStart + needle.length; index += 1) {
    const unit = units[index]
    if (!unit) continue
    const existing = segments.get(unit.node)
    if (existing) {
      existing.start = Math.min(existing.start, unit.start)
      existing.end = Math.max(existing.end, unit.end)
    } else {
      segments.set(unit.node, { start: unit.start, end: unit.end })
    }
  }

  let firstMark: HTMLElement | undefined
  for (const [node, segment] of segments) {
    const range = document.createRange()
    range.setStart(node, segment.start)
    range.setEnd(node, segment.end)
    const mark = document.createElement('mark')
    mark.className = 'reader-search-mark'
    range.surroundContents(mark)
    firstMark ??= mark
  }
  firstMark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
async function renderAndRestore() {
  await nextTick()
  restore(props.restoreLocator)
  highlight(props.highlightQuery, props.highlightOccurrence)
  reportPosition()
}

watch(() => props.section.id, renderAndRestore, { immediate: true })
watch(
  () => [props.highlightQuery, props.highlightOccurrence] as const,
  async ([query, occurrence]) => {
    await nextTick()
    highlight(query, occurrence)
  },
)

watch(
  () => [
    props.settings.fontFamily,
    props.settings.fontSize,
    props.settings.lineHeight,
    props.settings.contentWidth,
    props.settings.paragraphGap,
    props.settings.indent,
  ],
  async () => {
    const locator = currentLocator()
    await nextTick()
    restore(locator)
  },
)

onBeforeUnmount(() => {
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})

defineExpose({
  getLocator: currentLocator,
  restore,
  scrollByPixels(distance: number) {
    viewport.value?.scrollBy({ top: distance })
  },
  scrollPage(direction: 1 | -1) {
    viewport.value?.scrollBy({ top: direction * (viewport.value.clientHeight * 0.86), behavior: 'smooth' })
  },
  atEnd() {
    const element = viewport.value
    return Boolean(element && element.scrollTop >= element.scrollHeight - element.clientHeight - 2)
  },
  focus() {
    viewport.value?.focus()
  },
})
</script>

<template>
  <div
    ref="viewport"
    class="reflow-viewport"
    tabindex="0"
    aria-label="文档正文"
    :style="readerStyle"
    @scroll.passive="handleScroll"
    @wheel.passive="$emit('manualInteraction')"
    @touchstart.passive="$emit('manualInteraction')"
    @pointerdown="$emit('manualInteraction')"
  >
    <article
      ref="article"
      class="reflow-content"
      :class="[`font-${settings.fontFamily}`, { 'no-indent': !settings.indent }]"
      v-html="section.html"
    />
  </div>
</template>
