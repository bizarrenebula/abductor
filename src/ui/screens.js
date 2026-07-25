/* =========================================================================
   SCREENS + UI WIRING — settings sliders, start/restart/end/pause/menu flow,
   the landing (login/free) screens, world/reactor/mode pickers, music volume,
   and the high-detail asset opt-in. Owns startGame() and endGame().
   ========================================================================= */
import { S } from '../core/state.js';
import { HOVER_BASE } from '../core/constants.js';
import { env, HAS_TOUCH, TOUCH_ONLY } from '../core/env.js';
import { input, resetInputTouch, ACTIONS, binds, keyLabel, beginCapture, cancelCapture, resetBinds,
         touchCfg, setTouch, resetTouch } from '../core/input.js';
import { reseed } from '../world/noise.js';
import { applyWorld, World, WORLD_CFG } from '../world/world-config.js';
import { clearWorld, updateChunks } from '../world/chunks.js';
import { applyWeather, weather } from '../world/weather.js';
import { saucer } from '../systems/saucer.js';
import { Special } from '../systems/special.js';
import { resetBuffs } from '../systems/buffs.js';
import { Upgrades } from '../systems/upgrades.js';
import { spawnUpgradeItems, clearUpgradeItems } from '../entities/upgradeItems.js';
import { CropCircles } from '../systems/cropcircles.js';
import { Clouds } from '../systems/clouds.js';
import { Fireflies } from '../systems/fireflies.js';
import { ValleyFog } from '../systems/valleyfog.js';
import { Birds } from '../systems/birds.js';
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
const oExtra=document.getElementById('oExtra');   // "Tuning" sector chip summary

/* opts.keep — "run it back" after a crash keeps the ship's earned upgrades
   (the save point survives a crash / disaster, per spec). Any other entry
   point (menu Play, restart, settings) passes no opts and starts grounded.
   Called directly as a click handler too, where the arg is an Event → no .keep. */
