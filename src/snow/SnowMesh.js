// Rendu de la neige : un plan de 80 x 80 mailles par morceau, hauteur lue dans une DataTexture (vertex shader).
// Au bord du champ, la surface va jusqu'au bord exact (demi-cellule de plus) et une jupe verticale descend jusqu'au sol :
// une marche enneigée se lit comme un bloc. Texture RG : r = hauteur de neige, g = verglas (1) ; le verglas sous moins de
// ICE_THIN de neige se dessine en glace gris-bleu brillante, posée 8 mm au-dessus du sol (au-dessus du revêtement). Les coutures entre morceaux d'un même champ restent partagées, sans jupe.
import * as THREE from 'three';
import { CELL, CLEAN, CHUNK, ICE_THIN } from './SnowField.js';

const TEX = CHUNK + 3, SIZE = CHUNK * CELL, MAX_PER_UPDATE = 6, MAX_PILES = 1024, PILE_RHO = 300;

// Morceau de cols x rows cellules. Sommet j au centre de la cellule j (repère du maillage : centre de la cellule 0) ;
// e = { l, r, b, t } : côtés qui sont des bords du champ. aCell = texel lu (cellule + 1), aSk = (dir x, mode, dir z) :
// mode 0 surface, 1 haut de jupe, 2 bas de jupe. Mis en cache par taille et par bords.
export function chunkGeometry(cols, rows, e) {
  const axis = (n, lo, hi) => { // [position en cellules, cellule lue]
    const a = []; if (lo) a.push([-0.5, 0]);
    for (let j = 0; j < n; j++) a.push([j, j]);
    a.push(hi ? [n - 0.5, n - 1] : [n, n]); // bord du champ : bord exact, cellule n-1 ; sinon 1re cellule du morceau suivant
    return a;
  };
  const X = axis(cols, e.l, e.r), Z = axis(rows, e.b, e.t), W = X.length;
  const pos = [], cell = [], sk = [], idx = [];
  const vert = (x, z, cx, cz, dx, mode, dz) => { pos.push(x * CELL, 0, z * CELL); cell.push(cx + 1, cz + 1); sk.push(dx, mode, dz); return pos.length / 3 - 1; };
  for (const [z, cz] of Z) for (const [x, cx] of X) vert(x, z, cx, cz, 0, 0, 0);
  for (let k = 0; k < Z.length - 1; k++) for (let j = 0; j < W - 1; j++) {
    const a = k * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // jupe : bande verticale le long d'un côté de bord ; ordre des sommets choisi pour que la face regarde dehors
  const skirt = (list, dx, dz) => {
    const top = list.map(([x, z, cx, cz]) => vert(x, z, cx, cz, dx, 1, dz)), bot = list.map(([x, z, cx, cz]) => vert(x, z, cx, cz, dx, 2, dz));
    for (let i = 0; i < list.length - 1; i++) {
      // (bas i, bas i+1, haut i) a pour normale (-tz, 0, tx) (tangente t, haut = +y) : on garde cet ordre si elle regarde dehors
      const tx = list[i + 1][0] - list[i][0], tz = list[i + 1][1] - list[i][1];
      if (-tz * dx + tx * dz > 0) idx.push(bot[i], bot[i + 1], top[i], top[i], bot[i + 1], top[i + 1]);
      else idx.push(bot[i], top[i], bot[i + 1], top[i], top[i + 1], bot[i + 1]);
    }
  };
  if (e.l) skirt(Z.map(([z, cz]) => [X[0][0], z, X[0][1], cz]), -1, 0);
  if (e.r) skirt(Z.map(([z, cz]) => [X[W - 1][0], z, X[W - 1][1], cz]), 1, 0);
  if (e.b) skirt(X.map(([x, cx]) => [x, Z[0][0], cx, Z[0][1]]), 0, -1);
  if (e.t) skirt(X.map(([x, cx]) => [x, Z[Z.length - 1][0], cx, Z[Z.length - 1][1]]), 0, 1);
  const g = new THREE.BufferGeometry(), x0 = X[0][0] * CELL, x1 = X[W - 1][0] * CELL, z0 = Z[0][0] * CELL, z1 = Z[Z.length - 1][0] * CELL;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
  g.setAttribute('aSk', new THREE.Float32BufferAttribute(sk, 3)); g.setIndex(idx);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, -0.1, z0), new THREE.Vector3(x1, 3, z1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 1, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2 + 2);
  return g;
}

