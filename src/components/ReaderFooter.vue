<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'

defineProps<{
  visible: boolean
  previousDisabled: boolean
  nextDisabled: boolean
  title: string
  status: string
  previousLabel: string
  nextLabel: string
}>()

defineEmits<{
  previous: []
  next: []
}>()
</script>

<template>
  <nav v-if="visible" class="reader-footer" aria-label="阅读翻页">
    <button type="button" :disabled="previousDisabled" @click="$emit('previous')">
      <ArrowLeft :size="18" />
      <span>{{ previousLabel }}</span>
    </button>
    <div class="footer-status">
      <strong>{{ title }}</strong>
      <span>{{ status }}</span>
    </div>
    <button type="button" :disabled="nextDisabled" @click="$emit('next')">
      <span>{{ nextLabel }}</span>
      <ArrowRight :size="18" />
    </button>
  </nav>
</template>
