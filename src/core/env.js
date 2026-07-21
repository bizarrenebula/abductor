/* =========================================================================
   ENV — device detection + mutable runtime flags.

   Native ES modules can't reassign an imported binding, so every flag that
   changes at runtime (HI_DETAIL toggle, post-fx fallback, view radius) lives
   as a PROPERTY on the exported `env` object. Mutate env.X anywhere; all
   importers see it live.
   ========================================================================= */
export const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const env = {
  IS_IOS,
  LOW_END: IS_IOS || matchMedia('(pointer:coarse)').matches,
  HI_DETAIL: false,   // opt-in high-detail on mobile via settings toggle
  VIEW_R: 2,          // 5x5 (desktop) / 3x3 (mobile) grid of chunks
  usePost: true,      // post-processing on; auto-drops to false if the GPU rejects it
};
if (env.LOW_END) env.VIEW_R = 1;

export function assetsOn() { return !env.LOW_END || env.HI_DETAIL; }
