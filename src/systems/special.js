/* =========================================================================
   SPECIAL — the "Great Pull": when charged and held, drags every nearby
   creature toward the ship. Charge builds from abductions and idle time.
   ========================================================================= */
import { WATER_Y } from '../core/constants.js';
import { heightAt } from '../world/terrain.js';
import { beep } from '../audio/music.js';
import { animals } from '../entities/registry.js';
import { saucer } from './saucer.js';
import { spBtn } from '../ui/dom.js';
import { input } from '../core/input.js';
import { t } from '../i18n.js';

export const Special={
  charge:1,active:false,RADIUS:70,
  gainAnimal(){this.charge=Math.min(1,this.charge+1/20);},
  update(dt,held){
    if(this.active){ if(!held||this.charge<=0)this.active=false; }
    else if(held&&this.charge>=1){this.active=true;beep(196,0.4,0.09);}
    if(this.active){
      this.charge=Math.max(0,this.charge-dt/3.5);
      const sx=saucer.position.x,sz=saucer.position.z;
      for(const a of animals){
        if(a.userData.abducting>0)continue;
        const dx=sx-a.position.x,dz=sz-a.position.z;
        const d=Math.hypot(dx,dz);
        if(d<this.RADIUS&&d>0.6){
          const pull=Math.min(1,dt*2.4);
          a.position.x+=dx*pull;a.position.z+=dz*pull;
          a.userData.hop=null;a.userData.phase='idle';a.userData.hopTimer=0.8+Math.random();
          const gh2=heightAt(a.position.x,a.position.z);
          a.position.y=(a.userData.biome==='water'&&gh2<WATER_Y)?WATER_Y+0.15:gh2;
          a.rotation.y=Math.atan2(dx,dz);
        }
      }
    }else{
      this.charge=Math.min(1,this.charge+dt/60);
    }
    // The PULL button only exists while the special is fully charged and idle.
    // It floats at the last spot the right stick was pressed (so it lands under
    // the player's thumb); press-and-hold fires the pull, which starts draining
    // the charge — dropping below full — and so the button hides itself until it
    // recharges. Until the first right-stick press we park it lower-right.
    const show=this.charge>=1&&!this.active;
    if(show){
      const x=input.pullX!=null?input.pullX:innerWidth*0.72;
      const y=input.pullY!=null?input.pullY:innerHeight*0.6;
      spBtn.style.left=x+'px';spBtn.style.top=y+'px';
      spBtn.textContent=t('hud.pull');
    }
    spBtn.classList.toggle('show',show);
  }
};
