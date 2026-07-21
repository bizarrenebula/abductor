/* =========================================================================
   STORY MODE — per-world three-mission chains (Earth / Moon / Mars): find and
   restore a structure, gather samples/specimens, then feed it. Replaces the
   side quests when Story mode is on.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y } from '../core/constants.js';
import { part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { sample, heightAt } from '../world/terrain.js';
import { beep } from '../audio/music.js';
import { BeamSFX } from '../audio/sfx.js';
import { banner } from '../ui/banner.js';
import { spawnPop } from '../ui/pop.js';
import { scoreV } from '../ui/dom.js';
import { saucer } from '../systems/saucer.js';
import { effBeamR } from '../systems/beam.js';
import { t } from '../i18n.js';

export const Story={
  active:false, world:null, stage:0, _pending:0, _last:'',
  // shared holders
  shipPos:null, ship:null, glows:[], debris:[], samples:[], targets:[], structure:null,
  need:{}, count:0, guides:[],
  reset(){
    this.active=false;this.stage=0;this.count=0;this._last='';this.world=null;
    if(this.ship){scene.remove(this.ship);this.ship=null;}
    if(this.structure){scene.remove(this.structure);this.structure=null;}
    this.debris.forEach(d=>scene.remove(d));this.debris.length=0;
    this.samples.forEach(s=>scene.remove(s));this.samples.length=0;
    this.targets.forEach(t=>scene.remove(t));this.targets.length=0;
    this.guides.forEach(g=>scene.remove(g));this.guides.length=0;
    this.glows.length=0;this.shipPos=null;this.need={};
    document.getElementById('hStory').style.display='none';
    document.getElementById('storyScreen').classList.add('hidden');
  },
  begin(world){
    this.reset();
    this.active=true;this.world=world;this.stage=1;
    document.getElementById('hStory').style.display='block';
    if(world==='earth')this.beginEarth();
    else if(world==='moon')this.beginMoon();
    else if(world==='mars')this.beginMars();
    this.hud();
  },

  /* ---- helpers ---- */
  farPoint(minD,maxD,avoidWater){
    for(let tr=0;tr<60;tr++){
      const ang=Math.random()*Math.PI*2,d=minD+Math.random()*(maxD-minD);
      const x=Math.cos(ang)*d,z=Math.sin(ang)*d;
      const sm=sample(x,z);
      if(avoidWater&&sm.biome==='water')continue;
      if(sm.h>28)continue;
      return {x,z};
    }
    return {x:minD,z:0};
  },
  scatter(n,minD,maxD){
    const out=[];
    for(let i=0;i<n;i++){
      const ang=(i/n)*Math.PI*2+Math.random()*0.5, d=minD+Math.random()*(maxD-minD);
      out.push({x:Math.cos(ang)*d, z:Math.sin(ang)*d});
    }
    return out;
  },
  // points laid along a randomly-curved route from origin (0,0) toward {tx,tz}.
  // The path bows sideways via a sine arc + a secondary wobble, so it's never straight.
  curvedPath(tx,tz,n,tStart,tEnd,jitter){
    const out=[];
    const len=Math.hypot(tx,tz)||1;
    // unit direction and its perpendicular
    const dirx=tx/len, dirz=tz/len;
    const perpx=-dirz, perpz=dirx;
    // random arc shape for this run
    const amp=(len*0.18)*(0.5+Math.random());          // how far the curve bows out
    const phase=Math.random()*Math.PI*2;
    const lobes=1+Math.random()*1.5;                   // 1–2.5 gentle bends
    const side=Math.random()<0.5?-1:1;
    for(let i=1;i<=n;i++){
      const t=tStart+(i/(n+1))*(tEnd-tStart);          // fraction along the main axis
      // base point along the straight line
      let x=tx*t, z=tz*t;
      // sine arc offset perpendicular to the route (0 at both ends, max in the middle)
      const bow=Math.sin(t*Math.PI)*amp*side;
      // secondary wobble for a less regular curve
      const wob=Math.sin(t*Math.PI*lobes+phase)*amp*0.35;
      const off=bow+wob;
      x+=perpx*off; z+=perpz*off;
      // small random jitter so points aren't perfectly on the curve
      x+=(Math.random()-0.5)*(jitter||0); z+=(Math.random()-0.5)*(jitter||0);
      out.push({x,z});
    }
    return out;
  },
  // a tall glowing guide pillar toward a destination
  buildGuide(col){
    const g=new THREE.Group();
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,160,8,1,true),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.16,depthWrite:false,
        blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
    beam.position.y=80;g.add(beam);
    const base=new THREE.Mesh(new THREE.RingGeometry(1.2,1.7,20),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false}));
    base.rotation.x=-Math.PI/2;base.position.y=0.2;g.add(base);
    g.userData.col=col;return g;
  },

  /* =================== EARTH — the crashed mothership =================== */
  beginEarth(){
    const p=this.farPoint(320,400,true);
    this.shipPos=p;
    this.ship=this.buildShip();
    this.ship.position.set(p.x,heightAt(p.x,p.z)-1.2,p.z);
    this.ship.rotation.z=0.16;this.ship.rotation.y=Math.random()*6.28;
    scene.add(this.ship);
    this.need={crystal:false,water:false,sand:false};
    const dpts=this.curvedPath(p.x,p.z,9,0.08,0.94,20);
    for(const q of dpts){
      const d=this.buildDebris();
      d.position.set(q.x,heightAt(q.x,q.z)+0.3,q.z);
      d.rotation.set(Math.random()*2,Math.random()*6,Math.random()*2);
      scene.add(d);this.debris.push(d);
    }
    setTimeout(()=>banner(t('banner.distress')),900);
  },
  buildShip(){
    const g=new THREE.Group();
    const hull=part(new THREE.SphereGeometry(11,28,16),
      new THREE.MeshStandardMaterial({color:0x2a3138,metalness:0.85,roughness:0.5}),0,0,0);
    hull.scale.set(1,0.28,1);g.add(hull);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(11,1.1,10,36),
      new THREE.MeshStandardMaterial({color:0x1c2228,metalness:0.9,roughness:0.6}));
    rim.rotation.x=Math.PI/2;g.add(rim);
    const dome=part(new THREE.SphereGeometry(4.5,20,12,0,Math.PI*1.4,0,Math.PI/2),
      new THREE.MeshStandardMaterial({color:0x27414a,roughness:0.2,metalness:0.3,transparent:true,opacity:0.6}),0,2.2,0);
    g.add(dome);
    for(let i=0;i<6;i++){
      const a=i/6*Math.PI*2;
      const gl=part(new THREE.SphereGeometry(0.5,8,6),
        new THREE.MeshStandardMaterial({color:0x331408,emissive:0xff6a20,emissiveIntensity:0.8,roughness:0.6}),
        Math.cos(a)*10.4,0.2,Math.sin(a)*10.4);
      g.add(gl);this.glows.push(gl);
    }
    const scorch=new THREE.Mesh(new THREE.CircleGeometry(17,28),
      new THREE.MeshBasicMaterial({color:0x050505,transparent:true,opacity:0.55,depthWrite:false}));
    scorch.rotation.x=-Math.PI/2;scorch.position.y=1.35;g.add(scorch);
    return g;
  },
  buildDebris(){
    const g=new THREE.Group();
    g.add(part(new THREE.TetrahedronGeometry(0.9+Math.random()*0.8,0),
      new THREE.MeshStandardMaterial({color:0x22262c,metalness:0.8,roughness:0.5,emissive:0xff6a20,emissiveIntensity:0.35}),0,0.4,0));
    return g;
  },
  buildSample(kind){
    const g=new THREE.Group();
    let m;
    if(kind==='water'){
      m=new THREE.MeshStandardMaterial({color:0x4fc8e8,emissive:0x3fb8e8,emissiveIntensity:0.8,roughness:0.1,transparent:true,opacity:0.9});
      g.add(part(new THREE.SphereGeometry(0.9,16,12),m,0,0.9,0));
    }else{
      m=new THREE.MeshStandardMaterial({color:0xd8a850,emissive:0xc88830,emissiveIntensity:0.6,roughness:0.6});
      g.add(part(new THREE.ConeGeometry(1.1,1.3,10),m,0,0.65,0));
    }
    const bcol=kind==='water'?0x4fc8e8:0xd8a850;
    const beacon=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,140,8,1,true),
      new THREE.MeshBasicMaterial({color:bcol,transparent:true,opacity:0.14,depthWrite:false,
        blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
    beacon.position.y=70;g.add(beacon);
    g.userData={sampleKind:kind,lift:0,phase:Math.random()*6.28,mat:m,baseY:0};
    return g;
  },
  spawnSamples(){
    const targets=[['water','water'],['sand','desert']];
    for(const [kind,biome] of targets){
      let fx=this.shipPos.x+80,fz=this.shipPos.z;
      outer:
      for(let r=50;r<=650;r+=30){
        for(let k=0;k<14;k++){
          const a=k/14*Math.PI*2;
          const x=this.shipPos.x+Math.cos(a)*r,z=this.shipPos.z+Math.sin(a)*r;
          if(sample(x,z).biome===biome){fx=x;fz=z;break outer;}
        }
      }
      const s=this.buildSample(kind);
      const gy=kind==='water'?WATER_Y+0.35:heightAt(fx,fz);
      s.position.set(fx,gy,fz);s.userData.baseY=gy;
      scene.add(s);this.samples.push(s);
    }
  },

  /* =================== MOON — the spyder lab =================== */
  beginMoon(){
    this.need={spyders:0,rocks:0};
    // mission 1: 5 moon spyders scattered wide
    const pts=this.scatter(5,180,460);
    for(const p of pts){
      const sp=this.buildSpyder();
      sp.position.set(p.x,heightAt(p.x,p.z)+0.4,p.z);
      sp.userData.baseY=sp.position.y;
      scene.add(sp);this.targets.push(sp);
    }
    setTimeout(()=>banner(t('banner.moonDirective')),900);
  },
  buildSpyder(){
    // eerie glowing arachnid: round body + radiating legs
    const g=new THREE.Group();
    const skin=0x2a3a44, glow=0xff3b52;
    const body=part(new THREE.SphereGeometry(0.7,14,12),
      new THREE.MeshStandardMaterial({color:skin,emissive:0x220008,roughness:0.5}),0,0.7,0);
    body.scale.set(1.1,0.85,1.2);g.add(body);
    const eyeM=new THREE.MeshBasicMaterial({color:glow});
    g.add(part(new THREE.SphereGeometry(0.6,12,10),
      new THREE.MeshStandardMaterial({color:glow,emissive:glow,emissiveIntensity:0.9,roughness:0.4,transparent:true,opacity:0.7}),0,0.85,0));
    const legM=new THREE.MeshStandardMaterial({color:0x1a2630,roughness:0.7});
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2, side=(i<4?1:-1);
      const l=part(new THREE.CylinderGeometry(0.09,0.05,1.3,6),legM,Math.cos(a)*0.7,0.6,Math.sin(a)*0.7);
      l.rotation.z=Math.cos(a)*0.9;l.rotation.x=Math.sin(a)*0.9;g.add(l);
      g.add(part(new THREE.SphereGeometry(0.09,6,6),legM,Math.cos(a)*1.25,0.15,Math.sin(a)*1.25));
    }
    g.add(part(new THREE.SphereGeometry(0.09,7,6),eyeM,-0.18,0.85,0.6));
    g.add(part(new THREE.SphereGeometry(0.09,7,6),eyeM,0.18,0.85,0.6));
    g.userData={spyder:true,lift:0,phase:Math.random()*6.28};
    return g;
  },
  buildLab(){
    // a larger alien structure — domed hub with buttressed pods and glowing core
    const g=new THREE.Group();
    const shell=part(new THREE.SphereGeometry(7,18,12,0,Math.PI*2,0,Math.PI/2),
      new THREE.MeshStandardMaterial({color:0x39525c,metalness:0.5,roughness:0.4}),0,0,0);
    g.add(shell);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(7.4,0.8,10,28),
      new THREE.MeshStandardMaterial({color:0x223038,metalness:0.7,roughness:0.5}));
    ring.rotation.x=Math.PI/2;ring.position.y=0.4;g.add(ring);
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2;
      const pod=part(new THREE.SphereGeometry(2.2,12,10),
        new THREE.MeshStandardMaterial({color:0x2e444d,metalness:0.5,roughness:0.45}),
        Math.cos(a)*7,1.2,Math.sin(a)*7);
      pod.scale.set(1,0.8,1);g.add(pod);
    }
    const core=part(new THREE.SphereGeometry(2,14,12),
      new THREE.MeshStandardMaterial({color:0x7fffd0,emissive:0x7fffd0,emissiveIntensity:0.9,roughness:0.3,transparent:true,opacity:0.85}),0,5,0);
    g.add(core);this.glows.push(core);
    const spire=part(new THREE.ConeGeometry(0.6,6,10),
      new THREE.MeshStandardMaterial({color:0x9fe8ff,emissive:0x7fffd0,emissiveIntensity:0.5,roughness:0.4}),0,8,0);
    g.add(spire);
    return g;
  },
  spawnLab(){
    const p=this.farPoint(300,440,false);
    this.shipPos=p;   // reuse as destination marker
    this.structure=this.buildLab();
    this.structure.position.set(p.x,heightAt(p.x,p.z),p.z);
    scene.add(this.structure);
    // guide pillars along a randomly-curved route, so the lab must be searched for
    const gpts=this.curvedPath(p.x,p.z,3,0.3,0.9,40);
    for(const q of gpts){
      const gd=this.buildGuide(0x7fffd0);
      gd.position.set(q.x,heightAt(q.x,q.z),q.z);
      scene.add(gd);this.guides.push(gd);
    }
  },
  // mission 3: mark existing moon rocks as collectable. We spawn dedicated sample rocks.
  buildMoonRock(){
    const g=new THREE.Group();
    const m=new THREE.MeshStandardMaterial({color:0x8a94a0,emissive:0x2a3238,emissiveIntensity:0.5,roughness:0.9,flatShading:true});
    g.add(part(new THREE.DodecahedronGeometry(0.8,0),m,0,0.6,0));
    g.add(part(new THREE.DodecahedronGeometry(0.5,0),m,0.5,0.3,0.3));
    const gl=new THREE.Mesh(new THREE.SphereGeometry(1.3,10,8),
      new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0.18,depthWrite:false,blending:THREE.AdditiveBlending}));
    gl.position.y=0.6;g.add(gl);
    g.userData={moonRock:true,lift:0,phase:Math.random()*6.28,glow:gl};
    return g;
  },
  spawnMoonRocks(){
    const pts=this.scatter(5,150,420);
    for(const p of pts){
      const r=this.buildMoonRock();
      r.position.set(p.x,heightAt(p.x,p.z)+0.2,p.z);
      r.userData.baseY=r.position.y;
      scene.add(r);this.targets.push(r);
    }
  },

  /* =================== MARS — the gem altar =================== */
  beginMars(){
    this.need={};
    // mission 1: find the altar, placed far
    const p=this.farPoint(320,460,false);
    this.shipPos=p;
    this.structure=this.buildAltar();
    this.structure.position.set(p.x,heightAt(p.x,p.z),p.z);
    scene.add(this.structure);
    // faint guide markers along a curved route toward the altar
    const gpts=this.curvedPath(p.x,p.z,3,0.3,0.9,40);
    for(const q of gpts){
      const gd=this.buildGuide(0xff8050);
      gd.position.set(q.x,heightAt(q.x,q.z),q.z);
      scene.add(gd);this.guides.push(gd);
    }
    setTimeout(()=>banner(t('banner.marsDirective')),900);
  },
  buildAltar(){
    // round stepped stone dais with 5 holes that light up when filled
    const g=new THREE.Group();
    const base=part(new THREE.CylinderGeometry(6,7,1.4,24),
      new THREE.MeshStandardMaterial({color:0x4a2820,roughness:0.9,flatShading:true}),0,0.7,0);
    g.add(base);
    const tier=part(new THREE.CylinderGeometry(4.4,5,1.0,24),
      new THREE.MeshStandardMaterial({color:0x5a352a,roughness:0.85}),0,1.6,0);
    g.add(tier);
    this._holes=[];
    const GEMS=[0xff3b30,0x30d060,0x3080ff,0x9040ff,0xf0f0f0];
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2;
      const hole=part(new THREE.CylinderGeometry(0.6,0.6,0.4,12),
        new THREE.MeshStandardMaterial({color:0x120a08,roughness:1}),Math.cos(a)*3,2.15,Math.sin(a)*3);
      g.add(hole);
      // the gem that will appear (hidden until filled)
      const gem=part(new THREE.OctahedronGeometry(0.7,0),
        new THREE.MeshStandardMaterial({color:GEMS[i],emissive:GEMS[i],emissiveIntensity:0.9,roughness:0.2,transparent:true,opacity:0.95}),
        Math.cos(a)*3,2.6,Math.sin(a)*3);
      gem.visible=false;g.add(gem);
      this._holes.push({gem,color:GEMS[i]});
    }
    const glyph=part(new THREE.TorusGeometry(2,0.3,8,20),
      new THREE.MeshStandardMaterial({color:0xff8050,emissive:0xff6030,emissiveIntensity:0.6,roughness:0.5}),0,2.2,0);
    glyph.rotation.x=Math.PI/2;g.add(glyph);this.glows.push(glyph);
    return g;
  },
  buildMarsCrystal(kind){
    const COLORS={red:0xff3b30,green:0x30d060,blue:0x3080ff,violet:0x9040ff,white:0xf0f0f0};
    const col=COLORS[kind];
    const g=new THREE.Group();
    const m=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.85,roughness:0.15,metalness:0.1,transparent:true,opacity:0.95});
    for(let i=0;i<3;i++){
      const c=part(new THREE.OctahedronGeometry(0.4+Math.random()*0.3,0),m,
        (Math.random()-0.5)*0.9,0.5+Math.random()*0.3,(Math.random()-0.5)*0.9);
      c.scale.y=1.6+Math.random();g.add(c);
    }
    const beacon=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,150,8,1,true),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.16,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
    beacon.position.y=75;g.add(beacon);
    g.userData={marsCrystal:kind,color:col,lift:0,phase:Math.random()*6.28,mat:m,baseY:0};
    return g;
  },
  spawnMarsCrystals(){
    const kinds=['red','green','blue','violet','white'];
    const pts=this.scatter(5,160,440);
    kinds.forEach((k,i)=>{
      const c=this.buildMarsCrystal(k);
      const p=pts[i];const gy=heightAt(p.x,p.z);
      c.position.set(p.x,gy+0.4,p.z);c.userData.baseY=gy+0.4;
      scene.add(c);this.samples.push(c);
    });
    this.need={red:false,green:false,blue:false,violet:false,white:false};
  },

  /* =================== HUD =================== */
  hud(){
    let txt='';
    const w=this.world;
    const mn=s=>'<span class="mnum">'+s+'</span>';
    if(w==='earth'){
      if(this.stage===1)txt=t('story.hud.e1');
      else if(this.stage===2){
        const n=(this.need.crystal?1:0)+(this.need.water?1:0)+(this.need.sand?1:0);
        txt=n>=3?t('story.hud.e2.return'):t('story.hud.e2.gather',{n:mn(n+'/3')});
      }
      else if(this.stage===3)txt=t('story.hud.e3',{n:mn(this.count+'/50')});
      else txt=t('story.hud.e.done');
    }else if(w==='moon'){
      if(this.stage===1)txt=t('story.hud.m1',{n:mn(this.need.spyders+'/5')});
      else if(this.stage===2)txt=t('story.hud.m2',{hint:mn(t('story.hud.m2.hint'))});
      else if(this.stage===3)txt=t('story.hud.m3',{n:mn(this.need.rocks+'/5')});
      else txt=t('story.hud.m.done');
    }else if(w==='mars'){
      if(this.stage===1)txt=t('story.hud.r1',{hint:mn(t('story.hud.r1.hint'))});
      else if(this.stage===2){
        const n=Object.values(this.need).filter(Boolean).length;
        txt=t('story.hud.r2',{n:mn(n+'/5')});
      }
      else if(this.stage===3)txt=t('story.hud.r3',{n:mn(this.count+'/15')});
      else txt=t('story.hud.r.done');
    }
    if(txt!==this._last){document.getElementById('sTxt').innerHTML=txt;this._last=txt;}
  },

  /* =================== collection hooks =================== */
  // earth crystal harvest
  crystalHook(){
    if(!this.active)return;
    if(this.world==='earth'){
      if(this.stage===2&&!this.need.crystal){this.need.crystal=true;banner(t('banner.crystalSecured'));this.hud();}
      else if(this.stage===3){this.count++;this.hud();if(this.count>=50)completeStage(3);}
    }
  },
  // any animal captured (mars mission 3 counts species)
  animalHook(name){
    if(!this.active)return;
    if(this.world==='mars'&&this.stage===3){
      this.count++;this.hud();
      if(this.count>=15)completeStage(3);
    }
  },

  /* =================== per-frame update =================== */
  update(dt,beamActive){
    if(!this.active||this.stage>=4)return;
    const t=performance.now()*0.001;
    for(const gl of this.glows)if(gl.material)gl.material.emissiveIntensity=0.5+0.4*Math.sin(t*4+ (gl.position?gl.position.x:0));
    if(this.world==='earth')this.updateEarth(dt,beamActive,t);
    else if(this.world==='moon')this.updateMoon(dt,beamActive,t);
    else if(this.world==='mars')this.updateMars(dt,beamActive,t);
    this.hud();
  },
  _liftInBeam(p,u,dt,beamActive){
    const R=effBeamR();
    const sx=p.position.x-saucer.position.x, sz=p.position.z-saucer.position.z;
    const inB=beamActive&&(sx*sx+sz*sz)<R*R;
    if(inB){u.lift=Math.min(1,u.lift+dt/0.95);p.rotation.y+=dt*5;}
    else if(u.lift>0)u.lift=Math.max(0,u.lift-dt*1.6);
    p.position.y=u.baseY+u.lift*(saucer.position.y-2-u.baseY);
    p.scale.setScalar(Math.max(0.05,1-u.lift*0.55));
    return u.lift>=1;
  },
  updateEarth(dt,beamActive,tt){
    for(const d of this.debris)if(d.children[0])d.children[0].material.emissiveIntensity=0.25+0.25*Math.sin(tt*2.5+d.position.x);
    const dx=saucer.position.x-this.shipPos.x,dz=saucer.position.z-this.shipPos.z;
    const near=(dx*dx+dz*dz)<26*26;
    if(this.stage===1&&near){completeStage(1);return;}
    if(this.stage===2){
      if(near&&this.need.crystal&&this.need.water&&this.need.sand){completeStage(2);return;}
      for(let i=this.samples.length-1;i>=0;i--){
        const p=this.samples[i],u=p.userData;
        u.mat.emissiveIntensity=0.6+0.3*Math.sin(tt*2+u.phase);
        if(this._liftInBeam(p,u,dt,beamActive)){
          scene.remove(p);this.samples.splice(i,1);
          spawnPop(p.position,'+1',t('label.SAMPLE'));beep(523,0.12,0.09);
          this.need[u.sampleKind]=true;
          banner(t(u.sampleKind==='water'?'banner.waterSecured':'banner.sandSecured'));this.hud();
        }
      }
    }
  },
  updateMoon(dt,beamActive,tt){
    if(this.stage===1){
      for(let i=this.targets.length-1;i>=0;i--){
        const p=this.targets[i],u=p.userData;
        p.scale.setScalar(1+0.05*Math.sin(tt*3+u.phase));
        if(this._liftInBeam(p,u,dt,beamActive)){
          scene.remove(p);this.targets.splice(i,1);
          this.need.spyders++;spawnPop(p.position,'+1',t('label.SPYDER'));beep(660,0.12,0.09);
          banner(t('banner.spyderCap',{n:this.need.spyders}));this.hud();
          if(this.need.spyders>=5)completeStage(1);
        }
      }
    }else if(this.stage===2){
      const dx=saucer.position.x-this.shipPos.x,dz=saucer.position.z-this.shipPos.z;
      if((dx*dx+dz*dz)<28*28)completeStage(2);
    }else if(this.stage===3){
      for(let i=this.targets.length-1;i>=0;i--){
        const p=this.targets[i],u=p.userData;
        if(u.glow)u.glow.material.opacity=0.14+0.1*Math.sin(tt*3+u.phase);
        if(this._liftInBeam(p,u,dt,beamActive)){
          scene.remove(p);this.targets.splice(i,1);
          this.need.rocks++;spawnPop(p.position,'+1',t('label.ROCK'));beep(523,0.12,0.09);
          banner(t('banner.rockSample',{n:this.need.rocks}));this.hud();
          if(this.need.rocks>=5)completeStage(3);
        }
      }
    }
  },
  updateMars(dt,beamActive,tt){
    if(this.stage===1){
      const dx=saucer.position.x-this.shipPos.x,dz=saucer.position.z-this.shipPos.z;
      if((dx*dx+dz*dz)<30*30)completeStage(1);
    }else if(this.stage===2){
      // collect gems and fill altar holes
      for(let i=this.samples.length-1;i>=0;i--){
        const p=this.samples[i],u=p.userData;
        u.mat.emissiveIntensity=0.7+0.3*Math.sin(tt*2+u.phase);
        if(this._liftInBeam(p,u,dt,beamActive)){
          scene.remove(p);this.samples.splice(i,1);
          this.need[u.marsCrystal]=true;
          // light the matching altar hole
          if(this.structure&&this.structure.userData){}
          if(this._holes){const hh=this._holes.find(h=>h.color===u.color&&!h.gem.visible);if(hh)hh.gem.visible=true;}
          spawnPop(p.position,'+1',t('label.'+u.marsCrystal.toUpperCase()));beep(587,0.12,0.09);
          banner(t('banner.gemPlaced',{gem:t('label.'+u.marsCrystal.toUpperCase())}));this.hud();
          if(Object.values(this.need).filter(Boolean).length>=5){
            const dx=saucer.position.x-this.shipPos.x,dz=saucer.position.z-this.shipPos.z;
            // must return to altar to complete (already near since gems auto-place)
          }
        }
      }
      // completion: all five placed
      if(Object.values(this.need).filter(Boolean).length>=5)completeStage(2);
    }
    // stage 3 handled by animalHook
  }
};
function completeStage(n){
  S.state='storyPause';
  BeamSFX.stop();S.prevBeam=false;
  if(n===3){S.score+=150;scoreV.textContent=S.score;}
  const w=Story.world||'earth';
  const title=t('story.'+w+'.'+n+'.title'), flavor=t('story.'+w+'.'+n+'.flavor');
  document.getElementById('stTitle').innerHTML=title;
  document.getElementById('stFlavor').textContent=flavor.replace(/<[^>]+>/g,'');
  const mins=Math.floor(S.elapsed/60),secs=Math.floor(S.elapsed%60);
  const rows=[[t('stat.harvest'),S.score],[t('stat.specimens'),S.taken],[t('stat.crystals'),S.crystals],
    [t('stat.energy'),Math.round(S.energy*100)+'%'],[t('stat.elapsed'),mins+':'+(secs<10?'0':'')+secs]];
  document.getElementById('stStats').innerHTML=
    rows.map(r=>'<div class="bk"><span>'+r[0]+'</span><span>'+r[1]+'</span></div>').join('');
  document.getElementById('stBtn').textContent=n===3?t('story.roam'):t('story.next');
  document.getElementById('storyScreen').classList.remove('hidden');
  beep(659,0.2,0.09);setTimeout(()=>beep(880,0.25,0.09),150);setTimeout(()=>beep(1318,0.4,0.09),320);
  Story._pending=n;
}
export function storyProceed(){
  document.getElementById('storyScreen').classList.add('hidden');
  const n=Story._pending, w=Story.world;
  if(n>=3){Story.stage=4;}
  else if(w==='earth'){
    if(n===1){Story.stage=2;Story.spawnSamples();}
    else if(n===2){Story.stage=3;Story.count=0;}
  }else if(w==='moon'){
    if(n===1){Story.stage=2;Story.spawnLab();}
    else if(n===2){Story.stage=3;Story.spawnMoonRocks();}
  }else if(w==='mars'){
    if(n===1){Story.stage=2;Story.spawnMarsCrystals();}
    else if(n===2){Story.stage=3;Story.count=0;}
  }
  Story.hud();
  S.state='playing';
}
