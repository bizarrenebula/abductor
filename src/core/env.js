/* =========================================================================
   ENV — device detection + mutable runtime flags.

   Native ES modules can't reassign an imported binding, so every flag that
   changes at runtime (post-fx fallback, view radius) lives as a PROPERTY on
   the exported `env` object. Mutate env.X anywhere; all importers see it live.

   Asset quality is decided here, once, from the device — there is no user
   toggle. Desktop loads the custom GLB/texture set; phones and tablets use the
   built-in procedural geometry, which is the difference between a snappy run
   and downloading ~200MB of models onto a phone.
   ========================================================================= */
export const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* A touchscreen alone is not a phone: plenty of laptops report a coarse
   pointer while still having a mouse. Requiring hover:none as well keeps
   those on the desktop path, where they belong. */
const TOUCH_ONLY =
  matchMedia('(pointer:coarse)').matches && matchMedia('(hover:none)').matches;

/* Escape hatch for testing either path on any machine: ?detail=high|low */
const FORCED = (location.search.match(/[?&]detail=(high|low)/) || [])[1] || null;

export const env = {
  IS_IOS,
  LOW_END: FORCED ? FORCED === 'low' : (IS_IOS || TOUCH_ONLY),
  VIEW_R: 2,          // 5x5 (desktop) / 3x3 (mobile) grid of chunks
  usePost: true,      // post-processing on; auto-drops to false if the GPU rejects it
  // Pure-JS experiment: skip ALL external GLB/texture downloads and run entirely
  // on procedural geometry, so the twisted dark-cartoon look is the real look on
  // every device. Flip to false (or use ?models=on) to bring the GLB set back.
  noExternal: true,
};
if (env.LOW_END) env.VIEW_R = 1;
if (/[?&]models=on/.test(location.search)) env.noExternal = false;   // escape hatch

/* Custom models/textures load only when external assets are enabled. */
export function assetsOn() { return !env.LOW_END && !env.noExternal; }
