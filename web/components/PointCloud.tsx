"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Point } from "@/lib/convert";

const NEAR_HUE = 0.08;
const FAR_HUE = 0.58;
const POINT_SIZE_CM = 1;

type View = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  points: THREE.Points;
};

function writePoints(geometry: THREE.BufferGeometry, points: Point[]) {
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const cms = points.map((p) => p.cm);
  const min = Math.min(...cms);
  const span = Math.max(...cms) - min || 1;
  const color = new THREE.Color();
  points.forEach((p, i) => {
    positions.set([p.x, p.y, p.z], i * 3);
    const t = (p.cm - min) / span;
    color.setHSL(NEAR_HUE + (FAR_HUE - NEAR_HUE) * t, 0.85, 0.6);
    colors.set([color.r, color.g, color.b], i * 3);
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
}

export function PointCloud({ points }: { points: Point[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- only known once creation fails
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(60, 30, -20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 40);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(160, 16, 0x39414d, 0x20252c);
    grid.position.set(0, -40, 40);
    scene.add(grid);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    scene.add(marker);

    const cloud = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: POINT_SIZE_CM, vertexColors: true }),
    );
    scene.add(cloud);
    viewRef.current = { camera, controls, points: cloud };

    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      viewRef.current = null;
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      cloud.geometry.dispose();
      (cloud.material as THREE.Material).dispose();
      grid.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (viewRef.current) writePoints(viewRef.current.points.geometry, points);
  }, [points]);

  const fitView = () => {
    const view = viewRef.current;
    const sphere = view?.points.geometry.boundingSphere;
    if (!view || !sphere || points.length === 0) return;
    const direction = view.camera.position.clone().sub(view.controls.target).normalize();
    view.controls.target.copy(sphere.center);
    view.camera.position
      .copy(sphere.center)
      .addScaledVector(direction, Math.max(sphere.radius * 2.5, 20));
  };

  return (
    <div className="relative h-full min-h-[60vh] overflow-hidden rounded-lg border border-zinc-800">
      <div ref={hostRef} className="absolute inset-0" data-testid="point-cloud" />
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-zinc-300">
          This browser couldn&apos;t start 3D graphics (WebGL), so the scan can&apos;t be
          shown. You can still scan and save it.
        </p>
      ) : (
        <button
          type="button"
          onClick={fitView}
          disabled={points.length === 0}
          className="absolute right-3 top-3 rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
        >
          Fit view
        </button>
      )}
    </div>
  );
}
