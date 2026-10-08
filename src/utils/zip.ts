import { DocumentFormatError } from '../adapters/errors'

interface ZipEntry {
  compression: number
  compressedSize: number
  name: string
  offset: number
}

const decoder = new TextDecoder()

function signature(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) throw new DocumentFormatError('EPUB 缺少 ZIP 目录')
  const start = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (signature(bytes, offset) === 0x06054b50) return offset
  }
  throw new DocumentFormatError('EPUB 缺少 ZIP 目录')
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const end = findEndOfCentralDirectory(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (directoryOffset + directorySize > bytes.length) {
    throw new DocumentFormatError('EPUB 的 ZIP 目录超出文件范围')
  }

  const entries: ZipEntry[] = []
  let offset = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || offset >= directoryOffset + directorySize) {
      throw new DocumentFormatError('EPUB 的 ZIP 目录条目不完整')
    }
    if (signature(bytes, offset) !== 0x02014b50) {
      throw new DocumentFormatError('EPUB 包含无效的 ZIP 条目')
    }
    const flags = view.getUint16(offset + 8, true)
    const compression = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const entryOffset = view.getUint32(offset + 42, true)
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const name = decoder.decode(nameBytes)
    entries.push({ compression, compressedSize, name, offset: entryOffset })
    offset += 46 + nameLength + extraLength + commentLength
    if ((flags & 0x08) !== 0 && compressedSize === 0) {
      throw new DocumentFormatError('EPUB 使用了不受支持的数据描述符')
    }
  }
  return entries
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new DocumentFormatError('当前浏览器不支持 EPUB 解压')
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.offset + 30 > bytes.length || signature(bytes, entry.offset) !== 0x04034b50) {
    throw new DocumentFormatError(`EPUB 条目无效：${entry.name}`)
  }
  const nameLength = view.getUint16(entry.offset + 26, true)
  const extraLength = view.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > bytes.length) throw new DocumentFormatError(`EPUB 条目超出文件范围：${entry.name}`)
  const compressed = bytes.subarray(start, end)
  if (entry.compression === 0) return compressed.slice()
  if (entry.compression === 8) return inflateRaw(compressed)
  throw new DocumentFormatError(`EPUB 使用了不支持的压缩方式：${entry.name}`)
}

export async function readZipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const result = new Map<string, Uint8Array>()
  for (const entry of readEntries(bytes)) {
    result.set(entry.name, await readEntry(bytes, entry))
  }
  return result
}
