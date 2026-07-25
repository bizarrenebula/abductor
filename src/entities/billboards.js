/* =========================================================================
   BILLBOARDS — roadside advertising hoardings. Purely set dressing you can't
   really read, but they stand tall beside the road and are SOLID, so a low pass
   clips one and crashes the ship (a barn-style obstacle). The sign face is a
   throwaway procedural "ad" that glows faintly, so it reads as a lit hoarding at
   night without costing a real light.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE } from '../core/constants.js';
import { mat, part, measureSolid } from '../core/mesh.js';

/* A random, unreadable poster: a bright field with a few blocks and bars in
   contrasting colours — enough to read as "an advert" from the air. */
function adTexture(){
  const c=document.createElement('canvas');c.width=256;c.height=160;
  const x=c.getContext('2d');
  const H=[0xff6b4a,0x4ad2ff,0xffd23f,0x8f5bff,0x3fd98a,0xff4a8f];
  const hex=h=>'#'+h.toString(16).padStart(6,'0');
  x.fillStyle=hex(H[(Math.random()*H.length)|0]);x.fillRect(0,0,256,160);
  // a contrasting panel block
  x.fillStyle=hex(H[(Math.random()*H.length)|0]);
  x.fillRect(12+Math.random()*40,18+Math.random()*30,90+Math.random()*80,50+Math.random()*50);
  // a couple of "text" bars
  x.fillStyle='rgba(20,20,24,0.85)';
  for(let i=0;i<3;i++)x.fillRect(20,96+i*16,80+Math.random()*150,8);
  // a bright accent dot / logo
  x.fillStyle=hex(H[(Math.random()*H.length)|0]);
  x.beginPath();x.arc(210+Math.random()*30,40+Math.random()*20,18,0,Math.PI*2);x.fill();
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.anisotropy=2;return t;
}

export function buildBillboard(){
  const g=new THREE.Group();
  const post=mat(0x2a2622,0.85), frame=mat(0x14110e,0.8);
  // two legs
  g.add(part(new THREE.CylinderGeometry(0.16,0.2,8.4,6),post,-2.1,4.2,0));
  g.add(part(new THREE.CylinderGeometry(0.16,0.2,8.4,6),post, 2.1,4.2,0));
  // cross-brace
  g.add(part(new THREE.BoxGeometry(4.6,0.22,0.22),frame,0,6.4,0));
  // the board: frame + a glowing ad face pointing +Z (toward the road)
  g.add(part(new THREE.BoxGeometry(6.4,3.4,0.3),frame,0,8.7,0));
  const tex=adTexture();
  const faceMat=new THREE.MeshStandardMaterial({map:tex,emissive:0xffffff,emissiveMap:tex,
    emissiveIntensity:0.4,roughness:0.7,metalness:0,flatShading:true});
  g.add(part(new THREE.PlaneGeometry(6.0,3.0),faceMat,0,8.7,0.17));
  g.scale.setScalar(OBJ_SCALE);
  g.userData.solid=true;          // crashing into it behaves like a barn
  g.userData.billboard=true;
  measureSolid(g);
  return g;
}
