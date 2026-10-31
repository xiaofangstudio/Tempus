# ⏱️ Tempus

> 小方工作室出品 ｜ Windows 桌面 ｜ MIT ｜ 完全免费 ｜ **当前版本 0.2.0**

**编码动效工作室：人写代码，实时渲染成片。**

现在用代码做视频很火（Remotion 带起来的这股风），但它天生是给 AI 和前端工程师用的命令行工具——要装 Node，要敲命令，写完才知道长什么样。Tempus 把同样的思路做成一个完整的桌面软件：左边是真正的代码编辑器，中间是一块大监视器，底下是一条时间轴——改一行代码，画面立刻变。**人直接上手改，也可以把外部 AI 接进来替你写。**

一句话记住：**代码做视频的内核，剪辑软件的顺手，AI 的后门。**

---

## 🚨 先看这一条

| 你可能想问 | 答案 |
| --- | --- |
| 这是给谁用的？ | 会一点 React 的人、想让 AI 写动画的人、厌倦了「改一行代码等十秒编译」的人 |
| 要会 React 吗？ | 要一点。动画就是普通 React 组件加一个 `useFrame()`，API 一共八个，十分钟上手，内置 API 文档随时查 |
| AI 能用吗？ | 能。自带 MCP 服务（12 个工具，Streamable HTTP），外部 AI 客户端粘一段配置就能连上，读工程、改代码、直接渲染出片 |
| 内置 AI 吗？ | 不内置。软件本身不含任何大模型，AI 走 MCP 从外面接 |
| 要装环境吗？ | **不用。** 编译引擎、ffmpeg 编码器、技能库全部打进安装目录，解压双击就能跑 |
| 要钱吗？要登录吗？ | 不要钱，不要账号，MIT 许可，不联网 |
| 有 macOS / 手机版吗？ | 没有，只做 Windows 桌面 |

---

## 🆕 这个版本（0.2.0）更新了什么

上一版还像个「能跑的雏形」，这一版是**真能当 IDE 用、真能出片**的一版。最硬的那根刺——预览白屏——拔掉了，然后一口气把整条链路补齐。

| 新东西 | 说白了就是 |
| --- | --- |
| 📺 **预览不再白屏，真能出片** | CSP 补上 `wasm-unsafe-eval` 与 `worker-src blob:`，esbuild-wasm 终于能在界面里实例化；worker 模式失败自动降级，编译初始化也纳进错误捕获，出问题会有像样的报错 |
| 🔁 **Remotion 代码搬过来更顺** | 补齐 `random(seed)`、`noise1D`、`useCurrentFrame`、`Series`、`Freeze`；`interpolate` 加 `posterize` 与 `extrapolate`，`spring` 加 `delay`/`reverse`，`Easing` 补 `bezier` 与各组合器。顺手修掉「文档声明了 `Easing.bezier`、运行时却没有」的坑——以前照着文档写必崩 |
| 🧭 **八菜单 IDE 化** | 顶部菜单栏：文件 / 编辑 / 选择 / 查看 / 转到 / 运行 / 终端 / 帮助。数据驱动、支持打勾 / 禁用 / 快捷键右对齐，键盘 ←→ 切菜单、↑↓ 选、Enter 执行，对齐 VS Code 手感 |
| ⌨️ **原生弹窗全废，改自绘** | Tauri 里 `window.prompt` 恒返回 null、`confirm` 恒返回 false——新建 / 改名 / 删除 / 分支这些以前「点了没反应」的全中招。现在全换成自绘对话框：自动聚焦全选、Enter 提交、Esc 取消 |
| 🍞 **IDE 味儿细节** | 面包屑（工程 › 目录 › 文件）、状态栏（行 / 列 / 字数 / 扩展名）、Ctrl+W 关标签 / Ctrl+Tab 切换 / 中键关闭、空态快捷键提示、帮助里的快捷键一览 |
| 🖱️ **操作更顺手** | 侧栏可拖宽（记住宽度、双击复位）、Ctrl+P 快速打开（递归索引 + 模糊评分）、预览 Ctrl+滚轮缩放、时间轴拖拽 seek 合并进 rAF 不再抖 |
| 🔊 **音频：从 0 到 1 全打通** | 新增 `<Audio>` 组件，`volume` 每帧求值就是真淡入淡出，seek 精确不爆音；离线混音出 16bit/48k WAV，导出时 ffmpeg 自动混流。**画面驱动音频** |
| 📊 **双监视器** | 画面监视器之外再加一条音频示波器：真实峰值、每秒网格、点 / 拖即 seek |
| 🎬 **序列器（多文件合并）** | 画面轨拖拽排序 → 逐段渲染 → `video_concat` 无缝拼接（`-c copy` 失败自动重编码兜底），一条配乐铺满 |
| ⚡ **并行渲染（真多线程）** | 帧区间等分，多线程各开一个无头浏览器 + 一条 ffmpeg，全部完成再拼接；配合设备信息，按你的 CPU 核数与内存给「建议并行数」 |
| 🎞️ **新建分类型 + 画幅预设** | 新建可选「画面 / 音频」，6 种画幅一键选（16:9 / 9:16 / 1:1 / 4:5 / 2.39:1 / 4:3） |
| 🌙 **暗色模式** | 只覆盖 CSS 变量、组件零改；Monaco 配 `tempus-dark` 主题，canvas 时间轴改成双色板，暗色下不再是一整块白 |
| 📦 **第三方 npm 包能 import** | 按 Node 规则逐级找 `node_modules`，读 `module`/`browser`/`main`——把包装进工程目录就能用 |
| 📚 **技能库 7 → 12** | 重写 `tempus-api`，新增 `remotion-parity`（Remotion→Tempus 对照表 + 踩坑）、`lower-thirds`、`data-viz`、`three-d-scene`、`audio` |
| 🛠️ **又补了一轮打磨** | 音频示波器与画面预览继续优化、工作台三者联动增强、新图标与样式打磨，`audio.md` 技能同步更新；工作台支持拖拽分屏（新增 `Splitter`），帧选取器抽成 `frame.ts` 重构，新建模板体系重写 |

