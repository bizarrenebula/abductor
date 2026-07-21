/* Big center-screen announcement banner. */
export function banner(txt){
  const b=document.getElementById('banner');
  b.innerHTML='<b></b>';b.firstChild.textContent=txt;
  b.classList.remove('show');void b.offsetWidth;b.classList.add('show');
}
