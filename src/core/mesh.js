/* Shared mesh helpers used by every procedural builder. */
import { THREE } from './three.js';
import { env } from './env.js';

export function mat(hex,rough){return new THREE.MeshStandardMaterial({color:hex,roughness:rough||0.85,metalness:0.02});}
export function part(geo,m,x,y,z){const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);me.castShadow=!env.LOW_END;return me;}
