/* =========================================================================
   SHIP UPGRADES — the game's third progression perk (alongside the harvest
   score and the side-quest missions). It runs in BOTH Story and Exploration and
   walks the ship from "grounded" to "hero" in a few minutes, two ways at once:

   1) THE COLLECT LADDER — everything you beam up (animals, crystals, humans)
      feeds a point pool that gradually widens the beam and, at the summit,
      unlocks the CLOAK (the highest achievement):
        BASIC BEAM → WIDE BEAM I → II → III → CLOAK

   2) FIELD UPGRADES — special parts scattered far apart on the map at random
      spots (marked on the radar, and blinking when they're in your line of
      sight). Fly over one to install it:
        THRUSTERS      — unlock climb/dive (altitude control)
        HIGH-END ENGINE — +25% engine thrust (the single speed part)

   The ship always starts grounded: base beam, standard engines, no altitude
   control, cloak locked.

   SAVE POINTS / CRASHES (req: never reset on a crash or a disaster hit)
     Every upgrade — a ladder tier or an installed part — writes a checkpoint.
     A fatal hit never rolls the ship back below it: Story respawns keep the
     whole state, and in Exploration "run it back" restores the checkpoint (see
     ui/screens.js). The only state below your last save point is a fresh new
     session from the menu, which starts the ship grounded again.
   ========================================================================= */
import { S } from '../core/state.js';
import { banner } from '../ui/banner.js';
import { showAchievement, hideAchievement } from '../ui/achievement.js';
import { beep } from '../audio/music.js';
import { t } from '../i18n.js';

/* Collect-ladder tiers: cumulative point cost + the capability granted. */
export const UP_TIERS=[
  { key:'basic', at:0,                 title:'upg.t.basic', guide:'upg.g.basic' },
  { key:'beam1', at:12,  beam:1.16,    title:'upg.t.beam1', guide:'upg.g.beam' },
  { key:'beam2', at:30,  beam:1.32,    title:'upg.t.beam2', guide:'upg.g.beam' },
  { key:'beam3', at:55,  beam:1.50,    title:'upg.t.beam3', guide:'upg.g.beam' },
  { key:'cloak', at:90,  cloak:true,   title:'upg.t.cloak', guide:'upg.g.cloak' },
];
const MAX_TIER=UP_TIERS.length-1;

/* The field-upgrade parts and what installing each does. */
export const UP_ITEMS={
  thrusters:  { alt:true,    col:0x7fd8ff },   // altitude control
  highEngine: { speed:1.25,  col:0xffb347 },   // +25% thrust (the single speed part)
};
export const ITEM_KEYS=Object.keys(UP_ITEMS);

const panel  = document.getElementById('hUpgrade');
const nameEl = document.getElementById('upgName');
const fillEl = document.getElementById('upgFill');
const nextEl = document.getElementById('upgNext');
const pipEls = {};
ITEM_KEYS.forEach(k=>{ pipEls[k]=document.getElementById('upgPip_'+k); });

function freshItems(){ const o={}; ITEM_KEYS.forEach(k=>o[k]=false); return o; }

export const Upgrades={
  points:0,
  tier:0,
  items:freshItems(),
  saved:{points:0,tier:0,items:freshItems()},   // last save point — restored after a crash
  altHinted:false,

  /* Fresh new-game start: grounded zero. */
  reset(){
    this.points=0;this.tier=0;this.items=freshItems();
    this.saved={points:0,tier:0,items:freshItems()};this.altHinted=false;
    this.apply();hideAchievement();this.hud();
  },
  /* Continue after a crash (Exploration "run it back"): keep the earned ship. */
  restore(){
    this.points=this.saved.points;this.tier=this.saved.tier;
    this.items=Object.assign(freshItems(),this.saved.items);this.altHinted=false;
    this.apply();hideAchievement();this.hud();
  },
  checkpoint(){ this.saved={points:this.points,tier:this.tier,items:Object.assign({},this.items)}; },

  /* Collecting anything feeds the ladder; crossing a threshold widens the beam
     (or, at the top, unlocks the cloak) and banks a save point. */
  gain(p){
    if(!(p>0))return;
    this.points+=p;
    while(this.tier<MAX_TIER && this.points>=UP_TIERS[this.tier+1].at){
      this.tier++;
      this.checkpoint();
      this.apply();
      this.announce(UP_TIERS[this.tier]);
    }
    this.hud();
  },

  /* Fly over a field part to install it (called by entities/upgradeItems.js). */
  collectItem(key){
    if(this.items[key])return;
    this.items[key]=true;
    this.checkpoint();
    this.apply();
    this.announce({title:'upg.t.'+key,guide:'upg.g.'+key});
    this.hud();
  },

  /* Recompute the live capability state from tier + installed parts. */
  apply(){
    let beam=1,cloak=false;
    for(let i=1;i<=this.tier;i++){
      const g=UP_TIERS[i];
      if(g.beam)beam=g.beam;
      if(g.cloak)cloak=true;
    }
    S.upBeam=beam;S.upCloak=cloak;
    S.upAltitude=!!this.items.thrusters;
    S.upSpeed=this.items.highEngine?1.25:1;
  },

  /* Cheerful on-screen achievement: a toast spelling out what it grants and how
     to use it (req), plus a rising chime. */
  announce(tier){
    showAchievement(t(tier.title),t(tier.guide));
    beep(659,0.16,0.07);setTimeout(()=>beep(880,0.16,0.07),110);setTimeout(()=>beep(1175,0.30,0.06),230);
  },

  /* One-time gentle nudge when the player tries to climb before Thrusters. */
  altBlockedHint(){
    if(this.altHinted||this.items.thrusters)return;
    this.altHinted=true;banner(t('upg.locked.alt'));
  },

  /* Live HUD: current beam/cloak tier + a bar toward the next, plus a pip per
     installed field part. */
  hud(){
    if(!panel)return;
    const cur=UP_TIERS[this.tier];
    if(nameEl)nameEl.textContent=t('upg.name.'+cur.key);
    if(this.tier>=MAX_TIER){
      if(fillEl)fillEl.style.width='100%';
      if(nextEl)nextEl.textContent=t('upg.hud.max');
    }else{
      const from=cur.at,to=UP_TIERS[this.tier+1].at;
      const f=Math.max(0,Math.min(1,(this.points-from)/(to-from)));
      if(fillEl)fillEl.style.width=(f*100).toFixed(1)+'%';
      if(nextEl)nextEl.textContent=t('upg.name.'+UP_TIERS[this.tier+1].key)+' · '+Math.max(0,to-this.points);
    }
    ITEM_KEYS.forEach(k=>{ if(pipEls[k])pipEls[k].classList.toggle('got',!!this.items[k]); });
  },
};
