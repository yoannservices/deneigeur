/* Fraise à neige (§8.2) : snowblower.glb (scan d'un seul bloc) tourné de 297° (le scan est de biais, entrée vers +z),
   rotation cuite dans la géométrie (boîte serrée) puis fitGLB(…, 1,4). La goulotte du scan est découpée (carve) et montée
   sur un pivot vertical (pivotAt) : A / E (KeyQ / KeyE) la tournent. chute = angle du jet par rapport à l'avant
   (0 = devant, > 0 = à gauche ; départ -π/2 = à droite), borné à ±2,2 rad.
   Conduite (joueur derrière les mancherons) : le moteur tourne tant que le joueur tient les mancherons et qu'il reste de
   l'essence (il brûle même turbine débrayée). Espace (manette A) embraye ou débraye la turbine : seule la turbine embrayée avale
   et jette la neige. Z / S avance ou recule (0 à 3 km/h ; turbine embrayée, blowerStep borne l'avance au débit), Q / D pivote
   (0,9 rad/s, même à l'arrêt). Calage : turbine débrayée et plus d'avance ; reculer (S) puis Espace pour réembrayer.
   Shortcut: turbine débrayée, la fraise roule sans limite dans la neige (sans l'avaler) ; la freiner si c'est gênant.
   Entrée : pushBlade sur la largeur (0,56 / 0,71 m) au bord avant, par pas de 0,1 m au plus ; la neige avalée est jetée aussitôt
   en cône à 6 m (10 m goulotte longue portée) dans la direction de la goulotte. Jet sur une voiture ou une porte :
   onPenalty une fois par cible et par visée (PenaltyGate : nouvelle pénalité après 1 s sans toucher cette cible).
   Interface véhicule (seat.js, Pickup.js) : { id, group, solid, phys, stowed, place, enter, exit, look, chase } ; rangée sur
   le plateau (stowed), c'est le pick-up qui pose son group et update ne fait rien. */
import * as THREE from 'three';
import { loadGLB, fitGLB, carve, pivotAt } from '../../../../assets/glb.js';
import { CarPhysics, collideCar } from './physics.js';
import { blowerStep, blowerSpec, blowerRpm, kgAhead, PenaltyGate, VMAX } from './blowerLogic.js';
import { makeBlowerDash } from './dash.js';
import { pushBlade } from '../snow/blade.js';
import { pressed, held } from '../core/input.js';
import { clamp } from '../core/util.js';

const MODEL = new URL('../../../../assets/models/snowblower.glb', import.meta.url).href;
const LEN = 1.4, YAW_SCAN = 297 * Math.PI / 180, TURN = 0.9, CHUTE_RATE = 1.2, CHUTE_MAX = 2.2, ACC = 2; // m, rad, rad/s, m/s²
const PIVOT = new THREE.Vector3(0.05, 0.44, 0.56), CHUTE_TOP = 0.5; // pied de la goulotte (mesuré sur le scan cadré), hauteur du bec au-dessus
const GRIP = [new THREE.Vector3(-0.22, 1.13, -0.64), new THREE.Vector3(0.22, 1.13, -0.64)]; // poignées droite (-x), gauche (+x)
const OPERATOR = -1.15, JET_N = 90; // m derrière le centre ; grains du jet visibles
const _v = new THREE.Vector3();

