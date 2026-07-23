/* =========================================================================
   ACHIEVEMENT TOAST — the cheerful card that pops up when the ship earns a new
   upgrade. Shows an eyebrow, a celebratory title, and a short practical guide
   (what it grants + how to use it). Auto-dismisses; a new one interrupts the
   old. Purely presentational — driven by systems/upgrades.js.
   ========================================================================= */
import { t } from '../i18n.js';

const el   = document.getElementById('achv');
const eyeEl = el && el.querySelector('.achv-eyebrow');
const ttlEl = el && el.querySelector('.achv-title');
const gdEl  = el && el.querySelector('.achv-guide');
let hideT=0;

/* title/guide are already-translated strings; eyebrow is a fixed i18n key. */
export function showAchievement(title,guide){
  if(!el)return;
  if(eyeEl)eyeEl.textContent=t('upg.eyebrow');
  if(ttlEl)ttlEl.textContent=title;
  if(gdEl)gdEl.textContent=guide;
  // restart the pop-in animation even if one is already on screen
  el.classList.remove('show');void el.offsetWidth;el.classList.add('show');
  clearTimeout(hideT);
  hideT=setTimeout(()=>el.classList.remove('show'),5200);
}

/* Called by startGame so a lingering toast never bleeds into the next run. */
export function hideAchievement(){ if(el){clearTimeout(hideT);el.classList.remove('show');} }
