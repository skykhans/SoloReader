import { invoke } from '@tauri-apps/api/core'
import type { PDFDocumentProxy } from 'pdfjs-dist'

let activePrintCleanup: (() => void) | undefined

export async function printDesktopPdf(
  pdf: PDFDocumentProxy,
  onProgress: (page: number, total: number) => void,
): Promise<void> {
  if (activePrintCleanup) throw new Error('请先关闭当前打印窗口')

  const container = document.createElement('div')
  container.className = 'desktop-print-pages'
  const style = document.createElement('style')
  const urls: string[] = []
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境无法准备 PDF 打印画布')

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup)
    container.remove()
    style.remove()
    for (const url of urls) URL.revokeObjectURL(url)
    canvas.width = 0
    canvas.height = 0
    activePrintCleanup = undefined
  }
  activePrintCleanup = cleanup

  try {
    const rules: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(pageNumber, pdf.numPages)
      const page = await pdf.getPage(pageNumber)
      const dimensions = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 150 / 72 })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成 PDF 打印页面')), 'image/png')
      })
      const url = URL.createObjectURL(blob)
      urls.push(url)
      const image = new Image()
      image.src = url
      await image.decode()
      const sheet = document.createElement('section')
      const pageName = `pdf-sheet-${pageNumber}`
      sheet.style.page = pageName
      sheet.style.width = `${dimensions.width}pt`
      sheet.style.height = `${dimensions.height}pt`
      sheet.append(image)
      container.append(sheet)
      rules.push(`@page ${pageName} { size: ${dimensions.width}pt ${dimensions.height}pt; margin: 0; }`)
    }
    canvas.width = 0
    canvas.height = 0
    style.textContent = rules.join('\n')
    document.head.append(style)
    document.body.append(container)
    window.addEventListener('afterprint', cleanup, { once: true })
    await invoke('print_document')
  } catch (error) {
    cleanup()
    throw error
  }
}

export function disposeDesktopPrint() {
  activePrintCleanup?.()
}
