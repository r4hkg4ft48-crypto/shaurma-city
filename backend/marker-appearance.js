'use strict';
function appearanceFor(category){
  const base={shape:'pin',size:42,scale:1,opacity:1,pulse:false,label_visible:false};
  if(category==='shawarma')return {...base,icon:'🥙',background:'#f1c96f',border:'#fff7df',text:'#24190d',glow:'#e8bd59',pulse:true};
  if(category==='doner_kebab')return {...base,icon:'🥙',background:'#d99b58',border:'#fff2df',text:'#25180d',glow:'#d79245'};
  if(category==='bakery')return {...base,icon:'🥐',background:'#c9a676',border:'#f7ead8',text:'#2b2117',glow:'#b88e5e'};
  if(category==='middle_eastern')return {...base,icon:'🍽️',background:'#a88d67',border:'#eee5d6',text:'#241f18',glow:'#9b815f'};
  return {...base,icon:'•',background:'#8f9585',border:'#eef0e8',text:'#182018',glow:'#78846f'};
}
module.exports={appearanceFor};
