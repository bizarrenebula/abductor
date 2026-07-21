/* Floating "+N" balloon at a world position, projected to screen. */
import { THREE } from '../core/three.js';
import { camera } from '../core/engine.js';
import { popLayer } from './dom.js';

const _v=new THREE.Vector3();
export function spawnPop(world3,txt,label){
  _v.copy(world3).project(camera);
  const x=(_v.x*0.5+0.5)*innerWidth, y=(-_v.y*0.5+0.5)*innerHeight;
  const el=document.createElement('div');el.className='balloon';
  el.innerHTML=(txt||'+1')+(label?'<span class="bsp">'+label+'</span>':'');
  el.style.left=x+'px';el.style.top=y+'px';popLayer.appendChild(el);
  setTimeout(()=>el.remove(),1200);
}
