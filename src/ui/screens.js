/* =========================================================================
   SCREENS + UI WIRING — settings sliders, start/restart/end/pause/menu flow,
   the landing (login/free) screens, world/reactor/mode pickers, music volume,
   and the high-detail asset opt-in. Owns startGame() and endGame().
   ========================================================================= */
import { env } from '../core/env.js';
import { S } from '../core/state.js';
import { input } from '../core/input.js';
import { reseed } from '../world/noise.js';
import { applyWorld, World, WORLD_CFG } from '../world/world-config.js';
import { clearWorld, updateChunks } from '../world/chunks.js';
import { applyWeather, weather } from '../world/weather.js';
import { saucer } from '../systems/saucer.js';
import { Special } from '../systems/special.js';
import { resetBuffs } from '../systems/buffs.js';
import { updateMissionHUD } from '../systems/missions.js';
import { resetMeteors } from '../hazards/meteors.js';
import { resetGeysers } from '../hazards/geysers.js';
import { resetLightning } from '../hazards/lightning.js';
import { Story, storyProceed } from '../story/story.js';
import { Music, TRACK_BY_WORLD } from '../audio/music.js';
import { BeamSFX } from '../audio/sfx.js';
import { loadAllAssets, spawnModel } from '../assets.js';
import { banner } from './banner.js';
import { setFX } from './postfx.js';
import { scoreV, specV, spBtn } from './dom.js';

const startScreen=document.getElementById('startScreen');
const overScreen=document.getElementById('overScreen');
const hud=document.getElementById('hud');
const sLock=document.getElementById('sLock'),oLock=document.getElementById('oLock');
const sBeam=document.getElementById('sBeam'),oBeam=document.getElementById('oBeam');
const sTime=document.getElementById('sTime'),oTime=document.getElementById('oTime');
const cEndless=document.getElementById('cEndless');

function syncLabels(){
  oLock.textContent=(+sLock.value===0)?'Instant':(+sLock.value).toFixed(2)+' s';
  oBeam.textContent=sBeam.value+' m';
  oTime.textContent=cEndless.checked?'Endless':sTime.value+' min';
  sTime.disabled=cEndless.checked;
}
[sLock,sBeam,sTime].forEach(el=>el.addEventListener('input',syncLabels));
cEndless.addEventListener('change',syncLabels);
syncLabels();

export function startGame(){
  S.lockTime=+sLock.value;
  S.beamR=(+sBeam.value)/2;
  S.endless=cEndless.checked;
  S.timeLimit=(+sTime.value)*60;
  S.timeLeft=S.timeLimit;
  S.score=0;scoreV.textContent='0';
  S.taken=0;S.tally={};specV.textContent='0 taken';
  resetBuffs();
  Special.charge=1;Special.active=false;input.spHeld=false;
  S.energy=1;S.vy=0;saucer.rotation.set(0,0,0);
  applyWorld(S.world);
  S.crystals=0;S.missionIdx=0;S.crashReason=null;
  S.isDay=true;S.dayF=1;S.cloak=false;S.warnLevel=0;
  resetMeteors();
  resetGeysers();
  resetLightning();
  S.vel.set(0,0,0);saucer.position.set(0,40,0);
  reseed();clearWorld();updateChunks(0,0);
  updateMissionHUD();
  Story.reset();
  if(S.storyMode)Story.begin(S.world);
  applyWeather._last=null;weather.timer=0;weather.biome='plains';applyWeather('clear');
  S.state='playing';
  startScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  document.getElementById('pauseScreen').classList.add('hidden');
  hud.classList.add('on');
  Music.set(TRACK_BY_WORLD[S.world]||'drift');
  if(S.world==='mars')setTimeout(()=>banner('☄ RED WASTE — BEWARE METEOR SHOWERS'),900);
  if(S.world==='moon')setTimeout(()=>banner('☄ MARE UMBRA — BEWARE DUST GEYSERS'),900);
}
export function endGame(reason){
  S.state='over';
  BeamSFX.stop();S.prevBeam=false;
  hud.classList.remove('on');
  document.getElementById('finalScore').textContent=S.score;
  const bk=document.getElementById('bkList');
  const names=Object.keys(S.tally);
  bk.innerHTML=names.length?names.map(n=>'<div class="bk"><span>'+n+' ×'+S.tally[n].c+'</span><span>'+(S.tally[n].c*S.tally[n].p)+' pts</span></div>').join('')
    :'<div class="bk"><span>nothing taken</span><span>—</span></div>';
  const msg=S.taken===0?'The herd out-guessed you. Tighten those predictions.'
    :S.taken<5?'A modest haul. The mothership expects more.'
    :S.taken<15?'Solid field work, operator.'
    :'Exemplary. The archives grow rich with specimens.';
  document.getElementById('overMsg').textContent=
    reason==='meteor'?'A meteor tore through the hull. Critical damage. The dust settles over the wreck.'
    :reason==='geyser'?'A dust geyser erupted straight into the hull. The ship is buried in regolith.'
    :reason==='lightning'?'A bolt of lightning split the hull. The storm swallows the wreck.'
    :(reason==='crash'||reason==='energy')?'The reactor died mid-air. The ship is part of the landscape now.':msg;
  overScreen.classList.remove('hidden');
}
document.getElementById('startBtn').addEventListener('click',startGame);
document.getElementById('againBtn').addEventListener('click',startGame);
document.getElementById('settingsBtn').addEventListener('click',()=>{
  overScreen.classList.add('hidden');startScreen.classList.remove('hidden');S.state='menu';
});

