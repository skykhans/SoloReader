<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Bookmark,
  BookOpen,
  FileSearch,
  ListTree,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  BookmarkRecord,
  DocumentMeta,
  OutlineItem,
  ReaderDocument,
  SearchHit,
} from '../domain/document'

export type NavigationTab = 'outline' | 'search' | 'bookmarks' | 'library'

const props = defineProps<{
  open: boolean
  activeTab: NavigationTab
  document: ReaderDocument | null
  activeTarget: string | number
  searchQuery: string
  searchHits: SearchHit[]
  searchTotal: number
  searchVisibleCount: number
  searchStatus: string
  searching: boolean
  bookmarks: BookmarkRecord[]
  recentDocuments: DocumentMeta[]
}>()

const emit = defineEmits<{
  close: []
  changeTab: [tab: NavigationTab]
  navigateOutline: [item: OutlineItem]
  jump: [value: number]
  updateSearchQuery: [value: string]
  search: []
  cancelSearch: []
  openSearchHit: [hit: SearchHit]
  showMoreSearch: []
  openBookmark: [bookmark: BookmarkRecord]
  deleteBookmark: [bookmarkId: string]
  openRecent: [documentId: string]
  deleteRecent: [documentId: string]
}>()

const drawer = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const outlineFilter = ref('')
const jumpValue = ref('')

const tabs = computed(() => {
  const all: Array<{ id: NavigationTab; label: string; icon: typeof ListTree }> = [
    { id: 'outline', label: '目录', icon: ListTree },
    { id: 'search', label: '搜索', icon: Search },
    { id: 'bookmarks', label: '书签', icon: Bookmark },
    { id: 'library', label: '书库', icon: BookOpen },
  ]
  return props.document ? all : all.filter((tab) => tab.id === 'library')
})

const filteredOutline = computed(() => {
  const query = outlineFilter.value.trim().toLocaleLowerCase()
  if (!query) return props.document?.outline ?? []
  return (props.document?.outline ?? []).filter((item) =>
    item.title.toLocaleLowerCase().includes(query),
  )
})

const visibleHits = computed(() => props.searchHits.slice(0, props.searchVisibleCount))

const formatLabel: Record<DocumentMeta['format'], string> = {
  txt: 'TXT',
  markdown: 'MD',
  html: 'HTML',
  rtf: 'RTF',
  epub: 'EPUB',
  docx: 'DOCX',
  pdf: 'PDF',
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatBookmarkPosition(bookmark: BookmarkRecord): string {
  if (bookmark.locator.kind === 'paged') return `第 ${bookmark.locator.page} 页`
  return `${Math.round(bookmark.locator.ratio * 100)}%`
}

function submitJump() {
  const value = Number(jumpValue.value)
  if (Number.isInteger(value) && value > 0) emit('jump', value)
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.value.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.value.length) % tabs.value.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.value.length - 1
  else return
  event.preventDefault()
  emit('changeTab', tabs.value[next].id)
  nextTick(() => drawer.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus())
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !drawer.value) return
  const focusable = Array.from(
    drawer.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    closeButton.value?.focus()
  },
)
</script>

