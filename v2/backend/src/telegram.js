'use strict';
const config=require('./config');
const db=require('./db');

const TELEGRAM_MAX_RETRIES=3;
const TELEGRAM_SYNC_DELAY_MS=300;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function call(token,method,body={},attempt=0){
  if(!token)return null;
  const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const j=await r.json().catch(()=>({}));

  if((r.status===429||j.error_code===429)&&attempt<TELEGRAM_MAX_RETRIES){
    const retryAfter=Math.max(1,Number(j.parameters?.retry_after)||1);
    const delay=retryAfter*1000+300;
    console.warn('Shaurmeg v2 Telegram rate limit '+method+' · retry '+(attempt+1)+'/'+TELEGRAM_MAX_RETRIES+' in '+delay+'ms');
    await sleep(delay);
    return call(token,method,body,attempt+1);
  }

  if(!r.ok||!j.ok){
    const error=new Error(j.description||method+'_failed');
    error.status=r.status;
    error.method=method;
    throw error;
  }
  return j.result;
}

function menuUrl(marker,est){
  const u=new URL(config.PUBLIC_APP_URL+'/menu.html');
  u.searchParams.set('marker',String(marker));
  u.searchParams.set('establishment',String(est));
  return u.toString();
}

async function sync(){
  const mapUrl=config.PUBLIC_APP_URL+'/index.html';
  const adminUrl=config.PUBLIC_APP_URL+'/admin-map.html';
  const venueUrl=config.PUBLIC_APP_URL+'/admin-venue.html';
  const tasks=[];
  const add=(name,fn)=>tasks.push({name,fn});

  if(config.AGGREGATOR_BOT_TOKEN){
    add('aggregator.menu',()=>call(config.AGGREGATOR_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Карта',web_app:{url:mapUrl}}}));
    add('aggregator.commands',()=>call(config.AGGREGATOR_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть карту Шаурмега'},{command:'map',description:'Карта заведений'}]}));
    add('aggregator.webhook',()=>call(config.AGGREGATOR_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/aggregator',allowed_updates:['message']}));
  }

  if(config.CLIENT_BOT_TOKEN){
    add('client.menu',()=>call(config.CLIENT_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Выбрать заведение',web_app:{url:mapUrl}}}));
    add('client.commands',()=>call(config.CLIENT_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть меню выбранной точки'},{command:'menu',description:'Открыть меню'}]}));
    add('client.webhook',()=>call(config.CLIENT_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/client',allowed_updates:['message']}));
  }

  if(config.ADMIN_BOT_TOKEN){
    add('admin.menu',()=>call(config.ADMIN_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Админка карты',web_app:{url:adminUrl}}}));
  }
  if(config.VENUE_OWNER_BOT_TOKEN){
    add('venue.menu',()=>call(config.VENUE_OWNER_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Мои заведения',web_app:{url:venueUrl}}}));
  }

  let ok=0;
  let failed=0;

  for(const task of tasks){
    try{
      await task.fn();
      ok++;
    }catch(e){
      failed++;
      console.error('Shaurmeg v2 Telegram sync '+task.name+':',e.message);
    }
    await sleep(TELEGRAM_SYNC_DELAY_MS);
  }

  console.log('Shaurmeg v2 Telegram sync · '+ok+' ok · '+failed+' failed · app '+config.PUBLIC_APP_URL);
  return {ok:failed===0,total:tasks.length,failed};
}

function install(app){
  app.post('/api/v2/telegram/aggregator',async(req,res)=>{
    res.sendStatus(200);
    try{
      const msg=req.body?.message;
      if(!msg?.chat?.id)return;
      if(!/^\/(start|map)/i.test(String(msg.text||'')))return;
      await call(config.AGGREGATOR_BOT_TOKEN,'sendMessage',{
        chat_id:msg.chat.id,
        text:'🗺 Шаурмег — выберите заведение на карте.',
        reply_markup:{inline_keyboard:[[{text:'Открыть карту',web_app:{url:config.PUBLIC_APP_URL+'/index.html'}}]]}
      });
    }catch(e){
      console.error('aggregator webhook',e.message);
    }
  });

  app.post('/api/v2/telegram/client',async(req,res)=>{
    res.sendStatus(200);
    try{
      const msg=req.body?.message;
      if(!msg?.chat?.id)return;
      const raw=String(msg.text||'');
      const m=raw.match(/^\/(?:start|menu)(?:@[A-Za-z0-9_]+)?(?:\s+order_(\d+))?/i);
      if(!m)return;

      if(!m[1]){
        return call(config.CLIENT_BOT_TOKEN,'sendMessage',{
          chat_id:msg.chat.id,
          text:'Сначала выберите заведение на карте Шаурмега.'
        });
      }

      const q=await db.query(
        `SELECT m.id,m.establishment_id,m.name,m.address,v.menu
         FROM shaurmeg_markers m
         JOIN shaurma_venues v ON v.venue_id=m.venue_id
         WHERE m.id=$1 AND m.is_active=TRUE AND v.is_active=TRUE`,
        [m[1]]
      );
      const x=q.rows[0];
      if(!x){
        return call(config.CLIENT_BOT_TOKEN,'sendMessage',{
          chat_id:msg.chat.id,
          text:'Эта точка недоступна. Выберите её заново на карте.'
        });
      }

      return call(config.CLIENT_BOT_TOKEN,'sendMessage',{
        chat_id:msg.chat.id,
        text:'🥙 '+x.name+(x.address?'\n'+x.address:''),
        reply_markup:{inline_keyboard:[[{text:'Открыть меню и заказать',web_app:{url:menuUrl(x.id,x.establishment_id)}}]]}
      });
    }catch(e){
      console.error('client webhook',e.message);
    }
  });
}

module.exports={sync,install};
