/* =========================================================================
   SHIP UPGRADES — the game's third progression perk (alongside the harvest
   score and the side-quest missions). It runs in BOTH Story and Exploration.

   CRUCIAL EQUIPMENT (collectible, always scattered on the map every run):
     BEAM       — the tractor beam itself; without it you cannot abduct
     THRUSTERS  — altitude control (ascend / descend)
     CLOAK      — go invisible
   The ship starts BARE — none of these installed. A checklist HUD flags what
   is still missing and what each unlocks; find the module on the map and fly
   over it to install it. You may use whatever you have collected, in any order.
   The checklist disappears once all three are aboard.

   Also scattered (optional, not on the checklist):
     HIGH-END ENGINE — +25% engine thrust

   THE COLLECT LADDER — once you own the beam, everything you beam up feeds a
   point pool that gradually WIDENS the beam: BASIC → WIDE I → II → III.

   SAVE POINTS / CRASHES (req: never reset on a crash or a disaster hit)
     Every upgrade writes a checkpoint. A fatal hit never rolls the ship back:
     Story respawns keep the whole state, and in Exploration "run it back"
     restores the checkpoint. A fresh session from the menu starts bare again.
   ========================================================================= */
import { S } from '../core/state.js';
import { banner } from '../ui/banner.js';
import { showAchievement, hideAchievement } from '../ui/achievement.js';
import { beep } from '../audio/music.js';
import { t } from '../i18n.js';
import { ModuleIcons } from './moduleIcons.js';

/* Collect-ladder tiers: cumulative point cost + the beam-width granted. Only
   meaningful once the BEAM module is installed (see apply/hud). */
export const UP_TIERS=[
  { key:'basic', at:0,                 title:'upg.t.basic', guide:'upg.g.basic' },
  { key:'beam1', at:20,  beam:1.16,    title:'upg.t.beam1', guide:'upg.g.beam' },
  { key:'beam2', at:50,  beam:1.32,    title:'upg.t.beam2', guide:'upg.g.beam' },
  { key:'beam3', at:95,  beam:1.50,    title:'upg.t.beam3', guide:'upg.g.beam' },
];
const MAX_TIER=UP_TIERS.length-1;

/* The findable modules. `crucial` ones show on the checklist and gate an action;
   dMin/dMax set how far out each scatters (crucial gear closer, so the beam in
   particular is quick to find, the cloak the furthest reward). */
export const UP_ITEMS={
  beam:       { beam:true,   crucial:true, col:0x8fffb0, dMin:90,  dMax:230  },  // the tractor beam
  thrusters:  { alt:true,    crucial:true, col:0x7fd8ff, dMin:220, dMax:480  },  // altitude control
  cloak:      { cloak:true,  crucial:true, col:0xc59bff, dMin:460, dMax:980  },  // invisibility
  highEngine: { speed:1.25,               col:0xffb347, dMin:380, dMax:1150 },  // +25% thrust (optional)
};
export const ITEM_KEYS=Object.keys(UP_ITEMS);
export const CRUCIAL=ITEM_KEYS.filter(k=>UP_ITEMS[k].crucial);   // beam, thrusters, cloak

const panel  = document.getElementById('hUpgrade');
const nameEl = document.getElementById('upgName');
const fillEl = document.getElementById('upgFill');
const nextEl = document.getElementById('upgNext');
const pipEls = {};
ITEM_KEYS.forEach(k=>{ pipEls[k]=document.getElementById('upgPip_'+k); });
/* The crucial three no longer have a DOM row. They are three glyphs over the
   ship, shown for a moment when one is installed or when one is used — or when
   the player reaches for one they have not found. See systems/moduleIcons.js. */

function freshItems(){ const o={}; ITEM_KEYS.forEach(k=>o[k]=false); return o; }

export const Upgrades={
  points:0,
  tier:0,
  items:freshItems(),
  saved:{points:0,tier:0,items:freshItems()},   // last save point — restored after a crash
  altHinted:false,
  beamHinted:false,

  /* Fresh new-game start: bare ship. */
  reset(){
    this.points=0;this.tier=0;this.items=freshItems();
    this.saved={points:0,tier:0,items:freshItems()};this.altHinted=false;this.beamHinted=false;
    this.apply();hideAchievement();this.hud();
  },
  /* Continue after a crash (Exploration "run it back"): keep the earned ship. */
  restore(){
    this.points=this.saved.points;this.tier=this.saved.tier;
    this.items=Object.assign(freshItems(),this.saved.items);this.altHinted=false;this.beamHinted=false;
    this.apply();hideAchievement();this.hud();
  },
  checkpoint(){ this.saved={points:this.points,tier:this.tier,items:Object.assign({},this.items)}; },

  /* Collecting anything feeds the ladder; crossing a threshold widens the beam
     and banks a save point. (Only reachable once you have the beam, since you
     can't harvest without it.) */
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

  /* Fly over a module to install it (called by entities/upgradeItems.js). */
  collectItem(key){
    if(this.items[key])return;
    this.items[key]=true;
    this.checkpoint();
    this.apply();
    this.announce({title:'upg.t.'+key,guide:'upg.g.'+key});
    this.hud();                       // ...which relights the glyph, and then:
    ModuleIcons.ping(key,'got');      // show the row, with this one pulsing
  },

  /* Recompute the live capability state from installed modules + beam tier. */
  apply(){
    let beam=1;
    for(let i=1;i<=this.tier;i++){ if(UP_TIERS[i].beam)beam=UP_TIERS[i].beam; }
    S.upBeam=beam;
    S.upHasBeam=!!this.items.beam;            // the tractor beam works at all
    S.upAltitude=!!this.items.thrusters;      // climb / dive
    S.upCloak=!!this.items.cloak;             // go invisible
    S.upSpeed=this.items.highEngine?1.25:1;
  },

  /* Cheerful on-screen achievement: a toast spelling out what it grants and how
     to use it (req), plus a rising chime. */
  announce(tier){
    showAchievement(t(tier.title),t(tier.guide));
    beep(659,0.16,0.07);setTimeout(()=>beep(880,0.16,0.07),110);setTimeout(()=>beep(1175,0.30,0.06),230);
  },

  /* One-time gentle nudges when the player tries an action they haven't found
     the module for yet. */
  altBlockedHint(){
    if(this.altHinted||this.items.thrusters)return;
    this.altHinted=true;banner(t('upg.locked.alt'));
  },
  beamBlockedHint(){
    if(this.beamHinted||this.items.beam)return;
    this.beamHinted=true;banner(t('upg.locked.beam'));
  },

  /* Live HUD:
       - the three module glyphs over the ship (which are only ever SHOWN by an
         event — this just keeps their lit/unlit state true);
       - the beam-width ladder panel, shown only once you own the beam. */
  hud(){
    ModuleIcons.sync(this.items);
    if(panel){
      panel.style.display=this.items.beam?'':'none';
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
    }
    ITEM_KEYS.forEach(k=>{ if(pipEls[k])pipEls[k].classList.toggle('got',!!this.items[k]); });
  },
};
