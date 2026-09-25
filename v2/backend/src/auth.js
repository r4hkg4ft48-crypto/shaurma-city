'use strict';
const crypto=require('crypto');
const config=require('./config');

function verifyInitData(initData,botToken){
  if(!botToken)throw Object.assign(new Error('telegram_not_configured'),{status:503});
  const p=new URLSearchParams(String(initData||''));
  const hash=p.get('hash');if(!hash)throw new Error('bad_init_data');
  p.delete('hash');
  const authDate=Number(p.get('auth_date')||0);
  const age=Math.floor(Date.now()/1000)-authDate;
  if(!authDate||age>86400||age<-300)throw new Error('expired_init_data');
  const dataCheck=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const calc=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
  if(calc.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash)))throw new Error('bad_hash');
  let user={};try{user=JSON.parse(p.get('user')||'{}')}catch{}
  if(!user.id)throw new Error('no_user');
  return user;
}
function verifyInitDataAny(initData,botTokens=[]){
  const tokens=[...new Set((Array.isArray(botTokens)?botTokens:[botTokens]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!tokens.length)throw Object.assign(new Error('telegram_not_configured'),{status:503});
  let lastError=null;
  for(const token of tokens){
    try{return verifyInitData(initData,token)}
    catch(e){lastError=e}
  }
  if(lastError&&!lastError.status)lastError.status=401;
  throw lastError||Object.assign(new Error('bad_init_data'),{status:401});
}

function key(scope){
  const base=scope==='admin'
    ? (config.ADMIN_BOT_TOKEN||config.OWNER_API_TOKEN)
    : scope==='venue'
      ? (config.VENUE_OWNER_BOT_TOKEN||config.OWNER_API_TOKEN)
      : (config.AGGREGATOR_BOT_TOKEN||config.CLIENT_BOT_TOKEN||config.OWNER_API_TOKEN);
  if(!base)throw Object.assign(new Error('session_not_configured'),{status:503});
  return crypto.createHmac('sha256','ShaurmegV2:'+scope).update(base).digest();
}
function sign(user,scope='client'){
  const now=Math.floor(Date.now()/1000);
  const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',scope,iat:now,exp:now+config.SESSION_TTL_SEC};
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',key(scope)).update(body).digest('base64url');
  return body+'.'+sig;
}
function readToken(req,scope='client'){
  try{
    const auth=req.get('authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7):String(req.query.session||req.query.admin_session||req.query.owner_session||'');
    const [body,sig,extra]=token.split('.');if(!body||!sig||extra)return null;
    const expected=crypto.createHmac('sha256',key(scope)).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(p.scope!==scope||!p.sub||Number(p.exp||0)<Math.floor(Date.now()/1000))return null;
    return p;
  }catch{return null}
}
function requireSession(scope='client'){
  return (req,res,next)=>{const s=readToken(req,scope);if(!s)return res.status(401).json({error:'unauthorized'});req.session=s;next()};
}
function ownerOk(req){
  if(config.OWNER_API_TOKEN&&(req.get('x-owner-token')===config.OWNER_API_TOKEN||String(req.query.token||'')===config.OWNER_API_TOKEN))return true;
  const s=readToken(req,'admin');return !!(s&&config.ADMIN_IDS.has(String(s.sub)));
}
function requireOwner(req,res,next){if(!ownerOk(req))return res.status(401).json({error:'unauthorized'});next()}
module.exports={verifyInitData,verifyInitDataAny,sign,readToken,requireSession,ownerOk,requireOwner};
