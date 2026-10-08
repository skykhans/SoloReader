<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { KeyRound, X } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  fileName: string
  message: string
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [password: string]
  cancel: []
}>()

const password = ref('')
const input = ref<HTMLInputElement>()
const dialog = ref<HTMLElement>()
const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>(focusableSelector))
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
    password.value = ''
    await nextTick()
    input.value?.focus()
  },
)
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('cancel')">
    <section
      ref="dialog"
      class="reader-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-title"
      @keydown="trapFocus"
    >
      <div class="dialog-header">
        <KeyRound :size="20" />
        <h2 id="password-title">PDF 密码</h2>
        <button class="icon-button" type="button" aria-label="取消输入密码" @click="$emit('cancel')">
          <X :size="19" />
        </button>
      </div>
      <p class="dialog-document-name">{{ fileName }}</p>
      <p class="dialog-message" role="status">{{ message }}</p>
      <form @submit.prevent="$emit('submit', password)">
        <input ref="input" v-model="password" type="password" autocomplete="current-password" aria-label="PDF 密码" />
        <div class="dialog-actions">
          <button class="secondary-command" type="button" :disabled="busy" @click="$emit('cancel')">取消</button>
          <button class="primary-command" type="submit" :disabled="busy || !password">{{ busy ? '正在验证' : '打开 PDF' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
