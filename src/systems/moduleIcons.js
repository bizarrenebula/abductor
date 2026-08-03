/* =========================================================================
   MODULE ICONS — the three ship modules, as symbols above the ship.

   This replaces a permanent row of text labels along the bottom of the screen.
   That row was honest but it was always there, and a checklist you have already
   read is just clutter: after the first minute it told the player nothing they
   did not know, while occupying the one strip of screen the hint card and the
   toasts also wanted.

   So the state moves ONTO THE SHIP and becomes momentary. Three small glyphs
   float over the saucer and are shown only at the two moments they mean
   anything:

     - a module is installed  — here is what you just gained, and what is left
     - a module is USED, or an attempt is made to use one that is missing —
       here is why nothing happened

   The second case is the useful one. Pressing the beam with no beam module used
   to produce a line of text; now the beam glyph appears greyed out, which says
   the same thing in the place the player is already looking and in a language
   that needs no reading.

   Greyed = still lying out there in the world. Lit = aboard. Lit is a SOFT
   glow, not a blaze: this is ship state, not an alarm.

   Then they go away. The reveal is a couple of seconds, and it drains faster
   the faster you are flying, so a glance while hovering lingers and the same
   glance at cruise is gone before it can sit in front of the country.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene, camera } from '../core/engine.js';
import { S } from '../core/state.js';
import { saucer } from './saucer.js';

/* The three modules, in the order they are meant to be found. */
export const MODULES=['thrusters','beam','cloak'];

const SIZE=3.3;          // world units per glyph
const GAP=4.0;           // centre-to-centre
/* Above the ship's origin, and only just: the chase camera looks DOWN at the
   saucer, so a world-space offset upward projects a long way up the screen. At
   11.5 the row sat near the top edge and read as HUD chrome rather than as
   something attached to the ship. This clears the energy bar (7.5, half a unit
   tall) with the glyph's lower edge and no more. */
const RISE=9.6;

const HOLD_GOT=2.4;      // seconds a collection stays up
const HOLD_TRY=1.3;      // ...and a use / refused use
const FADE_IN=0.14, FADE_OUT=0.45;

/* Colours are painted straight onto the canvas rather than passed to the
   material, and the texture is tagged sRGB. That sidesteps the trap that has
   bitten this codebase three times: renderer.outputEncoding is sRGB and three
   r128 does NOT convert a hex handed to a material, so a literal #3dff8a set as
   material.color arrives on screen washed out. A canvas texture is decoded on
   the way in and re-encoded on the way out, so what is typed here is what is
   seen. Keep material.color white and paint the colour in. */
const C_OFF='#6d7b76';      // missing: cold grey, clearly unlit
const C_ON ='#4dffa0';      // installed: the same matrix green the HUD uses

/* ---- the glyphs ----------------------------------------------------------
   Drawn as paths at 128px so they stay crisp when the ship is close, and kept
   to shapes that survive being 30 pixels tall when it is not: an arrow, a cone,
   an eye. No lettering — a label at this size is a smudge. */
const SLASH=[24,104,104,24];        // the cloak's strike-through, cut then redrawn

function drawGlyph(x,key,fill){
  x.fillStyle=fill; x.strokeStyle=fill;
  x.lineJoin='round'; x.lineCap='round';
  if(key==='thrusters'){
    /* An up arrow: this is the module that lets the ship hold a height. */
    x.beginPath();
    x.moveTo(64,16); x.lineTo(99,58); x.lineTo(79,58); x.lineTo(79,88);
    x.lineTo(49,88); x.lineTo(49,58); x.lineTo(29,58); x.closePath(); x.fill();
    // two short exhaust ticks, so it reads as thrust rather than as "up"
    x.lineWidth=9;
    x.beginPath(); x.moveTo(52,100); x.lineTo(52,112);
    x.moveTo(76,100); x.lineTo(76,112); x.stroke();
  }else if(key==='beam'){
    /* A saucer seen edge-on, casting a cone of light.

       The emitter is a flat ELLIPSE, not a trapezoid. Two tapers stacked point
       to point — a bar narrowing downward above a cone widening downward —
       make an hourglass, which is what the previous version drew. A disc reads
       as the thing doing the projecting and nothing else. */
    x.beginPath(); x.ellipse(64,26,35,10,0,0,Math.PI*2); x.fill();
    x.beginPath();
    x.moveTo(54,44); x.lineTo(74,44); x.lineTo(102,110); x.lineTo(26,110); x.closePath(); x.fill();
    /* One rung, CUT OUT of the cone rather than painted over it. Painted black
       it was an opaque slot that read as a hole in the sky behind. */
    x.save(); x.globalCompositeOperation='destination-out';
    x.lineWidth=7; x.lineCap='butt';
    x.beginPath(); x.moveTo(30,86); x.lineTo(98,86); x.stroke();
    x.restore();
  }else{
    /* An eye, struck through: seen, then not.

       STROKED, not filled. A filled almond with a pupil punched out and a slash
       cut across it is not an eye — it is two unrelated blobs, which is exactly
       what the first version rendered. The outline is the whole readable idea. */
    x.lineWidth=9;
    x.beginPath();
    x.moveTo(12,64); x.quadraticCurveTo(64,20,116,64);
    x.quadraticCurveTo(64,108,12,64); x.closePath(); x.stroke();
    x.beginPath(); x.arc(64,64,15,0,Math.PI*2); x.fill();
    // clear a lane for the slash so it reads over the eye, then lay it in
    x.save(); x.globalCompositeOperation='destination-out';
    x.lineWidth=24; x.lineCap='round';
    x.beginPath(); x.moveTo(SLASH[0],SLASH[1]); x.lineTo(SLASH[2],SLASH[3]); x.stroke();
    x.restore();
    x.lineWidth=10;
    x.beginPath(); x.moveTo(SLASH[0],SLASH[1]); x.lineTo(SLASH[2],SLASH[3]); x.stroke();
  }
}
/* One texture per module per state. Six in all, built once — a module changes
   state at most three times in a run, so a map swap is cheaper than tinting. */