/* ---------- pause / navigation ---------- */
const pauseScreen=document.getElementById('pauseScreen');
export function pauseGame(){ if(S.state!=='playing')return; S.state='paused'; BeamSFX.stop();S.prevBeam=false; pauseScreen.classList.remove('hidden'); }
function resumeGame(){ if(S.state!=='paused')return; S.state='playing'; pauseScreen.classList.add('hidden'); }
function toMenu(){ pauseScreen.classList.add('hidden'); overScreen.classList.add('hidden');
  startScreen.classList.remove('hidden'); hud.classList.remove('on'); S.state='menu';
  BeamSFX.stop();S.prevBeam=false;Music.set('off');Story.reset(); }
document.getElementById('pauseBtn').addEventListener('click',pauseGame);
spBtn.addEventListener('pointerdown',e=>{e.preventDefault();input.spHeld=true;});
spBtn.addEventListener('contextmenu',e=>e.preventDefault());
document.getElementById('resumeBtn').addEventListener('click',resumeGame);
document.getElementById('restartBtn').addEventListener('click',startGame);
document.getElementById('pSettingsBtn').addEventListener('click',toMenu);
document.getElementById('quitBtn').addEventListener('click',toMenu);
addEventListener('keydown',e=>{ if(e.key==='Escape'){
  if(S.state==='playing')pauseGame(); else if(S.state==='paused')resumeGame(); }});

/* ---------- music volume (tracks are per-world now) ---------- */
const sMusicVol=document.getElementById('sMusicVol');
Music.vol=+sMusicVol.value/100;
sMusicVol.addEventListener('input',()=>Music.setVolume(+sMusicVol.value/100));

/* ---------- world + reactor + mode selection ---------- */
document.getElementById('segWorld').addEventListener('click',e=>{
  const b=e.target.closest('[data-w]');if(!b)return;
  S.world=b.dataset.w;
  document.querySelectorAll('#segWorld [data-w]').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('oWorld').textContent=WORLD_CFG[S.world].label;
  if(S.state==='menu'){applyWorld(S.world);clearWorld();}
});
document.getElementById('segEnergy').addEventListener('click',e=>{
  const b=e.target.closest('[data-e]');if(!b)return;
  S.energyMode=b.dataset.e;
  document.querySelectorAll('#segEnergy [data-e]').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('oEnergy').textContent=S.energyMode==='drain'?'Drainable':'Infinite';
});
document.getElementById('segMode').addEventListener('click',e=>{
  const b=e.target.closest('[data-m]');if(!b)return;
  S.storyMode=(b.dataset.m==='story');
  document.querySelectorAll('#segMode [data-m]').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('oMode').textContent=S.storyMode?'Story':'Exploration';
});
document.getElementById('stBtn').addEventListener('click',storyProceed);

/* ---------- landing screen: login (under construction) / play for free ---------- */
document.getElementById('loginBtn').addEventListener('click',()=>{
  document.getElementById('landingScreen').classList.add('hidden');
  document.getElementById('constructScreen').classList.remove('hidden');
});
document.getElementById('backBtn').addEventListener('click',()=>{
  document.getElementById('constructScreen').classList.add('hidden');
  document.getElementById('landingScreen').classList.remove('hidden');
});
document.getElementById('freeBtn').addEventListener('click',()=>{
  document.getElementById('landingScreen').classList.add('hidden');
  document.getElementById('constructScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});

/* single tuned graphics mode — auto-drops to basic only if the GPU rejects post-fx */
setFX('full');

/* high-detail opt-in (mobile only — desktop already loads everything) */
if(env.LOW_END){
  const row=document.getElementById('hiRow');if(row)row.style.display='flex';
}
document.getElementById('cHiDetail').addEventListener('change',e=>{
  if(e.target.checked && !env.HI_DETAIL){
    env.HI_DETAIL=true;
    e.target.disabled=true;
    const lbl=e.target.parentElement;
    const txt=lbl.childNodes[lbl.childNodes.length-1];
    if(txt)txt.textContent=' high detail — loading models…';
    // block Play until every model + texture is in, so the run starts fully equipped
    const btn=document.getElementById('startBtn');
    const note=document.getElementById('loadNote');
    if(btn)btn.disabled=true;
    if(note)note.textContent='loading high-detail assets…';
    loadAllAssets().then(()=>{
      if(txt)txt.textContent=' high detail — models loaded ✓';
      const sm=spawnModel('saucer');
      if(sm){(saucer.userData.procBody||[]).forEach(o=>o.visible=false);
        sm.name="saucerModel";saucer.add(sm);}   /* keep rim lights for night blink */
      if(btn)btn.disabled=false;
      if(note)note.textContent='ready';
    });
  }
});
