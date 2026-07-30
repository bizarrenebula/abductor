/* =========================================================================
   SCREENS + UI WIRING — settings sliders, start/restart/end/pause/menu flow,
   the landing (login/free) screens, world/reactor/mode pickers, music volume,
   and the high-detail asset opt-in. Owns startGame() and endGame().
   ========================================================================= */
import { S } from '../core/state.js';
import { HOVER_BASE } from '../core/constants.js';
import { env, HAS_TOUCH, TOUCH_ONLY } from '../core/env.js';
import { input, resetInputTouch, ACTIONS, binds, keyLabel, beginCapture, cancelCapture, resetBinds,
         AXES, FUNCS, touchMap, touchInv, setTouchMap, setTouchInv, resetTouch } from '../core/input.js';
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
import { resetDestruction } from '../systems/destruction.js';
import { Clouds } from '../systems/clouds.js';
import { Fireflies } from '../systems/fireflies.js';
import { ValleyFog } from '../systems/valleyfog.js';
import { Birds } from '../systems/birds.js';
import { updateMissionHUD } from '../systems/missions.js';
import { resetMeteors } from '../hazards/meteors.js';
import { resetGeysers } from '../hazards/geysers.js';
import { resetLightning } from '../hazards/lightning.js';
import { Story, storyProceed } from '../story/story.js';
import { Tutorial } from '../systems/tutorial.js';
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
  Tutorial.stop();                 // clear any prior tutorial state on every fresh run
  // No time limit any more — the run is open-ended.
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
  reseed();clearWorld();resetDestruction();updateChunks(0,0);
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
// Play offers the guided tutorial first; either choice starts the game, and
// "Show me" then kicks off the walkthrough in the freshly-started world.
document.getElementById('startBtn').addEventListener('click',()=>{
  Tutorial.prompt(()=>{ startGame(); Tutorial.start(); }, ()=>startGame());
});
/* Injected so the tutorial's closing modal can restart the run or switch to
   Story mode — screens.js owns startGame, so handing the callbacks down keeps
   the import one-way (screens -> tutorial). */
Tutorial.replayRun=()=>{ startGame(); Tutorial.start(); };
Tutorial.toMenu=()=>toMenu();
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

/* Music / soundtrack removed — only in-game SFX remain (see audio/music.js). */

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
  syncTuningChip();
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
// per-sector: the highlight wedge's conic start angle (= sector centre − 60°) +
// the panel it opens. Three equal 120° sectors now that World is gone:
// Mode (top, centre conic 0°), How to play (lower-right, 120°), Tuning (lower-left, 240°).
const SECTORS={ mode:{wedge:300,pan:'panMode'},
                howto:{wedge:60,pan:'panHowto'}, extra:{wedge:180,pan:'panExtra'} };

// Which sector a screen point falls in, by angle from the saucer centre
// (atan2: 0°=east, +90°=south/down, −90°=north/up). Three 120° wedges: Mode spans
// the top, How to play the lower-right, Tuning the lower-left.
function sectorAt(x,y){
  const r=saucerMenu.getBoundingClientRect();
  const a=Math.atan2(y-(r.top+r.height/2),x-(r.left+r.width/2))*180/Math.PI;
  if(a>=-150&&a<-30)return 'mode';   // top
  if(a>=-30&&a<90)return 'howto';    // lower-right
  return 'extra';                     // lower-left (90..180 and -180..-150)
}
function highlight(sec){
  const ok=sec&&SECTORS[sec];
  if(ok)saucerHi.style.setProperty('--a',SECTORS[sec].wedge+'deg');
  saucerHi.classList.toggle('on',!!ok);
  saucerMenu.querySelectorAll('.sector').forEach(el=>el.classList.toggle('hot',ok&&el.dataset.sector===sec));
}
function openSector(sec){
  if(!sec||!SECTORS[sec])return;    // e.g. the (now hidden) world sector — do nothing
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
  // one row per physical axis: assign a movement function + optional invert
  for(const ax of AXES){
    const row=document.createElement('div');row.className='kb-row';
    const l=document.createElement('span');l.className='kb-act';l.textContent=t('axis.'+ax);
    const sel=document.createElement('select');sel.className='kb-sel';
    for(const fn of [...FUNCS,'']){
      const o=document.createElement('option');o.value=fn;
      o.textContent=t(fn?('func.'+fn):'func.none');
      if(touchMap[ax]===fn)o.selected=true;
      sel.appendChild(o);
    }
    sel.addEventListener('change',()=>{ setTouchMap(ax,sel.value); });
    const inv=document.createElement('button');inv.className='tg'+(touchInv[ax]?' on':'');
    inv.textContent=t('touch.invert');
    inv.addEventListener('click',()=>{ setTouchInv(ax,!touchInv[ax]); renderTouchControls(); });
    row.appendChild(l);row.appendChild(sel);row.appendChild(inv);touchbindsEl.appendChild(row);
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

/* ---------- graphics quality — Cinematic only (no in-game toggle) ----------
   Cinematic = bloom + colour grade + IBL reflections. renderFrame still auto-
   drops to Basic if a GPU rejects post-fx or the frame rate stays low. */
export function applyGfx(mode){
  S.gfx=(mode==='full')?'full':'basic';
  setFX(S.gfx==='full'?'full':'basic');
}
applyGfx('full');   // always cinematic

/* keep the "Tuning" sector chip in sync with the (only remaining) reactor setting */
function syncTuningChip(){ if(oExtra)oExtra.textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf'); }
syncTuningChip();

/* Asset quality is decided by the device in core/env.js — no toggle here. */

/* ---------- language (fixed to whatever i18n loaded; picker removed) ---------- */
onLang(()=>{
  // re-render dynamic menu bits that aren't plain [data-i18n] elements
  document.getElementById('oWorld').textContent=t('world.'+S.world);
  document.getElementById('oMode').textContent=t(S.storyMode?'mode.story':'mode.exploreShort');
  document.getElementById('oEnergy').textContent=t(S.energyMode==='drain'?'reactor.drain':'reactor.inf');
  syncTuningChip();
  if(specV)specV.textContent=t('hud.taken',{n:S.taken});
  renderKeybinds();renderTouchControls(); // control labels are localized
  Story._last=''; if(Story.active)Story.hud();
});
