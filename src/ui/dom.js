/* Shared HUD element handles, grabbed once. Module scripts are deferred, so
   the DOM is fully parsed before this evaluates. */
export const scoreV=document.getElementById('scoreV');
export const clockV=document.getElementById('clockV');
export const regionV=document.getElementById('regionV');
export const multV=document.getElementById('multV');
export const hTarget=document.getElementById('hTarget');
export const barFill=document.getElementById('barFill');
export const tName=document.getElementById('tName');
export const popLayer=document.getElementById('pop');
export const specV=document.getElementById('specV');
export const hBuffEl=document.getElementById('hBuff');
export const buffNameEl=document.getElementById('buffName');
export const spBtn=document.getElementById('spBtn');
export const cloakRing=document.getElementById('cloakRing');
export const cloakArc=cloakRing&&cloakRing.querySelector('.fg');
export const altScale=document.getElementById('altScale');
export const altKnob=document.getElementById('altKnob');
export const altVal=document.getElementById('altVal');
