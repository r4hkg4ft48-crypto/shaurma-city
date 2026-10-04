'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/domain');

test('default catalog has all configured categories and a populated menu',()=>{
  const seed=D.defaultMenuSeed();
  assert.equal(seed.sections.length,9);
  assert.ok(seed.sections.every(x=>x.active===true));
  assert.ok(seed.menu.length>=70);
  assert.ok(seed.sections.every(x=>String(x.cover||'').startsWith('data:image/jpeg;base64,')));
  assert.ok(seed.sections.every(x=>Array.isArray(x.gallery)));
  assert.ok(seed.menu.every(x=>String(x.image||'').startsWith('data:image/jpeg;base64,')));
  assert.equal(new Set(seed.menu.map(x=>x.image)).size,78);
  for(const section of seed.sections){
    assert.ok(seed.menu.some(x=>x.c===section.id),'missing items for '+section.id);
    assert.ok(Array.isArray(section.settings.required_fields));
  }
});

test('deep menu normalization preserves variants and operational fields',()=>{
  const row=D.normalizeMenu([{
    id:'x',n:'Test',c:'shawarma_doner',p:250,weight:'320 г',sku:'SKU-1',stock:12,
    tags:['popular'],composition:'A, B',schedule:{enabled:true,days:[1,2],from:'10:00',to:'22:00'},
    options:{
      meats:[{id:'chicken',name:'Курица',price:0,default:true}],
      sizes:[{id:'large',name:'L',price:50,default:true}],
      extras:[{id:'cheese',name:'Сыр',price:30}],
      required_groups:['meats','sizes']
    }
  }])[0];
  assert.equal(row.weight,'320 г');
  assert.equal(row.sku,'SKU-1');
  assert.equal(row.stock,12);
  assert.deepEqual(row.options.required_groups,['meats','sizes']);
  assert.equal(row.options.sizes[0].price,50);
});

test('server-authoritative selection price includes configured deltas and defaults',()=>{
  const item={
    id:'x',n:'Test',c:'shawarma_doner',p:250,
    options:{
      meats:[{id:'chicken',name:'Курица',price:0,default:true},{id:'beef',name:'Говядина',price:40}],
      sizes:[{id:'m',name:'M',price:0,default:true},{id:'l',name:'L',price:50}],
      sauces:[],bases:[],extras:[{id:'cheese',name:'Сыр',price:30}],
      required_groups:['meats','sizes']
    }
  };
  const priced=D.menuSelectionPrice(item,{meats:'beef',sizes:'l',extras:['cheese']});
  assert.ok(priced);
  assert.equal(priced.price,370);
  const defaults=D.menuSelectionPrice(item,{});
  assert.equal(defaults.price,250);
});

test('inactive categories are retained in full section state',()=>{
  const seed=D.defaultMenuSeed();
  seed.sections[2].active=false;
  const all=D.menuSectionsAll({menu_sections:seed.sections},seed.menu);
  const visible=D.menuSections({menu_sections:seed.sections},seed.menu);
  assert.equal(all.length,9);
  assert.equal(visible.length,8);
  assert.equal(all.find(x=>x.id===seed.sections[2].id).active,false);
});
