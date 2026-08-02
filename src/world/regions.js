/* =========================================================================
   REGIONS — the three lands: WILDERNESS, DESERT, URBAN.

   Until now "biome" was a per-texel classification from temperature/moisture
   noise, so grass, forest, sand and rock interleaved at terrain frequency. That
   is the root of most placement trouble in this codebase: a village needed a
   rare grass patch big enough to hold it, and a census of farmland candidates
   lost 214 of 440 to the biome test alone, because a rectangle of any size
   rarely lies wholly inside one texel-scale biome.

   Regions fix it at the source. They are ONE very low frequency field, so a
   region is kilometres across and you fly INTO it — green hills give way to
   dunes over the better part of a minute, rather than every hundred metres.

   Everything else reads the WEIGHTS, not the label: terrain height, colour and
   weather are all blends of the three, which is what makes the borders a
   gradient instead of a seam. `regionAt` returns the dominant one for the
   coarse yes/no decisions (which creature, which prop) where a blend is
   meaningless.
   ========================================================================= */
import { nRegion, fbm } from './noise.js';
import { smoothstep } from '../core/math.js';

export const WILD=0, DESERT=1, URBAN=2;
export const REGION_NAME=['wilderness','desert','urban'];

/* ~6200 units across. Two octaves: enough shape that borders wander, few enough
   that they fray into slivers — the same lesson the weather field taught.

   These numbers are measured, not guessed. Walking 40km lines across five seeds
   and recording the distance between region changes: at SCALE 0.00022 the median
   stretch was 950m, a patchwork rather than a land; at 0.00009 it was 2750m,
   which turned out to be TOO far — the desert in particular went on long enough
   to get boring before anything changed. 0.00016 sits between them at a 1250m
   median, so the three lands are neighbours you cross between rather than
   territories you are stuck in.

   The bands are asymmetric on purpose, and the ORDER of the shares is the point:
   wilderness largest, urban next, desert smallest. Desert is the cheapest region
   to look at — no woods, no towns, no roads, one ground colour — so it is the
   one you should spend least time in. Measured at 0.18/0.56: 46% wilderness,
   28% urban, 26% desert, against the 33/36/31 an even split gave. */
const SCALE=0.00016;
const BAND_A=0.18, BAND_B=0.56, BLEND=0.085;

/* 0..1. The noise is roughly symmetric about 0 with its 10th/90th percentiles
   near -+0.385, so x1.35 about 0.5 spreads it across the range. */
/* The offset matters. Simplex noise is exactly zero at every lattice point, and
   the world origin is one, so without it the field reads 0.5 at the spawn every
   single time — every run began dead centre of the urban band with the steepest
   part of the gradient underfoot, desert 800m one way and wilderness 800m the
   other. Sampling off-lattice puts the spawn somewhere different per seed. */
const OX=137.31, OZ=-91.77;

/* HOME. Every run begins at Area 51, which means every run begins in deep
   desert whatever the noise wanted — so the field is pulled to sand inside a
   bowl around the world origin and released over the next kilometre or so.
   Fixed, not seeded: the opening shot of the game should be the same country
   every time, and the variety starts once you fly out of it — which now happens
   sooner, because a guaranteed desert is still a desert and the point of the
   opening is to leave it. */
const HOME_IN=650, HOME_OUT=1900;

export function regionField(x,z){
  const v=fbm(nRegion,x*SCALE+OX,z*SCALE+OZ,2);
  let r=0.5+v*1.35;
  const home=1-smoothstep(HOME_IN,HOME_OUT,Math.hypot(x,z));
  if(home>0)r=r+(0.06-r)*home;
  return r<0?0:r>1?1:r;
}

/* How much of each region is in force here. Sums to 1. The bands are ordered
   desert -> urban -> wilderness, so desert never abuts wilderness directly:
   you always pass through settled country between the dunes and the peaks,
   which is both easier to blend and reads as a journey. */
const _w={wild:0,des:0,urb:0};
export function regionWeights(x,z){
  const r=regionField(x,z);
  const a=smoothstep(BAND_A-BLEND,BAND_A+BLEND,r);
  const b=smoothstep(BAND_B-BLEND,BAND_B+BLEND,r);
  _w.des =1-a;
  _w.urb =a-b;
  _w.wild=b;
  return _w;
}

/* The dominant region — for decisions that cannot be blended. */
export function regionAt(x,z){
  const r=regionField(x,z);
  return r<BAND_A?DESERT:(r<BAND_B?URBAN:WILD);
}
