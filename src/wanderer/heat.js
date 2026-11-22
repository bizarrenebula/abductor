/* =========================================================================
   HEAT — the harvest learns about you.

   docs/awareness.md, turned round for Wanderer mode: the more you fight the
   saucers, the more of them come, and the harder they look for you. One
   number, 0..1, read by the saucer AI and the HUD.

   RISES
     · a repel (pulse hit)                        a jump
     · breaking an abduction you saved something from   a bigger jump
     · each saucer that can see you in the open   a steady climb
     · being in a beam                            a faster climb
     · being caught in a searchlight              a jump
   FALLS
     · over time, always
     · faster in cover (tree / bridge), fastest inside a shelter
     · faster at night while no beam is near

   STAGES — each changes what the player has to do, not just a number:
     0 QUIET     3 saucers; they mostly harvest, now and then they come for you
     1 NOTICED   up to 5; more of them come for you, and see you further off
     2 HUNTED    up to 7; searchlights sweep the ground — they find you under
                 trees (not under bridges, not indoors)
     3 SWARM     8; faster, and a stunned saucer comes back sooner
   ========================================================================= */
import { banner } from '../ui/banner.js';
import { beep } from '../audio/music.js';
import { t } from '../i18n.js';

export const H={heat:0, stage:0, peak:0};

const STAGE_AT=[0, 0.25, 0.5, 0.78];
const DOWN_GAP=0.06;                     // hysteresis: a stage drops only this far below its line

export const HEAT_GAIN={repel:0.07, save:0.05, seenPerSec:0.011, beamPerSec:0.035, spotlit:0.06};

export function addHeat(v){ H.heat=Math.min(1,H.heat+v); }

/* cover: null | 'tree' | 'bridge' | 'barn'; night: 0..1; beamNear: a beam within ~60 */
export function updateHeat(dt,cover,night,beamNear){
  let fall=0.0055;
  if(cover==='tree'||cover==='bridge')fall*=2.6;
  if(cover==='barn')fall*=5.5;
  if(!beamNear)fall*=1+0.5*night;
  H.heat=Math.max(0,H.heat-fall*dt);
  H.peak=Math.max(H.peak,H.heat);
  // stage with hysteresis, so it does not flicker on a line
  let st=H.stage;
  while(st<3&&H.heat>=STAGE_AT[st+1])st++;
  while(st>0&&H.heat<STAGE_AT[st]-DOWN_GAP)st--;
  if(st>H.stage){
    banner(t('w.heat.up'+st));
    beep(196,0.25,0.07); setTimeout(()=>beep(147,0.35,0.07),220);
  }
  H.stage=st;
}

export function resetHeat(keep){ H.heat=keep?H.heat*0.5:0; H.stage=0; if(!keep)H.peak=0; }

/* what the saucers do at the current heat */
export const tune={
  ships:()=>[3,5,7,8][H.stage],
  huntChance:()=>0.3+0.55*H.heat,             // chance a free saucer picks you when it can see you
  sight:()=>95*(1+0.55*H.heat),
  speed:()=>1+0.35*H.heat,
  searchlights:()=>H.stage>=2,
  retreat:()=>H.stage>=3?[9,13]:[15,20],
};
