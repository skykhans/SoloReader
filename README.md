# 知页阅读器

本地优先的通用文档阅读器，支持 TXT、Markdown、HTML/HTM、RTF、EPUB、DOCX 和 PDF。

## 开发

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm run typecheck
npm run test:run
npm run build
```

文档只在本机浏览器中解析。书库文件、进度和书签存入 IndexedDB，阅读设置存入 localStorage。

## 格式边界

- TXT：严格 UTF-8、带 BOM 的 UTF-8、GB18030/GBK。
- Markdown：关闭原生 HTML，净化渲染结果。
- HTML：提取 `article`、`main` 或 `body`，禁止脚本、表单、iframe、远程图片和危险链接。
- RTF：提取常见段落、换行、制表符和 Unicode 字符。
- EPUB：读取容器、OPF 和 spine 章节，支持 ZIP 存储及 Deflate 压缩。
- DOCX：提取正文段落和 Heading 样式目录。
- PDF：PDF.js 分页 Canvas、文本层、注释层、目录、密码、全文搜索、缩放、下载和打印。
