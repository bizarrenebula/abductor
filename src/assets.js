/* =========================================================================
   ASSETS — optional custom GLB/texture loading with case-insensitive path
   fallbacks (GitHub Pages is case-sensitive), safe cloning of rigged models,
   and the splash-screen load diagnostics. Everything degrades to the built-in
   procedural version when an asset is missing or high-detail is off.
   ========================================================================= */
import { THREE, GLTF } from './core/three.js';
import { env, assetsOn } from './core/env.js';
import { ASSETS } from './core/constants.js';
import { getEnv } from './core/engine.js';
import { TEX } from './world/textures.js';

export const LOADED={};    // name -> prepared template Object3D

export function loadGLB(name){
  const cfg=ASSETS[name];
  return new Promise(res=>{
    if(!assetsOn()||!GLTF||!cfg||!cfg.url){res(null);return;}
    const stem=cfg.url.replace(/\.glb$/i,'');
    const tries=[cfg.url,stem+'.glb',stem+'.GLB'].filter((u,i,a)=>a.indexOf(u)===i);
    const attempt=i=>GLTF.load(tries[i],gltf=>{
      const root=new THREE.Group();
      const m=gltf.scene;
      m.traverse(o=>{ if(o.isMesh){o.castShadow=!env.LOW_END;o.receiveShadow=false;
        if(o.material){
          o.material.fog=true;
          if(o.material.isMeshStandardMaterial){
            const em=getEnv();
            if(em){o.material.envMap=em;o.material.envMapIntensity=1.5;}
            if(o.material.metalness>0.7)o.material.metalness=0.55;   // pure metal = black without strong env
            o.material.roughness=Math.max(o.material.roughness??0.5,0.25);
            o.material.needsUpdate=true;
          }
        } } });
      m.scale.setScalar(cfg.scale||1);
      m.rotation.y=cfg.rotY||0;
      // auto-seat the model so its base sits at y=0 (Meshy pivots are centered, which buries props).
      // Skip for the saucer (it flies) and creatures that get their own baseY handling.
      if(cfg.seat!==false){
        m.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(m);
        if(isFinite(box.min.y))m.position.y=-box.min.y;
      }
      m.position.y+=(cfg.yOffset||0);
      root.add(m);
      LOADED[name]=root;
      res(root);
    },undefined,err=>{
      if(i+1<tries.length){attempt(i+1);return;}
      console.warn('[assets] '+name+' failed:',err&&err.message);res(null);
    });
    attempt(0);
  });
}
export function loadTex(name){
  const cfg=ASSETS[name];
  return new Promise(res=>{
    if(!assetsOn()||!cfg||!cfg.url){res(null);return;}
    const tl=new THREE.TextureLoader();
    const finish=t=>{
      t.wrapS=t.wrapT=THREE.RepeatWrapping;t.encoding=THREE.sRGBEncoding;
      if(cfg.repeat)t.repeat.set(cfg.repeat,cfg.repeat);
      TEX[name]=t;res(t);
    };
    // GitHub Pages is case-sensitive: walk every common extension spelling
    const stem=cfg.url.replace(/\.(jpe?g|png)$/i,'');
    const tries=[cfg.url,stem+'.jpg',stem+'.JPG',stem+'.png',stem+'.PNG',stem+'.jpeg',stem+'.JPEG']
      .filter((u,i,a)=>a.indexOf(u)===i);
    (function next(i){
      if(i>=tries.length){res(null);return;}
      tl.load(tries[i],finish,undefined,()=>next(i+1));
    })(0);
  });
}
export function spawnModel(name){                 // fresh clone for one entity, or null
  const tpl=LOADED[name]; if(!tpl)return null;
  try{
    // SkeletonUtils-free: plain clone. If the source has a SkinnedMesh (rigged/animated
    // export), clone(true) produces a broken clone — detect and bake to a static pose instead.
    let skinned=false;
    tpl.traverse(o=>{ if(o.isSkinnedMesh)skinned=true; });
    if(skinned){
      if(!tpl.userData._static){       // build a static, unrigged version once, then clone that
        const st=new THREE.Group();
        tpl.traverse(o=>{ if(o.isMesh){
          const mm=new THREE.Mesh(o.geometry, o.material);
          o.updateWorldMatrix(true,false);
          mm.applyMatrix4(o.matrixWorld);
          mm.castShadow=!env.LOW_END;
          st.add(mm);
        }});
        tpl.userData._static=st;
      }
      return tpl.userData._static.clone(true);
    }
    return tpl.clone(true);
  }catch(e){ console.warn('[assets] clone failed for '+name+':',e&&e.message); return null; }
}

/* ---------- splash load diagnostics ---------- */
export const LOAD_ORDER=['loader','saucer','sheep','duck','camel','goat','crystal','barn','hiker','tree','grass','mountain','sand'];
(function diagInit(){
  const d=document.getElementById('splashLog');if(!d)return;
  if(env.LOW_END){d.innerHTML='<div><b>mobile mode</b></div><div>procedural graphics · optimized for speed</div>';return;}
  d.innerHTML=LOAD_ORDER.map(n=>'<div id="ld-'+n+'">'+n+': <span>…</span></div>').join('');
})();
export function diagSet(name,ok){
  const el=document.getElementById('ld-'+name);if(!el)return;
  el.innerHTML=name+': '+(ok?'<b>OK</b>':'<i>built-in</i>');
}
diagSet('loader',!!GLTF);
export function loadAllAssets(){
  return Promise.all([
    loadGLB('saucer').then(r=>diagSet('saucer',!!r)),
    loadGLB('sheep').then(r=>diagSet('sheep',!!r)),
    loadGLB('duck').then(r=>diagSet('duck',!!r)),
    loadGLB('camel').then(r=>diagSet('camel',!!r)),
    loadGLB('goat').then(r=>diagSet('goat',!!r)),
    loadGLB('crystal').then(r=>diagSet('crystal',!!r)),
    loadGLB('barn').then(r=>diagSet('barn',!!r)),
    loadGLB('hiker').then(r=>diagSet('hiker',!!r)),
    loadGLB('tree').then(r=>diagSet('tree',!!r)),
    loadTex('grass').then(r=>diagSet('grass',!!r)),
    loadTex('mountain').then(r=>diagSet('mountain',!!r)),
    loadTex('sand').then(r=>diagSet('sand',!!r))
  ]);
}
