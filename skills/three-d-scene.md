# Three.js 场景（three-d-scene）

`three` 已随运行时内置（`import * as THREE from 'three'` 直接用）。
但这里是**逐帧确定性渲染**，不是交互式 3D —— 写法跟网页里那套有两条硬性区别。

## 两条生死线

**1. 必须在 `useLayoutEffect` 里画，不能放 `useEffect`。**
导出时是"设置帧号 → 立刻截图"。`useEffect` 是异步的，截图时画布可能还是上一帧。
`useLayoutEffect` 在提交后同步执行，才能保证画布与 DOM 同帧。

**2. `WebGLRenderer` 必须开 `preserveDrawingBuffer: true`。**
不开的话，浏览器在合成后可能清空绘图缓冲区，无头截图会拿到**全黑**。
这是 3D 场景导出全黑的第一号原因。

```tsx
new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
```

## 标准骨架（可直接粘贴）

```tsx
import React, { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useVideoConfig } from 'tempus';

type S = { r: any; sc: any; cam: any; mesh: any; group: any };

export function Scene3D() {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<S | null>(null);
  const { width, height, fps } = useVideoConfig();
  const frame = useFrame();

  // 建场：只跑一次
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || st.current) return;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(width, height, false);
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    el.appendChild(r.domElement);

    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    cam.position.set(0, 0, 6);

    sc.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 4, 5);
    sc.add(key);

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x4f7cff, roughness: 0.35, metalness: 0.4 })
    );
    group.add(mesh);
    sc.add(group);

    st.current = { r, sc, cam, mesh, group };
    return () => {
      st.current = null;
      r.dispose();
      if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
    };
  }, [width, height]);

  // 每帧：位置由 frame 推导，画完立刻 present
  useLayoutEffect(() => {
    const s = st.current;
    if (!s) return;
    const t = frame / fps;
    s.group.rotation.y = t * 0.6;
    s.group.rotation.x = Math.sin(t * 0.8) * 0.18;
    s.mesh.position.y = Math.sin(t * 1.6) * 0.12;
    s.r.render(s.sc, s.cam);
  }, [frame, fps]);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
}
```

## 粒子场（确定性分布）

**绝不能用 `Math.random()`** —— 每帧重建会闪。用运行时自带的 `random(seed)`：

```tsx
import { random } from 'tempus';

const N = 900;
const pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  pos[i * 3]     = (random('px' + i) - 0.5) * 14;
  pos[i * 3 + 1] = (random('py' + i) - 0.5) * 8;
  pos[i * 3 + 2] = (random('pz' + i) - 0.5) * 10;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, color: 0x9fc4ff, transparent: true, opacity: 0.85 }));
```

数组**在组件外或 useMemo 里算一次**，不要每帧重建 —— 否则导出时会卡死。

## 运镜（相机动画）

```tsx
cam.position.x = interpolate(frame, [0, 90], [-6, 0], { easing: Easing.inOutCubic });
cam.position.z = interpolate(frame, [0, 90], [10, 5.5], { easing: Easing.outCubic });
cam.lookAt(0, 0, 0);
```

推拉镜头配 `outCubic`，横移配 `inOutCubic`，比全程匀速高级得多。

## 常见坑

| 症状 | 原因 |
|---|---|
| 导出全黑 | 没开 `preserveDrawingBuffer` |
| 导出画面比预览慢一帧 | 画在 `useEffect` 里，改 `useLayoutEffect` |
| 粒子疯狂闪烁 | 每帧重建了位置数组 / 用了 `Math.random` |
| 边缘锯齿严重 | `setPixelRatio` 没设，或 antialias 关了 |
| 模型看不见 | 相机 near/far 不对，或忘了加灯光（`MeshStandardMaterial` 无光即黑） |
| 切换合成后残留 | `dispose()` 没调用 |

## 自检

- [ ] `preserveDrawingBuffer: true`？
- [ ] 绘制在 `useLayoutEffect`？
- [ ] 所有随机走 `random(seed)` 且只算一次？
- [ ] 有环境光 + 主光？
- [ ] 卸载时 `dispose()` 并移除 canvas？
