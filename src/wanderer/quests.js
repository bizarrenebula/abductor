/* =========================================================================
   SIDE QUESTS — optional defence contracts that pay points.

   One at a time, in a rolling chain. Each pays into the same points the shop
   spends (and the score), so doing them is how a careful wanderer affords the
   upgrades. When the chain runs out it comes round again with bigger goals and
   bigger rewards.

   Driven by events the rest of Wanderer mode reports (questEvent), never by
   polling the world, so a quest counts exactly what the player did:

     repel           a pulse stunned a saucer
     save            a hit made a saucer drop what it held  {kind:'animal'|'human'}
     crystal         a crystal was taken
     selfdefence     a hit on a saucer that had you in its beam
     savepoint       a save point was reached
     heat            the heat stage changed                {from, to}

   A timed quest that runs out is simply dropped for the next one — no penalty,
   they are optional.
   ========================================================================= */
import { S } from '../core/state.js';
import { beep } from '../audio/music.js';
import { banner } from '../ui/banner.js';
import { scoreV } from '../ui/dom.js';
import { t } from '../i18n.js';

/* goal / reward are base values, scaled up each time round the chain */
const CHAIN=[
  {id:'repel',   goal:3, reward:30},
  {id:'rescue',  goal:2, reward:40},
  {id:'crystals',goal:3, reward:25},
  {id:'villager',goal:1, reward:50},
  {id:'dash',    goal:1, reward:40, time:240},     // reach the next save point in 4:00
  {id:'selfdef', goal:1, reward:40},
  {id:'double',  goal:1, reward:50, window:8},     // two repels within 8 s
  {id:'shake',   goal:1, reward:50},               // HUNTED or worse, then back to QUIET
];

export const Q={idx:0, round:0, n:0, timeLeft:0, done:0, earned:0, repelTimes:[], wasHunted:false};
const cur=()=>CHAIN[Q.idx%CHAIN.length];
const scale=()=>1+0.5*Q.round;
export const goalOf=()=>Math.max(1,Math.round(cur().goal*(cur().id==='villager'||cur().goal===1?1:scale())));
const rewardOf=()=>Math.round(cur().reward*scale()/5)*5;

export function resetQuests(){
  Q.idx=0; Q.round=0; Q.done=0; Q.earned=0; Q.repelTimes.length=0; begin();
}
function begin(){
  Q.n=0; Q.wasHunted=false;
  const c=cur(); Q.timeLeft=c.time||0;
}
function complete(){
  const r=rewardOf();
  S.score+=r; Q.earned+=r; Q.done++;
  scoreV.textContent=S.score;
  banner(t('w.q.done',{r}));
  beep(784,0.12,0.06); setTimeout(()=>beep(1046,0.12,0.06),120); setTimeout(()=>beep(1318,0.2,0.06),240);
  next();
}
function next(){
  Q.idx++;
  if(Q.idx%CHAIN.length===0)Q.round++;
  begin();
}

export function questEvent(type,data){
  const c=cur(); const id=c.id;
  if(type==='repel'){
    const now=performance.now()/1000;
    Q.repelTimes.push(now); while(Q.repelTimes.length>4)Q.repelTimes.shift();
    if(id==='repel')Q.n++;
    if(id==='double'){
      const k=Q.repelTimes.length;
      if(k>=2&&Q.repelTimes[k-1]-Q.repelTimes[k-2]<=c.window)Q.n=1;
    }
  }
  else if(type==='save'){
    if(id==='rescue'&&data&&data.kind==='animal')Q.n++;
    if(id==='villager'&&data&&data.kind==='human')Q.n++;
  }
  else if(type==='crystal'&&id==='crystals')Q.n++;
  else if(type==='selfdefence'&&id==='selfdef')Q.n++;
  else if(type==='savepoint'&&id==='dash')Q.n++;
  else if(type==='heat'&&id==='shake'){
    if(data.to>=2)Q.wasHunted=true;
    if(Q.wasHunted&&data.to===0)Q.n++;
  }
  if(Q.n>=goalOf())complete();
}

export function updateQuests(dt){
  const c=cur();
  if(c.time){
    Q.timeLeft-=dt;
    if(Q.timeLeft<=0){ banner(t('w.q.expired')); next(); }
  }
}

/* the side-quest panel (#hMission, shared with the saucer game) */
let lastHTML='';
export function drawQuest(){
  const el=document.getElementById('mTxt'); if(!el)return;
  const c=cur(), g=goalOf();
  let h=t('w.q.'+c.id,{n:g,w:c.window||0})+' — <span class="mnum">'+Math.min(Q.n,g)+'/'+g+'</span>';
  if(c.time){ const s=Math.max(0,Math.ceil(Q.timeLeft)); h+=' · <span class="mnum">'+Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+'</span>'; }
  if(c.id==='shake'&&Q.wasHunted)h+=' · '+t('w.q.shakeNow');
  h+='<div class="mitems"><span class="mi">'+t('w.q.reward')+' <b>'+rewardOf()+'</b></span></div>';
  if(h!==lastHTML){ el.innerHTML=h; lastHTML=h; }
}
