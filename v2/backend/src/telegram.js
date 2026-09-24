'use strict';
const config=require('./config');
const db=require('./db');

async function call(token,method,body={}){
  if(!token)return null;
  const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.description||method+'_failed');return j.result;
}
function menuUrl(marker,est){
  const u=new URL(config.PUBLIC_APP_URL+'/menu.html');u.searchParams.set('marker',String(marker));u.searchParams.set('establishment',String(est));return u.toString();
}
async function sync(){
  const mapUrl=config.PUBLIC_APP_URL+'/index.html';
  const adminUrl=config.PUBLIC_APP_URL+'/admin-map.html';
  const venueUrl=config.PUBLIC_APP_URL+'/admin-venue.html';
  const work=[];
  if(config.AGGREGATOR_BOT_TOKEN){
    work.push(call(config.AGGREGATOR_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Карта',web_app:{url:mapUrl}}}));
    work.push(call(config.AGGREGATOR_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть карту Шаурмега'},{command:'map',description:'Карта заведений'}]}));
    work.push(call(config.AGGREGATOR_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/aggregator',allowed_updates:['message']}));
  }
  if(config.CLIENT_BOT_TOKEN){
    work.push(call(config.CLIENT_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Выбрать заведение',web_app:{url:mapUrl}}}));
    work.push(call(config.CLIENT_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть меню выбранной точки'},{command:'menu',description:'Открыть меню'}]}));
    work.push(call(config.CLIENT_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/client',allowed_updates:['message']}));
  }
  if(config.ADMIN_BOT_TOKEN)work.push(call(config.ADMIN_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Админка карты',web_app:{url:adminUrl}}}));
  if(config.VENUE_OWNER_BOT_TOKEN)work.push(call(config.VENUE_OWNER_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Мои заведения',web_app:{url:venueUrl}}}));
  const result=await Promise.allSettled(work);
  const failed=result.filter(x=>x.status==='rejected');
  console.log('Shaurmeg v2 Telegram sync · '+(result.length-failed.length)+' ok · '+failed.length+' failed · app '+config.PUBLIC_APP_URL);
  failed.forEach(x=>console.error('Shaurmeg v2 Telegram sync:',x.reason?.message||x.reason));
  return {ok:failed.length===0,total:result.length,failed:failed.length};
}
function install(app){
  app.post('/api/v2/telegram/aggregator',async(req,res)=>{
    res.sendStatus(200);try{const msg=req.body?.message;if(!msg?.chat?.id)return;if(!/^\/(start|map)/i.test(String(msg.text||'')))return;await call(config.AGGREGATOR_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'🗺 Шаурмег — выберите заведение на карте.',reply_markup:{inline_keyboard:[[{text:'Открыть карту',web_app:{url:config.PUBLIC_APP_URL+'/index.html'}}]]}})}catch(e){console.error('aggregator webhook',e.message)}
  });
  app.post('/api/v2/telegram/client',async(req,res)=>{
    res.sendStatus(200);try{
      const msg=req.body?.message;if(!msg?.chat?.id)return;const raw=String(msg.text||''),m=raw.match(/^\/(?:start|menu)(?:@[A-Za-z0-9_]+)?(?:\s+order_(\d+))?/i);
      if(!m)return;
      if(!m[1])return call(config.CLIENT_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'Сначала выберите заведение на карте Шаурмега.'});
      const q=await db.query(`SELECT m.id,m.establishment_id,m.name,m.address,v.menu FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id WHERE m.id=$1 AND m.is_active=TRUE AND v.is_active=TRUE`,[m[1]]);
      const x=q.rows[0];if(!x)return call(config.CLIENT_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'Эта точка недоступна. Выберите её заново на карте.'});
      return call(config.CLIENT_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'🥙 '+x.name+(x.address?'\n'+x.address:''),reply_markup:{inline_keyboard:[[{text:'Открыть меню и заказать',web_app:{url:menuUrl(x.id,x.establishment_id)}}]]}});
    }catch(e){console.error('client webhook',e.message)}
  });
}
module.exports={sync,install};
