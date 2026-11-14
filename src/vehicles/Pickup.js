/* Pick-up du dépôt (§8.0) : npc/car-pickup.glb cadré par fitGLB (avant sur +z), roues rigWheels/poseWheel, physique CarPhysics.
   Il ne déneige pas : ses pneus tassent la neige (traces) et il patine dans plus de 25 cm (snowDrag, lu devant les roues motrices
   côté où l'on roule). Surface sous les roues (moyenne des 4) : hors champ ou dégagée (h < CLEAN) = chaussée nue, glace, neige tassée (rho ≥ packedMin), sinon neige. Caisse posée sur baseY + neige tassée sous chaque roue (rampe à 9 % de l'allée 7 : tangage).
   Habitacle par code (le modèle est une coque) : coque intérieure BackSide, planche de bord, combiné (dash.js), volant qui tourne.
   Phares (L) : un projecteur sans ombre, toujours dans la scène (intensité 0 éteint : pas de recompilation des shaders).
   Plateau : bed ; la fraise s'y charge par une rampe animée en 1,5 s (loadBlower / unloadBlower, appelés par seat.js).
   Interface attendue de la fraise (tâche 9) : { id: 'blower', group: Object3D, solid, stowed, place(x, z, yaw) } ;
   tant qu'elle est rangée (stowed), c'est le pick-up qui pose son group. */
import * as THREE from 'three';
import { loadGLB, fitGLB, rigWheels, poseWheel } from '../../../../assets/glb.js';
import { CarPhysics, snowDrag, collideCar, MU } from './physics.js';
import { makeDash } from './dash.js';
import { DENS, CLEAN, ICE_THIN } from '../snow/SnowField.js';
import { clamp } from '../core/util.js';

const MODEL = new URL('../../../../assets/models/npc/car-pickup.glb', import.meta.url).href;
const TYRES = 0.6; // pneus neige du pick-up (grip) ; les chaînes de la tâche 10 le monteront à 0,9
const RAMP_T = 1.5, RAMP_LEN = 1.8, BED_Y = 0.95; // s, m ; hauteur du plancher du plateau (mesurée sur le modèle)
const IDLE = { throttle: 0, brake: 0, steer: 0, hand: true };
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// neige sous un point du monde : [champ, cellule] ou null
const cell = (snow, x, z) => { const f = snow.fieldAt(x, z); return f ? [f, f.cellAt(x, z)] : null; };
// repère du véhicule [gauche, avant] -> monde ; oz = décalage du modèle (avant du modèle à z + oz du centre physique)
const toW = (ph, oz) => { const fx = Math.sin(ph.yaw), fz = Math.cos(ph.yaw); return (lx, lz) => [ph.x + fz * lx + fx * (lz - oz), ph.z - fx * lx + fz * (lz - oz)]; };

/* Pick-up et quad : neige lue juste devant chaque pneu dans le sens de marche (la roue tasse sa propre cellule). keys = surface
   de chaque roue (clé de MU : hors champ ou dégagée = asphalt, ice, packed, snow) ; depth = pire roue motrice du côté où l'on roule.
   v : { phys, wheels (rigWheels), radius } ; oz : centre physique décalé de oz vers l'avant du modèle (quad : lame comprise). */
export function wheelSurface(v, snow, dir, oz = 0) {
  const W = toW(v.phys, oz), keys = [];
  let depth = 0;
  for (const w of v.wheels) {
    const c = cell(snow, ...W(w.c.x, w.c.z + dir * (v.radius + 0.05))), [f, i] = c || [];
    keys.push(!c ? 'asphalt' : f.ice[i] && f.h[i] < ICE_THIN ? 'ice' : f.h[i] < CLEAN ? 'asphalt' : f.rho[i] >= DENS.packedMin ? 'packed' : 'snow');
    if (c && w.front === dir > 0) depth = Math.max(depth, f.h[i]);
  }
  return { depth, keys };
}

/* Caisse : chaque roue sur le sol + la neige une fois tassée (tangage, roulis, plus tangage et roulis dynamiques) ; les pneus
   tassent la neige (traces). v : { phys, wheels, group, tilt, track, groundAt, sync } */
