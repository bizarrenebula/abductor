/* =========================================================================
   CLOAK — tap the ship to toggle invisibility. Hides you from humans/hazards
   at the cost of a steady energy drain (see main loop).
   ========================================================================= */
import { lerp } from '../core/math.js';
import { S } from '../core/state.js';
import { POWER_MIN } from '../core/constants.js';
import { beep } from '../audio/music.js';
import { banner } from '../ui/banner.js';
import { saucer } from './saucer.js';
import { ModuleIcons } from './moduleIcons.js';
import { t } from '../i18n.js';

export function toggleCloak(){
  ModuleIcons.ping('cloak','try');   // shows the grey glyph only while it is unfound
  // Cloak is the summit of the upgrade ladder — locked until earned (req).
  if(!S.upCloak&&!S.cloak){beep(160,0.2,0.08);banner(t('upg.locked.cloak'));return;}
  /* No juice. The reactor is what the cloak runs on, and a flat one cannot
     hold it up — go and find crystals. Not fatal, just unavailable. */
  if(S.energyMode==='drain'&&S.energy<POWER_MIN&&!S.cloak){
    beep(160,0.2,0.08); banner(t('upg.locked.power')); return; }
  S.cloak=!S.cloak;
  beep(S.cloak?520:300,0.18,0.07);
  banner(t(S.cloak?'banner.cloakOn':'banner.cloakOff'));
}
export function applyCloakVisual(){
  const tgt=S.cloak?0.24:1;
  saucer.traverse(o=>{
    if(o.isMesh&&o.material){
      if(o.material.__baseOp==null)o.material.__baseOp=(o.material.opacity!=null?o.material.opacity:1);
      o.material.transparent=true;
      o.material.opacity=lerp(o.material.opacity,o.material.__baseOp*tgt,0.15);
    }
  });
}
