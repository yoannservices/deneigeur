/* Quad avec lame (§8.3) : quad-raptor.glb cadré par fitGLB à 1,85 m (avant déjà sur +z : pneus arrière plus larges), roues
   découpées dans le maillage unique des pneus (splitWheels), physique CarPhysics, lame construite par code.
   Centre physique = milieu de la boîte quad + lame (OZ m devant le centre du modèle) : la lame bute sur les obstacles.
   Lame : T / G (manette : croix haut / bas) la montent ou la baissent jusqu'en butée (animée, 0,5 m/s, 0,35 m au plus),
   A / E (KeyQ / KeyE, croix gauche / droite) l'orientent de -30° à +30° (angle > 0 = gauche). Baissée, elle racle par pushBlade
   (largeur 1,5 m, capacité 120 kg) par pas de 0,1 m au plus de son avance ; au-delà de la capacité la neige déborde du côté
   orienté (aux deux bouts lame droite), au plus spillPerM(angle) kg par mètre : le reste grossit la charge poussée, visible
   devant la lame. Charge > 1,5 x la capacité : les roues patinent (plus d'avance), il faut reculer : la charge reste en tas
   devant la lame (reculer ou la lever la dépose). Bourrelet devant les pneus avant ou la lame : snowDrag 'quad' (> 40 cm ralentit,
   > 70 cm bloque net : la vitesse vers le bourrelet est annulée). Neige déversée sur une voiture ou une porte : onPenalty (PenaltyGate, une fois par cible et par épisode).
   Interface véhicule (seat.js) : { id, group, solid, phys, place, enter, exit, look, chase, doorZ, lights, hits }. */
import * as THREE from 'three';
import { loadGLB, fitGLB, poseWheel } from '../../../../assets/glb.js';
import { CarPhysics, snowDrag, collideCar, MU } from './physics.js';
import { wheelSurface, settle } from './Pickup.js';
import { splitWheels } from './splitWheels.js';
import { BLADE, quadGrip, spillPerM, spillSide, windrowBeyond, windrowSweep } from './quadLogic.js';
import { PenaltyGate } from './blowerLogic.js';
import { makeDash } from './dash.js';
import { pushBlade, throwLoad } from '../snow/blade.js';
import { pressed, held } from '../core/input.js';
import { clamp } from '../core/util.js';

const MODEL = new URL('../../../../assets/models/quad-raptor.glb', import.meta.url).href;
const LEN = 1.85, TYRE_MAT = 'color_2829873';
// lame : bras de poussée articulés sous le châssis (y 0,25, z 0,3 du modèle), longueur ARM ; plaque de 0,42 m de haut
const ARM_Y = 0.25, ARM_Z = 0.3, ARM = 0.82, PLATE_H = 0.42, LIFT_MAX = 0.35, LIFT_RATE = 0.5, TURN_RATE = 0.8;
const BLADE_Z = ARM_Z + ARM, OZ = (BLADE_Z + 0.08 - LEN / 2) / 2; // bord de lame (modèle), décalage du centre physique
const IDLE = { throttle: 0, brake: 0, steer: 0, hand: true };
const _v = new THREE.Vector3();

