/* Joueur à pied (§8.1) : personnage animé (Idle, Walk, Run), pelle tenue des deux mains par IK, pousser / lever / jeter, endurance.
   Commandes : ZQSD marcher (par rapport au regard), Maj courir sans charge, clic droit lever ou baisser la pelle,
   clic gauche jeter la charge vers l'endroit visé (1,5 à 3 m selon l'inclinaison du regard).
   `save` : { shovel: 'base' | 'large' | 'pusher', owned: ['gear:boots', ...] } (identifiants d'achat de la décision F), absent = partie neuve.
   Sel (X) : `salt` = sacs de sel de la sauvegarde (`save.salt`, un sac = un coup de 20 m²), `onSalt(x, z)` posé par main.js (la nuit fait fondre le verglas).
   `refused` : secondes restantes du message « trop fatigué » après un jet refusé faute d'endurance (lu par le HUD).
   Charge de neige dans la pelle : `carry = { kg, rho }` ; `load()` charge le modèle. Obstacles : `solids` (quartier.solids, rectangles orientés). */
import * as THREE from 'three';
import { loadGLB } from '../../../../assets/glb.js';
import { inp, mouse, pressed } from '../core/input.js';
import { clamp, lerp, wrapPi } from '../core/util.js';
import { pushBlade, throwLoad } from '../snow/blade.js';
import { Stamina, walkFactor } from '../gameplay/rules.js';
import { LAYOUT } from '../world/layout.js';
import { collide } from '../world/solids.js';
import { SHOVELS, EFFECTS } from './toolsData.js';
import { ICE_THIN } from '../snow/SnowField.js';
import { makeShovel } from './tools.js';
import { solveArm, rotateWorld } from './ik.js';

const MODEL = new URL('../../../../assets/models/stylized_low_poly_animated_character.glb', import.meta.url).href;
const HEIGHT = 1.75, WALK = 1.5, RUN = 3.6, TURN = 9, ANIM_WALK = 1.3, ANIM_RUN = 3.4; // m/s ; ANIM_* : vitesse des clips
// pose de la pelle dans le repère du joueur : y, z de la poignée, inclinaison (rx < 0 relève la lame)
const POSE = { down: { y: 0.85, z: 0.32, rx: 0 }, up: { y: 0.95, z: 0.34, rx: -0.3 }, throw: { y: 1.12, z: 0.3, rx: -0.8 } };
const T_RELEASE = 0.22, T_END = 0.45; // s : la neige part au sommet du geste
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const RADIUS = 0.3; // m : cercle du joueur contre les obstacles
const _q = new THREE.Quaternion(), _axis = V(), _gr = V(), _gl = V(), _pr = V(), _pl = V();

