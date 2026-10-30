import * as esbuild from 'esbuild-wasm';
import { api } from './tauri';
import type { CompInfo, Mark } from './types';

/* 浏览器内增量编译：esbuild-wasm 把用户工程打成 IIFE，
 * react / react-dom / tempus 重定向到注入层 window.KV / window.KR。
 * 产物以完整 HTML 文档形式注入：预览 iframe（srcdoc）与无头导出共用同一条路。 */

let inited = false;

/* esbuild-wasm 初始化。
 * worker:true 时 esbuild 用 Blob URL 建 Worker；若 CSP/环境不允许就退化为同线程，
 * 两条路都失败才算编译不可用——避免「worker 建不起来 → 永远编译不出来」。 */
export async function ensureEsbuild(): Promise<void> {
  if (inited) return;
  const opts = { wasmURL: '/esbuild/esbuild.wasm' };
  try {
    await esbuild.initialize({ ...opts, worker: true });
  } catch {
    try {
      await esbuild.initialize({ ...opts, worker: false });
    } catch (e) {
      throw new Error('浏览器内编译器（esbuild.wasm）加载失败：' + String(e));
    }
  }
  inited = true;
}

/* virtual 外部模块：把 npm 重定向到注入层 */
const EXTERNALS: Record<string, string> = {
  react: `const R = window.KV.React;
export default R;
export const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, createContext, createElement, Fragment, cloneElement, useSyncExternalStore, forwardRef, Children, StrictMode } = R;`,
  'react-dom': `const D = window.KV.ReactDOM;
export default D;
export const { render, createPortal } = D;`,
  'react-dom/client': `const D = window.KV.ReactDOM;
export const { createRoot, hydrateRoot, flushSync } = D;`,
  tempus: `const K = window.KR;
export const { registerComposition, listCompositions, mark, interpolate, spring, Easing, random, noise1D, useFrame, useCurrentFrame, useVideoConfig, Sequence, Series, Freeze, AbsoluteFill, Audio, staticFile, setPlaying } = K;`,
  three: `const T = window.KV.Three;
export default T;
export const { Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer, Object3D, Group, Mesh, Line, LineSegments, Points, BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, MeshNormalMaterial, PointsMaterial, LineBasicMaterial, Color, Vector2, Vector3, Fog, AmbientLight, DirectionalLight, PointLight, BoxGeometry, SphereGeometry, PlaneGeometry, TorusGeometry, CylinderGeometry, RingGeometry, EdgesGeometry, WireframeGeometry, ShapeGeometry, IcosahedronGeometry, TetrahedronGeometry, OctahedronGeometry, Clock, Raycaster, MathUtils } = T;`
};

const KNOWN = new Set(Object.keys(EXTERNALS));

export type CompileResult = {
  ok: boolean;
  userJs?: string;
  userCss?: string;
  error?: string;
};

export async function compileProject(
  projectDir: string,
  entryRel: string
): Promise<CompileResult> {
  try {
    await ensureEsbuild();
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
  const root = projectDir.replace(/[\\/]+$/, '');

  const plugin: esbuild.Plugin = {
    name: 'tempus-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (KNOWN.has(args.path)) return { path: args.path, namespace: 'kv-external' };
        if (/^[A-Za-z]:[\\/]/.test(args.path)) {
          return { path: args.path, namespace: 'kv-fs', pluginData: { exts: [''] } };
        }
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          // 相对路径 → 工程内绝对路径；补默认扩展名
          let p = args.path;
          if (args.importer) {
            const dir = args.importer.replace(/[\\/][^\\/]+$/, '');
            p = args.path.startsWith('/') ? args.path : dir.replace(/[\\/]+$/, '') + '/' + args.path;
          } else {
            p = root + '/' + args.path;
          }
          const norm = normalizePath(p, root);
          const exts = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
          return { path: norm, namespace: 'kv-fs', pluginData: { exts } };
        }
        /* 裸导入兜底：按 Node 规则去工程的 node_modules 里找。
         * 这样 `npm i` 到工程目录的第三方包（Remotion 生态组件、工具库等）能直接 import，
         * 不再是"只能 import react/three/tempus"。 */
        const found = await resolveNodeModule(args.path, args.importer || root, root);
        if (found) return { path: found, namespace: 'kv-fs', pluginData: { exts: [''] } };
        return {
          errors: [{
            text: `找不到依赖 "${args.path}"。两种解法：① 把包装进工程目录（node_modules/）后直接 import；`
              + `② 用内置的 react、react-dom、three、tempus。注意依赖 Node 原生模块（fs/path 等）的包无法在浏览器里跑。`
          }]
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'kv-external' }, (args) => {
        return { contents: EXTERNALS[args.path], loader: 'js' };
      });

      build.onLoad({ filter: /.*/, namespace: 'kv-fs' }, async (args) => {
        const exts: string[] = (args.pluginData as any)?.exts ?? [''];
        for (const ext of exts) {
          const p = args.path + ext;
          if (await safeExists(p)) {
            const text = await api.fsRead(p);
            if (p.endsWith('.css')) {
              return {
                contents: `const __css=${JSON.stringify(text)};const __s=document.createElement('style');__s.textContent=__css;document.head.appendChild(__s);`,
                loader: 'js'
              };
            }
            const loader = p.endsWith('.tsx') ? 'tsx' : p.endsWith('.ts') ? 'ts' : p.endsWith('.jsx') ? 'jsx' : 'js';
            /* esbuild-wasm 的 onLoad 返回值不接受 sourcefile，多传会告警 */
            return { contents: text, loader, resolveDir: '/' };
          }
        }
        return { errors: [{ text: `找不到文件：${args.path}` }] };
      });
    }
  };

  try {
    const result = await esbuild.build({
      entryPoints: [{ in: root + '/' + entryRel.replace(/\\/g, '/'), out: 'bundle' }],
      bundle: true,
      format: 'iife',
      globalName: 'KUSER',
      target: 'es2020',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      write: false,
      plugins: [plugin],
      logLevel: 'silent'
    });
    let js = '', css = '';
    for (const f of result.outputFiles ?? []) {
      if (f.path.endsWith('.css')) css += f.text; else js += f.text;
    }
    return { ok: true, userJs: js, userCss: css };
  } catch (e: any) {
    const msg = e?.errors?.map((x: any) => `${x.location ? x.location.file + ':' + x.location.line + '  ' : ''}${x.text}`).join('\n') ?? String(e);
    return { ok: false, error: msg };
  }
}

