# FFmpeg 动态库放置位置

这个目录用来放 Reelix 随包分发的 **FFmpeg 动态库**。当前已放入 BtbN 的 LGPL 共享版（见下方「当前状态」）。

## 为什么要单独放一个目录

FFmpeg 是 **LGPL-2.1**，按 [AGENTS.md](../AGENTS.md) 与 [docs/06](../../docs/06-参考项目与许可边界.md) 第四节：

- **只能动态链接**，绝不做静态链接；
- 必须随包提供许可证文件与源码获取途径。

把 DLL 放在这里、由 `src-tauri/tauri.conf.json` 的 `bundle.resources` 声明（`"ffmpeg/*"`），是为了让用户能直接替换成自己编译的 FFmpeg。

## 放什么

自编译时只开需要的东西（[docs/07](../../docs/07-安装与打包.md) 第二节，收益最大的一条）：

- 编码 / 解码：H.264、HEVC、ProRes
- 音频：AAC、MP3、FLAC

关掉全部用不上的编解码器与封装格式，这一条能省几十 MB。

## 许可合规

放入二进制这里的同时，必须一并放入：

1. `COPYING.LGPLv2.1`（FFmpeg 的 LGPL 许可证文本）
2. 所用的准确版本号与全部编译期配置（`configure` 参数）
3. 源码获取途径说明（<https://ffmpeg.org/download.html>）

对应登记见仓库根目录的 `THIRD_PARTY_NOTICES.md` 第二节。

## 当前状态

**已可解码、探测、抽帧、混音、导出一帧。** 已放入：

| 文件 | 说明 |
| --- | --- |
| `ffmpeg.exe` / `ffprobe.exe` | N-127579-g5cb9fcd211（2026-10-16） |
| `avcodec-63.dll` 等 7 个 DLL | LGPL 共享版运行时，必须与 exe 同目录 |
| `COPYING.LGPLv2.1.txt` | 许可证文本 |
| `BUILD-INFO.txt` | 版本、完整 `configure` 参数、源码获取途径 |

来源：`BtbN/FFmpeg-Builds` 的 `ffmpeg-master-latest-win64-lgpl-shared.zip`。

## 裁剪构建（发版前必做）

当前是 BtbN 全量 LGPL 构建，整目录 **153.8MB**，远超 [docs/07](../../docs/07-安装与打包.md) 的 35MB 预算。
自编译脚本已经放在本目录：[build-windows.sh](./build-windows.sh)。

```bash
# MSYS2 MINGW64 / UCRT64 终端
./build-windows.sh --dry-run   # 只看 configure 参数
./build-windows.sh             # 真编译，产物直接覆盖本目录
```

脚本用 `--disable-everything` 起步，只按 Reelix 的真实调用面开启：

- **解码**：H.264 / HEVC / ProRes / MJPEG / PNG / BMP / WebP / VP8 / VP9 / AV1，
  音频 MP3 / AAC / FLAC / Vorbis / Opus / PCM；
- **编码**：`h264_mf` / `hevc_mf`（Windows Media Foundation，LGPL 合规）、AAC、
  PCM、PNG / MJPEG / ProRes、FLAC、libmp3lame；
- **封装**：mp4 / mov / matroska / webm / wav / mp3 / flac / ogg / image2 / rawvideo；
- **滤镜**：scale / pad / format / fps / trim / atrim / concat / amix / volume /
  aresample / subtitles / overlay / crop / transpose / split / setpts / apad / afade；
- **协议**：`file`、`pipe`（导出走 `pipe:0` 喂 rawvideo / PCM）。

关掉 `avdevice`（省 4.7MB），不启用 `libx264` / `libx265`（GPL）。脚本结束会打印
每个文件体积并与 35MB 预算对比，超预算直接非零退出。

编码器选择已同步到 [export.rs](../src/commands/export.rs)：H.264 依次尝试
`h264_mf → libopenh264 → h264_nvenc → libx264`，H.265 依次尝试
`hevc_mf → hevc_nvenc → libx265`，并按能力探测回退，不会再因为缺 libx264 直接失败。

参考实现：Clypra 的 `scripts/setup-ffmpeg.sh` 与 `scripts/ensure-sidecars.mjs`（仅参考流程，代码不并入）。
