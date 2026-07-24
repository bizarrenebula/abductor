/* =========================================================================
   MISSIONS — the Exploration-mode side-quest chain per world. Completing one
   banks a bonus and (usually) grants a buff; finishing the set banks +50.
   ========================================================================= */
import { S } from '../core/state.js';
import { World } from '../world/world-config.js';
import { beep } from '../audio/music.js';
import { banner } from '../ui/banner.js';
import { scoreV } from '../ui/dom.js';
import { grantBuffType } from './buffs.js';
import { t } from '../i18n.js';

function cnt(n){return (S.tally[n]&&S.tally[n].c)||0;}
// resolve one counter id -> its live count (creature tally, or crystals)
function itemCount(id){return id==='crystals'?S.crystals:cnt(id);}
/* `items` (optional) drives the per-type breakdown the player asked for
   ("4/5 goats, 1/5 ducks"). Each entry is [labelKey, counterId, goal]. */
const MISSION_SETS={
  earth:[
    {txt:'mission.earth1',p:()=>cnt('Sheep'),goal:5,bonus:10,
      items:[['creature.Sheep','Sheep',5]]},
    {txt:'mission.earth2',p:()=>Math.min(cnt('Sheep'),cnt('Goat'),cnt('Duck')),goal:5,bonus:25,
      items:[['creature.Sheep','Sheep',5],['creature.Goat','Goat',5],['creature.Duck','Duck',5]]},
    {txt:'mission.crystals',p:()=>S.crystals,goal:5,bonus:15,
      items:[['label.CRYSTAL','crystals',5]]},
    {txt:'mission.earth4',p:()=>cnt('Hiker')+cnt('Villager'),goal:1,bonus:30}
  ],
  moon:[
    {txt:'mission.moon1',p:()=>cnt('Blob'),goal:5,bonus:10,items:[['creature.Blob','Blob',5]]},
    {txt:'mission.moon2',p:()=>cnt('Skimmer'),goal:3,bonus:20,items:[['creature.Skimmer','Skimmer',3]]},
    {txt:'mission.crystals',p:()=>S.crystals,goal:5,bonus:15,items:[['label.CRYSTAL','crystals',5]]}
  ],
  mars:[
    {txt:'mission.mars1',p:()=>cnt('Strider'),goal:5,bonus:12,items:[['creature.Strider','Strider',5]]},
    {txt:'mission.mars2',p:()=>cnt('Tumbler'),goal:3,bonus:20,items:[['creature.Tumbler','Tumbler',3]]},
    {txt:'mission.mars3',p:()=>cnt('Wormling'),goal:2,bonus:22,items:[['creature.Wormling','Wormling',2]]},
    {txt:'mission.crystals',p:()=>S.crystals,goal:5,bonus:15,items:[['label.CRYSTAL','crystals',5]]}
  ]
};
const QUEST_BUFF={earth:['speed','wide','lock','speed'],moon:['speed','wide','lock'],mars:['speed','wide','lock','speed']};

export function updateMissionHUD(){
  const panel=document.getElementById('hMission');
  if(S.storyMode){if(panel)panel.style.display='none';return;}
  if(panel)panel.style.display='';
  const el=document.getElementById('mTxt');
  const set=MISSION_SETS[World.name]||[];
  if(S.missionIdx>=set.length){el.textContent=t('mission.allDone');return;}
  const m=set[S.missionIdx];
  const v=Math.min(m.goal,m.p());
  let html=t(m.txt)+' — <span class="mnum">'+v+'/'+m.goal+'</span>';
  // Per-type counters (collected vs required), e.g. Sheep 4/5 · Camel 1/5.
  if(m.items&&m.items.length>1){
    html+='<div class="mitems">'+m.items.map(it=>{
      const c=Math.min(it[2],itemCount(it[1]));
      return '<span class="mi'+(c>=it[2]?' done':'')+'">'+t(it[0])+' <b>'+c+'/'+it[2]+'</b></span>';
    }).join('')+'</div>';
  }
  el.innerHTML=html;
}
export function checkMissions(){
  if(S.storyMode)return;   // story mode replaces side quests
  const set=MISSION_SETS[World.name]||[];
  if(S.missionIdx<set.length){
    const m=set[S.missionIdx];
    if(m.p()>=m.goal){
      S.score+=m.bonus;scoreV.textContent=S.score;
      banner(t('banner.questDone',{n:m.bonus}));
      const qb=(QUEST_BUFF[World.name]||[])[S.missionIdx];
      if(qb)grantBuffType(qb,30);
      beep(659,0.2,0.08);setTimeout(()=>beep(880,0.2,0.08),140);setTimeout(()=>beep(1318,0.35,0.08),280);
      S.missionIdx++;
      if(S.missionIdx>=set.length){
        S.score+=50;scoreV.textContent=S.score;
        setTimeout(()=>banner(t('banner.allQuests')),1600);
      }
    }
  }
  updateMissionHUD();
}
