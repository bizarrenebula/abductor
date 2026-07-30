/* =========================================================================
   WAYPOINTS — "where do I fly?" guidance shared by every mode.

   Two halves, both immediate-mode: a system calls mark() for each thing the
   player is currently meant to find, once per frame, and this module draws it.

     1. SCREEN ARROWS. Off-screen (or behind you) an arrow pins to the screen
        edge pointing the way, with the distance. Once the target is in view the
        arrow becomes a small chevron floating over it, so the guidance never
        covers the thing you are flying toward.

     2. WORLD GLOW. objectiveGlow() builds a soft emissive halo + ground ring
        that pulses on the object itself, replacing the old blink/searchlight
        highlight. It keeps glowing until the player is close enough to collect,
        then fades out — so "it is still glowing" reads as "not yours yet".

   Arrows are DOM (no GPU cost, no draw calls); the glow is two additive meshes
   with no lights, so a dozen live objectives stay cheap on a phone.
   ========================================================================= */
import { THREE } from '../core/three.js';

/* ---- screen arrows -------------------------------------------------------- */
const MAX_ARROWS=8;         // hard cap so a crowded stage can't spam the screen
const EDGE=34;              // px inset from the screen edge for a pinned arrow
let host=null, pool=[];
function build(){
  if(host)return host;
  const css=document.createElement('style');
  css.textContent=`
  #wpLayer{position:fixed;inset:0;z-index:36;pointer-events:none;overflow:hidden}
  .wp{position:absolute;left:0;top:0;will-change:transform;transform-origin:50% 50%;
    display:none;align-items:center;flex-direction:column;gap:2px}
  .wp.on{display:flex}
  .wp-tri{width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;
    border-bottom:18px solid var(--wp,#8fe8b8);filter:drop-shadow(0 0 6px rgba(0,0,0,.85))}
  .wp-d{font-family:inherit;font-size:9px;letter-spacing:.12em;color:var(--wp,#8fe8b8);
    text-shadow:0 1px 6px rgba(0,0,0,.9)}
  /* the triangle alone rotates; the distance label stays upright and readable */
  .wp-tri{transition:none}
  .wp.near{opacity:.9}
  `;
  document.head.appendChild(css);
  host=document.createElement('div');host.id='wpLayer';
  document.body.appendChild(host);
  for(let i=0;i<MAX_ARROWS;i++){
    const el=document.createElement('div');el.className='wp';
    el.innerHTML='<div class="wp-tri"></div><div class="wp-d"></div>';
    host.appendChild(el);
    pool.push({el,tri:el.querySelector('.wp-tri'),lbl:el.querySelector('.wp-d')});
  }
  return host;
}

const _v=new THREE.Vector3();
let marks=[];

/* Register one objective for this frame.
   pos    — THREE.Vector3 (or {x,y,z}) in world space
   color  — CSS colour for the arrow
   near   — distance (world units) under which the player counts as "arrived";
            inside it the arrow is dropped so it stops nagging. */
export function mark(pos,color='#8fe8b8',near=26){
  // Copy the coordinates rather than keeping the reference: callers pass a
  // reused scratch vector, so holding it would make every mark collapse onto
  // whichever position was written last.
  if(pos)marks.push({x:pos.x,y:pos.y||0,z:pos.z,color,near});
}

/* Draw every marked objective and clear the list for the next frame. */
export function renderWaypoints(camera,fromPos){
  build();
  const W=innerWidth,H=innerHeight,cx=W/2,cy=H/2;
  // nearest first, so the cap drops the least relevant ones
  if(fromPos&&marks.length>1)
    marks.sort((a,b)=>
      ((a.x-fromPos.x)**2+(a.z-fromPos.z)**2)-
      ((b.x-fromPos.x)**2+(b.z-fromPos.z)**2));
  let n=0;
  for(const m of marks){
    if(n>=MAX_ARROWS)break;
    const d=fromPos?Math.hypot(m.x-fromPos.x,m.z-fromPos.z):0;
    if(fromPos&&d<m.near)continue;                 // close enough — the glow takes over
    _v.set(m.x,m.y,m.z).project(camera);
    const behind=_v.z>1;
    let nx=_v.x, ny=_v.y;
    if(behind){ nx=-nx; ny=-ny; }
    const onScreen=!behind&&Math.abs(nx)<=1&&Math.abs(ny)<=1;
    const p=pool[n++];
    p.el.style.setProperty('--wp',m.color);
    p.lbl.textContent=d>=1?Math.round(d)+' m':'';
    if(onScreen){
      // a chevron just above the target, pointing down at it
      const x=cx+nx*cx, y=cy-ny*cy;
      p.el.className='wp on near';
      p.el.style.transform='translate('+(x-13)+'px,'+(y-56)+'px)';
      p.tri.style.transform='rotate(180deg)';        // chevron points down at it
    }else{
      // pin to the screen edge along the direction of travel
      const ang=Math.atan2(ny,nx);                 // NDC: +y is up
      const hx=cx-EDGE, hy=cy-EDGE;
      const s=Math.min(hx/Math.max(1e-3,Math.abs(Math.cos(ang))),
                       hy/Math.max(1e-3,Math.abs(Math.sin(ang))));
      const x=cx+Math.cos(ang)*s, y=cy-Math.sin(ang)*s;
      p.el.className='wp on';
      p.el.style.transform='translate('+(x-13)+'px,'+(y-14)+'px)';
      // only the arrowhead turns — the label under it must stay upright
      p.tri.style.transform='rotate('+(-ang*180/Math.PI-90)+'deg)';
    }
  }
  for(let i=n;i<pool.length;i++)pool[i].el.className='wp';
  anyShown=n>0;
  marks.length=0;
}
/* Hide everything (menu / game over / mode switch). Cheap to call every frame:
   it no-ops once already cleared, so it never churns styles. */
let anyShown=false;
export function clearWaypoints(){
  marks.length=0;
  if(!anyShown||!host)return;
  for(const p of pool)p.el.className='wp';
  anyShown=false;
}

/* ---- world glow ----------------------------------------------------------
   A soft additive halo over the object plus a ground ring, both breathing. This
   replaces the old blink-and-searchlight treatment: the object simply glows
   until it is collected. */
function haloTex(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.35,'rgba(255,255,255,0.45)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
}
let _halo=null;
const haloMap=()=>(_halo||(_halo=haloTex()));   // one shared texture for every glow

/* Build a glow marker. `size` scales the halo to the object. */
export function objectiveGlow(color=0xffffff,size=1){
  const g=new THREE.Group();
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:haloMap(),color,
    transparent:true,opacity:0.55,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.setScalar(7*size);halo.position.y=2.2*size;g.add(halo);
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.6*size,3.4*size,32),
    new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.5,
      blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=0.18;g.add(ring);
  g.userData={halo,ring,phase:Math.random()*6.283,size};
  return g;
}
/* Breathe the glow. `k` (0..1) fades it out as the player closes in, so a
   collected/reached objective stops advertising itself. */
export function updateGlow(g,time,k=1){
  if(!g||!g.userData)return;
  const u=g.userData, w=0.5+0.5*Math.sin(time*2.1+u.phase);
  u.halo.material.opacity=(0.30+0.38*w)*k;
  u.halo.scale.setScalar((6.4+1.1*w)*u.size);
  u.ring.material.opacity=(0.26+0.30*w)*k;
  u.ring.scale.setScalar(1+0.07*w);
  g.visible=k>0.02;
}
