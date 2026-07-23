/* =========================================================================
   SCREENS + UI WIRING — settings sliders, start/restart/end/pause/menu flow,
   the landing (login/free) screens, world/reactor/mode pickers, music volume,
   and the high-detail asset opt-in. Owns startGame() and endGame().
   ========================================================================= */
import { S } from '../core/state.js';
import { HOVER_BASE } from '../core/constants.js';
import { env } from '../core/env.js';
import { input, resetInputTouch } from '../core/input.js';
import { reseed } from '../world/noise.js';
import { applyWorld, World, WORLD_CFG } from '../world/world-config.js';
import { clearWorld, updateChunks } from '../world/chunks.js';
import { applyWeather, weather } from '../world/weather.js';
import { saucer } from '../systems/saucer.js';
import { Special } from '../systems/special.js';
import { resetBuffs } from '../systems/buffs.js';
import { Upgrades } from '../systems/upgrades.js';
import { spawnUpgradeItems, clearUpgradeItems } from '../entities/upgradeItems.js';
import { updateMissionHUD } from '../systems/missions.js';
import { resetMeteors } from '../hazards/meteors.js';
import { resetGeysers } from '../hazards/geysers.js';
import { resetLightning } from '../hazards/lightning.js';
import { Story, storyProceed } from '../story/story.js';
import { Music, TRACK_BY_WORLD } from '../audio/music.js';
import { BeamSFX } from '../audio/sfx.js';
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
const oExtra=document.getElementById('oExtra');   // "Tuning" sector chip summary

function syncLabels(){
  oLock.textContent=(+sLock.value===0)?t('unit.instant'):t('unit.s',{n:(+sLock.value).toFixed(2)});
  oBeam.textContent=t('unit.m',{n:sBeam.value});
  oTime.textContent=cEndless.checked?t('unit.endless'):t('unit.min',{n:sTime.value});
  sTime.disabled=cEndless.checked;
  if(oExtra)oExtra.textContent=cEndless.checked?t('unit.endless'):t('unit.min',{n:sTime.value});
}
[sLock,sBeam,sTime].forEach(el=>el.addEventListener('input',syncLabels));
cEndless.addEventListener('change',syncLabels);
syncLabels();

/* opts.keep — "run it back" after a crash keeps the ship's earned upgrades
   (the save point survives a crash / disaster, per spec). Any other entry
   point (menu Play, restart, settings) passes no opts and starts grounded.
   Called directly as a click handler too, where the arg is an Event → no .keep. */
