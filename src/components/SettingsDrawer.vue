<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Download, Minus, Plus, Printer, RotateCw, X } from 'lucide-vue-next'
import type { ReaderSettings } from '../domain/document'
import { readerSettingsRanges } from '../storage'

const props = defineProps<{
  open: boolean
  settings: ReaderSettings
  isPdf: boolean
  pdfScale: number
  pdfRotation: number
}>()

const emit = defineEmits<{
  close: []
  updateSetting: [key: keyof ReaderSettings, value: ReaderSettings[keyof ReaderSettings]]
  reset: []
  updatePdfScale: [value: number]
  fitPdfWidth: []
  rotatePdf: []
  download: []
  print: []
}>()

const drawer = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !drawer.value) return
  const focusable = Array.from(drawer.value.querySelectorAll<HTMLElement>(focusableSelector))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return

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
  { immediate: true },
)

const setNumber = (key: keyof ReaderSettings, event: Event) => {
  emit('updateSetting', key, Number((event.target as HTMLInputElement).value))
}

const updateFontSize = (delta: number) => {
  emit('updateSetting', 'fontSize', props.settings.fontSize + delta)
}
</script>

<template>
  <aside
    ref="drawer"
    class="side-drawer settings-drawer"
    :class="{ open }"
    :aria-hidden="!open"
    :inert="!open"
    aria-label="阅读设置"
    aria-modal="true"
    role="dialog"
    @keydown="trapFocus"
  >
    <div class="drawer-header">
      <strong>阅读设置</strong>
      <button ref="closeButton" class="icon-button" type="button" aria-label="关闭阅读设置" @click="$emit('close')">
        <X :size="20" />
      </button>
    </div>

    <div class="settings-body">
      <fieldset class="setting-group">
        <legend>主题</legend>
        <div class="theme-options">
          <button
            v-for="theme in [
              { value: 'light', label: '明亮' },
              { value: 'paper', label: '纸张' },
              { value: 'green', label: '护眼' },
              { value: 'dark', label: '深色' },
            ]"
            :key="theme.value"
            class="theme-option"
            :class="{ active: settings.theme === theme.value }"
            :aria-pressed="settings.theme === theme.value"
            type="button"
            @click="$emit('updateSetting', 'theme', theme.value)"
          >
            <span class="theme-swatch" :data-theme-swatch="theme.value" />
            {{ theme.label }}
          </button>
        </div>
      </fieldset>

      <template v-if="!isPdf">
        <fieldset class="setting-group">
          <legend>字体</legend>
          <div class="segmented-control">
            <button
              v-for="font in [
                { value: 'serif', label: '宋体' },
                { value: 'kai', label: '楷体' },
                { value: 'sans', label: '黑体' },
              ]"
              :key="font.value"
              type="button"
              :class="{ active: settings.fontFamily === font.value }"
              :aria-pressed="settings.fontFamily === font.value"
              @click="$emit('updateSetting', 'fontFamily', font.value)"
            >
              {{ font.label }}
            </button>
          </div>
        </fieldset>

        <fieldset class="setting-group">
          <legend>字号</legend>
          <div class="stepper-control">
            <button
              type="button"
              aria-label="减小字号"
              :disabled="settings.fontSize <= readerSettingsRanges.fontSize.min"
              @click="updateFontSize(-1)"
            >
              <Minus :size="17" />
            </button>
            <output>{{ settings.fontSize }} px</output>
            <button
              type="button"
              aria-label="增大字号"
              :disabled="settings.fontSize >= readerSettingsRanges.fontSize.max"
              @click="updateFontSize(1)"
            >
              <Plus :size="17" />
            </button>
          </div>
        </fieldset>

        <label class="range-setting">
          <span>行距 <output>{{ settings.lineHeight.toFixed(2) }}</output></span>
          <input
            type="range"
            min="1.4"
            max="2.6"
            step="0.05"
            :value="settings.lineHeight"
            @input="setNumber('lineHeight', $event)"
          />
        </label>
        <label class="range-setting">
          <span>版心 <output>{{ settings.contentWidth }} px</output></span>
          <input
            type="range"
            min="560"
            max="1200"
            step="20"
            :value="settings.contentWidth"
            @input="setNumber('contentWidth', $event)"
          />
        </label>
        <label class="range-setting">
          <span>段距 <output>{{ settings.paragraphGap.toFixed(1) }} em</output></span>
          <input
            type="range"
            min="0"
            max="2.5"
            step="0.1"
            :value="settings.paragraphGap"
            @input="setNumber('paragraphGap', $event)"
          />
        </label>
        <label class="toggle-setting">
          <span>首行缩进</span>
          <input
            type="checkbox"
            :checked="settings.indent"
            @change="$emit('updateSetting', 'indent', ($event.target as HTMLInputElement).checked)"
          />
        </label>
        <label class="range-setting">
          <span>自动滚动 <output>{{ settings.autoScrollSpeed }} px/s</output></span>
          <input
            type="range"
            min="10"
            max="120"
            step="2"
            :value="settings.autoScrollSpeed"
            @input="setNumber('autoScrollSpeed', $event)"
          />
        </label>
      </template>

      <template v-else>
        <fieldset class="setting-group">
          <legend>页面缩放</legend>
          <div class="stepper-control">
            <button type="button" aria-label="缩小页面" @click="$emit('updatePdfScale', pdfScale - 0.1)">
              <Minus :size="17" />
            </button>
            <output>{{ Math.round(pdfScale * 100) }}%</output>
            <button type="button" aria-label="放大页面" @click="$emit('updatePdfScale', pdfScale + 0.1)">
              <Plus :size="17" />
            </button>
          </div>
          <div class="pdf-setting-actions">
            <button type="button" class="secondary-command" @click="$emit('fitPdfWidth')">适合宽度</button>
            <button type="button" class="secondary-command" @click="$emit('rotatePdf')">
              <RotateCw :size="17" />
              旋转 {{ pdfRotation }}°
            </button>
            <button type="button" class="secondary-command" @click="$emit('download')">
              <Download :size="17" />
              下载 PDF
            </button>
            <button type="button" class="secondary-command" @click="$emit('print')">
              <Printer :size="17" />
              打印 PDF
            </button>
          </div>
        </fieldset>
      </template>

      <button class="secondary-command reset-button" type="button" @click="$emit('reset')">恢复默认设置</button>
    </div>
  </aside>
</template>
