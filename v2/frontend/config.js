(() => {
  const qs=new URLSearchParams(location.search);
  const saved=localStorage.getItem('shaurmeg_api_v2')||'';
  const api=(qs.get('api')||saved||'https://shaurma-city-api.onrender.com/api/v2').replace(/\/+$/,'');
  if(qs.get('api'))localStorage.setItem('shaurmeg_api_v2',api);
  window.SHAURMEG={
    api,
    appVersion:'v2-clean-1',
    telegram:window.Telegram?.WebApp||null,
    money:v=>new Intl.NumberFormat('ru-RU').format(Number(v)||0)+' ₽',
    esc:v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
  };
})();