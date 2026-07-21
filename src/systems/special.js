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
          a.userData.hop=null;a.userData.hopTimer=0.8+Math.random();
          const gh2=heightAt(a.position.x,a.position.z);
          a.position.y=(a.userData.biome==='water'&&gh2<WATER_Y)?WATER_Y+0.15:gh2;
          a.rotation.y=Math.atan2(dx,dz);
        }
      }
    }else{
      this.charge=Math.min(1,this.charge+dt/60);
    }
    const pct=(this.charge*100)|0;
    spBtn.style.background='conic-gradient(var(--beam) '+(pct*3.6)+'deg, rgba(255,255,255,.05) '+(pct*3.6)+'deg)';
    spBtn.classList.toggle('ready',this.charge>=1&&!this.active);
    spBtn.textContent=this.active?'···':(this.charge>=1?t('hud.pull'):pct+'%');
  }
};
