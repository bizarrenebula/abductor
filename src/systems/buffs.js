/* =========================================================================
   BUFFS — every 4th specimen grants a timed boon (engines / lock / beam).
   `buff` is read by beam.effBeamR, abduction, and movement; exported as a live
   binding. startGame resets via resetBuffs() (can't reassign an import).
   ========================================================================= */
import { beep } from '../audio/music.js';
import { hBuffEl, buffNameEl } from '../ui/dom.js';
import { banner } from '../ui/banner.js';
import { t } from '../i18n.js';

/* ---- TURNED OFF -----------------------------------------------------------
   Buffs are disabled at the source, not deleted. Every fourth specimen fired a
   banner, a chime and a counting-down pill on top of whatever else was on
   screen — three more things competing with the hint card, the achievement
   toast and the module glyphs — and the boon itself was over before the player
   had finished reading what it was.

   ONE switch, here, because everything downstream already handles `buff` being
   null: beam.effBeamR, abduction and the movement multiplier all read it as a
   live binding and simply see "no buff". Nothing else needed changing, and
   flipping this back to true restores the feature whole for the pass that
   redesigns it. */
const ENABLED=false;

export const BUFFS={
  speed:{name:'buff.speed'},
  lock:{name:'buff.lock'},
  wide:{name:'buff.wide'}
};
export let buff=null,buffT=0;

/* Compact remaining-time label the player asked for: 5s, 30s, 1m, 1m 5s. */
export function fmtTime(s){
  s=Math.max(0,Math.ceil(s));
  if(s<60)return s+'s';
  const m=Math.floor(s/60), r=s%60;
  return r?m+'m '+r+'s':m+'m';
}

export function grantBuffType(k,dur){
  if(!ENABLED)return;                  // no boon, no banner, no pill, no chime
  buff=k;buffT=dur;
  const label=t(BUFFS[k].name);
  hBuffEl.style.display='block';
  buffNameEl.textContent=label+' · '+fmtTime(dur);
  // Announce what it does and for how long (req 6); the HUD pill then counts down.
  banner(t('banner.buff',{buff:label,time:fmtTime(dur)}));
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
  buffNameEl.textContent=t(BUFFS[buff].name)+' · '+fmtTime(buffT);
  // Pulse the pill in the last 5 seconds so a fading boon is noticeable.
  hBuffEl.classList.toggle('expiring',buffT<5);
}
export function resetBuffs(){buff=null;buffT=0;hBuffEl.style.display='none';hBuffEl.classList.remove('expiring');}
