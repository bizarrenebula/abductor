/* =========================================================================
   EGYPT — pyramids, and the sphinx that keeps one of them company.

   A joke with a straight face. The run begins at Area 51 in the middle of a
   desert, so the desert may as well have the other thing everyone pictures when
   you say "desert". They are placed like real monuments — rare, enormous, and
   visible from a long way off — rather than scattered as scenery.

   SCALE. A real Great Pyramid is 146m on a 230m base, which at this world's
   yardstick (~0.85m per unit) would be 172 units tall — half again as tall as
   the biggest mountain in the game and completely out of key. These are 58
   units to the apex on a 92-unit base: the tallest thing in a region that has
   no mountains at all, so it still reads as a landmark from the air without
   breaking the skyline.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { mat, part, measureSolid } from '../core/mesh.js';
import { disposable } from '../core/dispose.js';

export const PYRAMID_R = 46;      // base half-width
export const PYRAMID_H = 58;      // apex height

/* Sandstone. Warm and pale, and a shade lighter than the dune colour so the
   silhouette separates from the sand it stands on instead of melting into it. */
/* These look far too dark written down, and that is correct. The renderer has
   outputEncoding = sRGBEncoding but three r128 does NOT convert a hex passed to
   a material, so every colour here is a LINEAR value that gets brightened on
   the way out. #9c7b4f typed literally arrives on screen as a pale grey and the
   pyramid reads as a snowdrift. These are the linear pre-images of the sandstone
   actually wanted: 0x553a14 lands on ~#9c7b4f, 0x957447 on ~#c9b491.
   (The same trap ate the farmland palette earlier — see world/fields.js.) */
const STONE  = 0x553a14;
const CASING = 0x957447;          // the polished limestone that survives at the cap

export function buildPyramid(){
  const g=new THREE.Group();
  const stone=mat(STONE,0.96);
  /* A 4-sided cone IS a square pyramid. Rotated an eighth turn so the faces
     square up to the world axes rather than presenting an edge, which is what
     makes it read as built rather than as a rock. flatShading throughout: a
     pyramid is four flat planes and smooth normals would round it off. */
  const body=new THREE.Mesh(new THREE.ConeGeometry(PYRAMID_R,PYRAMID_H,4),stone);
  body.rotation.y=Math.PI/4;
  body.position.y=PYRAMID_H/2;
  body.castShadow=true; body.receiveShadow=true;
  g.add(body);
  // the surviving casing at the apex, the one detail that says Giza
  const cap=new THREE.Mesh(new THREE.ConeGeometry(PYRAMID_R*0.17,PYRAMID_H*0.17,4),
                           mat(CASING,0.7));
  cap.rotation.y=Math.PI/4;
  cap.position.y=PYRAMID_H*0.915;
  g.add(cap);
  // sand drifted up against the base, so it sits IN the desert rather than on it
  const skirt=new THREE.Mesh(new THREE.CylinderGeometry(PYRAMID_R*1.02,PYRAMID_R*1.14,3.2,4),
                             mat(0x6e491d,0.98));
  skirt.rotation.y=Math.PI/4; skirt.position.y=1.6;
  g.add(skirt);

  const u=g.userData;
  u.solid=true;
  /* A cylinder hitbox on a pyramid would stop the ship dead in open air level
     with the apex, 40 units clear of any stone. `cone` tells collision.js to
     test the real silhouette: allowed height falls off linearly with distance
     from the centre. */
  u.cone=true; u.coneR=PYRAMID_R; u.coneH=PYRAMID_H;
  u.rad=PYRAMID_R; u.top=PYRAMID_H;
  return g;
}

/* ---- rounded masses ----------------------------------------------------
   The Sphinx needs blocks, not blobs. Two earlier passes proved it: sharp boxes
   gave the right outline but read as a parked lorry, and ellipsoids softened it
   so far that it became a seal. What is wanted is a BOX with the edges taken
   off — which is what four and a half thousand years of blown sand actually
   does to limestone.

   A superellipsoid gives exactly that from one shared geometry. Take a unit
   sphere and re-project every vertex to radius (|x|^p+|y|^p+|z|^p)^(-1/p): at
   p=2 it is the sphere it started as, as p rises the faces flatten and the
   corners tighten, and at p=7 it is a box with a generous fillet. Scaling that
   one shape per mass keeps the silhouette square where it must be and soft
   everywhere it meets the light. */
const _roundBox=(function(){
  const g=new THREE.SphereGeometry(1,28,18);
  const pos=g.attributes.position, P=7, v=new THREE.Vector3();
  for(let i=0;i<pos.count;i++){
    v.fromBufferAttribute(pos,i).normalize();
    const k=Math.pow(Math.pow(Math.abs(v.x),P)+Math.pow(Math.abs(v.y),P)
                    +Math.pow(Math.abs(v.z),P),-1/P);
    pos.setXYZ(i,v.x*k,v.y*k,v.z*k);
  }
  g.computeVertexNormals();
  return g;                       // shared, never disposed with an instance
})();
function slab(m,w,h,d,x,y,z){
  const o=new THREE.Mesh(_roundBox,m);
  o.scale.set(w/2,h/2,d/2); o.position.set(x,y,z);
  o.castShadow=true; o.receiveShadow=true;
  return o;
}

/* The Sphinx: long low body, forelegs thrown right out in front, small head
   under a broad headdress. The real one is 73m long and 20m high — nearly four
   times as long as it is tall — and that ratio is the whole recognisability of
   the thing, so the masses below are laid out to it and the fine detail (brow,
   beard, the lappets of the nemes) is left off deliberately. */
export function buildSphinx(){
  const g=new THREE.Group();
  /* mat() forces flatShading, which is exactly what this must not have — the
     point of the rounded blocks is that the light wraps around them. */
  const stone=disposable(new THREE.MeshStandardMaterial({color:STONE,roughness:0.96,metalness:0.02}));
  const dark =disposable(new THREE.MeshStandardMaterial({color:0x251609,roughness:0.96,metalness:0.02}));

  g.add(slab(dark ,12.0,1.4,33.0,  0, 0.7,  0.0));   // bedrock trench
  g.add(slab(stone, 6.2,5.2,17.0,  0, 3.8, -3.0));   // body
  g.add(slab(stone, 7.0,6.4, 5.2,  0, 4.4,-12.0));   // haunches
  g.add(slab(stone, 6.6,5.6, 4.2,  0, 4.2,  6.0));   // shoulders
  for(const sx of [-2.0,2.0]){
    g.add(slab(stone,2.4,2.4,14.0, sx, 2.4, 11.0));  // foreleg
    g.add(slab(stone,2.7,1.8, 2.2, sx, 1.9, 18.2));  // paw
  }
  g.add(slab(stone,3.0,3.2, 2.6,  0, 7.4,  6.6));    // neck
  g.add(slab(stone,5.4,4.6, 3.6,  0,10.2,  6.9));    // nemes headdress
  g.add(slab(stone,3.0,3.2, 1.8,  0, 9.6,  8.6));    // face

  const u=g.userData;
  u.solid=true;
  measureSolid(g);
  return g;
}
