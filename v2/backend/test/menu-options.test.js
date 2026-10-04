'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/domain');

test('canonical menu preserves custom choice groups and quantity limits',()=>{
  const [item]=D.normalizeMenu([{
    id:'shawarma_cheese',name:'Сырная',category:'shawarma_doner',price:350,
    stock:0,min_qty:2,max_qty:4,weight:'350 г',sku:'SH-01',
    options:{sizes:[{id:'m',name:'M',price:0,default:true}],required_groups:['sizes']},
    choice_groups:[{
      id:'spicy',name:'Острота',type:'single',required:true,
      options:[{id:'mild',name:'Неострая',price_delta:0},{id:'hot',name:'Острая',price_delta:40,default:true}]
    }]
  }]);
  assert.equal(item.stock,0);
  assert.equal(item.min_qty,2);
  assert.equal(item.max_qty,4);
  assert.equal(item.weight,'350 г');
  assert.equal(item.choice_groups[0].options[1].price_delta,40);
});

test('priceMenuItem combines standard options and arbitrary groups on server',()=>{
  const [item]=D.normalizeMenu([{
    id:'x',n:'Шаурма',p:300,stock:null,
    options:{
      sizes:[{id:'s',name:'S',price:0},{id:'l',name:'L',price:90}],
      required_groups:['sizes']
    },
    choice_groups:[{
      id:'sauce_pack',name:'Доп. соусы',type:'multiple',min:0,max:2,
      options:[{id:'garlic',name:'Чесночный',price_delta:20},{id:'cheese',name:'Сырный',price_delta:30}]
    }]
  }]);
  const priced=D.priceMenuItem(item,{q:1,selection:{sizes:'l'},choices:{sauce_pack:['garlic','cheese']}});
  assert.equal(priced.error,undefined);
  assert.equal(priced.item.p,440);
  assert.match(priced.item.detail,/L/);
  assert.match(priced.item.detail,/Доп\. соусы/);
});

test('priceMenuItem rejects stop-list, invalid custom choice and quantity',()=>{
  const [sold]=D.normalizeMenu([{id:'a',n:'Айран',p:100,stock:0}]);
  assert.equal(D.priceMenuItem(sold,{q:1}).error,'item_unavailable');

  const [limited]=D.normalizeMenu([{
    id:'b',n:'Блюдо',p:200,min_qty:2,max_qty:3,
    choice_groups:[{id:'size2',name:'Подача',required:true,options:[{id:'one',name:'Один'}]}]
  }]);
  assert.equal(D.priceMenuItem(limited,{q:1,choices:{size2:['one']}}).error,'invalid_quantity');
  assert.equal(D.priceMenuItem(limited,{q:2,choices:{size2:['missing']}}).error,'invalid_choice');
  assert.equal(D.priceMenuItem(limited,{q:2,choices:{size2:['one']}}).item.p,200);
});

test('required unfinished custom group blocks ordering',()=>{
  const [item]=D.normalizeMenu([{id:'c',n:'Тест',p:100,choice_groups:[{id:'size',name:'Размер',required:true,options:[]}]}]);
  assert.equal(D.priceMenuItem(item,{q:1,choices:{}}).error,'invalid_choice_count');
});
