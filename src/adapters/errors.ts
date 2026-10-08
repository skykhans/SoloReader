export class DocumentFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentFormatError'
  }
}

export class DocumentEncodingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentEncodingError'
  }
}

export class DocumentParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentParseError'
  }
}

export type PdfPasswordFailure = 'required' | 'incorrect'

export class PdfPasswordError extends Error {
  readonly reason: PdfPasswordFailure

  constructor(reason: PdfPasswordFailure) {
    super(reason === 'required' ? '该 PDF 需要密码才能打开' : 'PDF 密码错误')
    this.name = 'PdfPasswordError'
    this.reason = reason
  }
}