一句话：**从「能跑」变成「真能干活」。**

---

## 📦 下载就能用

**想直接用** → 去 [Releases](https://github.com/xiaofangstudio/Tempus/releases) 下载 `Tempus-0.2.0-win64.zip`，解压、双击 `Tempus.exe`。不用装 Node、不用编译、不用配环境。

压缩包里就三样东西：

| 文件 / 目录 | 是什么 |
| --- | --- |
| `Tempus.exe` | 主程序，双击就开 |
| `ffmpeg/` | 全套编码运行时（ffmpeg + ffprobe + 7 个 DLL），已经在包里备好，**不用自己找 ffmpeg** |
| `skills/` | 内置动效方法论文档，AI 经 MCP 直接读 |

**想改代码** → 这个仓库里是完整源码：`scaffold/` 是 React + Tauri 全量工程，编码运行时在 `scaffold/src-tauri/ffmpeg/`，技能库在 `scaffold/src-tauri/skills/`。自己构建看下面的「🔨 自己构建」。

环境清单短得可怜，而且**全都自带或系统本来就有**：

| 依赖 | 从哪来 |
| --- | --- |
| WebView2 | Windows 10 / 11 自带 |
| Microsoft Edge（无头渲染用） | Windows 10 / 11 自带 |
| PowerShell（真终端用） | Windows 自带 |
| ffmpeg 编码器 | 目录里已备好 |
| esbuild-wasm 编译引擎 | 已打进程序，跑在界面进程里，**不需要 Node** |

解压到哪就在哪跑，换机器直接拷贝整个文件夹。

---

## 🧱 它能做什么

### 三块屏幕，一条链路

| 区域 | 能干什么 |
| --- | --- |
| 编辑器 | Monaco 编辑器（VS Code 同款内核），TypeScript / TSX 语法高亮、多文件树、错误即时报 |
| 监视器 | 大预览窗，代码保存即重新编译渲染，可拖播放头逐帧检查，画面与时间轴双向联动 |
| 时间轴 | 帧刻度、播放头拖拽、`mark()` 标记直接落在轴上，播放 / 暂停 / 逐帧步进 |

### 真 IDE 工作台（左侧）

进工程后左边不是玩具编辑器，是一套完整的 IDE：

| 能力 | 说明 |
| --- | --- |
| 文件树 | 懒加载递归目录，右键新建（.tsx 自动带模板）/ 重命名 / 删除 |
| 多标签页 | 未保存打点、中途关闭有提示，点开即切 |
| 智能补全 | Monaco + TypeScript 语言服务：`tempus` / `react` / `three` 全量真实类型，悬停看文档，错误即时报 |
| 保存 | Ctrl+S 全局保存全部未保存文件，即时落盘 |
| 命令面板 | Ctrl+Shift+P，所有命令一搜即达 |
| 真终端 | Ctrl+` 呼出，xterm.js + 真实 PowerShell 子进程（ConPTY），npm / git 随便敲，支持多终端标签 |
| Git 完整版 | 源代码管理面板（暂存 / 取消暂存 / 逐文件 diff）、提交（Ctrl+Enter）、分支切换 / 新建 / 删除、提交历史、push / pull / remote、init 一条龙 |

diff 视图左右分屏：工作区改动对着暂存区比，暂存区改动对着 HEAD 比，每一处修改看得清清楚楚。

### 加载页与欢迎页

- 启动先过加载页：资源初始化、esbuild-wasm 编译引擎就位
- 欢迎页双栏：左边**新建工程 / 打开工程 / 导入工程包**，右边模板卡片点选
- 新建工程三步走：点选模板 → 填名字选位置 → 一键落地；目录位置会记住上次的选择
- 最近工程：记住你最近开过的，一点就回，不要了可以逐条移除
- 全局深蓝 + 白配色，工程起点该有的安静样子

### 三套开箱模板

| 模板 | 里面有什么 |
| --- | --- |
| 空白工程 | 最小骨架：一个合成、一个组件、确定性纪律注释 |
| 标准工程 | 三幕正片 starter：场景拆文件、文案数据分离（data.ts）、颜色集中（theme.ts），换片不动代码 |
| 3D 工程 | three.js 星空：9000 粒子黄金角螺旋星野 + 线框二十面体 + 运镜，确定性 3D |

模板统一走专业克制风：深底、细字、单一强调色——工程起点，不是成品炫技。

### 工程管理

- 工程就是一个普通文件夹：`project.json` + `src/` 源码，随便用别的编辑器改也认
- **导入 / 导出工程**：打包成 `.tempus` 文件（ZIP 容器），拷给别人、换机搬家都是一个文件的事
- **最近工程**：记住你最近开过的，一点就回
- 保存即时落盘，无隐藏状态

### 渲染与导出

- **导出视频**：逐帧确定性渲染，系统 Edge 无头截帧、内置 ffmpeg 编码 H.264 MP4，画质 1080p 起
- 渲染过程有进度、可取消；帧帧是 `t` 的纯函数，同一工程渲染一万次画面都一样
- **确定性纪律**：运行时屏蔽随机数与实时时钟，用户代码里 `Math.random()` 与 `Date.now()` 都被接管，导出绝不闪帧

### 🤖 MCP 服务（给外部 AI 的口子）

软件内置一个本地 MCP 服务（右侧「MCP」面板一键开关、可设端口），**Streamable HTTP**，共 12 个工具：

| 工具 | 干什么 |
| --- | --- |
| `project_info` | 读工程名、入口、帧率、画幅 |
| `list_files` | 列出工程内全部文件 |
| `read_file` / `write_file` | 读、写工程源码——AI 就靠这个写动画 |
| `create_file` | 按内置模板新建文件（`kind`: `visual` 画面 / `audio` 音频），自动带上工程画幅与帧率 |
| `get_compositions` | 读所有已注册合成的参数 |
| `set_frame` | 改工程画幅（`preset` 或 `width`/`height`，写进 project.json） |
| `set_theme` | 切浅色 / 暗色界面 |
| `render_video` | 单个合成渲染出片，走和界面完全相同的一条管线 |
| `sequencer_render` | 多段合并渲染：按 `comp_ids` 顺序逐段渲染再拼成一条 |
| `list_skills` / `read_skill` | 读内置技能库——AI 写代码前先查文档 |

**AI 一句话就能接上**：在软件右侧 MCP 面板点「启动」，把下面这段配置粘给任何支持 MCP 的 AI 客户端（端口按面板显示的填，默认 8964）——

```json
{
  "mcpServers": {
    "tempus": { "url": "http://127.0.0.1:8964/mcp" }
  }
}
```

或者更省事，直接对 AI 说：「MCP 地址是 http://127.0.0.1:8964/mcp，读一下 tempus-api 技能，然后给工程加一个开场动画」。它自己会查文档、写代码、保存、看着监视器改，最后 `render_video` 出片——全程不需要人碰键盘。

### 内置技能库（12 份方法论文档）

技能库随软件分发（`skills/` 目录），AI 经 MCP 直接读取。除了本软件的 API 文档与确定性渲染纪律，还收录了一整套动效方法论：

| 文档 | 内容 |
| --- | --- |
| `tempus-api` | Tempus API 速查：八大 API、确定性纪律、内置依赖 |
| `liquid-glass` | 液态玻璃质感（iOS 26 风格）实现手法 |
| `motion-studio` | 全融合动画 / 宣传片生成链总控：路由 + 九大增强 |
| `painted-animation` | 逐帧手绘水彩动画方法论 |
| `kinetic-reel` | 动感字条 / 动效大片方法论 |
| `onetake` | 产品宣传片一镜到底方法论 |
| `director-grade` | 导演级 2D 动画：分镜、节拍表、风格手册 |

AI 拿到这些，写出来的不是「能动的东西」，而是有分镜、有节奏、有质感的片子。

### 八个 API，一张表背完

```tsx
import { registerComposition, useFrame, useVideoConfig,
         interpolate, spring, Sequence, Easing, mark } from 'tempus';

registerComposition({ id: 'main', width: 1920, height: 1080,
                      fps: 30, durationInFrames: 90, component: Main });

function Main() {
  const frame = useFrame();                 // 当前帧
  const { fps, width } = useVideoConfig();  // 画幅与帧率
  const x = interpolate(frame, [0, 90], [0, 800]);   // 线性插值
  const s = spring({ frame, fps });         // 弹簧物理
  mark(frame, '标题入场');                   // 时间轴上打标记
  return <div style={{ transform: `translateX(${x * s}px)` }}>你好</div>;
}
```

`Sequence` 管段落时序，`Easing` 给 30 多种缓动。就这些。

### 和纯命令行方案比，好在哪

| | 纯命令行方案 | Tempus |
| --- | --- | --- |
| 装环境 | Node.js + 包管理器 + 无头浏览器，一个都不能少 | **解压双击，完事** |
| 写代码 | 任何编辑器都行，但没有工程上下文 | 内置 IDE：真实 TS 类型、报错即时报、真终端、Git |
| 看效果 | 开预览服务，浏览器里另开一个页签 | **监视器就在代码旁边**，保存即变，时间轴逐帧查 |
| 给 AI 用 | 装官方 CLI，配环境变量 | MCP 面板一键开，粘一段 JSON 就接上 |
| 交给不会编程的同事 | 不现实 | 双击快捷方式打开工程就能改字换色 |
| 确定性 | 要自己小心别用随机数 | **运行时强制接管**，`Math.random()` 和 `Date.now()` 都拦下来 |

也要说实话：命令行方案的生态更大——想装任意 npm 包、用音频工具链、上云端渲染，那边路更宽。Tempus 的内置依赖是 `tempus` / `react` / `three` 三件，API 是八个核心原语，**做动效短片、产品宣传、片头包装绰绰有余**；需要更大生态的时候，工程也是普通文件夹，代码复制过去就能继续用。

---

## 🔨 自己构建

### 环境

| 需要 | 说明 |
| --- | --- |
| Windows 10 / 11 | 只做 Windows 桌面 |
| Node.js 18+ | 前端构建，Vite 5（只构建时需要，用户不需要） |
| Rust 1.75+ | 后端，Tauri v2 |
| WebView2 | Windows 10 / 11 一般自带 |

### 启动

```bash
cd scaffold
npm install

# 只跑前端，浏览器里看界面
npm run dev          # http://localhost:1429

# 跑完整桌面应用
npm run tauri dev
```

### 构建

```bash
npm run build        # 前端产物（含渲染运行时）
npm run tauri build  # 打包（exe + MSI）
```

---

## 📁 目录结构

```
Tempus/
├── README.md                  本文件
├── skills/                    内置技能库
└── scaffold/                  完整源码
    ├── src/                   前端：React + TypeScript
    │   ├── ui/                加载页、欢迎页、图标
    │   ├── workspace/         编辑器、监视器、时间轴、导出、MCP 面板
    │   └── core/              编译器、运行时、模板、类型
    ├── public/render/         渲染运行时（iframe 沙箱内跑用户代码）
    └── src-tauri/             后端：Rust
        ├── src/commands/      工程、渲染（Edge CDP + ffmpeg）、MCP 服务
        ├── ffmpeg/            编码运行时
        └── skills/            内置技能库
```

---

## ❓ 常见问题

**双击没反应 / 打开是白屏？**
确认装了 WebView2（Windows 11 一般自带）。自己构建的，先在 `scaffold/` 里跑 `npm install`。

**监视器一直转圈？**
等 esbuild-wasm 编译引擎就位（首次约一两秒）。还不行就看编辑器里的报错，通常是 `src/index.tsx` 忘了 `registerComposition`。

**导出的视频和预览不一样？**
检查代码里有没有用随机数或实时时钟。Tempus 运行时已接管它们保证确定性，但直接操作 DOM 越过 React 的写法可能漏帧——所有画面都走组件状态。

**AI 连不上 MCP？**
在右侧「MCP」面板点启动，确认端口没被占用，然后在 AI 客户端里填 **HTTP 地址** `http://127.0.0.1:8964/mcp`（端口以面板显示为准）。注意是 HTTP 不是 WebSocket。

**和 Remotion 工程通用吗？**
API 形状刻意对齐了 Remotion，纯组件代码基本复制即用；但工程文件格式是 Tempus 自己的（普通文件夹 + `project.json`），不走 Remotion 的 Node 工程。

---

## ⚖️ 许可与边界

- **MIT 许可**，非营利，小方工作室出品。
- **不带任何 AI 功能**：不接大模型、不内置智能生成；AI 一律经 MCP 由用户自己接入。
- **不做账号体系**：不登录、不注册、不联网校验。
- **永不自动更新**：不检查更新、不后台下载、不提示升级。
- **全中文界面**，Windows 优先。
- 思路致敬 Remotion（MIT），代码全部自研。

---

*小方工作室 · Tempus · 代码即动画*
