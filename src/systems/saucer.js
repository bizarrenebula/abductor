/* =========================================================================
   SAUCER — the player ship (procedural fallback body + rim lights), its glow
   lights, and the floating energy bar that hovers above it.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { lerp } from '../core/math.js';
import { scene, camera } from '../core/engine.js';
import { S } from '../core/state.js';

export const saucer=new THREE.Group();
(function(){
  const hull=new THREE.Mesh(
    new THREE.SphereGeometry(5,40,20),
    new THREE.MeshStandardMaterial({color:0x8fa0b0,metalness:0.95,roughness:0.25})
  );
  hull.scale.set(1,0.28,1);hull.castShadow=true;saucer.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(5,0.5,12,44),
    new THREE.MeshStandardMaterial({color:0x39424c,metalness:1,roughness:0.35}));
  rim.rotation.x=Math.PI/2;saucer.add(rim);
  const dome=new THREE.Mesh(new THREE.SphereGeometry(2.4,28,18,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x9fe8ff,metalness:0.1,roughness:0.05,
      transparent:true,opacity:0.55,emissive:0x184a55,emissiveIntensity:0.5}));
  dome.position.y=1.1;saucer.add(dome);
  const under=new THREE.Mesh(new THREE.SphereGeometry(3.2,28,16,0,Math.PI*2,Math.PI/2,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x2a333c,metalness:0.9,roughness:0.4}));
  under.position.y=-0.4;saucer.add(under);
  // rim lights
  const lights=new THREE.Group();
  for(let i=0;i<10;i++){
    const a=i/10*Math.PI*2;
    const b=new THREE.Mesh(new THREE.SphereGeometry(0.42,10,10),
      new THREE.MeshBasicMaterial({color:0x59ffb0,transparent:true}));
    b.position.set(Math.cos(a)*4.7,-0.15,Math.sin(a)*4.7);
    lights.add(b);
  }
  saucer.add(lights);saucer.userData.lights=lights;
  // hull/dome/under/rim are the fallback body; tag them so we can hide them
  saucer.userData.procBody=[hull,rim,dome,under];
})();
scene.add(saucer);
saucer.position.set(0,40,0);

/* saucer glow point light */
export const beamLight=new THREE.PointLight(0x59ffb0,0,60,2);
scene.add(beamLight);
/* soft running light: the ship glows and lights the ground below */
export const shipLight=new THREE.PointLight(0xaef0cc,0.85,50,2);
scene.add(shipLight);

/* floating energy bar above the saucer — shows while beaming or when low */
const EB_W=6.6;
const ebar3=new THREE.Group();
const ebarBG=new THREE.Mesh(new THREE.PlaneGeometry(7.2,0.8),
  new THREE.MeshBasicMaterial({color:0x08110c,transparent:true,opacity:0,depthTest:false}));
const ebarFill3=new THREE.Mesh(new THREE.PlaneGeometry(EB_W,0.44),
  new THREE.MeshBasicMaterial({color:0x59ffb0,transparent:true,opacity:0,depthTest:false}));
ebarFill3.position.z=0.02;
ebarBG.renderOrder=998;ebarFill3.renderOrder=999;
ebar3.add(ebarBG);ebar3.add(ebarFill3);
scene.add(ebar3);
export { ebarBG, ebarFill3 };
export function updateEnergyBar(dt,show){
  const tgt=show?1:0;
  ebarBG.material.opacity=lerp(ebarBG.material.opacity,tgt*0.55,Math.min(1,dt*6));
  ebarFill3.material.opacity=lerp(ebarFill3.material.opacity,tgt*0.95,Math.min(1,dt*6));
  ebar3.position.set(saucer.position.x,saucer.position.y+7.5,saucer.position.z);
  ebar3.quaternion.copy(camera.quaternion);
  const e=Math.max(0.001,S.energy);
  ebarFill3.scale.x=e;
  ebarFill3.position.x=-(1-e)*EB_W/2;
  ebarFill3.material.color.setHex(S.energy<0.28?0xff5040:0x59ffb0);
}
