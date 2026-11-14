// Ciel de nuit qui s'éclaircit vers l'aube (6 h 30, lueur à l'est), étoiles, montagnes en silhouette.
// Le dôme suit la caméra ; update(clockMinutes) règle aussi le brouillard, le fond et la lumière d'ambiance.
import * as THREE from 'three';
import { smooth, rng, fbm } from '../core/util.js';

const R = 360;
const NIGHT = { top: new THREE.Color(0x03061a), hor: new THREE.Color(0x0b1230), fog: new THREE.Color(0x0b1230), hemi: 0.9 };
const DAWN = { top: new THREE.Color(0x2c4a7e), hor: new THREE.Color(0xd99a78), fog: new THREE.Color(0x5d6a8a), hemi: 1.5 };

export function makeSky(scene, camera, hemi) {
  const group = new THREE.Group(); scene.add(group);
  const u = { top: { value: NIGHT.top.clone() }, hor: { value: NIGHT.hor.clone() }, glow: { value: 0 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hor; uniform float glow; varying vec3 vD;
      void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
        c += vec3(1.0, 0.55, 0.3) * glow * pow(max(vD.x, 0.0), 3.0) * (1.0 - h) * 0.6; // l'aube se lève à l'est (+x)
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  dome.renderOrder = -2; group.add(dome);

  // étoiles : hémisphère haut, s'éteignent à l'aube
  const r = rng(9), N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2, y = 0.08 + r() * 0.92, s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * s * (R - 5), y * (R - 5), Math.sin(a) * s * (R - 5)], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
  const stars = new THREE.Points(sg, starMat); stars.renderOrder = -1; group.add(stars);

  // montagnes : anneau de crêtes, sommets enneigés (couleur de sommet)
  const SEG = 160, mp = [], mc = [], dark = new THREE.Color(0x141a2c), snowC = new THREE.Color(0x8a96b4);
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, h = 30 + 75 * fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 4, 3), rr = R * 0.92;
    mp.push(Math.cos(a) * rr, -10, Math.sin(a) * rr, Math.cos(a) * rr, h, Math.sin(a) * rr);
    mc.push(...dark.toArray(), ...snowC.toArray());
  }
  const idx = []; for (let i = 0; i < SEG; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3)); mg.setAttribute('color', new THREE.Float32BufferAttribute(mc, 3)); mg.setIndex(idx);
  const mMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const mountains = new THREE.Mesh(mg, mMat); mountains.renderOrder = -1; group.add(mountains);

  return {
    // clockMinutes : minutes depuis minuit (4 h 00 = 240) ; aube de 5 h 45 à 7 h 00, notable vers 6 h 30
    update(clockMinutes) {
      const t = smooth(345, 420, clockMinutes);
      group.position.set(camera.position.x, 0, camera.position.z);
      u.top.value.lerpColors(NIGHT.top, DAWN.top, t); u.hor.value.lerpColors(NIGHT.hor, DAWN.hor, t); u.glow.value = t;
      starMat.opacity = 1 - t; mMat.color.setScalar(0.6 + 0.6 * t);
      if (scene.fog) scene.fog.color.lerpColors(NIGHT.fog, DAWN.fog, t);
      if (scene.background?.isColor) scene.background.lerpColors(NIGHT.fog, DAWN.fog, t);
      if (hemi) hemi.intensity = NIGHT.hemi + (DAWN.hemi - NIGHT.hemi) * t;
      return t;
    },
  };
}