export class Quad {
  constructor(scene, snow) {
    this.id = 'quad'; this.snow = snow;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt); scene.add(this.group);
    this.body = new THREE.Group(); this.body.position.z = -OZ; this.tilt.add(this.body); // modèle et lame, repère du modèle
    this.phys = new CarPhysics({ length: LEN / 2 + BLADE_Z + 0.08, width: BLADE.width, wheelbase: 1.26, rearBehind: 0.63 + OZ });
    this.solid = { x: 0, z: 0, hw: BLADE.width / 2, hd: this.phys.d.length / 2, yaw: 0 };
    this.solids = []; this.groundAt = () => 0; this.penaltyAt = () => null; this.onPenalty = () => {}; // posés par main.js
    this.blade = { height: LIFT_MAX, target: LIFT_MAX, angle: 0, width: BLADE.width, v: false }; // height : m au-dessus du sol
    // achats (tâche 12). shortcut: vblade = débord aux deux bouts seulement (pas de touche ni de forme en V) ; spreader = sel
    // derrière le quad (main.js, stock illimité) ; lights = phare plus fort, sans gyrophare. À compléter quand ces systèmes existeront.
    this.upgrades = { vblade: false, chains: false, lights: false, spreader: false };
    this.carry = { kg: 0, rho: 100 }; this.spillRate = 0; this.gate = new PenaltyGate(); this._t = 0;
    this.hits = 0; this.lights = false; this.fuel = 0.8; this.stuck = false; this.slip = false; this.driven = false;
    this.wheels = []; this.spin = 0; this.radius = 0.3; this.track = 1;
    this.chase = [5.4, 2.4]; this.doorZ = -0.3 - OZ; // descente à hauteur de la selle
    this.look = new THREE.Object3D(); // regard en vue guidon (Cams.followCar), enfant de l'œil
  }

  async load() {
    const scene = await loadGLB(MODEL);
    const out = fitGLB(scene, LEN); out.updateMatrixWorld(true);
    let tyre; out.traverse((o) => { if (o.isMesh && o.material.name === TYRE_MAT) tyre = o; });
    const wheels = splitWheels(tyre, 0, 0);
    out.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const zs = (front) => { const w = wheels.filter((k) => k.front === front); return w.reduce((s, k) => s + k.c.z, 0) / Math.max(1, w.length); };
    const zf = zs(true), zr = zs(false);
    this.radius = new THREE.Box3().setFromObject(wheels[0].spin).getSize(_v).y / 2;
    this.phys.d = { ...this.phys.d, wheelbase: zf - zr, rearBehind: OZ - zr };
    this.track = Math.abs(wheels.find((w) => w.left).c.x - wheels.find((w) => !w.left).c.x);
    this.wheels = wheels; this.body.add(out); this.model = out;

    // --- lame : plaque acier inclinée, couteau d'usure, nervures, bras de poussée et traverse ; pivot d'angle au centre ---
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9772a, roughness: 0.45, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.7, metalness: 0.4 });
    const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; return b; };
    this.arm = new THREE.Group(); this.arm.position.set(0, ARM_Y, ARM_Z); this.body.add(this.arm);
    for (const x of [-0.28, 0.28]) this.arm.add(box(0.05, 0.05, ARM, dark, x, 0, ARM / 2));
    this.arm.add(box(0.62, 0.05, 0.05, dark, 0, 0, ARM - 0.06));
    this.bladeYaw = new THREE.Group(); this.bladeYaw.position.z = ARM; this.arm.add(this.bladeYaw); // bord bas de la plaque à y = -ARM_Y
    const plate = box(BLADE.width, PLATE_H, 0.02, steel, 0, -ARM_Y + PLATE_H / 2, 0.06, -0.18); this.bladeYaw.add(plate);
    this.bladeYaw.add(box(BLADE.width, 0.05, 0.03, dark, 0, -ARM_Y + 0.025, 0.08));                     // couteau d'usure
    for (const x of [-0.6, -0.2, 0.2, 0.6]) this.bladeYaw.add(box(0.03, PLATE_H - 0.06, 0.05, dark, x, -ARM_Y + PLATE_H / 2, 0.02, -0.18));
    this.bladeYaw.add(box(0.12, 0.12, 0.08, dark, 0, 0, 0));                                              // rotule d'orientation
    // repères de bout de lame (tiges à embout orange) : la lame baissée est cachée par l'avant du quad en vue guidon
    const tip = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.6, roughness: 0.5 });
    for (const x of [-BLADE.width / 2 + 0.03, BLADE.width / 2 - 0.03]) {
      this.bladeYaw.add(box(0.015, 0.7, 0.015, dark, x, -ARM_Y + PLATE_H + 0.3, 0));
      this.bladeYaw.add(box(0.03, 0.12, 0.03, tip, x, -ARM_Y + PLATE_H + 0.6, 0));
    }
    // charge poussée : demi-ellipsoïde blanc devant la lame, à l'échelle du volume
    this.pile = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xeef3fb, roughness: 0.95 }));
    this.pile.position.set(0, -ARM_Y, 0.1); this.pile.visible = false; this.bladeYaw.add(this.pile);

    // --- poste de pilotage : yeux du pilote assis, combiné sur le guidon (y 1,06, z 0,25 du modèle), phare ---
    // shortcut: le guidon du modèle (dans les maillages par couleur) ne tourne pas ; le découper par carve s'il faut le voir braquer
    const eye = new THREE.Object3D(); eye.position.set(0, 1.62, -0.28); eye.rotation.x = 0.28; this.body.add(eye); eye.add(this.look); // regard baissé : lame dans le cadre
    const pod = new THREE.Group(); pod.position.set(0, 1.1, 0.2); pod.rotation.set(0.6, Math.PI, 0); this.body.add(pod);
    pod.add(box(0.2, 0.08, 0.03, dark, 0, 0, -0.016));
    this.dash = makeDash(0.18, 0.068); pod.add(this.dash.mesh);
    this.beam = new THREE.SpotLight(0xfff1d8, 0, 50, 0.6, 0.6, 1.4); this.beam.position.set(0, 0.8, LEN / 2 - 0.1);
    this.beam.target.position.set(0, 0, LEN / 2 + 18); this.body.add(this.beam, this.beam.target);
    this.place(this.phys.x, this.phys.z, this.phys.yaw);
    return this;
  }

  place(x, z, yaw) {
    this.dropLoad(); // la charge poussée reste sur place
    this.phys.place(x, z, yaw); this.group.position.y = this.groundAt(x, z); this.sync();
  }
  sync() { const p = this.phys, s = this.solid; s.x = p.x; s.z = p.z; s.yaw = p.yaw; this.group.position.x = p.x; this.group.position.z = p.z; this.group.rotation.y = p.yaw; }
  enter() { this.driven = true; }
  exit() { this.driven = false; this.phys.v = this.phys.vl = 0; this.dropLoad(); } // frein à main serré en descendant ; la charge reste devant la lame

  // bord bas de la lame, au centre (monde) : avancé de BLADE_Z - OZ devant le centre physique
  bladePos() { const p = this.phys, a = BLADE_Z - OZ; return [p.x + Math.sin(p.yaw) * a, p.z + Math.cos(p.yaw) * a]; }
  // charge poussée déposée en tas (rayon 1 m : un seul tas ne fait pas un bourrelet infranchissable) 0,35 m devant la lame
  dropLoad() {
    if (this.carry.kg <= 0) return;
    const [bx, bz] = this.bladePos(), p = this.phys, x = bx + Math.sin(p.yaw) * 0.35, z = bz + Math.cos(p.yaw) * 0.35, kind = this.penaltyAt(x, z, 0.4);
    if (this.gate.hit(kind, this._t)) this.onPenalty(kind);
    throwLoad(this.snow, this.carry, x, z, 1);
  }

  update(dt, inp, snow) {
    if (!this.model) return;
    this._t += dt;
    const ph = this.phys, b = this.blade, I = inp && this.driven ? inp : IDLE;
    if (inp && this.driven) {
      if (pressed('KeyT')) b.target = LIFT_MAX; if (pressed('KeyG')) b.target = 0;
      b.angle = clamp(b.angle + ((held('KeyQ') ? 1 : 0) - (held('KeyE') ? 1 : 0)) * TURN_RATE * dt + ((pressed('KeyQ') && !held('KeyQ') ? 1 : 0) - (pressed('KeyE') && !held('KeyE') ? 1 : 0)) * 0.1, -BLADE.maxAngle, BLADE.maxAngle); // cran de 0,1 rad : croix de la manette (sans touche tenue)
    }
    b.height += clamp(b.target - b.height, -LIFT_RATE * dt, LIFT_RATE * dt);
    const down = b.height < 0.02;
    b.v = this.upgrades.vblade;

    // surface sous les pneus (chaînes : 0,9 sur neige tassée et verglas), bourrelet devant les pneus avant ou la lame
    const dir = I.throttle > I.brake ? 1 : I.brake > I.throttle ? -1 : Math.sign(ph.v) || 1;
    let { depth, keys } = wheelSurface(this, snow, dir, OZ);
    const [bx0, bz0] = this.bladePos(), fx = Math.sin(ph.yaw), fz = Math.cos(ph.yaw);
    // lame baissée : seulement face à son milieu (elle repousse de côté le bourrelet qu'elle reprend par son bout)
    if (dir > 0) for (const u of down ? [0] : [-0.6, 0, 0.6]) {
      const x = bx0 + fx * 0.25 + fz * u, z = bz0 + fz * 0.25 - fx * u, f = snow.fieldAt(x, z);
      if (f) depth = Math.max(depth, f.h[f.cellAt(x, z)]);
    }
    const sd = snowDrag(depth, 'quad');
    this.slip = dir > 0 && this.carry.kg > BLADE.capacity * BLADE.slip; // trop de neige devant la lame : les roues patinent
    this.stuck = sd.stuck || this.slip;
    ph.drag = this.slip ? 1 : sd.drag;
    if (this.stuck) ph.v = dir > 0 ? Math.min(ph.v, 0) : Math.max(ph.v, 0); // bloqué net (drag seul freine à 12 m/s² : la lame traverserait un bourrelet étroit)
    const n = keys.length || 1;
    ph.grip = keys.reduce((s, k) => s + quadGrip(k, this.upgrades.chains), 0) / n || 0.6;
    ph.mu = keys.length ? keys.reduce((s, k) => s + MU[k], 0) / n : MU.packed;
    ph.step(dt, I);
    if (ph.speed > 1e-4 && collideCar(ph, this.solids) > 2) this.hits++;

    // lame : raclage par pas de 0,1 m au plus de l'avance du bord de lame ; débord borné au bout orienté
    const [bx1, bz1] = this.bladePos(), d = (bx1 - bx0) * Math.sin(ph.yaw) + (bz1 - bz0) * Math.cos(ph.yaw);
    if (down && d > 1e-3) { // bloquée, la lame ne racle pas la neige qui s'éboule devant elle
      const k = Math.ceil(d / 0.1), side = spillSide(b.angle, b.v), yb = ph.yaw + b.angle;
      for (let i = 1; i <= k; i++) {
        const x = bx0 + (bx1 - bx0) * i / k, z = bz0 + (bz1 - bz0) * i / k, beyond = windrowBeyond(this.spillRate, this.carry.rho);
        const r = pushBlade(snow, { x, z, yaw: yb, width: b.width, down: true, side, capacity: BLADE.capacity, steel: true, spillMax: spillPerM(b.angle) * d / k, beyond, sweepLoose: windrowSweep(beyond) }, this.carry);
        this.spillRate += (r.spilled * k / d - this.spillRate) * Math.min(1, 3 * d / k); // kg par mètre déversés, lissés sur environ 0,3 m
        if (r.spilled > 0) for (const s of side === 0 ? [-1, 1] : [side]) { // bout de lame + beyond, comme pushBlade (+1 = droite)
          const e = b.width / 2 + beyond, kind = this.penaltyAt(x - Math.cos(yb) * s * e, z + Math.sin(yb) * s * e, 0.2);
          if (this.gate.hit(kind, this._t)) this.onPenalty(kind);
        }
      }
    }
    // reculer ou lever la lame : la charge reste en tas devant la lame
    if (!down || ph.v < -0.1) { this.dropLoad(); this.spillRate = 0; }
    settle(this, snow, dt, OZ);

    // lame (levée, orientée), charge visible, roues (elles tournent dans le vide quand le quad patine), phare, combiné
    this.arm.rotation.x = -Math.asin(b.height / ARM);
    this.bladeYaw.rotation.set(-this.arm.rotation.x, b.angle, 0, 'XYZ');
    const vol = this.carry.kg / this.carry.rho, s = Math.min(0.6, Math.sqrt(vol / 1.47));
    this.pile.visible = vol > 0.02; this.pile.scale.set(0.7, s, s); this.pile.position.z = 0.08 + s; // dos du tas contre la plaque
    const slip = this.stuck && (I.throttle > 0 || I.brake > 0);
    this.spin += (slip ? dir * Math.max(Math.abs(ph.v), 6 * Math.max(I.throttle, I.brake)) : ph.v) * dt / this.radius;
    for (const w of this.wheels) poseWheel(w, this.spin, ph.steer);
    this.beam.intensity = this.lights ? (this.upgrades.lights ? 50 : 25) : 0;
    if (this.driven) this.dash.draw({ kmh: Math.abs(ph.v) * 3.6, gear: ph.v < -0.2 ? 'R' : ph.v > 0.2 ? 'D' : I.hand ? 'P' : 'N', fuel: this.fuel, lights: this.lights, slip });
  }
}
