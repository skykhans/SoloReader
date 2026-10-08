import { defaultReaderSettings } from '../domain/defaults'
import type { ReaderSettings } from '../domain/document'

export const SETTINGS_STORAGE_KEY = 'universal-reader:settings:v1'

export const readerSettingsRanges = {
  fontSize: { min: 14, max: 32 },
  lineHeight: { min: 1.4, max: 2.6 },
  contentWidth: { min: 560, max: 1200 },
  paragraphGap: { min: 0, max: 2.5 },
  autoScrollSpeed: { min: 10, max: 120 },
} as const

const themes = new Set<ReaderSettings['theme']>(['light', 'paper', 'green', 'dark'])
const fontFamilies = new Set<ReaderSettings['fontFamily']>(['serif', 'kai', 'sans'])
const settingKeys = new Set([
  'theme',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'contentWidth',
  'paragraphGap',
  'indent',
  'autoScrollSpeed',
])

function assertNumberInRange(
  value: unknown,
  name: keyof typeof readerSettingsRanges,
  integer = false,
): asserts value is number {
  const range = readerSettingsRanges[name]
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < range.min ||
    value > range.max
  ) {
    throw new RangeError(`${name} must be ${range.min}-${range.max}${integer ? ' (integer)' : ''}`)
  }
}

export function validateReaderSettings(value: unknown): asserts value is ReaderSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Reader settings must be an object')
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== settingKeys.size || keys.some((key) => !settingKeys.has(key))) {
    throw new TypeError('Reader settings contain missing or unknown fields')
  }
  if (!themes.has(record.theme as ReaderSettings['theme'])) {
    throw new TypeError('Invalid reader theme')
  }
  if (!fontFamilies.has(record.fontFamily as ReaderSettings['fontFamily'])) {
    throw new TypeError('Invalid reader font family')
  }

  assertNumberInRange(record.fontSize, 'fontSize', true)
  assertNumberInRange(record.lineHeight, 'lineHeight')
  assertNumberInRange(record.contentWidth, 'contentWidth', true)
  assertNumberInRange(record.paragraphGap, 'paragraphGap')
  assertNumberInRange(record.autoScrollSpeed, 'autoScrollSpeed', true)

  if (typeof record.indent !== 'boolean') {
    throw new TypeError('indent must be a boolean')
  }
}

export function loadReaderSettings(storage: Storage = localStorage): ReaderSettings {
  const serialized = storage.getItem(SETTINGS_STORAGE_KEY)
  if (serialized === null) {
    return { ...defaultReaderSettings }
  }

  const value: unknown = JSON.parse(serialized)
  validateReaderSettings(value)
  return value
}

export function saveReaderSettings(settings: ReaderSettings, storage: Storage = localStorage): void {
  validateReaderSettings(settings)
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function clearReaderSettings(storage: Storage = localStorage): void {
  storage.removeItem(SETTINGS_STORAGE_KEY)
}
