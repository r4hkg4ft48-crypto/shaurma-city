'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/domain'),C=require('../src/builder-cinema');
const b=D.normalizeBuilderConfig({types:[{id:'wrap',name:'Шаурма',price:300}],breads:[{id:'bread',name:'Лаваш'}],meats:[{id:'chicken',name:'Курица'}],sauces:[{id:'garlic',name:'Чесночный'}],extras:[{id:'onion',name:'Лук'}]});
test('scene binds exact option IDs, including unknown ingredients, and keeps a stable grid',()=>{
 const p=C.plan(b,'wrap','Капуста');assert.deepEqual(p.slots.map(x=>x.key),['breads:bread','filling','meats:chicken','sauces:garlic','extras:onion']);assert.equal(p.grid,3);
 assert.throws(()=>C.plan(b,'another'),/Формат/);
});
test('only appearance-relevant changes invalidate a generated scene',()=>{
 const first=C.revision(b,'wrap','Капуста','photo1'),changed=structuredClone(b);changed.types[0].price=999;
 assert.equal(first,C.revision(changed,'wrap','Капуста','photo1'));
 changed.meats[0].name='Говядина';assert.notEqual(first,C.revision(changed,'wrap','Капуста','photo1'));
 assert.notEqual(first,C.revision(b,'wrap','Помидоры','photo1'));assert.notEqual(first,C.revision(b,'wrap','Капуста','photo2'));
});
test('rejects remote images, SVG, oversized input; does not fetch owner-supplied URLs',()=>{
 for(const input of ['https://localhost/private','data:image/svg+xml;base64,AAAA','data:image/png;base64,'+'A'.repeat(1600001)])assert.throws(()=>C.photo(input));
 assert.equal(C.photo('data:image/png;base64,YWJj').bytes.toString(),'abc');
});
test('no configured provider fails explicitly without making a billed request',async()=>{
 let called=false;await assert.rejects(C.render('data:image/png;base64,YWJj',C.plan(b,'wrap'),{key:'',fetcher:async()=>{called=true;}}),/Генерация пока/);assert.equal(called,false);
});
test('provider edit request carries the uploaded photo and returns a transparent atlas',async()=>{
 const sharp=require('sharp');const bytes=await sharp({create:{width:32,height:32,channels:4,background:{r:40,g:30,b:20,alpha:.5}}}).png().toBuffer();
 const out=await C.render('data:image/png;base64,'+bytes.toString('base64'),C.plan(b,'wrap'),{key:'test-only',fetcher:async(url,opt)=>{
  assert.equal(url,'https://api.openai.com/v1/images/edits');assert.equal(opt.body.get('background'),'transparent');assert.ok(opt.body.get('image') instanceof Blob);assert.ok(opt.body.get('prompt').includes('Чесночный'));
  return {ok:true,json:async()=>({data:[{b64_json:bytes.toString('base64')}]})};
 }});assert.match(out,/^data:image\/webp;base64,/);
});
test('provider failure is sanitized and never includes credential or provider body',async()=>{
 await assert.rejects(C.render('data:image/png;base64,YWJj',C.plan(b,'wrap'),{key:'test-secret',fetcher:async()=>({ok:false,status:500})}),e=>e.status===502&&!e.message.includes('test-secret'));
});