const FETCH = `
  ivec2 sij = ivec2(aCell + 0.5);
  vec2 sv = texelFetch(uSnow, sij, 0).rg;
  float sh = sv.r;
  float sBase = uBase0 + dot(uSlope, position.xz);`;
const HEAD = `uniform highp sampler2D uSnow;\nuniform vec2 uSlope;\nuniform float uBase0;\nuniform ivec4 uRange;\nattribute vec2 aCell;\nattribute vec3 aSk;\nvarying float vSnowH;\nvarying float vIce;\n`;

function displace(shader, u, withNormal) {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = HEAD + shader.vertexShader.replace('#include <begin_vertex>',
    `#include <begin_vertex>\n${withNormal ? '' : FETCH}\n vIce = sv.g > 0.5 && sh < ${ICE_THIN.toFixed(3)} ? 1.0 : 0.0;
 transformed.y = sBase + (aSk.y > 1.5 ? 0.0 : max(sh, vIce * 0.008)); vSnowH = sh;`);
  if (withNormal) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
    ${FETCH}
    // voisines bornées au champ (uRange) : au bord, pas de chute vers le 0 du dehors
    float hl = texelFetch(uSnow, clamp(sij + ivec2(-1, 0), uRange.xy, uRange.zw), 0).r, hr = texelFetch(uSnow, clamp(sij + ivec2(1, 0), uRange.xy, uRange.zw), 0).r;
    float hd = texelFetch(uSnow, clamp(sij + ivec2(0, -1), uRange.xy, uRange.zw), 0).r, hu = texelFetch(uSnow, clamp(sij + ivec2(0, 1), uRange.xy, uRange.zw), 0).r;
    vec3 objectNormal = aSk.y > 0.5 ? vec3(aSk.x, 0.0, aSk.z)
      : normalize(vec3(hl - hr - ${(2 * CELL).toFixed(3)} * uSlope.x, ${(2 * CELL).toFixed(3)}, hd - hu - ${(2 * CELL).toFixed(3)} * uSlope.y));
    #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
    #endif`);
  shader.fragmentShader = 'varying float vSnowH;\nvarying float vIce;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
 if (vSnowH < ${CLEAN.toFixed(3)} && vIce < 0.5) discard;`)
    // verglas : teinte gris-bleu et surface lisse (sans effet dans le matériau de profondeur, qui n'a pas ces blocs)
    .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.33, 0.46), vIce);')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.06, vIce);');
  return shader;
}

export class SnowMesh {
  constructor(scene, snow) {
    this.scene = scene; this.snow = snow; this.chunks = new Map(); // champ -> [{ tex, data }]
    this.geos = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    for (const f of snow.fields) this.addField(f);
    this.pileGeo = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.piles = new THREE.InstancedMesh(this.pileGeo, new THREE.MeshStandardMaterial({ color: 0xe6edfa, roughness: 0.95 }), MAX_PILES);
    this.piles.castShadow = this.piles.receiveShadow = true; this.piles.count = 0; this.piles.frustumCulled = false;
    scene.add(this.piles); this.pileSig = -1; this.rr = 0;
  }
  addField(f) {
    const list = [], sl = f.slope || { dx: 0, dz: 0 };
    for (let cz = 0; cz < f.chunksZ; cz++) for (let cx = 0; cx < f.chunksX; cx++) {
      const data = new Float32Array(TEX * TEX * 2), tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGFormat, THREE.FloatType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
      const cols = Math.min(CHUNK, f.nx - cx * CHUNK), rows = Math.min(CHUNK, f.nz - cz * CHUNK);
      const e = { l: cx === 0, r: cx === f.chunksX - 1, b: cz === 0, t: cz === f.chunksZ - 1 };
      const mx = f.x0 + cx * SIZE + CELL / 2, mz = f.z0 + cz * SIZE + CELL / 2; // sommet k au centre de la cellule k
      const u = {
        uSnow: { value: tex }, uSlope: { value: new THREE.Vector2(sl.dx, sl.dz) }, uBase0: { value: sl.dx * (mx - f.x0) + sl.dz * (mz - f.z0) },
        uRange: { value: new THREE.Vector4(e.l ? 1 : 0, e.b ? 1 : 0, e.r ? cols : TEX - 1, e.t ? rows : TEX - 1) },
      };
      const mat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, roughness: 0.92, metalness: 0 });
      mat.customProgramCacheKey = () => 'snow';
      mat.onBeforeCompile = (s) => displace(s, u, true);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.customProgramCacheKey = () => 'snowdepth';
      depth.onBeforeCompile = (s) => displace(s, u, false);
      const key = cols + 'x' + rows + (e.l ? 'l' : '') + (e.r ? 'r' : '') + (e.b ? 'b' : '') + (e.t ? 't' : '');
      if (!this.geos.has(key)) this.geos.set(key, chunkGeometry(cols, rows, e));
      let geo = this.geos.get(key);
      if (sl.dx || sl.dz) { // champ en pente : sphère englobante agrandie de la montée du morceau (géométrie propre)
        geo = geo.clone(); geo.boundingSphere = geo.boundingSphere.clone(); geo.boundingSphere.radius += SIZE * Math.hypot(sl.dx, sl.dz) + Math.abs(u.uBase0.value); geo.boundingBox = null;
      }
      const m = new THREE.Mesh(geo, mat);
      m.customDepthMaterial = depth; m.castShadow = m.receiveShadow = true;
      m.position.set(mx, f.y, mz);
      this.group.add(m); list.push({ tex, data });
    }
    this.chunks.set(f, list);
  }
  upload(f, c) {
    const cx = c % f.chunksX, cz = (c / f.chunksX) | 0, { data, tex } = this.chunks.get(f)[c];
    const ix0 = cx * CHUNK - 1, iz0 = cz * CHUNK - 1;
    for (let k = 0; k < TEX; k++) {
      const iz = iz0 + k, row = k * TEX, ok = iz >= 0 && iz < f.nz;
      for (let j = 0; j < TEX; j++) {
        const ix = ix0 + j, i = iz * f.nx + ix, inF = ok && ix >= 0 && ix < f.nx, o = (row + j) * 2;
        data[o] = inF ? f.h[i] : 0; data[o + 1] = inF ? f.ice[i] : 0;
      }
    }
    tex.needsUpdate = true;
  }
  update() {
    const F = this.snow.fields;
    for (const f of F) { if (!this.chunks.has(f)) this.addField(f); f.relax(); }
    // tourniquet : un morceau par champ à tour de rôle, pour qu'aucun champ sans cesse re-sali n'en affame un autre
    let n = 0, progress = true;
    while (n < MAX_PER_UPDATE && progress) {
      progress = false;
      for (let k = 0; k < F.length && n < MAX_PER_UPDATE; k++) {
        const f = F[(this.rr + k) % F.length], c = f.dirty.values().next();
        if (c.done) continue;
        this.upload(f, c.value); f.dirty.delete(c.value); n++; progress = true;
      }
      this.rr++;
    }
    this.updatePiles();
  }
  updatePiles() {
    const g = this.snow.ground, cnt = Math.min(g.length, MAX_PILES);
    let sig = cnt; for (let i = 0; i < cnt; i++) sig += g[i].kg;
    if (sig === this.pileSig) return;
    this.pileSig = sig; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < cnt; i++) {
      const r = Math.cbrt(3 * (g[i].kg / PILE_RHO) / (2 * Math.PI)); // calotte : V = 2/3 pi r^3, aplatie à 0,6
      m.compose(p.set(g[i].x, this.snow.fieldAt(g[i].x, g[i].z)?.baseY(g[i].x, g[i].z) ?? 0, g[i].z), q, s.set(r, r * 0.6, r)); this.piles.setMatrixAt(i, m);
    }
    this.piles.count = cnt; this.piles.instanceMatrix.needsUpdate = true;
  }
}
