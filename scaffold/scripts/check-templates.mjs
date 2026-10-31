/* 模板生成自检：node scripts/check-templates.mjs
 *
 * 为什么需要这个：三个工程模板已经从"死字符串"改成"按画幅生成的函数"，
 * 里面嵌了大量 ${} 与 \${} 转义。tsc 只检查生成器本身，
 * 不检查"生成出来的文件"是不是合法 TSX —— 这块必须真跑一遍。
 *
 * 做三件事：
 *   1. 六种画幅 × 三个模板全部生成；
 *   2. 每个生成文件用 esbuild 编译一遍（等价应用里浏览器内编译的那一步）；
 *   3. 检查 project.json 的 width/height/fps/frame 与源码里 registerComposition 是否一致。 */

import { build } from 'esbuild';
import { TEMPLATES } from '../src/core/templates.ts';
import { FRAME_PRESETS } from '../src/core/frame.ts';
import { buildVisualFile, buildAudioFile, compIdFromPath } from '../src/core/newfile.ts';

const FPS = [24, 30, 60];
let fail = 0;

for (const preset of FRAME_PRESETS) {
  for (const fps of FPS) {
    const frame = { width: preset.w, height: preset.h, fps };
    for (const tpl of TEMPLATES) {
      const files = tpl.build(frame);
      const tag = `${preset.id}@${fps} / ${tpl.id}`;

      // 1) project.json 一致性
      const meta = JSON.parse(files['project.json']);
      if (meta.width !== frame.width || meta.height !== frame.height || meta.fps !== fps) {
        console.log(`✗ ${tag} project.json 画幅不一致`, meta);
        fail++;
      }
      if (meta.frame !== preset.id) {
        console.log(`✗ ${tag} project.json frame=${meta.frame}，应为 ${preset.id}`);
        fail++;
      }

      // 2) 逐个文件编译
      for (const [path, code] of Object.entries(files)) {
        if (!/\.(tsx?|jsx?)$/.test(path)) continue;
        try {
          await build({
            stdin: { contents: code, loader: path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: '.' },
            write: false,
            bundle: false,
            jsx: 'transform',
            logLevel: 'silent'
          });
        } catch (e) {
          console.log(`✗ ${tag} 编译失败 ${path}`);
          for (const err of e.errors ?? []) {
            console.log(`    ${err.text}  (行 ${err.location?.line}, 列 ${err.location?.column})`);
          }
          fail++;
        }
      }

      // 3) registerComposition 里的画幅要与 project.json 一致
      const entry = files['src/index.tsx'];
      if (entry) {
        const m = entry.match(/registerComposition\(\{[\s\S]*?width:\s*(\d+),\s*height:\s*(\d+),\s*fps:\s*(\d+)/);
        if (!m) {
          console.log(`✗ ${tag} 找不到 registerComposition 画幅`);
          fail++;
        } else if (+m[1] !== frame.width || +m[2] !== frame.height || +m[3] !== fps) {
          console.log(`✗ ${tag} registerComposition ${m[1]}×${m[2]}@${m[3]}，应为 ${frame.width}×${frame.height}@${fps}`);
          fail++;
        }
      }
    }
  }
}

/* ---- 第二块：新建文件模板（点「+」/ MCP create_file 用的那两个） ---- */
const newFileCases = [
  { name: '画面 16:9', path: 'src/scenes/Title.tsx', code: buildVisualFile({ width: 1920, height: 1080, fps: 30, id: compIdFromPath('src/scenes/Title.tsx') }) },
  { name: '画面 9:16', path: 'src/Scene.tsx', code: buildVisualFile({ width: 1080, height: 1920, fps: 60, id: compIdFromPath('src/Scene.tsx') }) },
  { name: '音频', path: 'src/audio/bgm.tsx', code: buildAudioFile() }
];

for (const c of newFileCases) {
  for (const badWord of ['NaN', 'undefined', '[object Object]']) {
    if (c.code.includes(badWord)) { console.log(`✗ 新建文件模板（${c.name}）含 ${badWord}`); fail++; }
  }
  try {
    await build({
      stdin: { contents: c.code, loader: 'tsx', resolveDir: '.' },
      write: false, bundle: false, jsx: 'transform', logLevel: 'silent'
    });
  } catch (e) {
    console.log(`✗ 新建文件模板（${c.name}）编译失败`);
    for (const err of e.errors ?? []) console.log(`    ${err.text}`);
    fail++;
  }
  // 画面模板必须带上正确的画幅（音频模板本身不注册合成，没有画幅是对的）
  if (c.path.endsWith('.tsx') && c.path !== 'src/audio/bgm.tsx') {
    const m = c.code.match(/width:\s*(\d+),\s*height:\s*(\d+),\s*fps:\s*(\d+)/);
    if (!m) { console.log(`✗ 新建文件模板（${c.name}）缺画幅`); fail++; }
  }
}

console.log(fail === 0
  ? `✓ 全部通过：${FRAME_PRESETS.length} 画幅 × ${FPS.length} 帧率 × ${TEMPLATES.length} 模板 + ${newFileCases.length} 个新建文件模板`
  : `\n共 ${fail} 处问题`);
process.exit(fail === 0 ? 0 : 1);