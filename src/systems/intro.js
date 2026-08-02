/* =========================================================================
   INTRO CINEMATIC — the arrival. A mothership hangs high over the valley and
   lowers the player's saucer down a wide beam; the camera plays three shots and
   hands over to the live chase camera exactly where it would have been, so the
   film becomes gameplay without a cut.

   It runs as its own game state ('intro'), so none of the playing systems
   (abduction, energy, collision, hazards) tick while it plays. The HUD is faded
   out for the duration. A tap, click or key skips straight to the handover.

   The final camera pose is COMPUTED from the same profile the CameraRig uses,
   which is what makes the transition seamless — see playPose().
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene, camera } from '../core/engine.js';
import { saucer } from './saucer.js';
import { S } from '../core/state.js';
import { FLIGHT_PROFILE } from './flight-profile.js';
import { heightAt } from '../world/terrain.js';
import { Arrival } from '../audio/arrival.js';

const DUR = 9.0;            // seconds of film
const SHIP_TOP = 220;       // where the mothership hangs
/* Clouds live in a 34..92 band as camera-facing sprites up to ~46 units wide, so
   a camera inside that band ends up INSIDE a puff — which renders as a hard white
   rectangle across the frame. Every shot below therefore sits either well above
   the band (the opening, on top of the cloud deck) or below it (everything after
   the ship has come down). */
const CLOUD_TOP = 150;      // shot 1 altitude: above the deck, under the mothership
const DROP_FROM = 0.06;     // the saucer starts down the beam at this point in the film
const DROP_TO   = 0.74;     // ...and touches its hover height here

