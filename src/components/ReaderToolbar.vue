<script setup lang="ts">
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Download,
  Expand,
  FilePlus2,
  Menu,
  Minimize,
  Pause,
  Printer,
  Play,
  Settings2,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next'

defineProps<{
  title: string
  subtitle: string
  hasDocument: boolean
  bookmarked: boolean
  autoScrolling: boolean
  isPdf: boolean
  fullscreen: boolean
  progress: number
  zoomLabel: string
  zoomOutDisabled: boolean
  zoomInDisabled: boolean
}>()

defineEmits<{
  openNavigation: []
  openFile: []
  openLibrary: []
  toggleBookmark: []
  toggleAutoScroll: []
  openSettings: []
  toggleFullscreen: []
  zoomOut: []
  zoomIn: []
  download: []
  print: []
}>()
</script>

<template>
  <header class="reader-toolbar">
    <div class="toolbar-leading">
      <button
        class="icon-button"
        type="button"
        aria-label="打开阅读导航"
        title="阅读导航"
        :disabled="!hasDocument"
        @click="$emit('openNavigation')"
      >
        <Menu :size="20" />
      </button>
      <button class="brand-button" type="button" title="书库" @click="$emit('openLibrary')">
        <BookOpen :size="20" />
        <span>知页</span>
      </button>
      <div class="document-heading">
        <strong>{{ title }}</strong>
        <span>{{ subtitle }}</span>
      </div>
    </div>

    <div class="toolbar-actions">
      <button class="tool-button" type="button" title="打开文档" @click="$emit('openFile')">
        <FilePlus2 :size="18" />
        <span>打开</span>
      </button>
      <div v-if="hasDocument" class="toolbar-zoom" aria-label="文档缩放">
        <button
          class="icon-button"
          type="button"
          aria-label="缩小文档"
          title="缩小文档"
          :disabled="zoomOutDisabled"
          @click="$emit('zoomOut')"
        >
          <ZoomOut :size="18" />
        </button>
        <output class="toolbar-zoom-value">{{ zoomLabel }}</output>
        <button
          class="icon-button"
          type="button"
          aria-label="放大文档"
          title="放大文档"
          :disabled="zoomInDisabled"
          @click="$emit('zoomIn')"
        >
          <ZoomIn :size="18" />
        </button>
      </div>
      <button
        v-if="isPdf"
        class="icon-button desktop-only"
        type="button"
        aria-label="下载 PDF"
        title="下载 PDF"
        @click="$emit('download')"
      >
        <Download :size="18" />
      </button>
      <button
        v-if="isPdf"
        class="icon-button desktop-only"
        type="button"
        aria-label="打印 PDF"
        title="打印 PDF"
        @click="$emit('print')"
      >
        <Printer :size="18" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="bookmarked ? '移除当前位置书签' : '收藏当前位置'"
        :aria-pressed="bookmarked"
        :title="bookmarked ? '移除书签' : '添加书签'"
        :disabled="!hasDocument"
        @click="$emit('toggleBookmark')"
      >
        <BookmarkCheck v-if="bookmarked" :size="19" />
        <Bookmark v-else :size="19" />
      </button>
      <button
        v-if="!isPdf"
        class="icon-button"
        type="button"
        :aria-label="autoScrolling ? '停止自动滚动' : '开始自动滚动'"
        :aria-pressed="autoScrolling"
        :title="autoScrolling ? '停止自动滚动' : '自动滚动'"
        :disabled="!hasDocument"
        @click="$emit('toggleAutoScroll')"
      >
        <Pause v-if="autoScrolling" :size="19" />
        <Play v-else :size="19" />
      </button>
      <button
        class="icon-button"
        type="button"
        aria-label="打开阅读设置"
        title="阅读设置"
        @click="$emit('openSettings')"
      >
        <Settings2 :size="19" />
      </button>
      <button
        class="icon-button desktop-only"
        type="button"
        :aria-label="fullscreen ? '退出全屏' : '进入全屏'"
        :aria-pressed="fullscreen"
        :title="fullscreen ? '退出全屏' : '全屏'"
        @click="$emit('toggleFullscreen')"
      >
        <Minimize v-if="fullscreen" :size="19" />
        <Expand v-else :size="19" />
      </button>
    </div>
    <div
      class="toolbar-progress"
      role="progressbar"
      aria-label="阅读进度"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(progress)"
    >
      <span :style="{ width: `${Math.max(0, Math.min(100, progress))}%` }" />
    </div>
  </header>
</template>
