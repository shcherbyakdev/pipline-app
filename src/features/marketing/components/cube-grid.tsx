"use client";

import * as React from "react";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { usePrefersReducedMotion } from "./reduced-motion";

/* The hero band's ground: a field of tall cubes that ripples where the
   pointer moves (Codrops, "interactive wave propagation cube grid",
   2026-07). One InstancedMesh; the pointer is cast onto the cubes' top
   plane and leaves a trail of points; every frame each cube's height is
   the weighted average of the ripples those points send out (a Gaussian
   window riding an expanding circle, fading with age, distance and how
   fast the pointer was moving), and its colour mixes from the dark
   theme's panel to the brand accent by height. Waves average rather than
   stack, so overlapping trails stay calm. Idle for a few seconds (or a
   touch screen), it drops its own points now and then. Runs only while
   on screen; under reduced motion it draws one still frame. The math is
   on the CPU (a few hundred cubes, no shader patching); the GPU draws. */

const COLS = 14;
const ROWS = 12;
const GAP = 1;
const CUBE = 0.86;
const HEIGHT = 1.1;
const AMP = 0.55;
/* Wave shape: how fast the ring travels, how wide it is, its ripple
   frequency, and how long a point keeps sending. */
const SPEED = 2;
const WIDTH = 2.2;
const FREQ = 1.3;
const FADE = 3;
const TRAIL = 40;
const IDLE_MS = 3000;
const AUTO_EVERY_MS = 2400;

/* Dark theme's ground, panel and accent (globals.css `.dark`). */
const GROUND = "#111212";
const BASE = "#242526";
const HIGH = "#6975e2";

type TrailPoint = { x: number; z: number; t0: number; w: number };

/* Deterministic jitter per cube, so the rings never look machine-drawn. */
function jitter(i: number): [number, number] {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 43758.5453;
  return [((a - Math.floor(a)) - 0.5) * 0.16, ((b - Math.floor(b)) - 0.5) * 0.16];
}

export function CubeGrid({ className }: { className?: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      return; // no WebGL: the band keeps its dark ground
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(new Color(GROUND), 1);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new Scene();
    /* Orthographic and steep, so the field reads as tiles with a little
       relief rather than a landscape. */
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    scene.add(new HemisphereLight(0xffffff, 0x111212, 1.1));
    const key = new DirectionalLight(0xffffff, 1.3);
    key.position.set(-6, 16, 6);
    scene.add(key);

    const count = COLS * ROWS;
    const geometry = new BoxGeometry(CUBE, HEIGHT, CUBE);
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
    const mesh = new InstancedMesh(geometry, material, count);
    scene.add(mesh);

    const base = new Color(BASE);
    const high = new Color(HIGH);
    const tmp = new Object3D();
    const col = new Color();
    const cells: { x: number; z: number }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const [jx, jz] = jitter(i);
        cells.push({ x: (c - (COLS - 1) / 2) * GAP + jx, z: (r - (ROWS - 1) / 2) * GAP + jz });
      }
    }

    /* Frame the grid's width whatever the band's aspect: the frustum is
       the grid's width, the camera sits on a 68° slope. */
    const ELEV = (68 * Math.PI) / 180;
    const DIST = 60;
    const fit = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      const halfW = COLS * GAP * 0.5;
      const halfH = halfW / (w / h);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.position.set(0, Math.sin(ELEV) * DIST, Math.cos(ELEV) * DIST);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    /* The pointer, cast onto the cubes' top plane. */
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const top = new Plane(new Vector3(0, 1, 0), -HEIGHT);
    const trail: TrailPoint[] = [];
    let last: { x: number; z: number; t: number } | null = null;
    let lastInput = 0;
    const tilt = { x: 0, y: 0 };
    const push = (x: number, z: number, w: number) => {
      trail.push({ x, z, t0: performance.now(), w });
      if (trail.length > TRAIL) trail.shift();
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      tilt.x = ndc.x;
      tilt.y = ndc.y;
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(top, hit)) return;
      const now = performance.now();
      lastInput = now;
      if (last) {
        const d = Math.hypot(hit.x - last.x, hit.z - last.z);
        if (d < GAP * 0.5) return;
        const speed = d / Math.max(16, now - last.t); // world units per ms
        push(hit.x, hit.z, Math.min(1, 0.25 + speed * 40));
      } else {
        push(hit.x, hit.z, 0.6);
      }
      last = { x: hit.x, z: hit.z, t: now };
    };
    const onLeave = () => {
      last = null;
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);

    /* One frame: heights, colours, a breath of camera tilt. */
    const halfW = (COLS * GAP) / 2;
    const halfD = (ROWS * GAP) / 2;
    let nextAuto = performance.now() + IDLE_MS;
    const frame = (now: number) => {
      if (now - lastInput > IDLE_MS && now > nextAuto) {
        push((Math.random() * 2 - 1) * halfW * 0.8, (Math.random() * 2 - 1) * halfD * 0.8, 0.8);
        nextAuto = now + AUTO_EVERY_MS + Math.random() * 1200;
      }
      // drop dead points
      while (trail.length && now - trail[0].t0 > FADE * 3500) trail.shift();
      for (let i = 0; i < count; i++) {
        const cell = cells[i];
        let sumH = 0;
        let sumW = 0;
        for (const p of trail) {
          const age = (now - p.t0) / 1000;
          const dist = Math.hypot(cell.x - p.x, cell.z - p.z);
          const rel = dist - SPEED * age;
          const window = Math.exp(-(rel * rel) / (WIDTH * WIDTH));
          if (window < 0.002) continue;
          const weight = Math.exp(-age / FADE) * window * (1 / (1 + dist * 0.1)) * p.w;
          sumH += weight * Math.cos(FREQ * rel);
          sumW += weight;
        }
        const h = sumW > 0 ? (sumH / sumW) * Math.min(1, sumW) * AMP : 0;
        tmp.position.set(cell.x, HEIGHT / 2 + h, cell.z);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        const t = Math.max(0, Math.min(1, (h + AMP * 0.15) / AMP));
        col.copy(base).lerp(high, t * t);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      camera.position.x += (tilt.x * 0.8 - camera.position.x) * 0.04;
      camera.lookAt(tilt.x * 0.3, 0, -tilt.y * 0.3);
      renderer.render(scene, camera);
    };

    let raf = 0;
    let running = false;
    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    /* Still frame for reduced motion: one soft ring, drawn once. */
    if (reduced) {
      push(-halfW * 0.3, 0, 0.9);
      trail[0].t0 = performance.now() - 900;
      frame(performance.now());
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0.05 });
    io.observe(el);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reduced]);

  return <div ref={host} aria-hidden="true" className={className} />;
}
