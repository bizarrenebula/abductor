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

function cnt(n){return (S.tally[n]&&S.tally[n].c)||0;}
const MISSION_SETS={
  earth:[
    {txt:'Take 5 sheep',p:()=>cnt('Sheep'),goal:5,bonus:10},
    {txt:'5 each: sheep, camel, duck',p:()=>Math.min(cnt('Sheep'),cnt('Camel'),cnt('Duck')),goal:5,bonus:25},
    {txt:'Harvest 5 crystals',p:()=>S.crystals,goal:5,bonus:15},
    {txt:'Abduct a hiker or villager',p:()=>cnt('Hiker')+cnt('Villager'),goal:1,bonus:30}
  ],
  moon:[
    {txt:'Take 5 blobs',p:()=>cnt('Blob'),goal:5,bonus:10},
    {txt:'Take 3 skimmers',p:()=>cnt('Skimmer'),goal:3,bonus:20},
    {txt:'Harvest 5 crystals',p:()=>S.crystals,goal:5,bonus:15}
  ],
  mars:[
    {txt:'Take 5 striders',p:()=>cnt('Strider'),goal:5,bonus:12},
    {txt:'Take 3 tumblers',p:()=>cnt('Tumbler'),goal:3,bonus:20},
    {txt:'Take 2 wormlings',p:()=>cnt('Wormling'),goal:2,bonus:22},
    {txt:'Harvest 5 crystals',p:()=>S.crystals,goal:5,bonus:15}
  ]
};
const QUEST_BUFF={earth:['speed','wide','lock','speed'],moon:['speed','wide','lock'],mars:['speed','wide','lock','speed']};

export function updateMissionHUD(){
  const panel=document.getElementById('hMission');
  if(S.storyMode){if(panel)panel.style.display='none';return;}
  if(panel)panel.style.display='';
  const el=document.getElementById('mTxt');
  const set=MISSION_SETS[World.name]||[];
  if(S.missionIdx>=set.length){el.textContent='All contracts complete';return;}
  const m=set[S.missionIdx];
  const v=Math.min(m.goal,m.p());
  el.innerHTML=m.txt+' — <span class="mnum">'+v+'/'+m.goal+'</span>';
}
export function checkMissions(){
  if(S.storyMode)return;   // story mode replaces side quests
  const set=MISSION_SETS[World.name]||[];
  if(S.missionIdx<set.length){
    const m=set[S.missionIdx];
    if(m.p()>=m.goal){
      S.score+=m.bonus;scoreV.textContent=S.score;
      banner('SIDE QUEST DONE  +'+m.bonus);
      const qb=(QUEST_BUFF[World.name]||[])[S.missionIdx];
      if(qb)grantBuffType(qb,30);
      beep(659,0.2,0.08);setTimeout(()=>beep(880,0.2,0.08),140);setTimeout(()=>beep(1318,0.35,0.08),280);
      S.missionIdx++;
      if(S.missionIdx>=set.length){
        S.score+=50;scoreV.textContent=S.score;
        setTimeout(()=>banner('ALL SIDE QUESTS  +50'),1600);
      }
    }
  }
  updateMissionHUD();
}