export function startGame(opts){
  const keepUpgrades=!!(opts&&opts.keep===true);
  S.lockTime=+sLock.value;
  S.beamR=(+sBeam.value)/2;
  S.endless=cEndless.checked;
  S.timeLimit=(+sTime.value)*60;
  S.timeLeft=S.timeLimit;
  S.score=0;scoreV.textContent='0';
  S.taken=0;S.tally={};specV.textContent=t('hud.taken',{n:0});
  resetBuffs();
  Special.charge=1;Special.active=false;input.spHeld=false;resetInputTouch();
  S.energy=1;S.vy=0;saucer.rotation.set(0,0,0);
  S.yaw=0;S.yawV=0;S.hoverV=0;S.safePos.set(0,40,0);S.safeYaw=0;S.safeT=0;
  applyWorld(S.world);
  S.crystals=0;S.missionIdx=0;S.crashReason=null;
  S.isDay=true;S.dayF=1;S.cloak=false;S.warnLevel=0;S.hover=HOVER_BASE;S.agl=HOVER_BASE;S.beamStr=1;
  resetMeteors();
  resetGeysers();
  resetLightning();
  S.vel.set(0,0,0);saucer.position.set(0,40,0);
  reseed();clearWorld();updateChunks(0,0);
  // Ship upgrades: keep them through a "run it back" after a crash, otherwise
  // start grounded. Then scatter whichever field parts aren't installed yet.
  if(keepUpgrades)Upgrades.restore(); else Upgrades.reset();
  spawnUpgradeItems();
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
/* Story-mode respawn: a fatal hit costs the current mission's progress, not the
   whole run. The ship reappears at its last safe point, in-progress quest items
   return to their original spots (Story.respawnStage), and nearby hazards are
   cleared so the player isn't killed again on the same frame. */
export function respawn(){
  S.state='playing';
  BeamSFX.stop();S.prevBeam=false;S.beamPower=0;
  S.cloak=false;S.crashReason=null;S.warnLevel=0;
  S.vel.set(0,0,0);S.vy=0;S.yawV=0;S.hoverV=0;
  S.hover=HOVER_BASE;S.agl=HOVER_BASE;
  S.yaw=S.safeYaw||0;
  saucer.rotation.set(0,S.yaw,0);
  saucer.position.set(S.safePos.x,S.safePos.y,S.safePos.z);
  S.energy=Math.max(S.energy,0.6);          // a fresh half-tank so an energy death isn't a loop
  resetMeteors();resetGeysers();resetLightning();
  Music.set(TRACK_BY_WORLD[S.world]||'drift');   // an energy death silences the reactor track; bring it back
  Story.respawnStage();
  banner(t('banner.respawn'));
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
document.getElementById('startBtn').addEventListener('click',()=>startGame());
// "run it back" continues the same ship — a crash never costs your upgrades.
document.getElementById('againBtn').addEventListener('click',()=>startGame({keep:true}));
document.getElementById('settingsBtn').addEventListener('click',()=>{
  overScreen.classList.add('hidden');startScreen.classList.remove('hidden');S.state='menu';
  resetSaucerMenu();
});

/* ---------- pause / navigation ---------- */
const pauseScreen=document.getElementById('pauseScreen');
export function pauseGame(){ if(S.state!=='playing')return; S.state='paused'; BeamSFX.stop();S.prevBeam=false; pauseScreen.classList.remove('hidden'); }
function resumeGame(){ if(S.state!=='paused')return; S.state='playing'; pauseScreen.classList.add('hidden'); }
function toMenu(){ pauseScreen.classList.add('hidden'); overScreen.classList.add('hidden');
  startScreen.classList.remove('hidden'); hud.classList.remove('on'); S.state='menu';
  BeamSFX.stop();S.prevBeam=false;Music.set('off');Story.reset();clearUpgradeItems();resetSaucerMenu(); }
document.getElementById('pauseBtn').addEventListener('click',pauseGame);
// The floating PULL button (shown by special.js only when charged) is a
// press-and-hold trigger. Track the pressing pointer so the pull stops when
// THAT finger lifts — even after the button hides itself mid-drain, and even
// while the other thumb keeps flying. Listening on the window (not the button)
// guarantees we still catch the release once the button is hidden.
let spPtr=null;
spBtn.addEventListener('pointerdown',e=>{e.preventDefault();input.spHeld=true;spPtr=e.pointerId;});
const spRelease=e=>{ if(e.pointerId===spPtr){input.spHeld=false;spPtr=null;} };
addEventListener('pointerup',spRelease);
addEventListener('pointercancel',spRelease);
spBtn.addEventListener('contextmenu',e=>e.preventDefault());
document.getElementById('resumeBtn').addEventListener('click',resumeGame);
document.getElementById('restartBtn').addEventListener('click',startGame);
document.getElementById('pSettingsBtn').addEventListener('click',toMenu);
document.getElementById('quitBtn').addEventListener('click',toMenu);
addEventListener('keydown',e=>{ if(e.key==='Escape'){
  if(S.state==='playing')pauseGame(); else if(S.state==='paused')resumeGame(); }});

/* ---------- music volume ---------- */
const sMusicVol=document.getElementById('sMusicVol');
Music.vol=+sMusicVol.value/100;
sMusicVol.addEventListener('input',()=>Music.setVolume(+sMusicVol.value/100));

/* ---------- music source: bundled orchestral Soundtrack vs procedural synth ---------- */
const segMusic=document.getElementById('segMusic');
const oMusicSrc=document.getElementById('oMusicSrc');
export function applyMusicSrc(mode){
  S.musicMode=(mode==='procedural')?'procedural':'soundtrack';
  Music.setMode(S.musicMode);
  if(segMusic)segMusic.querySelectorAll('[data-ms]').forEach(x=>x.classList.toggle('on',x.dataset.ms===S.musicMode));
  if(oMusicSrc)oMusicSrc.textContent=t(S.musicMode==='procedural'?'music.procedural':'music.soundtrack');
  try{localStorage.setItem('abductor.music',S.musicMode);}catch(e){}
}
if(segMusic)segMusic.addEventListener('click',e=>{const b=e.target.closest('[data-ms]');if(b)applyMusicSrc(b.dataset.ms);});
let _ms0=null; try{_ms0=localStorage.getItem('abductor.music');}catch(e){}
if(_ms0!=='soundtrack'&&_ms0!=='procedural')_ms0='soundtrack';
// set the source before any track starts (Music.setMode no-ops until a track plays)
Music.mode=_ms0; S.musicMode=_ms0;
if(segMusic)segMusic.querySelectorAll('[data-ms]').forEach(x=>x.classList.toggle('on',x.dataset.ms===_ms0));
if(oMusicSrc)oMusicSrc.textContent=t(_ms0==='procedural'?'music.procedural':'music.soundtrack');

/* ---------- world + reactor + mode selection ---------- */
document.getElementById('segWorld').addEventListener('click',e=>{
  const b=e.target.closest('[data-w]');if(!b)return;
  if(b.disabled||b.classList.contains('locked'))return;   // Moon/Mars not playable yet
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

/* ---------- radial "saucer" setup menu ----------
   The setup screen is a saucer seen from above: three sectors on the rim
   (World / Mode / Tuning) and a live core in the middle. Slide a finger around
   the rim and release on a sector — its controls pop up in the core. A small
   "confirm" button closes the panel and turns the core back into a PLAY button;
   pick another sector to tweak more, confirm again, then press PLAY. */
const saucerMenu=document.getElementById('saucerMenu');
const saucerHit=document.getElementById('saucerHit');
const saucerHi=document.getElementById('saucerHi');
const saucerCore=document.getElementById('saucerCore');
const saucerPanel=document.getElementById('saucerPanel');
// per-sector: the highlight wedge's conic start angle + the panel it opens
const SECTORS={ world:{wedge:300,pan:'panWorld'}, mode:{wedge:60,pan:'panMode'}, extra:{wedge:180,pan:'panExtra'} };

// Which sector a screen point falls in, by angle from the saucer centre
// (atan2: 0°=east, +90°=south). Top third = world, right = mode, left = extra.
function sectorAt(x,y){
  const r=saucerMenu.getBoundingClientRect();
  const a=Math.atan2(y-(r.top+r.height/2),x-(r.left+r.width/2))*180/Math.PI;
  if(a>=-150&&a<-30)return 'world';
  if(a>=-30&&a<90)return 'mode';
  return 'extra';
}
function highlight(sec){
  if(sec)saucerHi.style.setProperty('--a',SECTORS[sec].wedge+'deg');
  saucerHi.classList.toggle('on',!!sec);
  saucerMenu.querySelectorAll('.sector').forEach(el=>el.classList.toggle('hot',el.dataset.sector===sec));
}
function openSector(sec){
  saucerPanel.querySelectorAll('.pan').forEach(p=>p.classList.toggle('on',p.id===SECTORS[sec].pan));
  saucerPanel.classList.remove('hidden');
  saucerMenu.classList.add('editing');   // hides the core PLAY until confirmed
  saucerPanel.scrollTop=0;
  highlight(sec);
}
function closeSaucerPanel(ready){
  saucerPanel.classList.add('hidden');
  saucerMenu.classList.remove('editing');
  highlight(null);
  if(ready)saucerCore.classList.add('ready');   // pulse PLAY once something's been confirmed
}
function resetSaucerMenu(){ closeSaucerPanel(false); saucerCore.classList.remove('ready'); }

let sDrag=false;
saucerHit.addEventListener('pointerdown',e=>{
  e.preventDefault(); sDrag=true;
  try{saucerHit.setPointerCapture(e.pointerId);}catch(_){}
  highlight(sectorAt(e.clientX,e.clientY));
});
saucerHit.addEventListener('pointermove',e=>{ if(sDrag)highlight(sectorAt(e.clientX,e.clientY)); });
saucerHit.addEventListener('pointerup',e=>{ if(!sDrag)return; sDrag=false; openSector(sectorAt(e.clientX,e.clientY)); });
saucerHit.addEventListener('pointercancel',()=>{ sDrag=false; if(saucerPanel.classList.contains('hidden'))highlight(null); });
document.getElementById('confirmBtn').addEventListener('click',()=>closeSaucerPanel(true));

/* The splash now hands straight to the setup screen — no landing gate. */

/* ---------- graphics quality toggle (Tuning sector) ----------
   Cinematic = bloom + colour grade + IBL reflections; Basic = direct render.
   Default follows the device (desktop → Cinematic, mobile → Basic), overridable
   here and remembered. renderFrame still auto-drops to Basic if a GPU rejects
   post-fx mid-run. */
const segGfx=document.getElementById('segGfx');
const oGraphics=document.getElementById('oGraphics');
export function applyGfx(mode){
  S.gfx=(mode==='full')?'full':'basic';
  setFX(S.gfx==='full'?'full':'basic');
  if(segGfx)segGfx.querySelectorAll('[data-g]').forEach(x=>x.classList.toggle('on',x.dataset.g===S.gfx));
  if(oGraphics)oGraphics.textContent=t(S.gfx==='full'?'gfx.cinematic':'gfx.basic');
  try{localStorage.setItem('abductor.gfx',S.gfx);}catch(e){}
}
if(segGfx)segGfx.addEventListener('click',e=>{const b=e.target.closest('[data-g]');if(b)applyGfx(b.dataset.g);});
let _gfx0=null; try{_gfx0=localStorage.getItem('abductor.gfx');}catch(e){}
if(_gfx0!=='full'&&_gfx0!=='basic')_gfx0=env.LOW_END?'basic':'full';
applyGfx(_gfx0);

/* Asset quality is decided by the device in core/env.js — no toggle here. */

/* ---------- language switch (landing + settings) ---------- */
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.getAttribute('data-lang'))));
onLang(()=>{
  // re-render dynamic menu bits that aren't plain [data-i18n] elements
  syncLabels();
  document.getElementById('oWorld').textContent=t('world.'+S.world);
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.explore');
  document.getElementById('oEnergy').textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf');
  if(oGraphics)oGraphics.textContent=t(S.gfx==='full'?'gfx.cinematic':'gfx.basic');
  if(oMusicSrc)oMusicSrc.textContent=t(S.musicMode==='procedural'?'music.procedural':'music.soundtrack');
  if(specV)specV.textContent=t('hud.taken',{n:S.taken});
  Story._last=''; if(Story.active)Story.hud();
});
