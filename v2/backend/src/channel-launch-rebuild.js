'use strict';

const config=require('./config');
const db=require('./db');
const content=require('./channel-content');
const assets=require('./channel-assets');

const VERSION='rich-direct-media-20261006-v3';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function tg(method,body={},attempt=0){
  if(!config.CHANNEL_BOT_TOKEN)throw new Error('channel_bot_token_missing');
  const r=await fetch('https://api.telegram.org/bot'+config.CHANNEL_BOT_TOKEN+'/'+method,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(12000)
  });
  const j=await r.json().catch(()=>({}));
  if((r.status===429||j.error_code===429)&&attempt<3){
    await sleep((Math.max(1,Number(j.parameters?.retry_after)||1)*1000)+250);
    return tg(method,body,attempt+1);
  }
  if(!r.ok||!j.ok)throw new Error(j.description||method+'_failed');
  return j.result;
}

async function tgPhoto(fields,filename,buffer,attempt=0){
  const form=new FormData();
  for(const [k,v] of Object.entries(fields||{})){
    if(v===undefined||v===null)continue;
    form.append(k,typeof v==='string'?v:JSON.stringify(v));
  }
  form.append('photo',new Blob([buffer],{type:'image/png'}),filename);
  const r=await fetch('https://api.telegram.org/bot'+config.CHANNEL_BOT_TOKEN+'/sendPhoto',{
    method:'POST',body:form,signal:AbortSignal.timeout(25000)
  });
  const j=await r.json().catch(()=>({}));
  if((r.status===429||j.error_code===429)&&attempt<3){
    await sleep((Math.max(1,Number(j.parameters?.retry_after)||1)*1000)+250);
    return tgPhoto(fields,filename,buffer,attempt+1);
  }
  if(!r.ok||!j.ok)throw new Error(j.description||'sendPhoto_failed');
  return j.result;
}

async function targetChat(){
  if(db.configured){
    const q=await db.query("SELECT value FROM shaurmeg_channel_settings WHERE key='channel_chat_id' LIMIT 1");
    const v=String(q.rows[0]?.value||'').trim();
    if(/^-100\d+$/.test(v))return v;
  }
  const raw=String(config.CHANNEL_CHAT_ID||'').trim();
  if(/^@[-_A-Za-z0-9]{4,}$/.test(raw)||/^-100\d+$/.test(raw))return raw;
  return '';
}

async function setting(key){
  const q=await db.query('SELECT value FROM shaurmeg_channel_settings WHERE key=$1 LIMIT 1',[key]);
  return String(q.rows[0]?.value||'');
}
async function setSetting(key,value){
  await db.query(`INSERT INTO shaurmeg_channel_settings(key,value,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,String(value||'')]);
}

async function cleanup(target){
  const slugs=new Set(content.launch().map(x=>x.slug));
  const q=await db.query('SELECT id,slug,message_ids FROM shaurmeg_channel_publications WHERE channel_chat_id=$1 ORDER BY id',[target]);
  const rowIds=[];let messages=0;
  for(const row of q.rows){
    if(!slugs.has(String(row.slug)))continue;
    rowIds.push(row.id);
    for(const mid of (Array.isArray(row.message_ids)?row.message_ids:[])){
      try{await tg('deleteMessage',{chat_id:target,message_id:Number(mid)});messages++}
      catch(e){console.warn('channel rebuild delete',row.slug,mid,e.message)}
      await sleep(70);
    }
  }
  if(rowIds.length)await db.query('DELETE FROM shaurmeg_channel_publications WHERE id = ANY($1::bigint[])',[rowIds]);
  return {rows:rowIds.length,messages};
}

function keyboard(username){
  if(!username)return null;
  return {inline_keyboard:[[{text:'🟠 Подключить заведение',url:'https://t.me/'+username+'?start=connect'}]]};
}

async function sendPost(target,post,username){
  const buf=await assets.render(post.slug);
  if(!buf)throw new Error('asset_render_failed:'+post.slug);
  const text=String(post.text||'');
  const parseMode=post.format||'HTML';
  const buttons=post.cta==='connect'?keyboard(username):null;
  const ids=[];
  if(text.length<=950){
    const msg=await tgPhoto({
      chat_id:target,caption:text,parse_mode:parseMode,
      ...(buttons?{reply_markup:buttons}:{})
    },post.slug+'.png',buf);
    if(msg?.message_id)ids.push(msg.message_id);
  }else{
    const photo=await tgPhoto({chat_id:target},post.slug+'.png',buf);
    if(photo?.message_id)ids.push(photo.message_id);
    const body={chat_id:target,text:text.slice(0,4090),parse_mode:parseMode,disable_web_page_preview:true};
    if(buttons)body.reply_markup=buttons;
    const msg=await tg('sendMessage',body);
    if(msg?.message_id)ids.push(msg.message_id);
  }
  if(ids.length){
    await db.query(`INSERT INTO shaurmeg_channel_publications(slug,channel_chat_id,message_ids,published_by)
      VALUES($1,$2,$3::jsonb,$4)`,[post.slug,target,JSON.stringify(ids),'clean-launch:'+VERSION]);
  }
  if(post.pin&&ids.length){
    try{await tg('pinChatMessage',{chat_id:target,message_id:ids[ids.length-1],disable_notification:true})}
    catch(e){console.warn('channel rebuild pin',e.message)}
  }
  return ids;
}

async function run(){
  if(!config.CHANNEL_BOT_TOKEN||!db.configured)return {enabled:false};
  const target=await targetChat();
  if(!target)return {enabled:true,waiting_for_channel:true};
  const versionKey='clean_launch_version:'+target;
  if(await setting(versionKey)===VERSION)return {enabled:true,already_done:true,version:VERSION};

  const access=await tg('getMe',{});
  const username=String(access?.username||config.CHANNEL_BOT_USERNAME||'').replace(/^@/,'');
  const member=await tg('getChatMember',{chat_id:target,user_id:access.id});
  if(String(member?.status)!=='administrator')throw new Error('channel_bot_not_administrator');

  await setSetting(versionKey,'rebuilding:'+VERSION);
  const removed=await cleanup(target);
  console.log('Channel clean rebuild · removed '+removed.rows+' rows · '+removed.messages+' messages');

  let published=0;
  try{
    for(const post of content.launch()){
      await sendPost(target,post,username);
      published++;
      console.log('Channel clean publish · '+published+'/12 · '+post.slug);
      await sleep(850);
    }
  }catch(e){
    console.error('Channel clean rebuild failed after '+published+' posts · '+e.message);
    throw e;
  }
  await setSetting(versionKey,VERSION);
  console.log('Channel clean rebuild complete · '+published+'/12 · '+VERSION);
  return {enabled:true,published,removed,version:VERSION};
}

// startup-detach validated
module.exports={run,VERSION};
