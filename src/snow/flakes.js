// Flocons : des points qui tombent dans une boîte centrée sur la caméra.
import * as THREE from 'three';

const COUNT = 2000, BX = 40, BY = 24, BZ = 40;

export function makeFlakes(scene, camera) {
  const pos = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) { pos[i * 3] = Math.random() * BX; pos[i * 3 + 1] = Math.random() * BY; pos[i * 3 + 2] = Math.random() * BZ; seed[i] = Math.random(); }
  const live = new Float32Array(COUNT * 3), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(live, 3)); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false; scene.add(pts);
  const wrap = (v, size) => ((v % size) + size) % size;
  return {
    update(dt, cmPerHour) {
      geo.setDrawRange(0, Math.round(COUNT * Math.min(1, Math.max(0, cmPerHour / 4))));
      const c = camera.position, t = performance.now() / 1000;
      for (let i = 0; i < COUNT; i++) {
        const j = i * 3, s = seed[i];
        pos[j + 1] -= (1.2 + s) * dt; pos[j] += (0.6 + Math.sin(t * 0.7 + s * 6.28) * 0.4) * dt;
        pos[j] = wrap(pos[j], BX); pos[j + 1] = wrap(pos[j + 1], BY); pos[j + 2] = wrap(pos[j + 2], BZ);
        live[j] = c.x - BX / 2 + wrap(pos[j] - c.x, BX);
        live[j + 1] = c.y - 6 + wrap(pos[j + 1] - c.y + 6, BY);
        live[j + 2] = c.z - BZ / 2 + wrap(pos[j + 2] - c.z, BZ);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
