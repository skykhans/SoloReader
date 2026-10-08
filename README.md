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

## Windows 桌面客户端

桌面版使用 Tauri 2 和 WebView2，复用现有阅读界面和本地解析逻辑。支持系统文件选择、拖放打开、PDF 另存为、全文打印、系统浏览器打开外部链接和窗口全屏。关闭窗口前保存阅读进度。

### 编译环境

- Rust stable（1.90 或更高版本，Windows MSVC 工具链）。
- Visual Studio 2022 Build Tools：安装“使用 C++ 的桌面开发”，包含 MSVC 和 Windows SDK。
- Node.js 与 npm。
- Microsoft Edge WebView2 Runtime；安装包会在缺少运行时的机器上联网安装。

```powershell
npm install
npm run desktop:dev
npm run desktop:build
```

开发模式使用固定端口 `127.0.0.1:5173`；退出桌面开发命令时会停止其启动的 Vite 服务。正式版内置前端资源，不需要启动服务器。

Rust 依赖通过项目内 `.cargo/config.toml` 使用 rsproxy 镜像，避免当前网络下官方源连接超时。版本和校验值记录在 `src-tauri/Cargo.lock`。

Windows 安装包输出到 `src-tauri/target/release/bundle/nsis/`，可执行文件为 `src-tauri/target/release/solo-reader.exe`。安装包仅安装到当前用户，无需管理员权限。当前生成的安装包未配置代码签名。

桌面书库与网页版书库相互独立。Windows 桌面数据位于 `%LOCALAPPDATA%/com.soloreader.desktop/` 下的 WebView2 数据目录；不连接远程数据库。

桌面 PDF 打印会以 150 DPI 逐页生成打印图像，保留页面尺寸和原文档方向，再打开系统打印界面；大文档准备打印时会占用更多内存。

## 格式边界

- TXT：严格 UTF-8、带 BOM 的 UTF-8、GB18030/GBK。
- Markdown：关闭原生 HTML，净化渲染结果。
- HTML：提取 `article`、`main` 或 `body`，禁止脚本、表单、iframe、远程图片和危险链接。
- RTF：提取常见段落、换行、制表符和 Unicode 字符。
- EPUB：读取容器、OPF 和 spine 章节，支持 ZIP 存储及 Deflate 压缩。
- DOCX：提取正文段落和 Heading 样式目录。
- PDF：PDF.js 分页 Canvas、文本层、注释层、目录、密码、全文搜索、缩放、下载和打印。
