/* Argent et achats (logique pure, aucun import de three). Prix : §8.1 à §8.3 ; identifiants d'achat : décision F. */
import { SHOVELS, GEAR } from '../player/toolsData.js';
import { BLOWER_UPGRADES } from '../vehicles/blowerLogic.js';
import { QUAD_UPGRADES } from '../vehicles/quadLogic.js';

export const CATALOG = { SHOVELS, GEAR, BLOWER_UPGRADES, QUAD_UPGRADES, blower: 600, quad: 2400, fuelPerL: 2, repair: 20 };

// achat d'un objet unique : refusé si l'argent manque ou s'il est déjà possédé
export function buy(save, item, price) {
  if (save.owned.includes(item) || !spend(save, price)) return false;
  save.owned.push(item); return true;
}
// dépense sans objet (sel, essence, réparation) : refusée si l'argent manque
export function spend(save, price) {
  if (!(save.money >= price)) return false;
  save.money -= price; return true;
}
// plein jusqu'au réservoir, arrondi à l'euro supérieur
export const fuelCost = (fuel, tank) => Math.max(0, Math.ceil((tank - fuel) * CATALOG.fuelPerL - 1e-9));
// outils des contrats proposés au tableau (drawContracts)
export const toolsOf = (save) => ['pelle', ...(save.owned.includes('blower') ? ['fraise'] : []), ...(save.owned.includes('quad') ? ['quad'] : [])];
