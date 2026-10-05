/* Shared presentation and navigation helpers. No auth or API permissions are altered. */
(() => {
 'use strict';
 const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',orders:'M8 4H5v17h14V4h-3M8 2h8v4H8zM8 11h8M8 15h6',menu:'M12 5C8 2 3 3 3 5v15c3-2 6-2 9 0 3-2 6-2 9 0V5c0-2-5-3-9 0zM12 5v15',recipe:'M5 9c-4-3-1-8 3-6 1-3 7-3 8 0 4-2 7 3 3 6v5H5zM6 18h12M6 21h12M8 10v4M16 10v4',settings:'m10 2-1 3-3 1-3-1-2 4 2 2v3l-2 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-2-2v-3l2-2-2-4-3 1-3-1-1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',store:'M3 10h18l-2-7H5zM4 10v11h16V10M8 21v-7h8v7M3 10c0 4 4 4 5 0 0 4 7 4 8 0 1 4 5 4 5 0',palette:'M21 12a9 9 0 1 0-9 9c3 0 1-4 4-4h2c2 0 3-2 3-5M7 8h.01M11 5h.01M16 7h.01M18 11h.01',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0zM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',layers:'m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',plus:'M12 4v16M4 12h16',camera:'M3 6h4l2-3h6l2 3h4v15H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6',key:'M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0M13 11l8 8M18 16l3-3M16 14l3-3',users:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 21v-3c0-7 18-7 18 0v3M20 3c4 1 4 7 0 8',telegram:'m22 3-4 18-6-5-4 3v-6L2 10zM8 13 18 7l-6 9',chart:'M3 3v18h18M7 17v-6M12 17V7M17 17V4',arrow:'M5 12h14M14 7l5 5-5 5'};
 function icons(root=document){root.querySelectorAll('[data-icon]:not([data-drawn])').forEach(el=>{const d=paths[el.dataset.icon]||paths.settings;el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+d+'"/></svg>';el.dataset.drawn='1'});}
 function init(){
  icons();const tg=window.Telegram?.WebApp;
  // Embedded modules share the already initialized Telegram SDK only on the same origin.
  if(new URLSearchParams(location.search).get('embed')==='console'){
   document.documentElement.classList.add('consoleEmbedded');
   try{if(parent!==window&&parent.location.origin===location.origin&&parent.Telegram)window.Telegram=parent.Telegram}catch{}
  }
  try{tg?.ready?.();tg?.expand?.();tg?.setHeaderColor?.('#07111b');tg?.setBackgroundColor?.('#07111b');if(tg?.isVersionAtLeast?.('8.0')&&!tg.isFullscreen)tg.requestFullscreen?.()}catch{}
  function safe(){const a=tg?.contentSafeAreaInset||{};document.documentElement.style.setProperty('--tg-top',Math.max(0,a.top||0)+'px');}
  safe();try{tg?.onEvent?.('contentSafeAreaChanged',safe)}catch{}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const close=document.querySelector('#itemEditor:not(.hidden) #itemEditorBack,#itemDrawer:not(.hidden) #closeItemDrawer');close?.click()}});
 }
 // Reuse the parent SDK before inline auth code runs in same-origin operational frames.
 if(new URLSearchParams(location.search).get('embed')==='console'){try{if(parent!==window&&parent.location.origin===location.origin&&parent.Telegram)window.Telegram=parent.Telegram}catch{}}
 window.ShaurmegConsole={icons};
 document.addEventListener('DOMContentLoaded',init,{once:true});
})();