<template>
  <aside
    ref="drawer"
    class="side-drawer navigation-drawer"
    :class="{ open }"
    :aria-hidden="!open"
    :inert="!open"
    aria-label="阅读导航"
    @keydown="trapFocus"
  >
    <div class="drawer-header">
      <strong>阅读导航</strong>
      <button ref="closeButton" class="icon-button" type="button" aria-label="关闭阅读导航" @click="$emit('close')">
        <X :size="20" />
      </button>
    </div>

    <div class="drawer-tabs" role="tablist" aria-label="导航内容">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :class="{ active: activeTab === tab.id }"
        @click="$emit('changeTab', tab.id)"
        @keydown="handleTabKeydown($event, index)"
      >
        <component :is="tab.icon" :size="17" />
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeTab === 'outline' && document" class="drawer-panel" role="tabpanel">
      <form class="jump-form" @submit.prevent="submitJump">
        <input
          v-model="jumpValue"
          type="number"
          min="1"
          :max="document.kind === 'paged' ? document.pageCount : document.sections.length"
          :placeholder="document.kind === 'paged' ? '页码' : '章节序号'"
          :aria-label="document.kind === 'paged' ? '跳转页码' : '跳转章节序号'"
        />
        <button class="secondary-command" type="submit">跳转</button>
      </form>
      <input v-model="outlineFilter" class="drawer-search" type="search" placeholder="筛选目录" aria-label="筛选目录" />
      <p class="panel-status">
        {{ document.outline.length ? `共 ${document.outline.length} 项` : document.kind === 'paged' ? '此 PDF 没有内置目录' : '未识别到标题' }}
      </p>
      <ol class="outline-list">
        <li v-for="item in filteredOutline" :key="item.id">
          <button
            type="button"
            :class="{ active: activeTarget === (item.anchorId ?? item.target) }"
            :style="{ paddingInlineStart: `${12 + Math.min(5, item.level - 1) * 16}px` }"
            :aria-current="activeTarget === (item.anchorId ?? item.target) ? 'location' : undefined"
            @click="$emit('navigateOutline', item)"
          >
            {{ item.title }}
          </button>
        </li>
      </ol>
    </section>

    <section v-else-if="activeTab === 'search' && document" class="drawer-panel" role="tabpanel">
      <form class="search-form" @submit.prevent="$emit('search')">
        <input
          :value="searchQuery"
          type="search"
          placeholder="搜索全文"
          aria-label="搜索全文"
          @input="$emit('updateSearchQuery', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="searching"
          class="secondary-command square-command"
          type="button"
          aria-label="取消搜索"
          title="取消搜索"
          @click="$emit('cancelSearch')"
        >
          <X :size="18" />
        </button>
        <button v-else class="primary-command square-command" type="submit" aria-label="开始搜索">
          <FileSearch :size="18" />
        </button>
      </form>
      <p class="panel-status" role="status" aria-live="polite">{{ searchStatus }}</p>
      <ol class="search-result-list">
        <li v-for="hit in visibleHits" :key="hit.id">
          <button type="button" @click="$emit('openSearchHit', hit)">
            <strong>{{ hit.label }}</strong>
            <span>{{ hit.snippet }}</span>
          </button>
        </li>
      </ol>
      <button
        v-if="visibleHits.length < searchHits.length"
        class="secondary-command load-more"
        type="button"
        @click="$emit('showMoreSearch')"
      >
        显示更多（{{ visibleHits.length }} / {{ searchHits.length }}）
      </button>
      <p v-if="searchTotal > searchHits.length" class="panel-status">
        匹配共 {{ searchTotal }} 处，已保留前 {{ searchHits.length }} 处
      </p>
    </section>

    <section v-else-if="activeTab === 'bookmarks' && document" class="drawer-panel" role="tabpanel">
      <p class="panel-status">{{ bookmarks.length ? `共 ${bookmarks.length} 个书签` : '还没有书签' }}</p>
      <ol class="bookmark-list">
        <li v-for="bookmark in bookmarks" :key="bookmark.id">
          <button class="bookmark-open" type="button" @click="$emit('openBookmark', bookmark)">
            <strong>{{ bookmark.label }}</strong>
            <span>{{ formatBookmarkPosition(bookmark) }} · {{ bookmark.excerpt }}</span>
          </button>
          <button
            class="icon-button quiet-button"
            type="button"
            :aria-label="`删除书签 ${bookmark.label}`"
            title="删除书签"
            @click="$emit('deleteBookmark', bookmark.id)"
          >
            <Trash2 :size="17" />
          </button>
        </li>
      </ol>
    </section>

    <section v-else class="drawer-panel" role="tabpanel">
      <p class="panel-status">{{ recentDocuments.length ? `最近打开 ${recentDocuments.length} 本` : '书库为空' }}</p>
      <ol class="library-list">
        <li v-for="item in recentDocuments" :key="item.id">
          <button class="library-open" type="button" @click="$emit('openRecent', item.id)">
            <span class="format-badge">{{ formatLabel[item.format] }}</span>
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ formatSize(item.size) }}</small>
            </span>
          </button>
          <button
            class="icon-button quiet-button"
            type="button"
            :aria-label="`从书库移除 ${item.title}`"
            title="从书库移除"
            @click="$emit('deleteRecent', item.id)"
          >
            <Trash2 :size="17" />
          </button>
        </li>
      </ol>
    </section>
  </aside>
</template>
