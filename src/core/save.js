/* Sauvegarde de la partie (logique pure, aucun import de three), sur le modèle de parking-master/src/core/save.js.
   Clé deneigeur.save.v1. Forme : { v: 1, night, money, rep, owned, upgrades, fuel: { blower }, shovel, salt, damaged }.
   owned : identifiants d'achat (décision F : shovel:<clé>, gear:<clé>, blower, quad, blower:<amélioration>, quad:<amélioration>) ;
   les améliorations des véhicules sont lues dans owned (upgrades reste vide, gardé pour la forme du plan).
   shovel : pelle en main ; salt : sacs de sel (un sac = un coup de X, 20 m²) ; damaged : véhicules non réparés ('pickup', 'quad').
   La grille de neige n'est pas sauvegardée : « Continuer » repart d'une neige neuve à la nuit suivante.
   storage = localStorage ou équivalent ({ getItem, setItem }) ; indisponible ou qui lève : partie neuve, sans erreur.
   Chaque champ d'une sauvegarde v1 est vérifié (type, bornes) : un champ invalide prend la valeur de fresh(). */
import { SHOVELS } from '../player/toolsData.js';

export const KEY = 'deneigeur.save.v1';
export const fresh = () => ({ v: 1, night: 1, money: 0, rep: 0, owned: ['shovel:base'], upgrades: {}, fuel: { blower: 0 }, shovel: 'base', salt: 0, damaged: [] });

// sauvegarde lisible de cette version, sinon null
function read(storage) {
  try { const s = JSON.parse(storage.getItem(KEY)); return s && typeof s === 'object' && s.v === 1 ? s : null; } catch { return null; }
}
export const exists = (storage) => !!read(storage);
const num = (v, d, lo = 0, hi = Infinity) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
export function load(storage) {
  const f = fresh(), s = read(storage);
  if (!s) return f;
  const owned = Array.isArray(s.owned) ? [...new Set(['shovel:base', ...s.owned.filter((x) => typeof x === 'string')])] : f.owned;
  const shovel = typeof s.shovel === 'string' && Object.hasOwn(SHOVELS, s.shovel) && owned.includes('shovel:' + s.shovel) ? s.shovel : 'base';
  return {
    ...f, ...s, owned, shovel,
    night: Math.floor(num(s.night, 1, 1)), money: num(s.money, 0), rep: num(s.rep, 0), salt: Math.floor(num(s.salt, 0)),
    upgrades: s.upgrades && typeof s.upgrades === 'object' && !Array.isArray(s.upgrades) ? s.upgrades : {},
    fuel: { blower: num(s.fuel?.blower, 0, 0, 4) }, // 4 L : le plus grand réservoir
    damaged: Array.isArray(s.damaged) ? s.damaged.filter((x) => x === 'pickup' || x === 'quad') : [],
  };
}

export function persist(storage, save) {
  try { storage.setItem(KEY, JSON.stringify(save)); return true; } catch { return false; } // stockage indisponible : on joue sans sauvegarde
}

export const storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
export const save = load(storage);