async function safeExists(p: string): Promise<boolean> {
  try {
    await api.fsRead(p);
    return true;
  } catch {
    return false;
  }
}

/* 按 Node 解析规则找裸导入：从 importer 目录逐级向上，在 node_modules 里找。
 * 支持 package.json 的 module / main，以及常见的 index 兜底。 */
async function resolveNodeModule(spec: string, importer: string, root: string): Promise<string | null> {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const rootN = norm(root).replace(/\/+$/, '').toLowerCase();

  /* 逐级向上的目录链（importer 所在目录 → 工程根） */
  const chain: string[] = [];
  let dir = norm(importer).replace(/\/[^/]*$/, '');
  for (let i = 0; i < 12; i++) {
    chain.push(dir);
    if (dir.toLowerCase() === rootN) break;
    const up = dir.replace(/\/[^/]*$/, '');
    if (!up || up === dir) break;
    dir = up;
  }

  for (const base of chain) {
    const pkgBase = base + '/node_modules/' + spec;

    const pkgPath = pkgBase + '/package.json';
    if (await safeExists(pkgPath)) {
      try {
        const pkg = JSON.parse(await api.fsRead(pkgPath)) as {
          module?: string; main?: string; exports?: unknown; browser?: string | Record<string, string>;
        };
        const cands: string[] = [];
        if (typeof pkg.module === 'string') cands.push(pkg.module);
        if (typeof pkg.browser === 'string') cands.push(pkg.browser);
        if (typeof pkg.main === 'string') cands.push(pkg.main);
        cands.push('index.js', 'index.mjs', 'index.ts');
        for (const c of cands) {
          const p = normalizePath(pkgBase + '/' + c.replace(/^\.\//, ''), root);
          if (await safeExists(p)) return p;
        }
      } catch { /* package.json 不合法，继续试直接文件 */ }
    }

    for (const ext of ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '/index.js', '/index.mjs']) {
      const p = normalizePath(pkgBase + ext, root);
      if (await safeExists(p)) return p;
    }
  }
  return null;
}

function normalizePath(p: string, root: string): string {
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(p);
  const parts: string[] = [];
  const raw = p.replace(/\\/g, '/').split('/');
  for (const seg of raw) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const joined = parts.join('/');
  if (isWinAbs) {
    // 盘符被拆进 parts[0]（如 "D:"）
    if (!/^[A-Za-z]:$/.test(parts[0] ?? '')) return root + '/' + joined;
    return joined;
  }
  return root + '/' + joined;
}

/* 生成注入文档：vendor（React+运行时）+ 用户 bundle + init。
 * 代码内若出现字面量 </script> 需转义为 <\/script>（JS 字符串中 \/ 等价 /，语义不变）。 */
function safeScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

export function buildDocument(
  vendorJs: string,
  userJs: string,
  userCss: string,
  compId: string | null,
  mediaTable?: Record<string, string>
): string {
  const c = JSON.stringify(compId);
  const style = userCss ? `<style>${userCss.replace(/<\/style/gi, '<\\/style')}</style>` : '';
  /* 素材表：相对路径 → blob URL，运行时 staticFile() 查这张表 */
  const media = mediaTable && Object.keys(mediaTable).length
    ? `<script>window.__MEDIA=${safeScript(JSON.stringify(mediaTable))}</script>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000;overflow:hidden}
#root{position:fixed;inset:0}
</style>${media}<script>${safeScript(vendorJs)}</script>${style}</head>
<body><div id="root"></div><script>${safeScript(userJs)}</script><script>window.KR.init({compId:${c}})</script></body></html>`;
}

/* 文档缓存：同一份编译产物 × 同一合成 × 同一素材表只拼接一次
 * （vendor 835KB，重复拼接浪费明显） */
const docCache = new Map<string, string>();

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function mediaKey(mediaTable?: Record<string, string>): number {
  if (!mediaTable) return 0;
  const keys = Object.keys(mediaTable).sort();
  let h = 7;
  for (const k of keys) h = (h * 31 + (hashStr(k) ^ hashStr(mediaTable[k]))) | 0;
  return h;
}

export function buildDocumentCached(
  vendorJs: string,
  userJs: string,
  userCss: string,
  compId: string | null,
  mediaTable?: Record<string, string>
): string {
  const mk = mediaKey(mediaTable);
  const key = `${String(compId)}|${hashStr(userJs)}|${hashStr(userCss)}|${userJs.length}|${userCss.length}|${mk}`;
  const hit = docCache.get(key);
  if (hit) return hit;
  const doc = buildDocument(vendorJs, userJs, userCss, compId, mediaTable);
  if (docCache.size > 32) docCache.clear(); // 简单防洪
  docCache.set(key, doc);
  return doc;
}
