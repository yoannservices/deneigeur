/* Maillages des outils à main, construits par code. Pelle : origine = poignée (main droite), lame vers +z et vers le bas ;
   posée à 0,85 m de haut sans rotation, le bas de la lame touche le sol. userData.grip = [main droite, main gauche] (repère de la pelle),
   userData.blade = point de raclage (bas de la lame), userData.snow = maillage de la charge (échelle = remplissage). */
import * as THREE from 'three';
import { SHOVELS } from './toolsData.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const WOOD = std(0x8a5a32), GRIP = std(0x1d1f24), SNOW = std(0xeef3fa, { roughness: 0.95 });
const BLADE = { base: std(0x2f6fb5, { roughness: 0.5 }), large: std(0xd8462e, { roughness: 0.5 }), pusher: std(0x2a2d33, { roughness: 0.5, metalness: 0.4 }) };
const END = new THREE.Vector3(0, 0, 0), BASE = new THREE.Vector3(0, -0.66, 0.6);

export function makeShovel(kind = 'base') {
  const w = SHOVELS[kind].width, g = new THREE.Group(), add = (m) => { m.castShadow = true; g.add(m); return m; };
  // manche : de la poignée au haut de la lame
  const len = END.distanceTo(BASE), handle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, len, 8), WOOD));
  handle.position.copy(END).lerp(BASE, 0.5); handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), BASE.clone().sub(END).normalize());
  const d = add(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), GRIP)); d.position.set(0, 0.04, -0.03); // poignée en D
  // lame : dos incliné vers l'arrière + fond (pelle) ; la pelle-poussoir est un simple rabot plus haut
  const back = add(new THREE.Mesh(new THREE.BoxGeometry(w, kind === 'pusher' ? 0.34 : 0.28, 0.012), BLADE[kind]));
  back.position.set(0, -0.71, 0.64); back.rotation.x = -0.3;
  if (kind !== 'pusher') { const floor = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, 0.3), BLADE[kind])); floor.position.set(0, -0.845, 0.83); }
  const snow = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), SNOW));
  snow.position.set(0, -0.84, 0.8); snow.visible = false; snow.userData.full = new THREE.Vector3(w * 0.9, 0.22, 0.32);
  g.userData = { grip: [END.clone(), END.clone().lerp(BASE, 0.28)], blade: new THREE.Vector3(0, -0.85, 0.84), snow, kind };
  return g;
}

// shortcut: luge dessinée mais pas encore utilisée (transport de 60 kg vers un tas), à brancher avec la boutique (tâche 10)
export function makeSled() {
  const g = new THREE.Group(), red = std(0xb3262e, { roughness: 0.5 });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.1), red); tub.position.y = 0.12; tub.castShadow = true; g.add(tub);
  for (const s of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.2), GRIP); r.position.set(s, 0.015, 0); g.add(r); }
  return g;
}
