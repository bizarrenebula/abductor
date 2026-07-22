/* =========================================================================
   SCREENS + UI WIRING — settings sliders, start/restart/end/pause/menu flow,
   the landing (login/free) screens, world/reactor/mode pickers, music volume,
   and the high-detail asset opt-in. Owns startGame() and endGame().
   ========================================================================= */
import { env } from '../core/env.js';
import { S } from '../core/state.js';
import { HOVER_BASE } from '../core/constants.js';
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
import { t, setLang, onLang } from '../i18n.js';

const startScreen=document.getElementById('startScreen');
const overScreen=document.getElementById('overScreen');
const hud=document.getElementById('hud');
const sLock=document.getElementById('sLock'),oLock=document.getElementById('oLock');
const sBeam=document.getElementById('sBeam'),oBeam=document.getElementById('oBeam');
const sTime=document.getElementById('sTime'),oTime=document.getElementById('oTime');
const cEndless=document.getElementById('cEndless');

function syncLabels(){
  oLock.textContent=(+sLock.value===0)?t('unit.instant'):t('unit.s',{n:(+sLock.value).toFixed(2)});
  oBeam.textContent=t('unit.m',{n:sBeam.value});
  oTime.textContent=cEndless.checked?t('unit.endless'):t('unit.min',{n:sTime.value});
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
  S.taken=0;S.tally={};specV.textContent=t('hud.taken',{n:0});
  resetBuffs();
  Special.charge=1;Special.active=false;input.spHeld=false;
  S.energy=1;S.vy=0;saucer.rotation.set(0,0,0);
  applyWorld(S.world);
  S.crystals=0;S.missionIdx=0;S.crashReason=null;
  S.isDay=true;S.dayF=1;S.cloak=false;S.warnLevel=0;S.hover=HOVER_BASE;S.agl=HOVER_BASE;S.beamStr=1;
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
  if(S.world==='mars')setTimeout(()=>banner(t('banner.mars')),900);
  if(S.world==='moon')setTimeout(()=>banner(t('banner.moon')),900);
}
export function endGame(reason){
  S.state='over';
  BeamSFX.stop();S.prevBeam=false;
  hud.classList.remove('on');
  document.getElementById('finalScore').textContent=S.score;
  const bk=document.getElementById('bkList');
  const names=Object.keys(S.tally);
  bk.innerHTML=names.length?names.map(n=>'<div class="bk"><span>'+t('creature.'+n)+' ×'+S.tally[n].c+'</span><span>'+(S.tally[n].c*S.tally[n].p)+' pts</span></div>').join('')
    :'<div class="bk"><span>'+t('over.nothing')+'</span><span>—</span></div>';
  const msg=S.taken===0?t('over.msg.none')
    :S.taken<5?t('over.msg.few')
    :S.taken<15?t('over.msg.some')
    :t('over.msg.many');
  document.getElementById('overMsg').textContent=
    reason==='meteor'?t('over.msg.meteor')
    :reason==='geyser'?t('over.msg.geyser')
    :reason==='lightning'?t('over.msg.lightning')
    :reason==='impact'?t('over.msg.impact')
    :(reason==='crash'||reason==='energy')?t('over.msg.crash'):msg;
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
  document.getElementById('oWorld').textContent=t('world.'+S.world);
  if(S.state==='menu'){applyWorld(S.world);clearWorld();}
});
document.getElementById('segEnergy').addEventListener('click',e=>{
  const b=e.target.closest('[data-e]');if(!b)return;
  S.energyMode=b.dataset.e;
  document.querySelectorAll('#segEnergy [data-e]').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('oEnergy').textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf');
});
document.getElementById('segMode').addEventListener('click',e=>{
  const b=e.target.closest('[data-m]');if(!b)return;
  S.storyMode=(b.dataset.m==='story');
  document.querySelectorAll('#segMode [data-m]').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.explore');
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
    if(txt)txt.textContent=t('hi.loading');
    // block Play until every model + texture is in, so the run starts fully equipped
    const btn=document.getElementById('startBtn');
    const note=document.getElementById('loadNote');
    if(btn)btn.disabled=true;
    if(note)note.textContent=t('loadNote.loadingHi');
    loadAllAssets().then(()=>{
      if(txt)txt.textContent=t('hi.loaded');
      const sm=spawnModel('saucer');
      if(sm){(saucer.userData.procBody||[]).forEach(o=>o.visible=false);
        sm.name="saucerModel";saucer.add(sm);}   /* keep rim lights for night blink */
      if(btn)btn.disabled=false;
      if(note)note.textContent=t('loadNote.ready');
    });
  }
});

/* ---------- language switch (landing + settings) ---------- */
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.getAttribute('data-lang'))));
onLang(()=>{
  // re-render dynamic menu bits that aren't plain [data-i18n] elements
  syncLabels();
  document.getElementById('oWorld').textContent=t('world.'+S.world);
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.explore');
  document.getElementById('oEnergy').textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf');
  if(specV)specV.textContent=t('hud.taken',{n:S.taken});
  Story._last=''; if(Story.active)Story.hud();
});
