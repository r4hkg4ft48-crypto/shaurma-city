'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/domain');

test('default catalog has all configured categories and a populated menu',()=>{
  const seed=D.defaultMenuSeed();
  assert.equal(seed.sections.length,9);
  assert.ok(seed.sections.every(x=>x.active===true));
  assert.ok(seed.menu.length>=70);
  assert.ok(seed.sections.every(x=>String(x.cover||'').includes('/api/v2/menu-photo/')));
  assert.ok(seed.sections.every(x=>Array.isArray(x.gallery)));
  assert.ok(seed.menu.every(x=>String(x.image||'').includes('/api/v2/menu-photo/')));
  assert.equal(new Set(seed.menu.map(x=>x.image)).size,78);
  assert.equal(D.isGeneratedMenuPhotoName('shawarma_doner_01.jpg'),true);
  assert.equal(D.isGeneratedMenuPhotoName('shawarma_doner_x1.jpg'),false);
  const photo=Buffer.from(D.generatedMenuPhotoBase64('shawarma_doner_01.jpg'),'base64');
  assert.equal(photo[0],0xFF);assert.equal(photo[1],0xD8);assert.ok(photo.length>5000);
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


test('generic custom choice groups are normalized and priced server-side',()=>{
  const item=D.normalizeMenu([{
    id:'x',n:'Test',c:'shawarma_doner',p:300,available:true,min_qty:1,max_qty:3,
    choice_groups:[{
      id:'spice',name:'Острота',type:'single',required:true,min:1,max:1,
      options:[
        {id:'mild',name:'Обычная',price_delta:0,active:true,default:true},
        {id:'hot',name:'Острая',price_delta:40,active:true}
      ]
    },{
      id:'extras2',name:'Дополнительно',type:'multiple',required:false,min:0,max:2,
      options:[{id:'cheese',name:'Сыр',price_delta:50,active:true},{id:'jal',name:'Халапеньо',price_delta:30,active:true}]
    }]
  }])[0];
  assert.equal(item.available,true);
  assert.equal(item.max_qty,3);
  assert.equal(item.choice_groups.length,2);
  const priced=D.menuSelectionPrice(item,{}, {spice:['hot'],extras2:['cheese','jal']});
  assert.ok(priced);
  assert.equal(priced.price,420);
  assert.equal(D.menuSelectionPrice(item,{}, {spice:[]}),null);
  assert.equal(D.menuSelectionPrice(item,{}, {spice:['hot','mild']}),null);
});


test('scheduled menu availability respects timezone window',()=>{
  const item={active:true,available:true,stock:null,schedule:{enabled:true,days:[1],from:'10:00',to:'12:00'}};
  assert.equal(D.menuItemAvailableNow(item,'Europe/Moscow',new Date('2026-10-05T08:00:00Z')),true);
  assert.equal(D.menuItemAvailableNow(item,'Europe/Moscow',new Date('2026-10-05T10:30:00Z')),false);
  assert.equal(D.menuItemAvailableNow({...item,available:false},'Europe/Moscow',new Date('2026-10-05T08:00:00Z')),false);
});
