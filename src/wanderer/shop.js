/* =========================================================================
   THE SHOP — upgrades, bought only at save points.

   Points come from repelling saucers (10 a hit). Spending them does not lower
   the run's score: the shop draws on a wallet of points earned minus points
   spent, and the end card still shows everything you earned.

   It opens by itself when you are properly inside a save point — in the
   waystation barn, or on the ground under the save bridge — and closes when
   you walk back out. SHOP / B reopens it while you are still there.

   Upgrades last for the whole run, through a respawn. Each is read by the
   system it changes through UP.* (gun.js, player.js, saucers.js, wanderer.js).
   ========================================================================= */
import { S } from '../core/state.js';
import { TOUCH_ONLY } from '../core/env.js';
import { beep } from '../audio/music.js';
import { t } from '../i18n.js';

export const UP={wide:0, quick:0, cell:0, legs:0, grip:0, wind:0};
let spent=0;
export const wallet=()=>Math.max(0,(S.score||0)-spent);

/* id, levels' prices. Effects (per level) are applied where the thing lives:
     wide  pulse hit radius +2.2, and a bigger pulse          (gun.js)
     quick recharge time ×0.78                                (gun.js)
     cell  energy per shot ×0.75 — more shots per cell        (gun.js)
     legs  run speed +1.3                                     (player.js)
     grip  a beam's lock on you fills ×0.78 as fast           (saucers.js)
     wind  one more "run it back"                             (wanderer.js) */
const ITEMS=[
  {id:'wide',  cost:[30,50,80]},
  {id:'quick', cost:[30,50,80]},
  {id:'cell',  cost:[40,70]},
  {id:'legs',  cost:[30,60]},
  {id:'grip',  cost:[40,80]},
  {id:'wind',  cost:[120]},
];
export function resetShop(){ for(const k in UP)UP[k]=0; spent=0; }
export const onBuy={wind:null};      // wanderer.js hooks "second wind" here

/* ---- DOM ---- */
const css=`
#wShop{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;
  background:rgba(2,6,5,.55);backdrop-filter:blur(3px);font-family:inherit}
#wShop.on{display:flex}
#wShop .card{width:min(440px,92vw);max-height:86vh;overflow:auto;padding:18px 18px 14px;border-radius:16px;
  background:rgba(6,16,13,.92);border:1px solid rgba(143,232,184,.28);box-shadow:0 10px 40px rgba(0,0,0,.6)}
#wShop .eb{font-size:10px;letter-spacing:.32em;color:#5cffa8;text-transform:uppercase}
#wShop h2{margin:4px 0 2px;font-size:20px;letter-spacing:.12em;color:#e6fff3}
#wShop .wal{font-size:12px;letter-spacing:.14em;color:rgba(220,255,240,.75);margin-bottom:12px}
#wShop .wal b{color:#ffd36a;font-size:15px}
.wsItem{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(143,232,184,.12)}
.wsItem .tx{flex:1;min-width:0}
.wsItem .nm{font-size:13px;letter-spacing:.1em;color:#dfffee}
.wsItem .ds{font-size:11px;color:rgba(200,240,225,.6);margin-top:2px}
.wsItem .pips{font-size:10px;letter-spacing:.2em;color:#5cffa8;margin-top:3px}
.wsItem button{min-width:84px;padding:8px 10px;border-radius:9px;border:1px solid rgba(143,232,184,.5);
  background:rgba(40,110,80,.35);color:#eafff4;font:600 12px/1 inherit;letter-spacing:.1em;cursor:pointer}
.wsItem button:disabled{opacity:.35;cursor:default}
.wsItem button.max{border-color:rgba(255,255,255,.15);background:none}
#wShop .close{width:100%;margin-top:12px;padding:11px;border-radius:10px;border:none;
  background:#7fffc4;color:#03140c;font:700 13px/1 inherit;letter-spacing:.22em;cursor:pointer}
#wShopBtn{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:13;display:none;
  padding:9px 18px;border-radius:20px;border:1px solid rgba(143,232,184,.6);background:rgba(10,40,30,.7);
  color:#dfffee;font:600 12px/1 inherit;letter-spacing:.2em;pointer-events:auto;cursor:pointer}
body.wander #wShopBtn.on{display:block}
`;
const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
const root=document.createElement('div'); root.id='wShop';
root.innerHTML=`<div class="card"><div class="eb" id="wsEb"></div><h2 id="wsH"></h2>
  <div class="wal" id="wsWal"></div><div id="wsList"></div><button class="close" id="wsClose"></button></div>`;
document.body.appendChild(root);
const btn=document.createElement('button'); btn.id='wShopBtn'; document.body.appendChild(btn);
const $=id=>document.getElementById(id);

let open=false;
export const shopIsOpen=()=>open;

function render(){
  $('wsEb').textContent=t('w.shop.eyebrow');
  $('wsH').textContent=t('w.shop.title');
  $('wsWal').innerHTML=t('w.shop.wallet',{n:'<b>'+wallet()+'</b>'});
  $('wsClose').textContent=t('w.shop.close');
  const L=$('wsList'); L.innerHTML='';
  for(const it of ITEMS){
    const lvl=UP[it.id], max=it.cost.length, price=it.cost[lvl];
    const row=document.createElement('div'); row.className='wsItem';
    const pips='●'.repeat(lvl)+'○'.repeat(max-lvl);
    row.innerHTML='<div class="tx"><div class="nm">'+t('w.shop.'+it.id)+'</div><div class="ds">'+t('w.shop.'+it.id+'.d')+'</div>'
      +'<div class="pips">'+pips+'</div></div>';
    const b=document.createElement('button');
    if(lvl>=max){ b.textContent=t('w.shop.max'); b.disabled=true; b.className='max'; }
    else{
      b.textContent=price+' '+t('w.shop.pts');
      b.disabled=wallet()<price;
      b.addEventListener('click',()=>{
        if(wallet()<price||UP[it.id]>=max)return;
        spent+=price; UP[it.id]++;
        if(it.id==='wind'&&onBuy.wind)onBuy.wind();
        beep(660,0.1,0.06); setTimeout(()=>beep(990,0.14,0.06),100);
        render();
      });
    }
    row.appendChild(b); L.appendChild(row);
  }
}
export function openShop(){
  if(open)return; open=true; render(); root.classList.add('on'); btn.classList.remove('on');
  // the mouse is needed for the buttons: let go of it without pausing the run
  if(document.pointerLockElement)document.exitPointerLock();
}
export function closeShop(){ if(!open)return; open=false; root.classList.remove('on'); }
$('wsClose').addEventListener('click',()=>closeShop());
btn.addEventListener('click',()=>openShop());
export function shopButton(show){
  btn.textContent=t('w.shop.btn')+(TOUCH_ONLY?'':' · B');
  btn.classList.toggle('on',!!show&&!open);
}
