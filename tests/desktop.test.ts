import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { selectDesktopDocument, saveDesktopPdf } from '../src/services/desktop'
import { disposeDesktopPrint, printDesktopPdf } from '../src/services/desktop-print'

const native = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open, save: native.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: native.readFile, writeFile: native.writeFile }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

beforeEach(() => vi.resetAllMocks())
afterEach(() => {
  disposeDesktopPrint()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('桌面文件操作', () => {
  it('取消对话框时不读取或写入文件', async () => {
    native.open.mockResolvedValue(null)
    native.save.mockResolvedValue(null)
    expect(await selectDesktopDocument()).toBeNull()
    await saveDesktopPdf(new File(['%PDF'], '阅读.pdf'))
    expect(native.readFile).not.toHaveBeenCalled()
    expect(native.writeFile).not.toHaveBeenCalled()
  })

  it('使用中文文件名和原始字节，并向上抛出读取失败', async () => {
    native.open.mockResolvedValue('C:\\书籍\\测试.pdf')
    native.readFile.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    const file = await selectDesktopDocument()
    expect(file?.name).toBe('测试.pdf')
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    native.readFile.mockRejectedValue(new Error('读取被拒绝'))
    await expect(selectDesktopDocument()).rejects.toThrow('读取被拒绝')
  })
})

describe('桌面 PDF 打印', () => {
  function mockPdf(renderError?: Error): PDFDocumentProxy {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['page'])))
    vi.stubGlobal('Image', function () {
      const image = document.createElement('img')
      image.decode = vi.fn().mockResolvedValue(undefined)
      return image
    })
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:print-page')
      static revokeObjectURL = vi.fn()
    })
    return {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: (pageNumber === 1 ? 595 : 842) * scale, height: 842 * scale }),
        render: () => ({ promise: renderError ? Promise.reject(renderError) : Promise.resolve() }),
      })),
    } as unknown as PDFDocumentProxy
  }

  it('打印全部页面，保留各页尺寸，打印结束后释放所有资源', async () => {
    const pdf = mockPdf()
    native.invoke.mockResolvedValue(undefined)
    await printDesktopPdf(pdf, vi.fn())
    expect(document.querySelectorAll('.desktop-print-pages img')).toHaveLength(2)
    expect(document.querySelector<HTMLStyleElement>('style')?.textContent).toContain('size: 842pt 842pt')
    expect(native.invoke).toHaveBeenCalledWith('print_document')
    await expect(printDesktopPdf(pdf, vi.fn())).rejects.toThrow('请先关闭当前打印窗口')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.querySelector('.desktop-print-pages')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('渲染或原生打印失败时清理页面，并允许再次打印', async () => {
    await expect(printDesktopPdf(mockPdf(new Error('渲染失败')), vi.fn())).rejects.toThrow('渲染失败')
    expect(native.invoke).not.toHaveBeenCalled()
    expect(document.querySelector('.desktop-print-pages')).toBeNull()
    native.invoke.mockRejectedValue(new Error('打印失败'))
    await expect(printDesktopPdf(mockPdf(), vi.fn())).rejects.toThrow('打印失败')
    expect(document.querySelector('.desktop-print-pages')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
