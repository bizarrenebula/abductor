/* =========================================================================
   HAZARD DIFFICULTY — Earth easy (x1), Moon medium (geysers x1.5), Mars hard
   (meteors x2). Story mode doubles on top. mult raises event frequency
   (shorter gap) and count-per-event.
   ========================================================================= */
import { S } from '../core/state.js';
import { World } from '../world/world-config.js';

export const HAZARD_DIFFICULTY={earth:1, moon:1.5, mars:2};
export function hazMult(){return (HAZARD_DIFFICULTY[World.name]||1)*(S.storyMode?2:1);}   // story mode still doubles on top
export function hazCount(){                                   // base 3–4, scaled and floored
  const m=hazMult();
  const base=3+((Math.random()*2)|0);
  return Math.max(3,Math.round(base*m));
}
