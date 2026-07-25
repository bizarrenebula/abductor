/* =========================================================================
   GAS STATIONS — roadside stops. Each is a solid obstacle (the ship crashes
   into one, like a barn), doubles as a shelter the forecourt NPCs run to, and
   is placed just off the tarmac facing the road.

   Falls back to a procedural canopy-and-shop when gas_station.glb is absent.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, ASSETS } from '../core/constants.js';
import { mat, part, measureSolid } from '../core/mesh.js';
import { LOADED, spawnModel } from '../assets.js';
import { forecourtPool } from '../systems/nightlights.js';

function procStation(){
  const g=new THREE.Group();
  const wall=mat(0xb8b2a4,0.9), trim=mat(0x9a3b2e,0.7), post=mat(0x6d6a63,0.6);
  const glass=new THREE.MeshStandardMaterial({color:0x16221f,roughness:0.2,metalness:0.1,
    emissive:0xffe0a0,emissiveIntensity:0.35});
  // shop
  g.add(part(new THREE.BoxGeometry(5.2,3.0,3.6),wall,0,1.5,-2.2));
  g.add(part(new THREE.BoxGeometry(5.4,0.35,3.8),trim,0,3.15,-2.2));
  g.add(part(new THREE.BoxGeometry(4.0,1.5,0.12),glass,0,1.6,-0.42));
  // forecourt canopy over the pumps
  g.add(part(new THREE.BoxGeometry(7.6,0.42,5.4),wall,0,4.3,2.4));
  g.add(part(new THREE.BoxGeometry(7.7,0.22,5.5),trim,0,4.58,2.4));
  [[-3.2,0.4],[3.2,0.4],[-3.2,4.4],[3.2,4.4]].forEach(p=>
    g.add(part(new THREE.CylinderGeometry(0.17,0.17,4.1,8),post,p[0],2.05,p[1])));
  // pumps
  [[-1.5,2.4],[1.5,2.4]].forEach(p=>{
    g.add(part(new THREE.BoxGeometry(0.7,1.5,0.5),post,p[0],0.75,p[1]));
    g.add(part(new THREE.BoxGeometry(0.5,0.4,0.1),glass,p[0],1.3,p[1]+0.28));
  });
  // lit forecourt under the canopy — glows at night, dark by day
  const fp=forecourtPool(7);fp.position.set(0,0.1,2.4);g.add(fp);
  g.scale.multiplyScalar(OBJ_SCALE);
  return g;
}

export function buildStation(){
  let g=null;
  if(LOADED.gas_station){
    g=spawnModel('gas_station');
    if(g)g.scale.setScalar((ASSETS.gas_station.scale||1)*OBJ_SCALE);
  }
  if(!g)g=procStation();
  g.userData.solid=true;          // crashing into it behaves like a barn
  g.userData.station=true;
  measureSolid(g);
  return g;
}
