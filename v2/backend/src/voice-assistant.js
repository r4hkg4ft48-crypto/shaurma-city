'use strict';

const INTENTS=new Set(['list_active','read_order','set_status','help','unknown']);
const STATUSES=new Set(['new','cooking','ready','done']);

function normalizeText(value){
  return String(value||'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g,'е')
    .replace(/[«»“”"'.,!?;:()[\]{}]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function orderReference(text){
  const raw=String(text||'');
  const order=raw.match(/\bSC-\d{7}-\d{2}\b/i);
  if(order)return {target:'order_number',order_ref:order[0].toUpperCase()};
  const id=raw.match(/(?:заказ(?:а|у|ом)?|номер|id)\s*#?\s*(\d{1,12})\b/i);
  if(id)return {target:'id',order_ref:id[1]};
  if(/\b(стар(ый|ого)|перв(ый|ого))\b/i.test(raw))return {target:'oldest',order_ref:''};
  return {target:'latest',order_ref:''};
}

function localStatus(text){
  const s=normalizeText(text);
  if(/(выполнен|выполнено|выдан|выдано|отдан|отдано|закрыт|закрыто|завершен|завершено)/.test(s))return 'done';
  if(/(готовится|готовить|готовим|начинай готовить|начать готовить|в работу|на кухню|делаем)/.test(s))return 'cooking';
  if(/(готов|готово|готовый|приготовлен|приготовлено)/.test(s))return 'ready';
  if(/(принят|принято|прими|принять)/.test(s))return 'new';
  return '';
}

function parseLocalIntent(text){
  const s=normalizeText(text);
  if(!s)return {intent:'unknown',target:'latest',order_ref:'',status:''};

  if(/(помощь|что умеешь|команды|как пользоваться|голосовые команды)/.test(s)){
    return {intent:'help',target:'latest',order_ref:'',status:''};
  }

  if(/(сколько|какие|покажи|список|очередь|активные)/.test(s)&&/(заказ|заказы|заказов|очередь)/.test(s)){
    return {intent:'list_active',target:'latest',order_ref:'',status:''};
  }

  const status=localStatus(s);
  if(status&&(/заказ/.test(s)||/(последний|старый|первый|его|этот)/.test(s)||s.split(' ').length<=5)){
    return {intent:'set_status',...orderReference(text),status};
  }

  if(/(повтори|прочитай|расскажи|что в|состав|детали|какой статус|статус)/.test(s)&&/заказ/.test(s)){
    return {intent:'read_order',...orderReference(text),status:''};
  }

  if(/(последний|текущий|старый|первый)\s+заказ/.test(s)){
    return {intent:'read_order',...orderReference(text),status:''};
  }

  return {intent:'unknown',...orderReference(text),status:''};
}

function sanitizeAiIntent(value){
  const raw=value&&typeof value==='object'?value:{};
  const intent=INTENTS.has(String(raw.intent))?String(raw.intent):'unknown';
  const target=['latest','oldest','order_number','id'].includes(String(raw.target))?String(raw.target):'latest';
  const orderRef=String(raw.order_ref||'').trim().slice(0,40);
  const status=STATUSES.has(String(raw.status))?String(raw.status):'';
  if(intent==='set_status'&&!status)return {intent:'unknown',target,order_ref:orderRef,status:''};
  return {intent,target,order_ref:orderRef,status};
}

function extractResponseText(payload){
  if(typeof payload?.output_text==='string')return payload.output_text.trim();
  const chunks=[];
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    for(const part of Array.isArray(item?.content)?item.content:[]){
      if(typeof part?.text==='string')chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonObject(text){
  const raw=String(text||'').trim();
  if(!raw)return null;
  try{return JSON.parse(raw)}catch{}
  const match=raw.match(/\{[\s\S]*\}/);
  if(!match)return null;
  try{return JSON.parse(match[0])}catch{return null}
}

module.exports={
  normalizeText,
  parseLocalIntent,
  sanitizeAiIntent,
  extractResponseText,
  parseJsonObject
};
