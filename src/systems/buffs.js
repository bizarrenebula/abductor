/* =========================================================================
   BUFFS — every 4th specimen grants a timed boon (engines / lock / beam).
   `buff` is read by beam.effBeamR, abduction, and movement; exported as a live
   binding. startGame resets via resetBuffs() (can't reassign an import).
   ========================================================================= */
import { beep } from '../audio/music.js';
import { hBuffEl, buffNameEl } from '../ui/dom.js';
import { t } from '../i18n.js';

export const BUFFS={
  speed:{name:'buff.speed'},
  lock:{name:'buff.lock'},
  wide:{name:'buff.wide'}
};
export let buff=null,buffT=0;

export function grantBuffType(k,dur){
  buff=k;buffT=dur;
  hBuffEl.style.display='block';buffNameEl.textContent=t(BUFFS[k].name)+' · '+dur+'s';
  beep(659,0.25,0.07);setTimeout(()=>beep(988,0.3,0.06),120);
}
export function grantBuff(){
  const ks=Object.keys(BUFFS);
  grantBuffType(ks[(Math.random()*ks.length)|0],15);
}
export function updateBuff(dt){
  if(!buff)return;
  buffT-=dt;
  if(buffT<=0){buff=null;hBuffEl.style.display='none';return;}
  buffNameEl.textContent=t(BUFFS[buff].name)+' · '+Math.ceil(buffT)+'s';
}
export function resetBuffs(){buff=null;buffT=0;hBuffEl.style.display='none';}
