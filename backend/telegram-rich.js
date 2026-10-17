'use strict';
// Telegram Bot API 10.3 rich messages. The original keyboard and text are retained
// as a safe fallback on clients/bot gateways which reject rich formatting.
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const allowedUrl=url=>/^(?:https?:\/\/|tg:\/\/)/i.test(String(url||''));
function buttonRow(row){
  if(!Array.isArray(row)||!row.length||row.length>8)return '';
  const items=[];
  for(const button of row){
    if(!button||typeof button!=='object')return '';
    const text=escapeHtml(String(button.text||'').slice(0,80));
    if(!text)return '';
    let attrs='';
    if(typeof button.callback_data==='string'&&Buffer.byteLength(button.callback_data,'utf8')<=64&&button.callback_data.length){
      const style=/^(?:ko:|va:)/.test(button.callback_data)?' style="primary"':'';
      attrs='type="callback_data" data="'+escapeHtml(button.callback_data)+'"'+style;
    }else if(button.web_app?.url&&allowedUrl(button.web_app.url)){
      attrs='type="web_app" url="'+escapeHtml(button.web_app.url)+'"';
    }else if(button.url&&allowedUrl(button.url)){
      attrs='type="url" url="'+escapeHtml(button.url)+'"';
    }else return '';
    items.push('<tg-button '+attrs+'>'+text+'</tg-button>');
  }
  return '<tg-button-row align="center">'+items.join('')+'</tg-button-row>';
}
function buttonsFromMarkup(markup){
  if(!markup||typeof markup!=='object'||!Array.isArray(markup.inline_keyboard))return null;
  if(markup.inline_keyboard.length>12)return null;
  const rows=markup.inline_keyboard.map(buttonRow);
  return rows.every(Boolean)?rows.join(''):null;
}
function textToHtml(text){
  const input=String(text??'').replace(/\r/g,'').trim().slice(0,3900);
  if(!input)return '<p> </p>';
  const chunks=input.split(/\n\s*\n/).filter(Boolean);
  const first=chunks.shift()||'';
  const firstLines=first.split('\n');
  const title=firstLines.shift()||'';
  const parts=[];
  parts.push((title.length<=115?'<h3>'+escapeHtml(title)+'</h3>':'<p>'+escapeHtml(title)+'</p>'));
  if(firstLines.length)chunks.unshift(firstLines.join('\n'));
  for(const chunk of chunks){
    const lines=chunk.split('\n').filter(Boolean);
    let mode='';
    let buffer=[];
    const flush=()=>{
      if(!buffer.length)return;
      if(mode==='list')parts.push('<ul>'+buffer.map(s=>'<li>'+escapeHtml(s)+'</li>').join('')+'</ul>');
      else parts.push('<p>'+buffer.map(escapeHtml).join('<br/>')+'</p>');
      buffer=[];
    };
    for(const line of lines){
      const match=line.match(/^\s*[•*\-]\s+(.+)$/);
      const next=match?'list':'paragraph';
      if(mode&&next!==mode)flush();
      mode=next;
      buffer.push(match?match[1]:line);
    }
    flush();
  }
  return parts.join('\n');
}
function safeImageUrl(value){
  const valueText=String(value||'').trim();
  if(!valueText||valueText.length>1400)return '';
  try{
    const u=new URL(valueText);
    if(u.protocol!=='https:'||u.username||u.password)return '';
    if(!u.hostname||u.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname))return '';
    return u.toString();
  }catch{return ''}
}
function orderHtml(order,{photoUrl=''}={}){
  const items=Array.isArray(order?.items)?order.items:[];
  const esc=escapeHtml;
  const cell=(value)=>'<td>'+esc(value)+'</td>';
  const photo=safeImageUrl(photoUrl);
  const photoBlock=photo?'<figure><img src="'+esc(photo)+'"/><figcaption>'+esc(String(items[0]?.n||items[0]?.name||'Блюдо').slice(0,100))+'</figcaption></figure>':'';
  const lines=items.slice(0,80).map(item=>
    '<tr>'+cell(String(item?.n||item?.name||'Позиция').slice(0,150))+
    '<td align="right">'+esc(Math.max(1,Number(item?.q)||1))+'</td></tr>'
  );
  const details=items.filter(item=>item?.detail).map(item=>'<li><b>'+esc(String(item.n||item.name||'Позиция'))+
    '</b>: '+esc(String(item.detail).slice(0,300))+'</li>').join('');
  const extra=[];
  for(const [label,value] of [
    ['Получение',order?.fulfillment_type==='cafe'?'В заведении / самовывоз':'Доставка'],
    ['Адрес',order?.fulfillment_type==='cafe'?'':order?.address],
    ['Клиент',order?.customer_name],['Телефон',order?.phone],['Комментарий',order?.comment]
  ])if(value)extra.push('<p><b>'+label+':</b> '+esc(String(value).slice(0,300))+'</p>');
  return [
    '<h2>🥙 '+esc(String(order?.venue_name||'Заведение'))+'</h2>',
    '<h3>Заказ '+esc(String(order?.order_number||('#'+order?.id)))+'</h3>',
    photoBlock,
    '<table bordered compact><tr><th>Позиция</th><th>Кол-во</th></tr>'+lines.join('')+'</table>',
    details?'<details><summary>Состав и пожелания</summary><ul>'+details+'</ul></details>':'',
    ...extra,
    '<hr/>',
    '<p><b>Итого:</b> '+esc(Number(order?.total)||0)+' ₽</p>',
    '<p><b>Статус:</b> '+esc(({new:'🟠 Принят',cooking:'🔥 Готовится',ready:'✅ Готово',done:'🏁 Выполнен',cancelled:'Отменён'})[order?.status]||order?.status||'')+'</p>'
  ].join('\n');
}
function prepare(method,body){
  if(!body||typeof body!=='object'||!['sendMessage','editMessageText'].includes(method)||typeof body.text!=='string'||(body.parse_mode&&!body.__rich_html)||body.entities)return null;
  if(body.chat_id===undefined||body.chat_id===null)return null;
  const keyboard=buttonsFromMarkup(body.reply_markup);
  const embeds=keyboard!==null;
  const {text,disable_web_page_preview,link_preview_options,parse_mode,entities,reply_markup,__rich_html,...others}=body;
  const html=String(body.__rich_html||textToHtml(text))+(embeds?'\n'+keyboard:'');
  const next={...others,rich_message:{html}};
  if(!embeds&&reply_markup)next.reply_markup=reply_markup;
  if(method==='sendMessage')return {method:'sendRichMessage',body:next};
  return {method:'editMessageText',body:next};
}
function canFallback(error){
  const status=Number(error?.status||error?.telegram?.error_code);
  // Telegram returns validation failures before dispatching any message.
  return status===400||status===404;
}
async function withRich(method,body,perform){
  const clean={...(body||{})};
  delete clean.__rich_html;
  const rich=prepare(method,body);
  if(!rich)return perform(method,clean);
  try{return await perform(rich.method,rich.body)}
  catch(error){
    if(!canFallback(error))throw error;
    console.warn('Telegram rich fallback '+method+': '+String(error.message||'').slice(0,160));
    return perform(method,clean);
  }
}
module.exports={escapeHtml,buttonRow,buttonsFromMarkup,textToHtml,orderHtml,safeImageUrl,prepare,withRich,canFallback};
