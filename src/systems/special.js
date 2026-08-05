/* =========================================================================
   SPECIAL — the "Great Pull": when charged and held, drags every nearby
   creature toward the ship. Charge builds from abductions and idle time.
   ========================================================================= */
import { WATER_Y } from '../core/constants.js';
import { heightAt } from '../world/terrain.js';
import { beep } from '../audio/music.js';
import { animals } from '../entities/registry.js';
import { saucer } from './saucer.js';
import { S } from '../core/state.js';
import { spBtn } from '../ui/dom.js';
import { t } from '../i18n.js';

export const Special={
  charge:1,active:false,RADIUS:70,
  gainAnimal(){this.charge=Math.min(1,this.charge+1/20);},
  update(dt,held,avail=true){
    /* USABLE gates the PULL ITSELF, not just the button.
       `avail` and S.upHasBeam used to reach only the display code at the bottom
       of this function, so hiding the button hid the button and nothing else —
       on a PC the Q keybind fired a full mass pull with no beam module aboard
       and before the lesson that explains it. Touch was accidentally safe
       because there was nothing to press.
       It also cancels a pull in progress: losing the beam mid-pull should stop
       the pull, not leave it running until the key is released. */
    const usable=avail&&S.upHasBeam;
    if(this.active){ if(!held||!usable||this.charge<=0)this.active=false; }
    else if(held&&usable&&this.charge>=1){this.active=true;beep(196,0.4,0.09);}
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
    /* The PULL button sits on the minimap's line, bottom-right (positioned in
       CSS). It shows only while the special is fully charged and idle;
       press-and-hold fires the pull, which starts draining the charge —
       dropping it below full — so the button hides while it (re)charges.

       And it stays OFFLINE until the tractor beam is aboard. A mass pull drags
       every creature nearby into the beam; with no beam there is nothing for
       them to arrive in, so offering the button before the module is found
       advertises a control that cannot do anything.

       `avail` is the second half of that: during the guided run it is false
       until the mass-pull lesson comes up, so the player beams one sheep the
       ordinary way before being shown the button that does it wholesale. See
       Tutorial.pullTaught(), which main.js passes in. */
    const show=usable&&this.charge>=1&&!this.active;
    if(show)spBtn.textContent=t('hud.pull');
    spBtn.classList.toggle('show',show);
  }
};