export class SnowBlower {
  constructor(scene, snow) {
    this.id = 'blower'; this.snow = snow;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt); scene.add(this.group);
    this.phys = new CarPhysics({ length: LEN, width: 0.7, wheelbase: 0.6, rearBehind: 0 }); // conteneur d'état + push ; intégration ici
    this.solid = { x: 0, z: 0, hw: 0.35, hd: LEN / 2, yaw: 0 };
    this.upgrades = { motor: false, width: false, tank: false, lights: false, chute: false }; // achats (tâche 12)
    this.fuel = blowerSpec(this.upgrades).tank; this.chute = -Math.PI / 2;
    this.on = false; this.auger = false; this.stalled = false; this.overT = 0; this.kgPerSec = 0; this.rpm = 0; this.lights = false; // on = moteur, auger = turbine
    this.stowed = false; this.driven = false; this.hits = 0;
    this.solids = []; this.groundAt = () => 0; this.penaltyAt = () => null; this.onPenalty = () => {}; // posés par main.js
    this.intake = { kg: 0, rho: 100 }; this.gate = new PenaltyGate(); this._jetT = 0; this._t = 0; // intake : neige avalée, jetée dans la même image
    this.chase = [4.2, 2.1];
    this.look = new THREE.Object3D(); // regard en première personne (Cams.followCar), enfant de l'œil
  }

  async load() {
    const scene = await loadGLB(MODEL); scene.updateMatrixWorld(true);
    // rotation du scan cuite dans la géométrie : setFromObject mesure sinon la boîte locale tournée (trop grande)
    const g = new THREE.Group(), R = new THREE.Matrix4().makeRotationY(YAW_SCAN), meshes = [];
    scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) { o.geometry = o.geometry.clone().applyMatrix4(R.clone().multiply(o.matrixWorld)); o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); g.add(o); }
    const out = fitGLB(g, LEN); out.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(out, true), size = box.getSize(new THREE.Vector3());
    this.solid.hw = size.x / 2; this.solid.hd = size.z / 2; this.phys.d = { length: size.z, width: size.x, wheelbase: 0.6, rearBehind: 0 };
    // goulotte : triangles au-dessus du carter, autour de son pied ; angle naturel du bec mesuré sur ses sommets hauts
    const parts = carve(out, (o, c) => (c.x > PIVOT.x - 0.17 && c.x < PIVOT.x + 0.22 && c.z > 0.44 && c.z < 0.72 && c.y > PIVOT.y ? 'chute' : null)).chute || [];
    let sx = 0, sz = 0, n = 0;
    for (const m of parts) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (_v.y > PIVOT.y + 0.26) { sx += _v.x - PIVOT.x; sz += _v.z - PIVOT.z; n++; } } }
    this.chute0 = n ? Math.atan2(sx, sz) : 0;
    this.pivot = pivotAt(out, PIVOT, parts);
    out.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.tilt.add(out); this.model = out;

    // jet de neige : grains sur une parabole, repère tourné comme la goulotte (+z = sens du jet)
    this.jet = new THREE.Group(); this.jet.position.set(PIVOT.x, PIVOT.y + CHUTE_TOP, PIVOT.z); this.tilt.add(this.jet);
    this.jetSeed = Float32Array.from({ length: JET_N * 2 }, () => Math.random());
    const jg = new THREE.BufferGeometry(); jg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(JET_N * 3), 3));
    this.jetPts = new THREE.Points(jg, new THREE.PointsMaterial({ color: 0xf2f6ff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
    this.jetPts.frustumCulled = false; this.jetPts.visible = false; this.jet.add(this.jetPts);

    // poste de conduite : yeux de l'opérateur, petit tableau sur la traverse du guidon, phare (amélioration)
    const eye = new THREE.Object3D(); eye.position.set(0, 1.62, OPERATOR + 0.12); this.tilt.add(eye); eye.add(this.look);
    const pod = new THREE.Group(); pod.position.set(0, 1.2, -0.6); pod.rotation.set(0.7, Math.PI, 0); this.tilt.add(pod);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.085, 0.03), new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 }));
    housing.position.z = -0.016; pod.add(housing);
    this.dash = makeBlowerDash(0.18, 0.068); pod.add(this.dash.mesh);
    this.beam = new THREE.SpotLight(0xfff1d8, 0, 25, 0.6, 0.5, 1.4); this.beam.position.set(0, 0.6, size.z / 2);
    this.beam.target.position.set(0, 0, size.z / 2 + 8); this.tilt.add(this.beam, this.beam.target);
    this.place(this.phys.x, this.phys.z, this.phys.yaw);
    return this;
  }

  place(x, z, yaw) { this.phys.place(x, z, yaw); this.group.position.y = this.groundAt(x, z); this.sync(); }
  sync() { const p = this.phys, s = this.solid; s.x = p.x; s.z = p.z; s.yaw = p.yaw; this.group.position.x = p.x; this.group.position.z = p.z; this.group.rotation.y = p.yaw; this.group.updateMatrixWorld(true); }
  enter() { this.driven = true; }
  exit() { this.driven = false; this.on = this.auger = false; this.phys.v = this.phys.vl = 0; } // lâcher les mancherons coupe tout (homme mort)
  toggleAuger() {
    if (this.auger) { this.auger = false; return; }
    if (this.on) { this.auger = true; this.stalled = false; this.overT = 0; } // réembrayer après un calage : reculer d'abord (S)
  }
  // repère local [gauche, avant] -> monde (hauteur : y local, inclinaison comprise)
  toWorld(local, out = new THREE.Vector3()) { return this.tilt.localToWorld(out.copy(local)); } // matrices mises à jour par sync()
  grips(gr, gl) { return [this.toWorld(GRIP[0], gr), this.toWorld(GRIP[1], gl)]; }
  operatorSpot() { const p = this.phys; return [p.x + Math.sin(p.yaw) * OPERATOR, p.z + Math.cos(p.yaw) * OPERATOR]; }

  update(dt, inp, snow) {
    if (!this.model || this.stowed) return;
    this._t += dt;
    const ph = this.phys, spec = blowerSpec(this.upgrades), I = this.driven ? inp : null;
    if (I) {
      this.chute = clamp(this.chute + ((held('KeyQ') ? 1 : 0) - (held('KeyE') ? 1 : 0)) * CHUTE_RATE * dt + ((pressed('KeyQ') ? 1 : 0) - (pressed('KeyE') ? 1 : 0)) * 0.15, -CHUTE_MAX, CHUTE_MAX);
    }
    // avance : la neige mesurée sur 0,3 m devant l'entrée borne la vitesse (débit), la fraise cale si on insiste
    let fx = Math.sin(ph.yaw), fz = Math.cos(ph.yaw), front = ph.d.length / 2;
    const want = I ? (I.throttle - I.brake) * VMAX : 0;
    this.on = this.driven && this.fuel > 0; if (!this.on) this.auger = false; // repart seul après le jerrican
    if (I && pressed('Space')) this.toggleAuger();
    let target = 0; this.kgPerSec = 0; // débit avalé (kg/s), pour le son de la tâche suivante
    if (this.on) {
      const depth = this.auger ? kgAhead(snow, ph.x + fx * front, ph.z + fz * front, ph.yaw, spec.width, 0.3) : 0;
      const r = blowerStep(this, dt, { want, depthKgPerM: depth, power: spec.power, gameH: this.gameH });
      target = r.speed; this.kgPerSec = r.kgPerSec; if (r.stalled) this.auger = false;
      if (this.fuel <= 0) this.on = this.auger = false;
    }
    this.rpm += (blowerRpm(this, this.kgPerSec, spec.power) - this.rpm) * Math.min(1, 6 * dt);
    ph.v += clamp(target - ph.v, -ACC * dt, ACC * dt); ph.vl = 0;
    if (I) ph.yaw += I.steer * TURN * dt;
    const x0 = ph.x, z0 = ph.z;
    fx = Math.sin(ph.yaw); fz = Math.cos(ph.yaw);
    ph.rx += fx * ph.v * dt; ph.rz += fz * ph.v * dt;
    if (I) collideCar(ph, this.solids);
    const d = (ph.x - x0) * fx + (ph.z - z0) * fz; // avancée réelle sur l'axe (après collision)

    // entrée : bande de 0,15 m au bord avant, pas de 0,1 m au plus ; tout ce qui entre ressort par la goulotte
    if (this.auger && d > 0) {
      const n = Math.ceil(d / 0.1), bx = ph.x + fx * (front - 0.15), bz = ph.z + fz * (front - 0.15);
      for (let k = 1; k <= n; k++) pushBlade(snow, { x: bx - fx * d * (1 - k / n), z: bz - fz * d * (1 - k / n), yaw: ph.yaw, width: spec.width, down: true, side: 0, capacity: Infinity, steel: false }, this.intake);
    }
    if (this.intake.kg > 0) {
      const kg = this.intake.kg, a = ph.yaw + this.chute, dist = spec.range * (0.8 + 0.2 * Math.random()), lat = (Math.random() - 0.5) * 0.24 * dist;
      this.toWorld(this.jet.position, _v);
      const x = _v.x + Math.sin(a) * dist + Math.cos(a) * lat, z = _v.z + Math.cos(a) * dist - Math.sin(a) * lat;
      const kind = this.penaltyAt(x, z, 0.35);
      if (this.gate.hit(kind, this._t)) this.onPenalty(kind);
      snow.deposit(x, z, kg, this.intake.rho, 0.35); this.intake.kg = 0;
      this._jetT = 0.25;
    }

    // caisse posée sur le sol + neige (roues derrière, carter devant) : tangage sur la pente de l'allée 7
    const yF = this.groundAt(ph.x + fx * 0.3, ph.z + fz * 0.3), yR = this.groundAt(ph.x - fx * 0.3, ph.z - fz * 0.3), k = Math.min(1, 12 * dt);
    this.group.position.y += ((yF + yR) / 2 - this.group.position.y) * k;
    this.tilt.rotation.x += (-Math.atan2(yF - yR, 0.6) - this.tilt.rotation.x) * k;
    this.sync();

    // goulotte, jet, phare, tableau
    this.pivot.rotation.y = this.chute - this.chute0; this.jet.rotation.y = this.chute;
    this._jetT -= dt; this.jetPts.visible = this._jetT > 0;
    if (this.jetPts.visible) {
      const pos = this.jetPts.geometry.attributes.position, R = spec.range, drop = PIVOT.y + CHUTE_TOP, s = this.jetSeed; // retombe au niveau des roues
      for (let i = 0; i < JET_N; i++) {
        const t = (s[i] + this._t * 1.4) % 1, z = t * R * (0.85 + 0.15 * s[JET_N + i]);
        pos.setXYZ(i, (s[JET_N + i] - 0.5) * 0.22 * z, 4 * 1.2 * t * (1 - t) - drop * t, z);
      }
      pos.needsUpdate = true;
    }
    this.beam.intensity = this.lights && this.upgrades.lights ? 25 : 0;
    if (this.driven) this.dash.draw({ rpm: this.rpm, fuel: this.fuel / spec.tank, auger: this.auger, stalled: this.stalled, lights: this.beam.intensity > 0 });
  }
}