export function settle(v, snow, dt, oz = 0) {
  const ph = v.phys, W = toW(ph, oz), ys = [], pack = Math.min(1, ph.speed * dt * 3);
  for (const w of v.wheels) {
    const [x, z] = W(w.c.x, w.c.z), c = cell(snow, x, z); if (!c) { ys.push(v.groundAt(x, z)); continue; }
    const [f, i] = c; ys.push(f.baseY(x, z) + f.h[i] * f.rho[i] / DENS.packedMax);
    if (pack > 0) for (const o of [-0.1, 0, 0.1]) { const k = cell(snow, ...W(w.c.x + o, w.c.z)); if (k) k[0].pack(k[1], pack); }
  }
  const avg = (sel) => { let s = 0, n = 0; v.wheels.forEach((w, k) => { if (sel(w)) { s += ys[k]; n++; } }); return n ? s / n : 0; };
  const yF = avg((w) => w.front), yR = avg((w) => !w.front), yL = avg((w) => w.left), yRt = avg((w) => !w.left), k = Math.min(1, 12 * dt);
  v.group.position.y += ((yF + yR) / 2 - v.group.position.y) * k;
  const t = v.tilt.rotation, d = ph.d;
  t.x += (-Math.atan2(yF - yR, d.wheelbase) + clamp(-ph.acc * 0.0045, -0.035, 0.035) - t.x) * k;
  t.z += (Math.atan2(yL - yRt, v.track || d.width) + clamp(ph.v * ph.yawRate * 0.0028, -0.035, 0.035) - t.z) * k;
  v.sync();
}

