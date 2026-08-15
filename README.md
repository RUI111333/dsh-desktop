<p align="center">
  <img src="assets/icon.svg" alt="dsh-desktop" width="96"/>
</p>

<h1 align="center">dsh-desktop</h1>

<p align="center">
  <strong>DeepSeek Harness(dsh)的桌面端</strong>
  <br/>
  一个轻量 Electron 壳,启动内置的 <code>dsh web</code> 服务,把它的 Web UI 加载进原生窗口 —— <strong>界面与功能与 Web 版完全一致</strong>。
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="dsh" src="https://img.shields.io/badge/engine-DeepSeek%20Harness-4D6BFE?style=flat-square"/></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-3fb950?style=flat-square"/></a>
  <a href="https://github.com/RUI111333/dsh-desktop/releases"><img alt="release" src="https://img.shields.io/github/v/release/RUI111333/dsh-desktop?style=flat-square"/></a>
</p>

<p align="center">
  <a href="#-下载使用">下载使用</a> ·
  <a href="#-从源码构建">从源码构建</a> ·
  <a href="#-架构">架构</a> ·
  <a href="#-使用前提">使用前提</a> ·
  <a href="#-开源协议">开源协议</a>
</p>

<hr/>

> 架构参考 [reasonix](https://github.com/esengine/DeepSeek-Reasonix) 桌面端的「壳 + 本地服务 + WebView」模式。

## ✨ 特性

| 特性 | 说明 |
|---|---|
| 功能与 Web 版一致 | 窗口直接加载 dsh 的 Web UI,同一套前端、同一个后端 |
| 无边框深色外壳 | 自定义标题栏,视觉风格对齐 reasonix |
| 开箱即用 | 内置 `@deepseek-ai/dsh`,无需本地安装 / 构建 dsh |
| 系统托盘 | 关闭按钮最小化到托盘,托盘菜单可退出 |
| 单实例锁 | 重复启动只激活已有窗口,不重复拉起服务 |
| 窗口状态记忆 | 记住窗口位置与大小 |
| 更新提示 | 启动时自动检查 dsh 新版本,发现新版弹提示 |
| 黑鲸鱼图标 | 应用 / 快捷方式图标使用 dsh 自带的黑鲸鱼 logo |

## ⬇️ 下载使用

最省事的方式:到 [Releases](https://github.com/RUI111333/dsh-desktop/releases) 页面下载最新安装包。

| 文件 | 说明 |
|---|---|
| `DeepSeek Harness Setup x.y.z.exe` | NSIS 安装包,双击安装,自动创建桌面快捷方式 |
| `win-unpacked` 压缩包 | 免安装便携版,解压后双击 `DeepSeek Harness.exe` 即可 |

安装后首次启动约需 25 秒(初始化 profile),之后会快很多。

## 🚀 从源码构建

需要 [Node.js](https://nodejs.org/) ≥ 24。

```bash
git clone https://github.com/RUI111333/dsh-desktop.git
cd dsh-desktop
npm install
npm run icon     # 生成 build/ 下的 PNG 图标
npm start        # 开发模式运行
```

打包成安装器:

```bash
npm run dist     # electron-builder 打 NSIS 安装包,产物在 dist/
```

> 国内网络打包时,给 electron-builder 的辅助二进制加镜像:
>
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
> ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
> npm run dist
> ```

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│              Electron 主进程                 │
│  ┌───────────────────────────────────────┐  │
│  │  BrowserWindow(无边框 + 深色标题栏)    │  │
│  │   shell.html ── iframe → 127.0.0.1:3080│  │
│  └───────────────────────────────────────┘  │
│                    │ spawn                  │
│                    ▼                        │
│  dsh web 服务(Electron Node 子进程,        │
│  --expose-internals + ELECTRON_RUN_AS_NODE) │
└─────────────────────────────────────────────┘
```

主进程启动时用 Electron 自带的 Node 拉起内置的 `dsh web`,轮询等 `127.0.0.1:3080` 就绪后加载 `shell.html`;退出时给 dsh 发 `SIGTERM` 优雅关闭。

## 📁 目录结构

```
dsh-desktop/
├── main.js                 # Electron 主进程(启动 dsh、窗口、托盘、更新检查、生命周期)
├── shell.html              # 无边框窗口的深色外壳(标题栏 + iframe)
├── preload.js              # 预加载脚本(窗口控制 IPC)
├── assets/
│   └── icon.svg            # 黑鲸鱼图标源文件(dsh Web UI 的 favicon)
├── build/                  # 生成的 PNG 图标(npm run icon 产出)
├── scripts/
│   ├── make-icon.mjs       # SVG → 多尺寸 PNG
│   └── create-shortcut.ps1 # 创建桌面快捷方式
├── package.json            # 依赖 + electron-builder 打包配置
├── LICENSE                 # MIT
└── README.md
```

## 🔧 关键实现细节

1. **`--expose-internals`**:dsh 的 `web` profile 会挂一个 watch-only HMR 服务,该服务要求 Node 启动时带 `--expose-internals` 标志。因此主进程用 `ELECTRON_RUN_AS_NODE=1` + `--expose-internals` 启动 dsh:

   ```js
   spawn(process.execPath, ['--expose-internals', dshBin, 'web'], {
     env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
   });
   ```

2. **`npmRebuild: false`**:dsh 依赖的原生模块 `node-pty` 是 N-API(ABI 稳定),预编译二进制可直接用于 Electron 的 Node,无需重编译(重编译会因 winpty 子模块缺失而失败)。

## 🔑 使用前提

同 Web 版:需要配置 DeepSeek API Key。

- 环境变量 `DEEPSEEK_API_KEY`,或
- `~/.dsh/.env`,或
- `~/.dsh/.credentials.yaml`

## 📄 开源协议

[MIT](./LICENSE),与 dsh 一致。

> 图标(黑鲸鱼)为 DeepSeek 的商标,权利归 DeepSeek 所有。
