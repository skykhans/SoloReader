import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { vi } from 'vitest'

Object.defineProperties(globalThis, {
  Blob: { configurable: true, value: NodeBlob },
  File: { configurable: true, value: NodeFile },
})

class StorageMock implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.#values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.#values.set(String(key), String(value))
  }
}

const localStorageMock = new StorageMock()
vi.stubGlobal('localStorage', localStorageMock)
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
})

Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: (handle: number) => window.clearTimeout(handle),
})