/* ---- the mothership + its beam (built once, reused every run) ------------- */
let rig=null;
function build(){
  if(rig)return rig;
  const g=new THREE.Group();

  // Hull: a vast dark disc, far bigger than the player's saucer, with a lit
  // underside so it reads as a silhouette with a glowing belly.
  const hull=new THREE.Mesh(new THREE.SphereGeometry(60,40,20),
    new THREE.MeshStandardMaterial({color:0x05070a,metalness:0.85,roughness:0.55,
      emissive:0x0a1a22,emissiveIntensity:0.35}));
  hull.scale.set(1,0.26,1); g.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(60,4.5,12,64),
    new THREE.MeshStandardMaterial({color:0x070a0e,metalness:0.8,roughness:0.5}));
  rim.rotation.x=Math.PI/2; g.add(rim);
  const belly=new THREE.Mesh(new THREE.CircleGeometry(34,48),
    new THREE.MeshBasicMaterial({color:0x8fe8ff,transparent:true,opacity:0.62,
      blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  // Clear of the hull's lowest point (-15.6) so the two don't z-fight into a
  // jagged rim where the ellipsoid pokes through the disc.
  belly.rotation.x=Math.PI/2; belly.position.y=-16.4; g.add(belly);
  // a ring of lights around the rim, chasing
  const lights=[];
  for(let i=0;i<20;i++){
    const a=i/20*Math.PI*2;
    const s=new THREE.Mesh(new THREE.SphereGeometry(3.0,8,8),
      new THREE.MeshBasicMaterial({color:0xbfefff,transparent:true,opacity:0.9,
        blending:THREE.AdditiveBlending,depthWrite:false}));
    s.position.set(Math.cos(a)*58,-4,Math.sin(a)*58); g.add(s); lights.push(s);
  }

  // The delivery beam: a wide cone from the mothership's belly to the ground.
  const beamMat=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    uniforms:{uTime:{value:0},uPow:{value:0}},
    // vRim is |N·V|: ~1 where the cone wall faces the camera (the middle of the
    // shaft on screen) and ~0 at its silhouette. Without it the cone reads as a
    // flat slab with hard edges; with it, the shaft fades out sideways like light.
    vertexShader:`varying float vY;varying float vRim;
      void main(){ vY=position.y;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vRim=abs(dot(normalize(normalMatrix*normal),normalize(-mv.xyz)));
        gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`varying float vY;varying float vRim;uniform float uTime;uniform float uPow;
      void main(){ float t=vY+0.5;
        float bands=0.5+0.5*sin(t*30.0-uTime*4.0);
        // Roughly 40% of the alpha this was tuned at over grass. The cone is
        // additive and DOUBLE-sided, so a fragment gets the near wall AND the far
        // wall; over dark meadow that summed to a shaft of light, but over the
        // sand every run lands on it summed straight past white and buried the
        // saucer in a flat trapezoid.
        float a=(mix(0.032,0.088,t)+0.024*bands)*smoothstep(0.0,0.62,vRim);
        vec3 col=mix(vec3(0.20,0.72,0.95),vec3(0.80,0.97,1.0),t);
        gl_FragColor=vec4(col,clamp(a,0.0,1.0)*uPow); }`
  });
  // The beam, its ground disc and the pool light are placed in WORLD space each
  // frame, so they hang off the scene — not off `g`, which spins and translates.
  const beam=new THREE.Mesh(new THREE.ConeGeometry(1,1,48,1,true),beamMat);
  const disc=new THREE.Mesh(new THREE.CircleGeometry(1,48),
    new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  disc.rotation.x=-Math.PI/2;
  /* The pool. Note the 3rd argument: with physicallyCorrectLights off, three
     falls off as (1 - d/distance)^decay, NOT inverse-square — so `distance` is
     the pool's RADIUS, and at 150 this was a floodlight covering the whole shot.
     Over grass that read as moonlight; over the sand every run now lands on, it
     clipped a 300-unit circle of ground to flat white. */
  const glow=new THREE.PointLight(0x9fe8ff,0,62,2);

  const props=[g,beam,disc,glow];
  for(const p of props){ scene.add(p); p.visible=false; }
  rig={g,hull,belly,lights,beam,beamMat,disc,glow,props};
  return rig;
}

/* ---- the film frame: letterbox bars + a fade-up from black ----------------
   Built lazily, kept between runs. Sits above the HUD (z 10) but below the
   menu/pause screens (z 40) so quitting mid-film still shows the menu. */
let film=null;
function filmDOM(){
  if(film)return film;
  const wrap=document.createElement('div');
  wrap.id='introFilm';
  wrap.style.cssText='position:fixed;inset:0;z-index:35;pointer-events:none;display:none';
  const bar='position:absolute;left:0;right:0;height:12vh;background:#000;transition:none';
  const top=document.createElement('div'); top.style.cssText=bar+';top:0';
  const bot=document.createElement('div'); bot.style.cssText=bar+';bottom:0';
  const fade=document.createElement('div');
  fade.style.cssText='position:absolute;inset:0;background:#000';
  wrap.appendChild(top);wrap.appendChild(bot);wrap.appendChild(fade);
  document.body.appendChild(wrap);
  film={wrap,top,bot,fade};
  return film;
}

/* Where the live chase camera will be once we hand over. Computed from the same
   profile CameraRig uses, so the last frame of the film IS the first frame of
   play — no jump. */
const _pose={pos:new THREE.Vector3(), look:new THREE.Vector3()};
function playPose(x,y,z,yaw){
  const c=FLIGHT_PROFILE.camera;
  const sy=Math.sin(yaw), cy=Math.cos(yaw);
  _pose.pos.set(x+sy*c.distance, y+c.height, z+cy*c.distance);   // behind + above
  _pose.look.set(x-sy*c.lookAhead, y-c.lookDrop, z-cy*c.lookAhead);
  return _pose;
}

const _v=new THREE.Vector3(), _l=new THREE.Vector3();
const ease=t=>t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;      // smooth in/out
const clamp01=t=>t<0?0:t>1?1:t;

export const Intro={
  active:false,
  _t:0, _done:null, _x:0, _z:0, _groundY:0, _restY:0, _yaw:0, _shot:0,

  /* Start the film. The world must already be built (startGame does that first).
     onDone runs once the camera has settled into the play pose. */
  play(x,z,yaw,onDone){
    build();
    const f=filmDOM();
    f.wrap.style.display='block'; f.fade.style.opacity='1';
    f.top.style.height=f.bot.style.height='12vh';
    this.active=true; this._t=0; this._shot=0; this._done=onDone||null;
    this._x=x; this._z=z; this._yaw=yaw||0;
    this._groundY=heightAt(x,z);
    this._restY=this._groundY+15;                       // HOVER_BASE above the ground
    for(const p of rig.props)p.visible=true;
    rig.g.position.set(x,SHIP_TOP,z);
    rig.disc.position.set(x,this._groundY+0.2,z);
    saucer.position.set(x,SHIP_TOP-18,z);
    saucer.rotation.set(0,yaw||0,0);
    Arrival.play();                    // the score, scheduled against these same beats
    addEventListener('pointerdown',this._skip,{passive:true});
    addEventListener('keydown',this._skip);
  },
  // Rush to the handover. The cue can't scrub, so it ducks its build and drops
  // the landing under the shortened ending.
  _skip:()=>{ if(!Intro.active||Intro._t>=DUR-1.1)return; Intro._t=DUR-1.1; Arrival.skip(); },

  update(dt){
    if(!this.active)return;
    this._t+=dt;
    const T=clamp01(this._t/DUR), t=this._t;
    const x=this._x, z=this._z;

    // --- mothership: hangs, breathes, and lifts away at the end ---
    const lift=clamp01((T-0.80)/0.20);
    rig.g.position.set(x, SHIP_TOP+lift*160+Math.sin(t*0.5)*2, z);
    rig.g.rotation.y+=dt*0.06;
    for(let i=0;i<rig.lights.length;i++){
      const ph=i/rig.lights.length*Math.PI*2;
      rig.lights[i].material.opacity=(0.25+0.75*Math.pow(0.5+0.5*Math.sin(t*2.2-ph*2),3))*(1-lift);
    }
    rig.belly.material.opacity=0.62*(1-lift);
    rig.hull.material.emissiveIntensity=0.35*(1-lift);

    // --- delivery beam: opens, carries the saucer, then closes ---
    const bp=Math.min(clamp01((T-0.05)/0.12), 1-clamp01((T-0.74)/0.16));
    rig.beamMat.uniforms.uTime.value=t;
    rig.beamMat.uniforms.uPow.value=bp;
    const top=rig.g.position.y-15, bot=this._groundY;
    rig.beam.position.set(x,(top+bot)/2,z);
    rig.beam.scale.set(22*bp, top-bot, 22*bp);
    rig.disc.material.opacity=0.13*bp;
    rig.disc.scale.setScalar(20*bp);
    rig.glow.position.set(x,this._groundY+34,z);
    /* Halved from the value that was tuned over grass. Every run now lands on
       SAND, which is roughly three times as bright and gets a further x1.45 from
       the ground shader's texture multiply, so the old pool clipped to a flat
       white disc with a hard elliptical edge — the brightest thing in a film
       whose subject is a small lit saucer. */
    rig.glow.intensity=0.85*bp;                       // a pool of light, not a floodlight

    // --- the saucer rides the beam down ---
    // Front-loaded: it pulls away from the mothership smoothly, covers most of the
    // altitude quickly, then settles the last stretch slowly — which also puts it
    // low over the valley for the closing shots, with the landscape in frame.
    const d=Math.pow(ease(clamp01((T-DROP_FROM)/(DROP_TO-DROP_FROM))),0.62);
    const fromY=SHIP_TOP-18;
    saucer.position.set(x, fromY+(this._restY-fromY)*d, z);
    saucer.rotation.y=this._yaw+(1-d)*6.0;              // slow spin that settles on heading

    // --- three shots, then ease into the live chase pose ---
    const pose=playPose(x,saucer.position.y,z,this._yaw);
    const shot=T<0.30?1:T<0.64?2:3;
    if(T<0.30){
      // 1. up on top of the cloud deck, under the mothership's belly: the beam
      //    opens and the saucer is let go. The aim drifts down over the shot,
      //    from the hull to the clouds it is about to drop through.
      const k=T/0.30, a=this._yaw+0.35+k*0.45;
      _v.set(x+Math.sin(a)*130, CLOUD_TOP-10+k*6, z+Math.cos(a)*130);
      _l.set(x, SHIP_TOP-16-k*109, z);      // hull → the cloud deck it drops through
    }else if(T<0.64){
      // 2. cut to the valley floor, well back, watching it come down. The aim
      //    sits between the beam's base and the ship so the land stays in frame
      //    however high the saucer still is.
      // The bearing is taken from the AREA 51 SIGN, not from the ship's heading:
      // standing beyond the sign and looking back at the beam puts the sign in
      // the foreground of the shot, so the film says where this is, not just
      // that it is a desert. Offset a little off the sign's own bearing so it
      // frames to one side instead of eclipsing the descending saucer.
      const sd=(S.signX!=null)?Math.atan2(S.signX-x,S.signZ-z):this._yaw+1.15;
      const k=(T-0.30)/0.34, a=sd+0.34+k*0.30;
      _v.set(x+Math.sin(a)*82, this._groundY+13, z+Math.cos(a)*82);
      _l.set(x, this._groundY+(saucer.position.y-this._groundY)*0.42, z);
    }else{
      // 3. swing behind and settle exactly on the play pose
      const k=ease(clamp01((T-0.64)/0.36));
      const a=this._yaw+1.9*(1-k);          // swings round to dead astern as k→1
      const r=70+(FLIGHT_PROFILE.camera.distance-70)*k;
      _v.set(x+Math.sin(a)*r,
             saucer.position.y+12+(FLIGHT_PROFILE.camera.height-12)*k,
             z+Math.cos(a)*r);
      _v.lerp(pose.pos,k*k);                            // converge hard at the end
      _l.copy(saucer.position).lerp(pose.look,k);
    }
    // Cut hard between shots (a smoothed 150-unit reposition would read as a wild
    // swoop); glide within a shot, and tighten the glide as the last shot lands so
    // the camera is genuinely ON the play pose when the chase rig takes over.
    if(shot!==this._shot){ this._shot=shot; camera.position.copy(_v); }
    else camera.position.lerp(_v,Math.min(1,dt*(shot===3?6+30*clamp01((T-0.86)/0.14):6)));
    camera.up.set(0,1,0);
    camera.lookAt(_l);

    // --- the frame: fade up from black, then retract the bars as play begins ---
    const f=filmDOM();
    f.fade.style.opacity=String(1-clamp01(this._t/1.3));
    const open=clamp01((T-0.82)/0.18);
    f.top.style.height=f.bot.style.height=(12*(1-open)).toFixed(2)+'vh';

    if(this._t>=DUR)this.finish();
  },

  /* Tear the film down: listeners off, props hidden, frame cleared. */
  _clear(){
    this.active=false;
    removeEventListener('pointerdown',this._skip);
    removeEventListener('keydown',this._skip);
    if(rig){ for(const p of rig.props)p.visible=false; rig.glow.intensity=0; }
    if(film){ film.wrap.style.display='none'; film.fade.style.opacity='0';
              film.top.style.height=film.bot.style.height='0'; }
  },

  /* Hand over to gameplay. */
  finish(){
    if(!this.active)return;
    Arrival.release();
    this._clear();
    saucer.position.set(this._x,this._restY,this._z);
    saucer.rotation.set(0,this._yaw,0);
    const cb=this._done; this._done=null;
    if(cb)cb(this._x,this._restY,this._z,this._yaw);
  },

  /* Abort without running the callback (quit to menu mid-film). */
  stop(){
    this._done=null;
    Arrival.stop();                    // the film is gone; its score goes with it
    this._clear();
  },
};
export default Intro;
