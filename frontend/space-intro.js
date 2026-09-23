(function(){
'use strict';

const VERSION='2';
let activeRun=0,raf=0,resizeBound=false;

const $=(s,r=document)=>r.querySelector(s);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const ease=t=>1-Math.pow(1-t,3);

function inject(){
  if($('#rcSpaceIntro'))return;
  document.body.insertAdjacentHTML('beforeend',`
  <div id="rcSpaceIntro" class="rcSpaceIntro" aria-hidden="true">
    <canvas id="rcSpaceCanvas"></canvas>
    <div class="rcSpaceGrain"></div>
    <div class="rcSpaceVignette"></div>
    <div class="rcSpaceHud">
      <div class="rcSpaceHudTop"><span class="rcSpaceDot"></span><span id="rcSpaceStage">DEEP SPACE</span></div>
      <div class="rcSpaceHudBottom"><span>SHAURMEG // REAL CITY</span><span id="rcSpaceTelemetry">000.0 AU</span></div>
    </div>
    <button id="rcSpaceSkip" class="rcSpaceSkip" type="button">Пропустить</button>
    <div class="rcSpaceFlash"></div>
  </div>`);
  $('#rcSpaceSkip').addEventListener('click',()=>finish(activeRun,true));
}

function makeStars(count){
  const a=[];
  for(let i=0;i<count;i++){
    const r=Math.random(),band=Math.random()<.46;
    a.push({
      x:(Math.random()-.5)*2.4,
      y:band?(Math.random()-.5)*.26+(Math.random()-.5)*.08:(Math.random()-.5)*1.55,
      z:.08+Math.pow(Math.random(),1.5)*1.7,
      s:.25+Math.random()*1.75,
      b:.45+Math.random()*.55,
      hue:Math.random()
    });
  }
  return a;
}
function makeDust(count){
  const a=[];
  for(let i=0;i<count;i++){
    const ang=Math.random()*Math.PI*2,rad=Math.pow(Math.random(),.62);
    a.push({
      x:Math.cos(ang)*rad,
      y:Math.sin(ang)*rad*.19+(Math.random()-.5)*.055,
      z:Math.random(),
      a:.04+Math.random()*.15,
      s:.4+Math.random()*1.5
    });
  }
  return a;
}

function earthTexture(size=512){
  const c=document.createElement('canvas');c.width=c.height=size;
  const x=c.getContext('2d');
  const grd=x.createLinearGradient(0,0,size,size);
  grd.addColorStop(0,'#173e57');grd.addColorStop(.48,'#24647a');grd.addColorStop(1,'#0d2d45');
  x.fillStyle=grd;x.fillRect(0,0,size,size);

  const land=[
    [.28,.31,.20,.16,-.18],[.40,.44,.12,.19,.22],[.57,.29,.22,.13,.06],
    [.68,.48,.18,.23,-.18],[.48,.66,.13,.19,.25],[.78,.69,.09,.08,.14]
  ];
  for(let i=0;i<land.length;i++){
    const [cx,cy,rx,ry,rot]=land[i];
    x.save();x.translate(cx*size,cy*size);x.rotate(rot);
    const g=x.createRadialGradient(-rx*size*.18,-ry*size*.22,2,0,0,rx*size);
    g.addColorStop(0,i%2?'#68805a':'#758461');g.addColorStop(.55,i%2?'#536b4d':'#657451');g.addColorStop(1,'rgba(54,75,52,.22)');
    x.fillStyle=g;x.beginPath();x.ellipse(0,0,rx*size,ry*size,0,0,Math.PI*2);x.fill();x.restore();
  }

  x.globalAlpha=.34;x.strokeStyle='#eef7f6';x.lineWidth=size*.012;
  for(let i=0;i<15;i++){
    const y=(.12+i*.055+Math.sin(i*1.9)*.02)*size;
    x.beginPath();x.moveTo(size*.08,y);
    x.bezierCurveTo(size*.28,y-size*.04,size*.58,y+size*.04,size*.94,y-size*.01);x.stroke();
  }
  x.globalAlpha=1;
  return c;
}

function resize(state){
  const c=state.canvas,dpr=Math.min(2,window.devicePixelRatio||1);
  state.w=Math.max(1,innerWidth);state.h=Math.max(1,innerHeight);state.dpr=dpr;
  c.width=Math.floor(state.w*dpr);c.height=Math.floor(state.h*dpr);c.style.width=state.w+'px';c.style.height=state.h+'px';
  state.ctx.setTransform(dpr,0,0,dpr,0,0);
}
function drawStarfield(state,p,shortMode){
  const {ctx,w,h,stars,dust}=state,cx=w*.5,cy=h*.5;
  const warp=shortMode?lerp(.22,.72,smooth(p)):p<.30?lerp(.08,.42,smooth(p/.30)):p<.55?lerp(.42,1.8,smooth((p-.30)/.25)):lerp(1.8,.3,smooth((p-.55)/.45));
  const rot=(shortMode?.06:p*.23),cr=Math.cos(rot),sr=Math.sin(rot);

  for(const s of stars){
    let z=s.z-(p*warp*.72);
    z=((z%1.75)+1.75)%1.75+.04;
    let xx=s.x,yy=s.y;
    const rx=xx*cr-yy*sr,ry=xx*sr+yy*cr;
    const scale=1/z,px=cx+rx*w*.34*scale,py=cy+ry*h*.55*scale;
    if(px<-20||px>w+20||py<-20||py>h+20)continue;
    const speed=clamp((1/z-1)*.95,0,1),len=warp>1?3+speed*24*warp:0;
    const alpha=clamp(s.b*(.32+speed*.84),.08,1);
    ctx.strokeStyle=s.hue>.82?`rgba(174,210,255,${alpha})`:s.hue<.12?`rgba(255,224,194,${alpha})`:`rgba(245,248,255,${alpha})`;
    ctx.lineWidth=Math.max(.35,s.s*(.34+speed*.75));
    ctx.beginPath();ctx.moveTo(px,py);
    if(len>0){const dx=(px-cx),dy=(py-cy),m=Math.hypot(dx,dy)||1;ctx.lineTo(px+dx/m*len,py+dy/m*len)}
    else ctx.lineTo(px+.1,py+.1);
    ctx.stroke();
  }

  if(!shortMode&&p<.48){
    const fade=1-smooth(clamp((p-.30)/.18,0,1));
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.20+p*.17);
    for(const d of dust){
      const xx=d.x*w*.76,yy=d.y*h*.90,glow=(1-Math.abs(d.y/.19));
      ctx.fillStyle=`rgba(190,208,225,${d.a*fade*Math.max(.15,glow)})`;
      ctx.beginPath();ctx.arc(xx,yy,d.s*(.7+glow*1.8),0,Math.PI*2);ctx.fill();
    }
    const g=ctx.createLinearGradient(-w*.52,0,w*.52,0);
    g.addColorStop(0,'rgba(86,100,124,0)');g.addColorStop(.42,`rgba(135,149,175,${.055*fade})`);g.addColorStop(.5,`rgba(245,235,217,${.14*fade})`);g.addColorStop(.58,`rgba(130,146,174,${.055*fade})`);g.addColorStop(1,'rgba(86,100,124,0)');
    ctx.fillStyle=g;ctx.fillRect(-w*.55,-h*.12,w*1.1,h*.24);ctx.restore();
  }
}
function drawSun(state,p){
  if(p<.27||p>.62)return;
  const {ctx,w,h}=state,t=clamp((p-.27)/.35,0,1),enter=smooth(clamp(t/.48,0,1)),exit=smooth(clamp((t-.54)/.46,0,1));
  const x=lerp(w*.78,w*.49,enter),y=lerp(h*.39,h*.50,enter),base=Math.min(w,h),r=lerp(base*.025,base*.28,enter)*(1-exit*.18);
  ctx.save();ctx.globalCompositeOperation='screen';
  let g=ctx.createRadialGradient(x,y,0,x,y,r*3.1);
  g.addColorStop(0,`rgba(255,255,242,${.95*(1-exit)})`);
  g.addColorStop(.12,`rgba(255,231,166,${.9*(1-exit)})`);
  g.addColorStop(.34,`rgba(255,164,65,${.34*(1-exit)})`);
  g.addColorStop(1,'rgba(255,120,32,0)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r*3.1,0,Math.PI*2);ctx.fill();
  g=ctx.createRadialGradient(x-r*.22,y-r*.18,r*.02,x,y,r);
  g.addColorStop(0,'#fffdf0');g.addColorStop(.40,'#ffe8a0');g.addColorStop(.78,'#ffbd54');g.addColorStop(1,'#f07820');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  const flare=.5*(1-exit);
  for(const k of [-.55,-.28,.31,.63]){
    const fx=lerp(x,w*.5,k+.5),fy=lerp(y,h*.5,k+.5),fr=r*(.08+Math.abs(k)*.07);
    ctx.fillStyle=`rgba(175,214,255,${flare*(.16+Math.abs(k)*.10)})`;ctx.beginPath();ctx.arc(fx,fy,fr,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
function drawEarth(state,p,shortMode){
  const start=shortMode?.12:.48;if(p<start)return;
  const {ctx,w,h,earth}=state,t=clamp((p-start)/(1-start),0,1),grow=ease(t);
  const base=Math.min(w,h),r=lerp(base*.035,base*(shortMode?1.08:1.24),Math.pow(grow,1.18));
  const x=lerp(w*.58,w*.50,smooth(t)),y=lerp(h*.56,h*.53,smooth(t));
  ctx.save();
  ctx.translate(x,y);ctx.rotate(-.08+t*.19);

  ctx.globalCompositeOperation='screen';
  let at=ctx.createRadialGradient(-r*.14,-r*.16,r*.74,0,0,r*1.19);
  at.addColorStop(.66,'rgba(90,177,226,0)');at.addColorStop(.86,'rgba(103,190,235,.13)');at.addColorStop(.97,'rgba(192,235,255,.64)');at.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=at;ctx.beginPath();ctx.arc(0,0,r*1.2,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation='source-over';

  ctx.save();ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip();
  const imgSize=r*2.18,shift=Math.sin(t*2.1)*r*.20;
  ctx.drawImage(earth,-imgSize/2+shift,-imgSize/2,imgSize,imgSize);
  const shadeG=ctx.createRadialGradient(-r*.34,-r*.28,r*.18,r*.24,r*.14,r*1.25);
  shadeG.addColorStop(0,'rgba(255,255,255,.08)');shadeG.addColorStop(.48,'rgba(0,0,0,.02)');shadeG.addColorStop(.82,'rgba(0,10,22,.42)');shadeG.addColorStop(1,'rgba(0,4,12,.78)');
  ctx.fillStyle=shadeG;ctx.fillRect(-r,-r,r*2,r*2);
  ctx.restore();

  ctx.strokeStyle='rgba(183,230,255,.55)';ctx.lineWidth=Math.max(1,r*.008);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
  ctx.restore();

  if(t>.69){
    const q=smooth((t-.69)/.31);
    const g=ctx.createRadialGradient(w*.5,h*.54,0,w*.5,h*.54,Math.max(w,h)*.8);
    g.addColorStop(0,`rgba(174,222,235,${.03+.13*q})`);g.addColorStop(.48,`rgba(72,124,104,${.02+.08*q})`);g.addColorStop(1,'rgba(1,7,12,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  }
}
function drawVelocity(state,p){
  const {ctx,w,h}=state;if(p<.25||p>.69)return;
  const a=Math.sin(clamp((p-.25)/.44,0,1)*Math.PI);
  ctx.save();ctx.globalCompositeOperation='screen';ctx.strokeStyle=`rgba(225,240,255,${.10*a})`;ctx.lineWidth=1;
  const cx=w*.5,cy=h*.5;
  for(let i=0;i<34;i++){
    const ang=(i/34)*Math.PI*2+(i%3)*.07,rad=Math.min(w,h)*(.12+(i%7)*.034),len=20+80*a;
    ctx.beginPath();ctx.moveTo(cx+Math.cos(ang)*rad,cy+Math.sin(ang)*rad);ctx.lineTo(cx+Math.cos(ang)*(rad+len),cy+Math.sin(ang)*(rad+len));ctx.stroke();
  }
  ctx.restore();
}
function drawFrame(state,p,shortMode){
  const {ctx,w,h}=state;
  ctx.clearRect(0,0,w,h);
  const bg=ctx.createRadialGradient(w*.5,h*.48,0,w*.5,h*.5,Math.max(w,h)*.72);
  bg.addColorStop(0,shortMode?'#07131c':'#050811');bg.addColorStop(.56,'#02060d');bg.addColorStop(1,'#000207');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  drawStarfield(state,p,shortMode);drawVelocity(state,p);if(!shortMode)drawSun(state,p);drawEarth(state,p,shortMode);
}

function stageText(p,shortMode){
  if(shortMode){
    if(p<.34)return ['EARTH ORBIT','038,000 KM'];
    if(p<.72)return ['ATMOSPHERIC ENTRY','012,400 KM'];
    return ['REAL CITY LINK','000.0 KM'];
  }
  if(p<.19)return ['MILKY WAY // LOCAL ARM','26,000 LY'];
  if(p<.35)return ['SOLAR VECTOR','4.8 AU'];
  if(p<.56)return ['SOLAR TRANSIT','1.0 AU'];
  if(p<.76)return ['EARTH APPROACH','148,000 KM'];
  return ['ATMOSPHERIC ENTRY','012,400 KM'];
}

async function finish(runId,skipped=false){
  if(runId!==activeRun)return;
  const root=$('#rcSpaceIntro'),screen=$('#realCityScreen');if(!root)return;
  cancelAnimationFrame(raf);
  root.classList.add('rcSpaceExit');
  root.querySelector('.rcSpaceFlash')?.classList.add('show');
  screen?.classList.add('rc-map-arriving');
  await new Promise(r=>setTimeout(r,skipped?240:430));
  screen?.classList.add('rc-map-arrived');
  screen?.classList.remove('rc-intro-running');
  await new Promise(r=>setTimeout(r,420));
  root.classList.remove('active','rcSpaceExit');
  root.setAttribute('aria-hidden','true');
  screen?.classList.remove('rc-map-arriving');
}

async function play({ready,mode='full'}={}){
  inject();
  const root=$('#rcSpaceIntro'),screen=$('#realCityScreen'),canvas=$('#rcSpaceCanvas'),ctx=canvas.getContext('2d',{alpha:false});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced){
    try{await ready}catch{}
    screen?.classList.add('rc-map-arrived');
    return;
  }
  const runId=++activeRun,shortMode=mode==='short';
  const duration=shortMode?2600:7900;
  const state={canvas,ctx,stars:makeStars(shortMode?250:520),dust:makeDust(shortMode?0:400),earth:earthTexture(512),w:0,h:0,dpr:1};
  resize(state);
  if(!resizeBound){window.addEventListener('resize',()=>{if(root.classList.contains('active'))resize(state)},{passive:true});resizeBound=true}
  root.classList.remove('rcSpaceExit');root.classList.add('active');root.setAttribute('aria-hidden','false');
  screen?.classList.add('rc-intro-running');screen?.classList.remove('rc-map-arrived');
  $('#rcSpaceSkip').classList.remove('show');
  setTimeout(()=>{if(runId===activeRun)$('#rcSpaceSkip')?.classList.add('show')},shortMode?650:1450);

  const start=performance.now();
  await new Promise(resolve=>{
    function tick(now){
      if(runId!==activeRun){resolve();return}
      const p=clamp((now-start)/duration,0,1);
      drawFrame(state,p,shortMode);
      const [stage,tele]=stageText(p,shortMode);
      const s=$('#rcSpaceStage'),t=$('#rcSpaceTelemetry');if(s)s.textContent=stage;if(t)t.textContent=tele;
      if(p>=1){resolve();return}
      raf=requestAnimationFrame(tick);
    }
    raf=requestAnimationFrame(tick);
  });

  if(runId!==activeRun)return;
  try{await Promise.race([Promise.resolve(ready),new Promise(r=>setTimeout(r,3600))])}catch{}
  await finish(runId,false);
}
function stop(){
  activeRun++;cancelAnimationFrame(raf);
  const root=$('#rcSpaceIntro'),screen=$('#realCityScreen');
  root?.classList.remove('active','rcSpaceExit');root?.setAttribute('aria-hidden','true');
  screen?.classList.remove('rc-intro-running','rc-map-arriving');screen?.classList.add('rc-map-arrived');
}
function preferredMode(){
  try{
    const key='rc_space_intro_v'+VERSION,now=Date.now(),last=Number(localStorage.getItem(key)||0);
    localStorage.setItem(key,String(now));
    return !last||now-last>6*60*60*1000?'full':'short';
  }catch{return 'full'}
}

window.RealCitySpaceIntro={play,stop,preferredMode};
})();