<script setup lang="ts">
import { BookOpenText, FileText, Trash2 } from 'lucide-vue-next'
import type { DocumentMeta } from '../domain/document'

defineProps<{
  recentDocuments: DocumentMeta[]
}>()

defineEmits<{
  openFile: []
  openRecent: [documentId: string]
  removeRecent: [documentId: string]
}>()

const formatLabels: Record<DocumentMeta['format'], string> = {
  txt: 'TXT',
  markdown: 'MD',
  html: 'HTML',
  rtf: 'RTF',
  epub: 'EPUB',
  docx: 'DOCX',
  pdf: 'PDF',
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <main class="empty-reader" aria-labelledby="empty-title">
    <section class="open-document-panel">
      <BookOpenText :size="42" stroke-width="1.5" />
      <h1 id="empty-title">打开本地文档</h1>
      <p>TXT · Markdown · HTML · PDF</p>
      <button class="primary-command" type="button" @click="$emit('openFile')">
        <FileText :size="18" />
        选择文档
      </button>
    </section>

    <section v-if="recentDocuments.length" class="recent-section" aria-labelledby="recent-title">
      <h2 id="recent-title">最近阅读</h2>
      <ul class="recent-list">
        <li v-for="document in recentDocuments" :key="document.id">
          <button class="recent-open" type="button" @click="$emit('openRecent', document.id)">
            <span class="format-badge">{{ formatLabels[document.format] }}</span>
            <span class="recent-meta">
              <strong>{{ document.title }}</strong>
              <small>{{ formatSize(document.size) }}</small>
            </span>
          </button>
          <button
            class="icon-button quiet-button"
            type="button"
            :aria-label="`从书库移除 ${document.title}`"
            title="从书库移除"
            @click="$emit('removeRecent', document.id)"
          >
            <Trash2 :size="17" />
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
