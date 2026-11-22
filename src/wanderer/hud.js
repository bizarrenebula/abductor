/* =========================================================================
   WANDERER HUD — everything on screen that is specific to being on foot.

   Built from JS (and its CSS injected) so index.html needs no new markup and
   the saucer game's HUD is untouched. While wanderer mode is playing, the body
   carries `.wander`, which hides the flight-only parts of the shared HUD (zoom,
   angle, cloak ring, altitude scale, pull button, side-quest and ship panels).

     · crosshair
     · pulse cell (energy) bar, bottom centre
     · cover line: HIDDEN · under a tree / under the bridge / in the barn, or EXPOSED
     · beam-lock vignette + LOCK meter when a saucer has you
     · touch: FIRE button, HIDE button (beside a shelter)
     · desktop: "click to look" until the pointer is locked
   ========================================================================= */
import { TOUCH_ONLY } from '../core/env.js';
import { wireButtons } from './controls.js';
import { t } from '../i18n.js';

const css=`
body.wander #zoomCtl,body.wander #angleCtl,body.wander #cloakRing,body.wander #altScale,
body.wander #spBtn,body.wander #hMission,body.wander #hUpgrade,body.wander #hBuff,
body.wander #hTarget,body.wander #hClock,body.wander #hStory{display:none!important}
@media (pointer:coarse){body.wander #minimap{left:auto;bottom:auto;right:14px;top:66px}}
#wHud{position:fixed;inset:0;pointer-events:none;z-index:12;display:none;font-family:inherit}
body.wander #wHud{display:block}
#wCross{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px}
#wCross:before,#wCross:after{content:'';position:absolute;background:rgba(210,255,240,.75);border-radius:1px}
#wCross:before{left:10px;top:2px;width:2px;height:18px}
#wCross:after{top:10px;left:2px;height:2px;width:18px}
#wCross.cool:before,#wCross.cool:after{background:rgba(210,255,240,.28)}
#wCell{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);width:min(240px,52vw);text-align:center}
#wCell .lbl{font-size:10px;letter-spacing:.2em;color:rgba(190,255,225,.7);margin-bottom:4px}
#wCellBar{height:7px;border-radius:4px;background:rgba(10,30,22,.6);border:1px solid rgba(143,232,184,.35);overflow:hidden}
#wCellFill{height:100%;width:100%;background:linear-gradient(90deg,#3fd9a0,#9ffff0);transition:width .12s}
#wCell.low #wCellFill{background:linear-gradient(90deg,#ff5a40,#ffa070)}
#wCover{position:absolute;left:50%;top:18px;transform:translateX(-50%);font-size:12px;letter-spacing:.22em;
  padding:5px 12px;border-radius:12px;background:rgba(4,12,10,.45);color:#ffb0a0;white-space:nowrap}
#wCover.hid{color:#9fffd8}
#wLockV{position:absolute;inset:0;opacity:0;
  background:radial-gradient(ellipse at center,rgba(120,230,255,0) 38%,rgba(120,230,255,.55) 100%)}
#wLock{position:absolute;left:50%;top:62%;transform:translateX(-50%);width:min(260px,60vw);text-align:center;opacity:0}
#wLock .lbl{font-size:12px;letter-spacing:.3em;color:#dffaff;text-shadow:0 0 8px #4cf}
#wLockBar{height:8px;margin-top:6px;border-radius:4px;background:rgba(0,20,30,.6);border:1px solid rgba(160,240,255,.6);overflow:hidden}
#wLockFill{height:100%;width:0;background:linear-gradient(90deg,#9ff,#fff)}
#wFire,#wHide{position:absolute;pointer-events:auto;border-radius:50%;border:2px solid rgba(160,255,225,.6);
  background:rgba(20,60,48,.45);color:#dfffee;font:600 13px/1 inherit;letter-spacing:.12em;touch-action:none;
  -webkit-user-select:none;user-select:none}
#wFire{right:28px;bottom:34px;width:84px;height:84px}
#wFire.cool{opacity:.55}
#wHide{right:126px;bottom:58px;width:64px;height:64px;display:none;font-size:11px}
#wHide.on{display:block}
#wTrek{position:absolute;left:50%;top:44px;transform:translateX(-50%);font-size:11px;letter-spacing:.16em;
  color:rgba(220,255,240,.8);white-space:nowrap;text-shadow:0 1px 3px #000}
#wTrek .d{color:#ffc870}#wTrek .s{color:#7dffbe}
#wHint{position:absolute;left:50%;top:50%;transform:translate(-50%,28px);font-size:12px;letter-spacing:.14em;
  color:rgba(220,255,240,.85);text-shadow:0 1px 3px #000;white-space:nowrap}
#wDark{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.35) 20%,rgba(0,0,0,.85) 100%);opacity:0;transition:opacity .4s}
#wDark.on{opacity:1}
`;
const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