export function startGame(opts){
  const keepUpgrades=!!(opts&&opts.keep===true);
  // Beam lock time, beam diameter and the survey window used to be tunable in
  // settings; they're now fixed at the defaults declared in core/state.js.
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
  CropCircles.reset();
  Clouds.spawnField(saucer.position.x,saucer.position.z);
  Fireflies.reset(saucer.position.x,saucer.position.z);
  ValleyFog.reset(saucer.position.x,saucer.position.z);
  Birds.reset(saucer.position.x,saucer.position.z);
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
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.exploreShort');
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
// per-sector: the highlight wedge's conic start angle + the panel it opens.
// Four 90° quadrants: World (top), Mode (right), How to play (bottom), Tuning (left).
const SECTORS={ world:{wedge:315,pan:'panWorld'}, mode:{wedge:45,pan:'panMode'},
                howto:{wedge:135,pan:'panHowto'}, extra:{wedge:225,pan:'panExtra'} };

// Which sector a screen point falls in, by angle from the saucer centre
// (atan2: 0°=east, +90°=south). Top=world, right=mode, bottom=howto, left=extra.
function sectorAt(x,y){
  const r=saucerMenu.getBoundingClientRect();
  const a=Math.atan2(y-(r.top+r.height/2),x-(r.left+r.width/2))*180/Math.PI;
  if(a>=-135&&a<-45)return 'world';
  if(a>=-45&&a<45)return 'mode';
  if(a>=45&&a<135)return 'howto';
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
  if(sec==='howto'){renderKeybinds();renderTouchControls();}   // fresh control rows when opened
  highlight(sec);
}
function closeSaucerPanel(ready){
  cancelCapture();
  saucerPanel.classList.add('hidden');
  saucerMenu.classList.remove('editing');
  highlight(null);
  if(ready)saucerCore.classList.add('ready');   // pulse PLAY once something's been confirmed
}

/* ---------- key-binding editor (How-to-play sector) ---------- */
const keybindsEl=document.getElementById('keybinds');
function renderKeybinds(){
  if(!keybindsEl)return;
  keybindsEl.innerHTML='';
  for(const a of ACTIONS){
    const row=document.createElement('div');row.className='kb-row';
    const lab=document.createElement('span');lab.className='kb-act';lab.textContent=t('act.'+a.id);
    const btn=document.createElement('button');btn.className='kb-key';btn.dataset.act=a.id;
    btn.textContent=keyLabel(binds[a.id]);
    btn.addEventListener('click',()=>{
      keybindsEl.querySelectorAll('.kb-key.listening').forEach(x=>{
        x.classList.remove('listening');x.textContent=keyLabel(binds[x.dataset.act]);});
      btn.classList.add('listening');btn.textContent=t('kb.press');
      beginCapture(a.id,()=>renderKeybinds());   // next keypress rebinds, then redraw
    });
    row.appendChild(lab);row.appendChild(btn);keybindsEl.appendChild(row);
  }
}
const bindResetBtn=document.getElementById('bindReset');
if(bindResetBtn)bindResetBtn.addEventListener('click',()=>{cancelCapture();resetBinds();renderKeybinds();});
renderKeybinds();

/* Touch (joystick) controls — the mobile counterpart to the key binds. Lets the
   player choose which stick flies vs slides and invert any axis; there are no
   keys to press on a phone, so this is what "binding your controls" means there. */
const touchbindsEl=document.getElementById('touchbinds');
function renderTouchControls(){
  if(!touchbindsEl)return;
  touchbindsEl.innerHTML='';
  // which physical stick FLIES (forward/back + turn); the other slides
  const r0=document.createElement('div');r0.className='kb-row';
  const l0=document.createElement('span');l0.className='kb-act';l0.textContent=t('touch.flyStick');
  const seg=document.createElement('div');seg.className='kb-seg';
  [['L','touch.left'],['R','touch.right']].forEach(([side,key])=>{
    const b=document.createElement('button');b.textContent=t(key);
    const flyLeft=touchCfg.swap;                         // swap => LEFT stick flies
    b.classList.toggle('on', side==='L'?flyLeft:!flyLeft);
    b.addEventListener('click',()=>{ setTouch('swap',side==='L'); renderTouchControls(); });
    seg.appendChild(b);
  });
  r0.appendChild(l0);r0.appendChild(seg);touchbindsEl.appendChild(r0);
  // per-axis invert toggles
  for(const [k,lab] of [['invFwd','touch.invFwd'],['invTurn','touch.invTurn'],
                        ['invStrafe','touch.invStrafe'],['invClimb','touch.invClimb']]){
    const row=document.createElement('div');row.className='kb-row';
    const l=document.createElement('span');l.className='kb-act';l.textContent=t(lab);
    const tg=document.createElement('button');tg.className='tg'+(touchCfg[k]?' on':'');
    tg.textContent=t(touchCfg[k]?'touch.on':'touch.off');
    tg.addEventListener('click',()=>{ setTouch(k,!touchCfg[k]); renderTouchControls(); });
    row.appendChild(l);row.appendChild(tg);touchbindsEl.appendChild(row);
  }
}
const touchResetBtn=document.getElementById('touchReset');
if(touchResetBtn)touchResetBtn.addEventListener('click',()=>{resetTouch();renderTouchControls();});
// Show the panel that fits the device: joystick config on touchscreens, and hide
// the keyboard key-binds when there's no keyboard at all (a pure touch device).
if(HAS_TOUCH){ const tw=document.getElementById('touchWrap'); if(tw)tw.style.display=''; }
if(TOUCH_ONLY){ const kw=document.getElementById('keysWrap'); if(kw)kw.style.display='none'; }
renderTouchControls();
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
  const gfxLabel=t(S.gfx==='full'?'gfx.cinematic':'gfx.basic');
  if(oGraphics)oGraphics.textContent=gfxLabel;
  if(oExtra)oExtra.textContent=gfxLabel;                 // Tuning sector chip summary
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
  document.getElementById('oWorld').textContent=t('world.'+S.world);
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.exploreShort');
  document.getElementById('oEnergy').textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf');
  if(oGraphics)oGraphics.textContent=t(S.gfx==='full'?'gfx.cinematic':'gfx.basic');
  if(oExtra)oExtra.textContent=t(S.gfx==='full'?'gfx.cinematic':'gfx.basic');
  if(oMusicSrc)oMusicSrc.textContent=t(S.musicMode==='procedural'?'music.procedural':'music.soundtrack');
  if(specV)specV.textContent=t('hud.taken',{n:S.taken});
  renderKeybinds();renderTouchControls(); // control labels are localized
  Story._last=''; if(Story.active)Story.hud();
});
