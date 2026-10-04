'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/domain');

test('normalizeMenu keeps configurable item fields',()=>{
  const [item]=D.normalizeMenu([{
    id:'shawarma_cheese',name:'Сырная',category:'shawarma',price:350,
    available:false,min_qty:2,max_qty:4,
    choice_groups:[{
      id:'size',name:'Размер',type:'single',required:true,
      options:[
        {id:'small',name:'Маленькая',price_delta:0,active:true},
        {id:'large',name:'Большая',price_delta:80,default:true}
      ]
    }]
  }]);
  assert.equal(item.available,false);
  assert.equal(item.min_qty,2);
  assert.equal(item.max_qty,4);
  assert.equal(item.choice_groups.length,1);
  assert.equal(item.choice_groups[0].options[1].price_delta,80);
});

test('priceMenuItem validates required choices and server price',()=>{
  const [item]=D.normalizeMenu([{
    id:'x',n:'Шаурма',p:300,available:true,
    choice_groups:[
      {id:'size',name:'Размер',type:'single',required:true,options:[
        {id:'s',name:'S',price_delta:0},
        {id:'l',name:'L',price_delta:90}
      ]},
      {id:'sauce',name:'Соус',type:'multiple',min:0,max:2,options:[
        {id:'garlic',name:'Чесночный',price_delta:20},
        {id:'cheese',name:'Сырный',price_delta:30},
        {id:'bbq',name:'BBQ',price_delta:25}
      ]}
    ]
  }]);
  assert.equal(D.priceMenuItem(item,{q:1,choices:{}}).error,'invalid_choice_count');
  const priced=D.priceMenuItem(item,{q:1,choices:{size:['l'],sauce:['garlic','cheese']}});
  assert.equal(priced.error,undefined);
  assert.equal(priced.item.p,440);
  assert.match(priced.item.detail,/Размер: L/);
  assert.match(priced.item.detail,/Соус:/);
});

test('priceMenuItem rejects sold out, invalid option and quantity limits',()=>{
  const [sold]=D.normalizeMenu([{id:'a',n:'Айран',p:100,available:false}]);
  assert.equal(D.priceMenuItem(sold,{q:1}).error,'item_unavailable');

  const [limited]=D.normalizeMenu([{
    id:'b',n:'Блюдо',p:200,min_qty:2,max_qty:3,
    choice_groups:[{id:'size',name:'Размер',required:true,options:[{id:'one',name:'Один'}]}]
  }]);
  assert.equal(D.priceMenuItem(limited,{q:1,choices:{size:['one']}}).error,'invalid_quantity');
  assert.equal(D.priceMenuItem(limited,{q:2,choices:{size:['missing']}}).error,'invalid_choice');
  assert.equal(D.priceMenuItem(limited,{q:2,choices:{size:['one']}}).item.p,200);
});
