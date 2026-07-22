/* Small scalar helpers used across the whole game. */
export const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
/* Shortest signed angular difference, wrapped to (-PI, PI]. */
export const wrapAngle=a=>{a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;};
/* Rotate `cur` toward `tgt` by at most `maxStep` radians, the short way round. */
export const turnToward=(cur,tgt,maxStep)=>{
  const d=wrapAngle(tgt-cur);
  return Math.abs(d)<=maxStep?tgt:cur+Math.sign(d)*maxStep;
};
/* Anchored three-point ramp: returns lo at x=xMin, mid at x=xMid, hi at x=xMax,
   linear on each side and clamped to the lo..hi span. Used for everything that
   scales with altitude, so they all pivot on the same resting height. */
export const ramp=(x,xMin,xMid,xMax,lo,mid,hi)=>{
  const v = x<=xMid ? lo+(x-xMin)/(xMid-xMin)*(mid-lo)
                    : mid+(x-xMid)/(xMax-xMid)*(hi-mid);
  return Math.min(Math.max(v,Math.min(lo,hi)),Math.max(lo,hi));
};
