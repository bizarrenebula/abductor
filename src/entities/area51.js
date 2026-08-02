/* =========================================================================
   AREA 51 — the sign that stands beside the landing site.

   Every run now begins in the middle of the desert (see world/regions.js: the
   region field is pulled to sand inside a bowl around the origin), and this is
   what tells you WHERE in the desert. It is the first thing the player sees
   after the arrival film, so it is the one prop in the game that has to be
   legible rather than suggestive: real text on the panel, and the alien head
   drawn large enough to read from the air.

   One instance per world, placed by world/chunks.js in whichever chunk holds
   the spawn — far enough out that it is outside SPAWN_CLEAR and cannot be
   crashed into on arrival, close enough to be unmissable.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE } from '../core/constants.js';
import { mat, part, measureSolid } from '../core/mesh.js';
import { disposable } from '../core/dispose.js';

/* The alien head, drawn rather than modelled. A grey is a poor silhouette in
   three dimensions — it is a smooth blob whose whole identity is the outline
   and the two eyes — so it reads far better as flat art on a sign face than as
   geometry, and costs one canvas instead of a mesh. */
function alienHead(x,cx,cy,s,ink,paper){
  x.fillStyle=ink;
  x.beginPath();
  // cranium: broad dome carried well past the eyes, then a hard taper to a
  // narrow chin. The width at the temples is the whole silhouette — pull it in
  // and the head stops reading as a grey and starts reading as an egg.
  x.moveTo(cx,cy-1.00*s);
  x.bezierCurveTo(cx+0.62*s,cy-1.00*s, cx+0.80*s,cy-0.55*s, cx+0.66*s,cy-0.05*s);
  x.bezierCurveTo(cx+0.52*s,cy+0.52*s, cx+0.22*s,cy+0.86*s, cx,cy+1.00*s);
  x.bezierCurveTo(cx-0.22*s,cy+0.86*s, cx-0.52*s,cy+0.52*s, cx-0.66*s,cy-0.05*s);
  x.bezierCurveTo(cx-0.80*s,cy-0.55*s, cx-0.62*s,cy-1.00*s, cx,cy-1.00*s);
  x.fill();
  // Eyes are painted in the PAPER colour, not punched out with a composite op:
  // destination-out clears alpha, and a texture on an opaque material ignores
  // alpha, so the cut-out came back as black and the head read as a solid blob.
  x.fillStyle=paper;
  for(const sgn of [-1,1]){
    x.save();
    x.translate(cx+sgn*0.30*s, cy-0.16*s);
    x.rotate(-sgn*0.42);                 // outer corner high, inner corner low
    x.beginPath();
    x.ellipse(0,0,0.28*s,0.125*s,0,0,Math.PI*2);
    x.fill();
    x.restore();
  }
}

function signTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=384;
  const x=c.getContext('2d');
  // weathered government white, with a black keyline inset from the edge the way
  // a real regulatory sign is printed
  x.fillStyle='#d9d5c6';x.fillRect(0,0,512,384);
  x.fillStyle='#1a1712';x.fillRect(14,14,484,356);
  x.fillStyle='#d9d5c6';x.fillRect(22,22,468,340);

  alienHead(x,256,110,78,'#1a1712','#d9d5c6');

  x.fillStyle='#1a1712';
  x.textAlign='center';x.textBaseline='middle';
  x.font='bold 92px Helvetica, Arial, sans-serif';
  x.fillText('AREA 51',256,248);
  x.font='bold 30px Helvetica, Arial, sans-serif';
  x.fillText('RESTRICTED AREA',256,306);
  x.fillRect(150,330,212,5);

  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;t.anisotropy=4;
  return t;
}

export function buildArea51Sign(){
  const g=new THREE.Group();
  const post=mat(0x3a3630,0.9), frame=mat(0x1a1712,0.85);
  g.add(part(new THREE.CylinderGeometry(0.17,0.21,7.0,6),post,-1.9,3.5,0));
  g.add(part(new THREE.CylinderGeometry(0.17,0.21,7.0,6),post, 1.9,3.5,0));
  g.add(part(new THREE.BoxGeometry(4.4,0.20,0.20),frame,0,5.0,0));
  // backing board, then the printed face just proud of it on BOTH sides — you
  // arrive from the sky on no particular heading, so a one-sided sign is a blank
  // rectangle half the time
  g.add(part(new THREE.BoxGeometry(5.6,4.2,0.28),frame,0,7.1,0));
  const tex=disposable(signTexture());
  const faceMat=disposable(new THREE.MeshStandardMaterial({
    map:tex,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:0.30,
    roughness:0.85,metalness:0,side:THREE.DoubleSide}));
  const front=part(new THREE.PlaneGeometry(5.2,3.9),faceMat,0,7.1,0.16);
  const back =part(new THREE.PlaneGeometry(5.2,3.9),faceMat,0,7.1,-0.16);
  back.rotation.y=Math.PI;
  g.add(front);g.add(back);
  g.scale.setScalar(OBJ_SCALE);
  g.userData.solid=true;              // a billboard-class obstacle
  measureSolid(g);
  return g;
}