const root=document.createElement('div'); root.id='wHud';
root.innerHTML=`
<div id="wDark"></div>
<div id="wLockV"></div>
<div id="wCross"></div>
<div id="wCover">EXPOSED</div>
<div id="wHint"></div>
<div id="wTrek"></div>
<div id="wLock"><div class="lbl">BEAM LOCK</div><div id="wLockBar"><div id="wLockFill"></div></div></div>
<div id="wCell"><div class="lbl">PULSE CELL</div><div id="wCellBar"><div id="wCellFill"></div></div></div>
<button id="wHide">HIDE</button>
<button id="wFire">FIRE</button>`;
document.body.appendChild(root);

const $=id=>document.getElementById(id);
const el={cross:$('wCross'),cover:$('wCover'),hint:$('wHint'),lock:$('wLock'),lockFill:$('wLockFill'),lockV:$('wLockV'),
  cell:$('wCell'),trek:$('wTrek'),cellFill:$('wCellFill'),fire:$('wFire'),hide:$('wHide'),dark:$('wDark')};
if(!TOUCH_ONLY)el.fire.style.display='none';
wireButtons(el.fire,el.hide);

export function showWanderHUD(on){
  document.body.classList.toggle('wander',!!on);
  const lbl=document.querySelector('#hScore .lbl');
  if(lbl)lbl.textContent=on?t('w.hud.repelled'):t('hud.harvest');
}

const COVER_TXT={tree:'w.cover.tree',bridge:'w.cover.bridge',barn:'w.cover.barn'};
let last={};
/* s: {energy, cool, cover, revealed, lock, nearShelter, inBarn, locked(pointer), touch} */
export function drawWanderHUD(s){
  const hid=!!s.cover&&!s.revealed;
  const cv=hid?t(COVER_TXT[s.cover]):(s.cover&&s.revealed?t('w.cover.revealed'):t('w.cover.exposed'));
  if(cv!==last.cv){ el.cover.textContent=cv; last.cv=cv; }
  el.cover.classList.toggle('hid',hid);
  el.cellFill.style.width=(Math.max(0,s.energy)*100).toFixed(1)+'%';
  el.cell.classList.toggle('low',s.energy<0.2);
  el.cross.classList.toggle('cool',s.cool);
  el.fire.classList.toggle('cool',s.cool);
  const lk=Math.max(0,Math.min(1,s.lock));
  el.lock.style.opacity=lk>0.01?1:0;
  el.lockFill.style.width=(lk*100).toFixed(1)+'%';
  el.lockV.style.opacity=(lk*0.9).toFixed(3);
  el.dark.classList.toggle('on',!!s.inBarn);
  el.hide.classList.toggle('on',!!(s.nearShelter||s.inBarn));
  el.hide.textContent=s.inBarn?t('w.btn.leave'):t('w.btn.hide');
  if(s.trek){
    const km=v=>v>=1000?(v/1000).toFixed(1)+' km':Math.round(v/10)*10+' m';
    const tx='<span class="d">'+t('w.hud.escape')+' '+km(s.trek.dest)+'</span>'
      +(s.trek.save!=null?' · <span class="s">'+t('w.hud.save',{n:s.trek.saves+1,total:s.trek.total})+' '+km(s.trek.save)+'</span>':'');
    if(tx!==last.tx){ el.trek.innerHTML=tx; last.tx=tx; }
  }
  let hint='';
  if(!TOUCH_ONLY&&!s.locked)hint=t('w.hint.click');
  else if(s.inBarn)hint=TOUCH_ONLY?'':t('w.hint.leave');
  else if(s.nearShelter&&!TOUCH_ONLY)hint=t('w.hint.hide');
  if(hint!==last.hint){ el.hint.textContent=hint; last.hint=hint; }
}
