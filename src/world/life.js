/* Vie du quartier (§4), visuels des événements de Night : chasse-neige de la commune (npc/veh-postvan.glb + étrave et
   gyrophare par code) sur sa tournée, piétons (proportional_low_poly_man, instanciés) dont Night calcule la marche, bus
   (town-bus.glb) sur la rue principale. makeLife(scene, snow) -> { hooks: { onPlow, onPeds, onBus }, update(dt), ready }. */
import * as THREE from 'three';
import { loadGLB, bakeParts } from '../../../../assets/glb.js';

const url = (f) => new URL(`../../../../assets/models/${f}.glb`, import.meta.url).href;
const PED_SCALE = 1.75 / 5.75, MAX_PEDS = 16, TINTS = [0x6b8fc4, 0xc46b6b, 0x8fb86b, 0xe0d6b0, 0x7a6ba8, 0xd9a066, 0x4a5a6a];
const PLOW_V = 9, BUS_V = 10; // m/s, temps réel

// véhicule cuit en une pièce par matériau, grand axe sur z, longueur len (m) si donnée
async function vehicle(file, len) {
  const k = bakeParts(await loadGLB(url(file)), 1);
  if (k.size.x > k.size.z) { for (const p of k.parts) p.geo.rotateY(Math.PI / 2); [k.size.x, k.size.z] = [k.size.z, k.size.x]; }
  if (len) { const s = len / k.size.z; for (const p of k.parts) p.geo.scale(s, s, s); k.size.multiplyScalar(s); }
  const g = new THREE.Group();
  for (const p of k.parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; g.add(m); }
  g.visible = false; g.userData.size = k.size;
  return g;
}

// fait rouler obj le long d'une polyligne [[x, z], ...] puis le cache
class Drive {
  constructor(obj, v) { this.obj = obj; this.v = v; this.pts = null; }
  start(pts) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.pts = pts; this.cum = cum; this.s = 0; this.yaw = null; this.obj.visible = pts.length > 1;
  }
  update(dt) {
    if (!this.pts || !this.obj.visible) return false;
    this.s += this.v * dt; const { pts, cum } = this, end = cum[cum.length - 1];
    if (this.s >= end) { this.obj.visible = false; this.pts = null; return false; }
    let i = 1; while (cum[i] < this.s) i++;
    const a = pts[i - 1], b = pts[i], t = (this.s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    // virage adouci : le cap rejoint celui du segment à 2,5 rad/s
    this.yaw = this.yaw == null ? yaw : this.yaw + Math.max(-2.5 * dt, Math.min(2.5 * dt, Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))));
    this.obj.position.set(a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t); this.obj.rotation.y = this.yaw;
    return true;
  }
}

export function makeLife(scene, snow) {
  let plow = null, bus = null, pedMeshes = null, peds = null, beacon = null, t = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

  const ready = Promise.all([
    vehicle('npc/veh-postvan').then((g) => {
      const sz = g.userData.size, orange = new THREE.MeshStandardMaterial({ color: 0xe07a1a, roughness: 0.5, metalness: 0.3, emissive: 0x5a2600 }); // lueur : visible la nuit hors des lampadaires
      // étrave : plaque inclinée en biais devant le capot (rejette la neige à droite), deux bras
      const blade = new THREE.Mesh(new THREE.BoxGeometry(sz.x + 0.8, 0.75, 0.08), orange);
      blade.position.set(0, 0.45, sz.z / 2 + 0.55); blade.rotation.set(-0.2, 0.35, 0); blade.castShadow = true; g.add(blade);
      for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), orange); arm.position.set(s * 0.5, 0.4, sz.z / 2 + 0.25); g.add(arm); }
      beacon = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 2 }));
      beacon.position.set(0, sz.y + 0.06, -0.2 + sz.z * 0.15); g.add(beacon);
      scene.add(g); plow = new Drive(g, PLOW_V);
    }),
    vehicle('town-bus', 11.5).then((g) => { scene.add(g); bus = new Drive(g, BUS_V); }),
    loadGLB(url('proportional_low_poly_man__free_download')).then((root) => {
      const k = bakeParts(root, PED_SCALE);
      pedMeshes = k.parts.map((p) => { const im = new THREE.InstancedMesh(p.geo, p.mat, MAX_PEDS); im.count = 0; im.castShadow = true; im.frustumCulled = false; scene.add(im); return im; });
      for (const im of pedMeshes) { for (let i = 0; i < MAX_PEDS; i++) im.setColorAt(i, _c.set(TINTS[i % TINTS.length])); im.instanceColor.needsUpdate = true; }
    }),
  ]).catch((e) => console.warn('vie du quartier : modèles non chargés', e));

  const hooks = {
    onPlow: (path) => ready.then(() => plow?.start(path)),
    onBus: (path) => ready.then(() => bus?.start(path)),
    onPeds: (list) => { peds = list; },
  };

  function update(dt) {
    t += dt;
    plow?.update(dt); bus?.update(dt);
    if (beacon && plow?.obj.visible) beacon.material.emissiveIntensity = Math.sin(t * 12) > 0 ? 3 : 0.3; // gyrophare
    if (peds && pedMeshes) {
      const n = Math.min(peds.length, MAX_PEDS);
      for (let i = 0; i < n; i++) {
        const p = peds[i], f = snow.fieldAt(p.x, p.z), y = f ? f.baseY(p.x, p.z) + f.h[f.cellAt(p.x, p.z)] : 0, sw = Math.sin(t * 7 + i * 1.7);
        _q.setFromEuler(_e.set(0, p.yaw, sw * 0.05)); _m.compose(_p.set(p.x, y + Math.abs(sw) * 0.035, p.z), _q, _s);
        for (const im of pedMeshes) im.setMatrixAt(i, _m);
      }
      for (const im of pedMeshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    }
  }
  return { hooks, update, ready, get plow() { return plow; }, get bus() { return bus; } };
}
