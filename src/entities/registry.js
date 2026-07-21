/* =========================================================================
   ENTITY REGISTRY — the shared live arrays every system reads. Owned here so
   spawners (chunks), the abduction loop, and cleanup can all splice the same
   lists without a circular-import tangle.
   ========================================================================= */
export const animals=[];    // creatures + humans (abductable)
export const pickups=[];    // energy crystals
export const props=[];      // beam-fodder scenery, no reward
export const shelters=[];    // {x,z} points humans flee toward
