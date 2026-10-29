import { defineConfig } from 'vite';

// 渲染层构建：产出 public/render/vendor.js（IIFE）。
// 内容 = React + ReactDOM + Tempus 运行时 + 引导器，暴露 window.KV / window.KR。
// 用户代码在浏览器/无头浏览器里由 esbuild-wasm 增量编译后追加在 vendor 之后。
export default defineConfig({
  /* lib 模式下 vite 不替换 process.env.NODE_ENV，React 的 CJS 产物会在浏览器里
   * 抛 "process is not defined"，必须显式 define 成 production。 */
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    target: 'es2020',
    outDir: 'public/render',
    emptyOutDir: true,
    lib: {
      entry: 'src-runtime/vendor.ts',
      name: 'KVendor',
      formats: ['iife'],
      fileName: () => 'vendor.js'
    }
  }
});
