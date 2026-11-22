/* =========================================================================
   THREATS — where the AI saucers are, as plain data.

   Wanderer mode turns the saucer from the player into the enemy, and the
   creatures that used to run from the player's ship now have to run from these
   instead. humans.js, animals.js and the minimap read this list; only
   wanderer/saucers.js writes it. Kept in its own import-free module so none of
   those readers pull the whole wanderer system (and its import graph) in.
   ========================================================================= */

/* One entry per live AI saucer: {x, y, z, beaming, stunned}. Entries are
   reused in place, `n` is how many are live. */
export const threats={list:[],n:0};

/* Nearest live saucer to a ground point, as {d, x, z}, or d=Infinity. Stunned
   or retreating ships still count: a person does not stop being afraid of a
   saucer because it is wobbling. */
const _near={d:Infinity,x:0,z:0};
export function nearestThreat(x,z){
  _near.d=Infinity;
  for(let i=0;i<threats.n;i++){
    const t=threats.list[i];
    const d=Math.hypot(t.x-x,t.z-z);
    if(d<_near.d){_near.d=d;_near.x=t.x;_near.z=t.z;}
  }
  return _near;
}
