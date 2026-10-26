(() => {
  const qs=new URLSearchParams(location.search);
  const saved=localStorage.getItem('shaurmeg_api_v3')||'';
  const api=(qs.get('api')||saved||location.origin+'/api/v2').replace(/\/+$/,'');
  if(qs.get('api'))localStorage.setItem('shaurmeg_api_v3',api);
  window.SHAURMEG={
    api,
    appVersion:'v3-unified',
    telegram:window.Telegram?.WebApp||null,
    money:v=>new Intl.NumberFormat('ru-RU').format(Number(v)||0)+' ₽',
    esc:v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
  };
})();