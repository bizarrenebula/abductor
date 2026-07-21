/* =========================================================================
   THREE — central handle to the global THREE (loaded via classic <script> in
   index.html, since r128 ships no ESM build) plus the shared GLTFLoader.

   Import THREE from here everywhere so the low-res geometry wrap below is
   guaranteed to run FIRST: this module evaluates before any importer's body,
   so every geometry constructor is already patched on mobile before the first
   mesh is built.
   ========================================================================= */
import { env } from './env.js';

export const THREE = window.THREE;

/* On LOW_END (mobile), wrap primitive geometry constructors so every procedural
   creature/prop/hazard is built with fewer segments — one global change that
   lightens all inline geometries at once. Runs before any geometry is created. */
(function lowResGeometry(){
  if(!env.LOW_END||typeof THREE==='undefined')return;
  const T=THREE;
  const clampSeg=(v,min)=>Math.max(min,Math.round(v*0.6));
  const wrap=(name,idxs,mins)=>{
    const Orig=T[name];if(!Orig)return;
    function LowRes(...a){
      idxs.forEach((ix,k)=>{ if(typeof a[ix]==='number')a[ix]=clampSeg(a[ix],mins[k]); });
      return new Orig(...a);
    }
    LowRes.prototype=Orig.prototype;
    T[name]=LowRes;
  };
  wrap('SphereGeometry',[1,2],[6,5]);        // (r, widthSeg, heightSeg)
  wrap('CylinderGeometry',[3],[5]);          // (rTop, rBottom, h, radialSeg)
  wrap('ConeGeometry',[2],[5]);              // (r, h, radialSeg)
  wrap('TorusGeometry',[2,3],[6,10]);        // (r, tube, radialSeg, tubularSeg)
  wrap('CircleGeometry',[1],[10]);           // (r, seg)
  wrap('RingGeometry',[2],[16]);             // (inner, outer, thetaSeg)
})();

export const GLTF = (typeof THREE!=='undefined' && THREE.GLTFLoader) ? new THREE.GLTFLoader() : null;