function iconTex(key,got){
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d');
  if(got){
    /* Installed: a soft halo baked behind the glyph. Baked, because a second
       additive sprite per icon would cost six more draws to say the same
       thing, and this one never has to be animated. Drawn to its own canvas and
       blurred underneath, because the glyphs punch holes in themselves with
       destination-out and a shadow drawn in the same pass gets punched too. */
    const h=document.createElement('canvas'); h.width=h.height=128;
    const hx=h.getContext('2d');
    drawGlyph(hx,key,C_ON);
    x.save(); x.filter='blur(5px)'; x.globalAlpha=0.85;
    x.drawImage(h,0,0); x.drawImage(h,0,0);
    x.restore();
    x.drawImage(h,0,0);            // the clean shape, over its own glow
  }else{
    drawGlyph(x,key,C_OFF);
  }
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
}

/* ---- the row -------------------------------------------------------------
   Parented to the scene, not to the saucer: the ship banks and spins, and a
   row of symbols that rolled with it would be unreadable exactly when the
   player most wants to read it. Positioned each frame and turned to face the
   camera, the same way the energy bar is. */
const row=new THREE.Group();
const cells=[];
MODULES.forEach((key,i)=>{
  const tex={off:iconTex(key,false),on:iconTex(key,true)};
  const m=new THREE.Mesh(new THREE.PlaneGeometry(SIZE,SIZE),
    new THREE.MeshBasicMaterial({map:tex.off,transparent:true,opacity:0,
      depthTest:false,depthWrite:false}));
  m.position.x=(i-(MODULES.length-1)/2)*GAP;
  m.renderOrder=1000;
  row.add(m);
  cells.push({key,mesh:m,tex,got:false,pulse:0});
});
row.visible=false;
scene.add(row);

let hold=0;      // seconds of reveal left
let fade=0;      // 0..1 current opacity envelope

export const ModuleIcons={
  /* Something happened involving `key`. `kind` is 'got' for an installation
     (longer, and the glyph itself pulses) or 'try' for a use or a refused use.

     Safe to call every frame while a control is held: the hold is a maximum,
     not an accumulator, so holding the beam keeps the row up for as long as the
     beam is open and no longer. */
  ping(key,kind){
    if(S.state!=='playing')return;
    const want=kind==='got'?HOLD_GOT:HOLD_TRY;
    if(want>hold)hold=want;
    const c=cells.find(c=>c.key===key);
    if(c&&kind==='got')c.pulse=1;
  },

  /* Which modules are aboard. Called by upgrades.js whenever that changes. */
  sync(has){
    for(const c of cells){
      const got=!!has[c.key];
      if(got===c.got)continue;
      c.got=got;
      c.mesh.material.map=got?c.tex.on:c.tex.off;
      c.mesh.material.needsUpdate=true;
    }
  },

  update(dt,speed){
    if(S.state!=='playing'){ hold=0; fade=0; row.visible=false; return; }
    if(hold>0){
      /* ...and they go away FASTER THE FASTER YOU FLY. Standing still over a
         module you cannot reach, the row is worth a long look; at cruise it has
         already told you what it knows and would only hang in front of the
         country. */
      const rush=1+Math.min(2.5,(speed||0)/26);
      hold=Math.max(0,hold-dt*rush);
    }
    const tgt=hold>0?1:0;
    const rate=tgt>fade?dt/FADE_IN:dt/FADE_OUT;
    fade+=Math.max(-rate,Math.min(rate,tgt-fade));
    if(fade<=0.002){ row.visible=false; return; }
    row.visible=true;
    row.position.set(saucer.position.x,saucer.position.y+RISE,saucer.position.z);
    row.quaternion.copy(camera.quaternion);
    for(const c of cells){
      if(c.pulse>0)c.pulse=Math.max(0,c.pulse-dt*1.6);
      const p=c.pulse*c.pulse;                     // ease out: a bump, not a throb
      c.mesh.material.opacity=fade*(c.got?0.92:0.5)*(1+0.6*p);
      c.mesh.scale.setScalar(1+0.35*p);
    }
  },

  /* A fresh run: nothing shown, nothing held over from the last one. */
  reset(){ hold=0; fade=0; row.visible=false; for(const c of cells)c.pulse=0; },
};
