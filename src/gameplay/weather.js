// Bulletin météo d'avant la nuit (§5, §6), logique pure.
import { clamp } from '../core/util.js';

// densité de la neige qui tombe : poudreuse 100 kg/m³ sous -2 °C, mouillée 400 au-dessus de -1 °C, interpolée entre les deux
export const rhoAt = (tempC) => 100 + 300 * clamp(tempC + 2, 0, 1);

// night : numéro de la nuit (1, 2, ...) ; early : une nuit sur trois, un habitant avance son heure limite de 30 minutes
export function bulletin(night, rand) {
  const startCm = 5 + Math.floor(rand() * 26), tempC = Math.round((-10 + rand() * 12) * 10) / 10; // -10 à +2 °C
  return { night, startCm, cmPerHour: 2, tempC, wet: tempC > -1, rho: rhoAt(tempC), early: night % 3 === 0 };
}
