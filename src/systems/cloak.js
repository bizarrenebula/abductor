/* =========================================================================
   CLOAK — tap the ship to toggle invisibility. Hides you from humans/hazards
   at the cost of a steady energy drain (see main loop).
   ========================================================================= */
import { lerp } from '../core/math.js';
import { S } from '../core/state.js';
import { beep } from '../audio/music.js';
import { banner } from '../ui/banner.js';
import { saucer } from './saucer.js';
import { t } from '../i18n.js';

export function toggleCloak(){
  // Cloak is the summit of the upgrade ladder — locked until earned (req).
  if(!S.upCloak&&!S.cloak){beep(160,0.2,0.08);banner(t('upg.locked.cloak'));return;}
  if(S.energyMode==='drain'&&S.energy<0.06&&!S.cloak){beep(160,0.2,0.08);return;}  // no juice
  S.cloak=!S.cloak;
  beep(S.cloak?520:300,0.18,0.07);
  banner(t(S.cloak?'banner.cloakOn':'banner.cloakOff'));
}
export function applyCloakVisual(){
  const tgt=S.cloak?0.24:1;
  saucer.traverse(o=>{
    if(o.isMesh&&o.material&&o.parent!==saucer.userData.lights){
      if(o.material.__baseOp==null)o.material.__baseOp=(o.material.opacity!=null?o.material.opacity:1);
      o.material.transparent=true;
      o.material.opacity=lerp(o.material.opacity,o.material.__baseOp*tgt,0.15);
    }
  });
}
