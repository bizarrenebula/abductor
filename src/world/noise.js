/* =========================================================================
   NOISE — tiny 2D simplex + fbm, and the six seeded noise fields the terrain
   sampler reads. reseed() reassigns the fields; importers of nElev..nMoist see
   the new values via ES-module live bindings.
   ========================================================================= */

/* ---------- tiny 2D simplex noise (public-domain style) ---------- */
export function makeNoise(seed){
  const p=new Uint8Array(256);
  for(let i=0;i<256;i++)p[i]=i;
  let n=(seed*65536)>>>0 || 1;
  const rnd=()=>{n=(n*16807)%2147483647;return (n&2147483646)/2147483646;};
  for(let i=255;i>0;i--){const r=(rnd()*(i+1))|0;const t=p[i];p[i]=p[r];p[r]=t;}
  const perm=new Uint16Array(512),pm=new Uint8Array(512);
  for(let i=0;i<512;i++){perm[i]=p[i&255];pm[i]=perm[i]%12;}
  const g=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[1,0],[-1,0],[0,1],[0,-1],[0,1],[0,-1]];
  const F=0.3660254037844386,G=0.21132486540518713;
  return function(xin,yin){
    let n0,n1,n2;
    const s=(xin+yin)*F;
    const i=Math.floor(xin+s),j=Math.floor(yin+s);
    const t=(i+j)*G;
    const x0=xin-(i-t),y0=yin-(j-t);
    let i1,j1; if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    const x1=x0-i1+G,y1=y0-j1+G,x2=x0-1+2*G,y2=y0-1+2*G;
    const ii=i&255,jj=j&255;
    let t0=0.5-x0*x0-y0*y0; if(t0<0)n0=0;else{t0*=t0;const gi=pm[ii+perm[jj]];n0=t0*t0*(g[gi][0]*x0+g[gi][1]*y0);}
    let t1=0.5-x1*x1-y1*y1; if(t1<0)n1=0;else{t1*=t1;const gi=pm[ii+i1+perm[jj+j1]];n1=t1*t1*(g[gi][0]*x1+g[gi][1]*y1);}
    let t2=0.5-x2*x2-y2*y2; if(t2<0)n2=0;else{t2*=t2;const gi=pm[ii+1+perm[jj+1]];n2=t2*t2*(g[gi][0]*x2+g[gi][1]*y2);}
    return 70*(n0+n1+n2);
  };
}

export let nElev,nHill,nMtn,nRiver,nTemp,nMoist;
export function reseed(){
  const s=(Math.random()*1e6)|0;
  nElev=makeNoise(s+1); nHill=makeNoise(s+2); nMtn=makeNoise(s+3);
  nRiver=makeNoise(s+4); nTemp=makeNoise(s+5); nMoist=makeNoise(s+6);
}
export function fbm(nz,x,z,oct){let a=1,f=1,sum=0,norm=0;for(let i=0;i<oct;i++){sum+=a*nz(x*f,z*f);norm+=a;a*=0.5;f*=2;}return sum/norm;}
