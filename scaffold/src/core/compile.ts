import * as esbuild from 'esbuild-wasm';
import { api } from './tauri';
import type { CompInfo, Mark } from './types';

/* 浏览器内增量编译：esbuild-wasm 把用户工程打成 IIFE，
 * react / react-dom / tempus 重定向到注入层 window.KV / window.KR。
 * 产物以完整 HTML 文档形式注入：预览 iframe（srcdoc）与无头导出共用同一条路。 */

let inited = false;

export async function ensureEsbuild(): Promise<void> {
  if (inited) return;
  await esbuild.initialize({
    wasmURL: '/esbuild/esbuild.wasm',
    worker: true
  });
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
export const { registerComposition, listCompositions, mark, interpolate, spring, Easing, useFrame, useVideoConfig, Sequence, AbsoluteFill } = K;`,
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
  await ensureEsbuild();
  const root = projectDir.replace(/[\\/]+$/, '');

  const plugin: esbuild.Plugin = {
    name: 'tempus-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
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
        return { errors: [{ text: `依赖 "${args.path}" 未内置。Tempus 内置：react、react-dom、three、tempus；其余请使用相对路径的工程内文件。` }] };
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

export function buildDocument(vendorJs: string, userJs: string, userCss: string, compId: string | null): string {
  const c = JSON.stringify(compId);
  const style = userCss ? `<style>${userCss.replace(/<\/style/gi, '<\\/style')}</style>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000;overflow:hidden}
#root{position:fixed;inset:0}
</style><script>${safeScript(vendorJs)}</script>${style}</head>
<body><div id="root"></div><script>${safeScript(userJs)}</script><script>window.KR.init({compId:${c}})</script></body></html>`;
}

/* 文档缓存：同一份编译产物 × 同一合成只拼接一次（vendor 很大，重复拼接浪费明显） */
const docCache = new Map<string, string>();

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

export function buildDocumentCached(vendorJs: string, userJs: string, userCss: string, compId: string | null): string {
  const key = `${String(compId)}|${hashStr(userJs)}|${hashStr(userCss)}|${userJs.length}|${userCss.length}`;
  const hit = docCache.get(key);
  if (hit) return hit;
  const doc = buildDocument(vendorJs, userJs, userCss, compId);
  if (docCache.size > 32) docCache.clear(); // 简单防洪
  docCache.set(key, doc);
  return doc;
}