export class Walker {
  constructor(scene, snow, save) {
    this.scene = scene; this.snow = snow; this.save = save;
    this.group = new THREE.Group(); scene.add(this.group);
    this.position = this.group.position; this.yaw = 0;
    this.lookYaw = 0; this.lookPitch = 0.35; // fournis par la caméra
    this.stamina = new Stamina();
    this.down = true; this.speed = 0; this.throwT = -1; this.hideHead = false;
    this.cars = []; this.doors = []; this.solids = []; this.onPenalty = () => {};
    this.onSalt = null; this.refused = 0;
    this.carry = { kg: 0, rho: 100 };
    this.aim = V(); this.eye = V(); this.pose = { ...POSE.down };
    this._prev = null; this._prevL = false; this._prevR = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.25, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.8, depthWrite: false }));
    this.marker.visible = false; scene.add(this.marker);
    this.setTool(save?.shovel in SHOVELS ? save.shovel : 'base');
  }
  has(id) { return !!this.save?.owned?.includes(id); }
  get salt() { return this.save?.salt ?? 0; }
  set salt(n) { if (this.save) this.save.salt = n; }
  setTool(kind) {
    if (this.shovel) this.group.remove(this.shovel);
    this.tool = kind; this.shovel = makeShovel(kind); this.group.add(this.shovel);
  }

  async load() {
    const root = await loadGLB(MODEL);
    // mise à l'échelle par la hauteur (fitGLB mesurerait l'envergure des bras en T), pieds sur y = 0
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), s = HEIGHT / box.getSize(V()).y, c = box.getCenter(V());
    const wrap = new THREE.Group(); wrap.add(root); wrap.scale.setScalar(s); wrap.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); // bras déplacés par l'IK hors de la boîte de repos
    // shortcut: matériau unique en atlas de texture, pas de bonnet ni de veste d'hiver retouchés ; à faire avec un atlas modifié
    this.group.add(wrap); this.model = wrap;
    const B = {}; root.traverse((o) => { if (o.isBone) B[o.name.replace(/_\d+$/, '').replace('mixamorig', '')] = o; });
    this.bones = { spine: B.Spine, head: B.Head,
      R: { arm: B.RightArm, fore: B.RightForeArm, hand: B.RightHand }, L: { arm: B.LeftArm, fore: B.LeftForeArm, hand: B.LeftHand } };
    this.mixer = new THREE.AnimationMixer(root);
    this.acts = {};
    for (const n of ['Idle', 'Walk', 'Run']) { const a = this.mixer.clipAction(root.animations.find((k) => k.name === n)); a.play(); this.acts[n] = a; }
    return this;
  }

  groundY(x, z) {
    const f = this.snow.fieldAt(x, z);
    if (f) return f.baseY(x, z) + f.h[f.cellAt(x, z)];
    const t = LAYOUT.terrace; // parvis de l'église (pas de champ de neige sur toute la terrasse)
    return x >= t.x0 && x < t.x0 + t.w && z >= t.z0 && z < t.z0 + t.d ? t.y : 0;
  }
  // un tas tombé sur une voiture (emprise tournée) ou devant une porte : une seule pénalité par jet
  penaltyAt(x, z, r = 0.25) {
    for (const d of this.doors) if (x > d.x0 - r && x < d.x0 + d.w + r && z > d.z0 - r && z < d.z0 + d.d + r) return 'door';
    for (const c of this.cars) {
      const s = c.userData.size || { x: 1.9, z: 4.6 }, dx = x - c.position.x, dz = z - c.position.z, a = c.rotation.y;
      const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
      if (Math.abs(lx) < s.x / 2 + r && Math.abs(lz) < s.z / 2 + r) return 'car';
    }
    return null;
  }

  update(dt) {
    if (!this.model) return;
    const st = this.stamina, sh = SHOVELS[this.tool], load = this.carry, p = this.position, first = this.hideHead;
    st.max = 100 + (this.has('gear:gloves') ? EFFECTS.gloves : 0);
    const raised = mouse.right && !this._prevR && this.down; if (mouse.right && !this._prevR) this.down = !this.down;
    const click = mouse.left && !this._prevL; this._prevL = mouse.left; this._prevR = mouse.right;
    if (pressed('KeyX') && this.salt > 0 && this.onSalt) { this.salt--; this.onSalt(p.x, p.z); }

    // --- déplacement relatif au regard ---
    const cy = this.lookYaw, fx = Math.sin(cy), fz = Math.cos(cy);
    let dx = fx * inp.z - fz * inp.x, dz = fz * inp.z + fx * inp.x; // droite = (-cos yaw, sin yaw)
    const len = Math.hypot(dx, dz), mag = Math.min(1, len); if (len > 0) { dx /= len; dz /= len; }
    const f = this.snow.fieldAt(p.x, p.z), depth = f ? f.h[f.cellAt(p.x, p.z)] : 0;
    const boots = this.has('gear:boots'), slow = Math.min(0.5, depth * 1.5) * (boots ? EFFECTS.boots : 1); // décision B : bottes x 0,75
    const running = inp.run && load.kg === 0 && !st.exhausted;
    // verglas : pas plus courts, et l'élan ne se reprend ni ne se perd vite (glissade surtout en courant) ; les bottes accrochent mieux
    // shortcut: glissade sur la vitesse seulement (la direction suit toujours la marche) ; vecteur vitesse à garder s'il faut de vraies dérives
    this.onIce = !!(f && f.ice[f.cellAt(p.x, p.z)] && depth < ICE_THIN); // verglas sous 2 cm de neige au plus
    const ice = this.onIce ? (boots ? 0.85 : 0.7) : 1, grip = this.onIce ? (running ? (boots ? 2.5 : 1) : (boots ? 5 : 3)) : 8;
    const target = this.throwT >= 0 ? 0 : mag * (running ? RUN : WALK) * walkFactor(load.kg, sh.capacity) * (1 - slow) * ice * (st.exhausted ? 0.4 : 1);
    this.speed = lerp(this.speed, target, Math.min(1, dt * grip));
    if (len > 0) this._dir = [dx, dz]; else if (this.onIce && this._dir) [dx, dz] = this._dir; // sur le verglas, l'élan continue sans touche
    p.x += dx * this.speed * dt; p.z += dz * this.speed * dt;
    if (this.solids.length) [p.x, p.z] = collide(p.x, p.z, RADIUS, this.solids); // bâtiments, voitures garées, murs du parvis
    const yawTo = first || this.throwT >= 0 ? cy : mag > 0 ? Math.atan2(dx, dz) : this.yaw;
    this.yaw += clamp(wrapPi(yawTo - this.yaw), -TURN * dt, TURN * dt);
    p.y = lerp(p.y, this.groundY(p.x, p.z), Math.min(1, dt * 15));
    const moving = this.speed > 0.05; // épuisé et chargé, on pousse à moins de 0,2 m/s : ça reste « pousser »
    st.update(dt, moving ? (this.down ? 'push' : 'walk') : 'idle'); // pelle levée, même chargée : marche

    // --- raclage : bas de la lame, par pas de 0,1 m au plus pour ne sauter aucune cellule ---
    const ux = Math.sin(this.yaw), uz = Math.cos(this.yaw), reach = POSE.down.z + this.shovel.userData.blade.z;
    const bx = p.x + ux * reach, bz = p.z + uz * reach, prev = this._prev;
    if (this.down && this.throwT < 0 && prev) {
      const d = (p.x - prev[0]) * ux + (p.z - prev[1]) * uz; // avancée du corps sur l'axe avant : tourner sur place ne racle pas
      if (d > 0) {
        const n = Math.ceil(d / 0.1);
        for (let k = 1; k <= n; k++) pushBlade(this.snow, { x: bx - ux * d * (1 - k / n), z: bz - uz * d * (1 - k / n), yaw: this.yaw, width: sh.width, down: true, side: 0, capacity: sh.capacity, steel: this.has('gear:steel') }, load);
      }
    }
    this._prev = [p.x, p.z];
    // pelle-poussoir levée : la charge reste devant la lame (pas de jet)
    if (raised && sh.noThrow && load.kg > 0) { const kind = this.penaltyAt(bx, bz); throwLoad(this.snow, load, bx, bz); if (kind) this.onPenalty(kind); }

    // --- jet vers l'endroit visé ---
    const dist = 1.5 + 1.5 * clamp((0.7 - this.lookPitch) / 0.7, 0, 1);
    this.aim.set(p.x + fx * dist, 0, p.z + fz * dist); this.aim.y = this.groundY(this.aim.x, this.aim.z) + 0.03;
    this.refused = Math.max(0, this.refused - dt);
    if (click && this.throwT < 0 && load.kg > 0 && !sh.noThrow) {
      if (st.spend(st.throwCost(load.kg))) { this.throwT = 0; this._throwAt = this.aim.clone(); } else this.refused = 1.5;
    }
    if (this.throwT >= 0) {
      const t0 = this.throwT; this.throwT += dt;
      if (t0 < T_RELEASE && this.throwT >= T_RELEASE) {
        const a = this._throwAt, kind = this.penaltyAt(a.x, a.z);
        throwLoad(this.snow, load, a.x, a.z);
        if (kind) this.onPenalty(kind);
      }
      if (this.throwT >= T_END) this.throwT = -1;
    }
    this.marker.visible = load.kg > 0 && !sh.noThrow && this.throwT < 0; this.marker.position.copy(this.aim);

    // --- pose de la pelle ---
    const rest = this.down ? POSE.down : POSE.up, P = this.pose;
    if (this.throwT >= 0) {
      const t = this.throwT, [a, b, k] = t < T_RELEASE ? [POSE.up, POSE.throw, t / T_RELEASE] : [POSE.throw, rest, (t - T_RELEASE) / (T_END - T_RELEASE)];
      for (const q of ['y', 'z', 'rx']) P[q] = lerp(a[q], b[q], clamp(k, 0, 1));
    } else for (const q of ['y', 'z', 'rx']) P[q] = lerp(P[q], rest[q], Math.min(1, dt * 12));
    const lift = this.down && this.throwT < 0 ? clamp(this.groundY(bx, bz) - p.y, -0.3, 0.3) : 0; // lame posée sur la pente ou la marche
    this.shovel.position.set(-0.03, P.y + lift, P.z); this.shovel.rotation.x = P.rx;
    const snowM = this.shovel.userData.snow; snowM.visible = load.kg > 0;
    if (snowM.visible) snowM.scale.copy(snowM.userData.full).multiplyScalar(Math.cbrt(Math.min(1, load.kg / sh.capacity)));

    // --- animation, puis IK des bras sur le manche ---
    this.shovel.visible = true;
    this.animate(dt, this.throwT >= 0 ? 0.15 : this.down ? 0.3 : 0.15, () => {
      const g = this.shovel.userData.grip; return [this.shovel.localToWorld(_gr.copy(g[0])), this.shovel.localToWorld(_gl.copy(g[1]))];
    });
  }

  /* Debout aux mancherons de la fraise (main.js pose position et yaw) : pelle rangée, mains sur les poignées gr, gl (monde). */
  operate(dt, speed, gr, gl) {
    if (!this.model) return;
    this.speed = speed; this.shovel.visible = this.marker.visible = false; this._prev = null;
    this.animate(dt, 0.25, () => [gr, gl]);
  }

  // clips mélangés selon this.speed, buste penché de `lean`, puis IK des deux bras sur grips() (appelé après la mise à jour des matrices)
  animate(dt, lean, grips) {
    const A = this.acts, run = clamp((this.speed - WALK) / (RUN - WALK), 0, 1), walk = clamp(this.speed / 0.4, 0, 1);
    A.Idle.setEffectiveWeight(1 - walk); A.Walk.setEffectiveWeight(walk * (1 - run)); A.Run.setEffectiveWeight(walk * run);
    A.Walk.setEffectiveTimeScale(clamp(this.speed / ANIM_WALK, 0.5, 1.6)); A.Run.setEffectiveTimeScale(clamp(this.speed / ANIM_RUN, 0.6, 1.3));
    this.mixer.update(dt);
    const bones = this.bones, ux = Math.sin(this.yaw), uz = Math.cos(this.yaw);
    bones.head.scale.setScalar(this.hideHead ? 1e-3 : 1); // première personne : tête écrasée sur le cou (le clip pose aussi l'échelle des os)
    this.group.rotation.y = this.yaw; this.group.updateMatrixWorld(true);
    rotateWorld(bones.spine, _q.setFromAxisAngle(_axis.set(uz, 0, -ux), lean)); // buste penché vers l'outil (épaules basses du modèle stylisé)
    const [gr, gl] = grips();
    // pôles des coudes (vers l'extérieur et le bas), repère du joueur -> monde
    solveArm(bones.R, gr, _pr.set(-0.7 * uz - 0.2 * ux, -0.6, 0.7 * ux - 0.2 * uz)); solveArm(bones.L, gl, _pl.set(0.7 * uz - 0.2 * ux, -0.6, -0.7 * ux - 0.2 * uz));
    bones.head.getWorldPosition(this.eye); this.eye.x += ux * 0.12; this.eye.y += 0.2; this.eye.z += uz * 0.12;
  }
}