export class Pickup {
  constructor(scene) {
    this.id = 'pickup'; this.scene = scene;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt); scene.add(this.group);
    this.phys = new CarPhysics({ length: 5.8, width: 2.3, wheelbase: 3.2, rearBehind: 1.5 }); // remplacé par les cotes du modèle
    this.solid = { x: 0, z: 0, hw: 1.15, hd: 2.9, yaw: 0 };
    this.solids = []; // obstacles (main.js)
    this.groundAt = () => 0; // hauteur du sol hors des champs de neige (main.js)
    this.bed = new Set(['jerrycan']); // jerrican de 2 L dès le départ (§8.0, panne de la fraise)
    this.hits = 0; this.lights = false; this.fuel = 0.8; this.stuck = false; this.driven = false; this.doorZ = 0;
    this.rampT = -1; this.rampDir = 1; this.cargo = null;
    this.wheels = []; this.spin = 0; this.radius = 0.4;
  }

  async load() {
    const scene = await loadGLB(MODEL);
    const nat = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const out = fitGLB(scene, Math.max(nat.x, nat.z), 0);
    out.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const wheels = rigWheels(out), body = new THREE.Box3().setFromObject(out).getSize(new THREE.Vector3());
    const zs = (front) => { const w = wheels.filter((k) => k.front === front); return w.reduce((s, k) => s + k.c.z, 0) / Math.max(1, w.length); };
    const zf = zs(true), zr = zs(false);
    this.radius = new THREE.Box3().setFromObject(wheels[0].spin).getSize(_v).y / 2;
    this.phys.d = { length: body.z, width: body.x, wheelbase: zf - zr, rearBehind: -zr };
    this.solid.hw = body.x / 2; this.solid.hd = body.z / 2;
    this.track = Math.abs(wheels.find((w) => w.left).c.x - wheels.find((w) => !w.left).c.x);
    this.wheels = wheels; this.tilt.add(out);

    // --- habitacle : repères pris sur le vitrage (pare-brise = avant de la vitre) ; la coque est fermée sous les vitres (sill),
    //     la planche, le combiné et le haut du volant sont donc posés au-dessus ---
    let glass, shell, optics;
    out.traverse((o) => { if (!o.isMesh) return; const n = o.material.name || ''; if (/glass/i.test(n)) glass = o; else if (/body/i.test(n)) shell = o; else if (/optic/i.test(n)) optics = o; });
    glass.material.side = THREE.FrontSide; // vu de l'intérieur, le vitrage teinté assombrirait toute la vue
    const gb = new THREE.Box3().setFromObject(glass), winZ = gb.max.z, sill = gb.min.y, cabW = gb.max.x - gb.min.x;
    // coque intérieure : la coque du modèle n'a qu'une face, invisible de l'intérieur (portières, pavillon)
    const inner = new THREE.Mesh(shell.geometry, new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.95, side: THREE.BackSide }));
    shell.add(inner);
    const trim = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 }), dark = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 });
    const cab = new THREE.Group(); this.tilt.add(cab);
    const board = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.12, 0.08, 0.5), trim); board.position.set(0, sill + 0.02, winZ - 0.3); cab.add(board);
    const dx = 0.4; // conducteur à gauche (+x)
    this.doorZ = winZ - 1.1;
    const pod = new THREE.Group(); pod.position.set(dx, sill + 0.12, winZ - 0.5); pod.rotation.set(0.35, Math.PI, 0); cab.add(pod);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.17, 0.05), dark); housing.position.z = -0.026; pod.add(housing);
    this.dash = makeDash(0.38, 0.14); pod.add(this.dash.mesh);
    const col = new THREE.Group(); col.position.set(dx, sill - 0.17, winZ - 0.62); col.rotation.x = 0.45; cab.add(col);
    this.wheelGfx = new THREE.Group(); col.add(this.wheelGfx);
    this.wheelGfx.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 8, 32), dark));
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.012), dark); s.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0); s.rotation.z = a; this.wheelGfx.add(s); }
    this.wheelGfx.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16).rotateX(Math.PI / 2), dark));
    this.eye = new THREE.Object3D(); this.eye.position.set(dx, sill + 0.38, this.doorZ); this.tilt.add(this.eye);
    this.look = new THREE.Object3D(); this.eye.add(this.look); // orientation du regard posée par Cams.followCar

    // --- phares et feux arrière : le modèle n'a qu'un matériau Optics ; ses triangles sont triés avant / arrière (deux groupes) ---
    if (optics) {
      out.updateMatrixWorld(true);
      const g = optics.geometry, pos = g.attributes.position, idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()], front = [], rear = [];
      for (let t = 0; t < idx.length; t += 3) {
        let z = 0; for (let j = 0; j < 3; j++) z += _v.fromBufferAttribute(pos, idx[t + j]).applyMatrix4(optics.matrixWorld).z;
        (z > 0 ? front : rear).push(idx[t], idx[t + 1], idx[t + 2]);
      }
      g.setIndex([...front, ...rear]); g.clearGroups(); g.addGroup(0, front.length, 0); g.addGroup(front.length, rear.length, 1);
      this.head = optics.material.clone(); this.head.emissive = new THREE.Color(0xfff1d8); this.head.emissiveIntensity = 0;
      this.tail = optics.material.clone(); this.tail.emissive = new THREE.Color(0xff1a0a); this.tail.emissiveIntensity = 0;
      optics.material = [this.head, this.tail];
    }
    this.beam = new THREE.SpotLight(0xfff1d8, 0, 70, 0.55, 0.6, 1.4); this.beam.position.set(0, 0.85, body.z / 2 - 0.2);
    this.beam.target.position.set(0, 0, body.z / 2 + 25); this.tilt.add(this.beam, this.beam.target);

    // --- rampe de chargement (montrée pendant l'animation) ---
    this.ramp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, Math.hypot(RAMP_LEN, BED_Y)), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.6 }));
    this.ramp.position.set(0, BED_Y / 2, -body.z / 2 - RAMP_LEN / 2); this.ramp.rotation.x = -Math.atan2(BED_Y, RAMP_LEN); this.ramp.visible = false; this.tilt.add(this.ramp);
    this.place(this.phys.x, this.phys.z, this.phys.yaw);
    return this;
  }

  place(x, z, yaw) { this.phys.place(x, z, yaw); this.sync(); }
  sync() { const p = this.phys, s = this.solid; s.x = p.x; s.z = p.z; s.yaw = p.yaw; this.group.position.x = p.x; this.group.position.z = p.z; this.group.rotation.y = p.yaw; }
  enter() { this.driven = true; }
  exit() { this.driven = false; this.phys.v = this.phys.vl = 0; } // frein à main serré en descendant

  // point du monde (x, z) -> repère du pick-up [gauche, avant]
  local(x, z) { const p = this.phys, c = Math.cos(p.yaw), n = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return [dx * c - dz * n, dx * n + dz * c]; }
  nearTailgate(x, z) { const [lx, lz] = this.local(x, z); return Math.abs(lx) < this.solid.hw + 0.3 && lz < -this.solid.hd + 0.3 && lz > -this.solid.hd - 2.5; }
  loadBlower(b) { if (this.rampT >= 0 || this.bed.has('blower')) return false; this.bed.add('blower'); b.stowed = true; this.cargo = b; this.rampT = 0; this.rampDir = 1; return true; }
  unloadBlower(b) { if (this.rampT >= 0 || !this.bed.has('blower')) return false; this.bed.delete('blower'); this.cargo = b; this.rampT = 0; this.rampDir = -1; return true; }


  update(dt, inp, snow) {
    const ph = this.phys, I = !inp || !this.driven || this.rampT >= 0 ? IDLE : inp;
    const dir = I.throttle > I.brake ? 1 : I.brake > I.throttle ? -1 : Math.sign(ph.v) || 1;
    const { depth, keys } = wheelSurface(this, snow, dir);
    const sd = snowDrag(depth, 'pickup'); ph.drag = sd.drag; this.stuck = sd.stuck;
    ph.grip = TYRES; ph.mu = keys.length ? keys.reduce((s, k) => s + MU[k], 0) / keys.length : MU.packed;
    ph.step(dt, I);
    if (ph.speed > 1e-4 && collideCar(ph, this.solids) > 2) this.hits++; // chocs pour les réparations du garage (tâche 12) ; à l'arrêt, rien à tester
    settle(this, snow, dt);

    // roues (elles tournent dans le vide quand le pick-up patine), volant, phares, combiné
    const slip = this.stuck && (I.throttle > 0 || I.brake > 0);
    this.spin += (slip ? dir * Math.max(Math.abs(ph.v), 6 * Math.max(I.throttle, I.brake)) : ph.v) * dt / this.radius;
    for (const w of this.wheels) poseWheel(w, this.spin, ph.steer);
    if (!this.dash) return;
    this.wheelGfx.rotation.z = -ph.steer * 14;
    this.beam.intensity = this.lights ? 60 : 0;
    if (this.head) { this.head.emissiveIntensity = this.lights ? 2 : 0; this.tail.emissiveIntensity = I.brake > 0 && ph.v > 0.25 ? 2.5 : this.lights ? 0.9 : 0; } // feux stop
    if (this.driven) this.dash.draw({ kmh: Math.abs(ph.v) * 3.6, gear: ph.v < -0.2 ? 'R' : ph.v > 0.2 ? 'D' : I.hand ? 'P' : 'N', fuel: this.fuel, lights: this.lights, slip });
    this.updateRamp(dt);
  }

  // rampe : la fraise monte (ou descend) du sol derrière le plateau jusqu'au plancher en 1,5 s ; rangée, elle suit le plateau
  updateRamp(dt) {
    const b = this.cargo; if (!b) return;
    const hd = this.solid.hd, P0 = [-hd - RAMP_LEN + 0.4, 0], P1 = [-hd, BED_Y], P2 = [-hd + 1.2, BED_Y];
    let u = 1;
    if (this.rampT >= 0) {
      this.rampT += dt; u = clamp(this.rampT / RAMP_T, 0, 1); if (this.rampDir < 0) u = 1 - u;
      this.ramp.visible = this.rampT < RAMP_T;
    }
    const [a, c, s] = u < 0.7 ? [P0, P1, u / 0.7] : [P1, P2, (u - 0.7) / 0.3];
    _v.set(0, a[1] + (c[1] - a[1]) * s, a[0] + (c[0] - a[0]) * s);
    this.tilt.updateMatrixWorld(true); this.tilt.localToWorld(_v);
    b.group.position.copy(_v); b.group.quaternion.copy(this.tilt.getWorldQuaternion(_q));
    if (this.rampT >= RAMP_T) {
      this.rampT = -1; this.ramp.visible = false;
      if (this.rampDir < 0) { b.stowed = false; b.place?.(_v.x, _v.z, this.phys.yaw); this.cargo = null; }
    }
  }
}
