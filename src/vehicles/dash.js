/* Combiné d'instruments (§5 des conventions) : CanvasTexture redessinée à 20 Hz au plus, sur un plan avec polygonOffset
   (posé contre son boîtier sans scintillement). Rétroéclairé : MeshBasicMaterial, lisible la nuit.
   draw({ kmh, gear: 'P' | 'R' | 'N' | 'D', fuel: 0 à 1, lights, slip }) ; slip = voyant d'antipatinage (roues qui patinent).
   makeBlowerDash : petit tableau de la fraise (§8.2), même support : compte-tours, jauge d'essence, voyants TURBINE, CALÉE, PHARES. */
import * as THREE from 'three';

const MAX = 140; // km/h en bout de cadran

// support commun : canvas 512 px de large, texture, plan ; due() limite le redessin à 20 Hz
function panel(w, h) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  let last = -1e9;
  return { mesh, g, tex, W: c.width, H: c.height, due(force) { const now = performance.now(); if (!force && now - last < 50) return false; last = now; return true; } };
}

export function makeBlowerDash(w, h) {
  const { mesh, g, tex, W, H, due } = panel(w, h), MAXR = 4000;
  return {
    mesh,
    /* s : { rpm, fuel: 0 à 1, auger, stalled, lights } */
    draw(s, force = false) {
      if (!due(force)) return;
      g.fillStyle = '#07090c'; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      // compte-tours : barre horizontale graduée tous les 1000 tr/min, rouge au-delà de 3500
      const x0 = 24, x1 = W * 0.66, y0 = H * 0.2, bh = H * 0.26, r = Math.max(0, Math.min(1, s.rpm / MAXR));
      g.fillStyle = '#1a1f27'; g.fillRect(x0, y0, x1 - x0, bh);
      g.fillStyle = s.rpm > 3500 ? '#ef4444' : s.rpm < 1500 && s.rpm > 0 ? '#f59e0b' : '#22c55e'; g.fillRect(x0, y0, (x1 - x0) * r, bh);
      g.fillStyle = '#8a93a3'; g.font = `600 ${Math.round(H * 0.13)}px Inter, sans-serif`;
      for (let k = 0; k <= 4; k++) { const x = x0 + (x1 - x0) * k / 4; g.fillRect(x - 1, y0 + bh, 2, 8); g.fillText(k, x, y0 + bh + H * 0.13); }
      g.fillStyle = '#f4f7fb'; g.font = `700 ${Math.round(H * 0.22)}px Inter, sans-serif`; g.textAlign = 'left';
      g.fillText(Math.round(s.rpm / 10) * 10, x0, H * 0.84);
      g.fillStyle = '#8a93a3'; g.font = `500 ${Math.round(H * 0.12)}px Inter, sans-serif`; g.fillText('tr/min', x0 + W * 0.22, H * 0.86); // graduations en milliers
      // essence (barre verticale)
      const fx = W - 40, fy0 = H * 0.16, fh = H * 0.66, f = Math.max(0, Math.min(1, s.fuel));
      g.strokeStyle = '#3a4250'; g.lineWidth = 2; g.strokeRect(fx - 10, fy0, 20, fh);
      g.fillStyle = f < 0.15 ? '#f59e0b' : '#d8dee8'; g.fillRect(fx - 8, fy0 + fh * (1 - f) + 2, 16, Math.max(0, fh * f - 4));
      g.fillStyle = '#8a93a3'; g.textAlign = 'center'; g.font = `600 ${Math.round(H * 0.11)}px Inter, sans-serif`; g.fillText('⛽', fx, fy0 + fh + H * 0.1);
      // voyants
      g.font = `700 ${Math.round(H * 0.13)}px Inter, sans-serif`; g.textAlign = 'right'; const vx = W - 72;
      g.fillStyle = s.auger ? '#22c55e' : '#262c35'; g.fillText('TURBINE', vx, H * 0.24);
      g.fillStyle = s.stalled ? '#ef4444' : '#262c35'; g.fillText('CALÉE', vx, H * 0.5);
      g.fillStyle = s.lights ? '#22c55e' : '#262c35'; g.fillText('PHARES', vx, H * 0.76);
      tex.needsUpdate = true;
    },
  };
}

export function makeDash(w, h) {
  const { mesh, g, tex, W, H, due } = panel(w, h);
  const R = H * 0.42, cx = R + 14, cy = H / 2 + 6, A0 = Math.PI * 0.75, SPAN = Math.PI * 1.5; // cadran de 225° à -45°
  return {
    mesh,
    draw(s, force = false) {
      if (!due(force)) return;
      g.fillStyle = '#07090c'; g.fillRect(0, 0, W, H);
      // compteur à aiguille
      g.lineWidth = 3; g.strokeStyle = '#3a4250'; g.beginPath(); g.arc(cx, cy, R, A0, A0 + SPAN); g.stroke();
      g.fillStyle = '#d8dee8'; g.font = `600 ${Math.round(H * 0.085)}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k <= MAX; k += 10) {
        const a = A0 + SPAN * k / MAX, big = k % 20 === 0, r0 = R - (big ? 14 : 8);
        g.strokeStyle = big ? '#e8edf5' : '#8a93a3'; g.lineWidth = big ? 3 : 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
        if (big) g.fillText(k, cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30));
      }
      const a = A0 + SPAN * Math.min(1, s.kmh / MAX);
      g.strokeStyle = '#ff3b30'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.stroke();
      g.fillStyle = '#222831'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
      // vitesse en chiffres et rapport
      const mx = W * 0.58;
      g.fillStyle = '#f4f7fb'; g.font = `700 ${Math.round(H * 0.34)}px Inter, sans-serif`; g.fillText(Math.round(s.kmh), mx, H * 0.36);
      g.fillStyle = '#8a93a3'; g.font = `500 ${Math.round(H * 0.09)}px Inter, sans-serif`; g.fillText('km/h', mx, H * 0.6);
      g.font = `700 ${Math.round(H * 0.15)}px Inter, sans-serif`;
      ['P', 'R', 'N', 'D'].forEach((k, i) => { g.fillStyle = k === s.gear ? '#22c55e' : '#3a4250'; g.fillText(k, mx + (i - 1.5) * H * 0.17, H * 0.82); });
      // essence (barre verticale) et voyants
      const fx = W - 34, fy0 = H * 0.18, fh = H * 0.62, f = Math.max(0, Math.min(1, s.fuel));
      g.strokeStyle = '#3a4250'; g.lineWidth = 2; g.strokeRect(fx - 8, fy0, 16, fh);
      g.fillStyle = f < 0.15 ? '#f59e0b' : '#d8dee8'; g.fillRect(fx - 6, fy0 + fh * (1 - f) + 2, 12, fh * f - 4);
      g.fillStyle = '#8a93a3'; g.font = `600 ${Math.round(H * 0.08)}px Inter, sans-serif`; g.fillText('1/1', fx, fy0 - 12); g.fillText('0', fx, fy0 + fh + 14);
      g.font = `700 ${Math.round(H * 0.1)}px Inter, sans-serif`; g.textAlign = 'right';
      g.fillStyle = s.lights ? '#22c55e' : '#262c35'; g.fillText('≡◐ PHARES', W - 60, H * 0.2);
      g.fillStyle = s.slip ? '#f59e0b' : '#262c35'; g.fillText('⚠ PATINE', W - 60, H * 0.42);
      tex.needsUpdate = true;
    },
  };
}
