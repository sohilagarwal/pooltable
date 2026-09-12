(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  let points=[];
  let active=false;
  let lastTouchAt=0;
  let lastInput={t:0,x:-9999,y:-9999};
  const names=['top-left','top-right','bottom-right','bottom-left'];

  function videoContentRect(video, stage){
    const sr=stage.getBoundingClientRect();
    const vw=video.videoWidth||16, vh=video.videoHeight||9;
    const sa=sr.width/sr.height, va=vw/vh;
    let width,height,left,top;
    if(va>sa){width=sr.width;height=width/va;left=0;top=(sr.height-height)/2;}
    else{height=sr.height;width=height*va;top=0;left=(sr.width-width)/2;}
    return {stageRect:sr,width,height,left,top};
  }

  function clientPoint(evt){
    if(evt.touches&&evt.touches.length)return {x:evt.touches[0].clientX,y:evt.touches[0].clientY};
    if(evt.changedTouches&&evt.changedTouches.length)return {x:evt.changedTouches[0].clientX,y:evt.changedTouches[0].clientY};
    return {x:evt.clientX,y:evt.clientY};
  }

  function draw(){
    const canvas=$('overlay'),video=$('video'),stage=$('videoStage');
    if(!canvas||!video||!stage)return;
    const sr=stage.getBoundingClientRect(),d=root.devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(sr.width*d));canvas.height=Math.max(1,Math.round(sr.height*d));
    canvas.style.width=sr.width+'px';canvas.style.height=sr.height+'px';
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!points.length)return;
    const vr=videoContentRect(video,stage);
    const map=p=>({x:(vr.left+p.x*vr.width)*d,y:(vr.top+p.y*vr.height)*d});
    ctx.strokeStyle='#50e58a';ctx.fillStyle='#50e58a';ctx.lineWidth=3*d;
    ctx.beginPath();points.forEach((p,i)=>{const q=map(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});if(points.length===4)ctx.closePath();ctx.stroke();
    ctx.font=`${14*d}px -apple-system,sans-serif`;ctx.textBaseline='middle';
    points.forEach((p,i)=>{const q=map(p);ctx.beginPath();ctx.arc(q.x,q.y,9*d,0,Math.PI*2);ctx.fill();ctx.fillStyle='#07110c';ctx.fillText(String(i+1),q.x-4*d,q.y);ctx.fillStyle='#50e58a';});
  }

  function updateInstruction(){
    const el=$('calInstruction');if(el)el.textContent=points.length<4?'Tap '+names[points.length]+' cloth corner':'Calibration complete';
    const status=$('calTapStatus');if(status)status.textContent=`${points.length}/4 corners captured`;
  }

  function handle(evt){
    if(!active)return;
    // Deduplicate Safari's touch/pointer/click event cascade.
    const now=Date.now();
    if(evt.type==='touchstart')lastTouchAt=now;
    if(evt.cancelable)evt.preventDefault();
    if(evt.stopPropagation)evt.stopPropagation();
    const video=$('video'),stage=$('videoStage');if(!video||!stage)return;
    const pt=clientPoint(evt);
    if(now-lastInput.t<550 && Math.hypot(pt.x-lastInput.x,pt.y-lastInput.y)<18)return;
    lastInput={t:now,x:pt.x,y:pt.y};
    const vr=videoContentRect(video,stage),sx=pt.x-vr.stageRect.left,sy=pt.y-vr.stageRect.top;
    const status=$('calTapStatus');
    if(sx<vr.left||sx>vr.left+vr.width||sy<vr.top||sy>vr.top+vr.height){if(status)status.textContent='Tap inside the live camera image';return;}
    points.push({x:(sx-vr.left)/vr.width,y:(sy-vr.top)/vr.height});
    draw();updateInstruction();
    root.dispatchEvent(new CustomEvent('poolcam-calibration-point',{detail:{index:points.length,point:points[points.length-1],points:points.slice()}}));
    if(points.length===4){
      active=false;document.body.classList.remove('calibrating');
      const guide=$('calGuide');if(guide)guide.classList.add('hidden');
      localStorage.setItem('poolcam-v45-cal',JSON.stringify(points));
      root.dispatchEvent(new CustomEvent('poolcam-calibration-complete',{detail:{points:points.slice()}}));
    }
  }

  function start(existing){
    points=[];active=true;document.body.classList.add('calibrating');
    const guide=$('calGuide');if(guide)guide.classList.remove('hidden');
    updateInstruction();draw();
  }
  function cancel(){active=false;document.body.classList.remove('calibrating');const guide=$('calGuide');if(guide)guide.classList.add('hidden');const saved=load();points=saved;draw();root.dispatchEvent(new Event('poolcam-calibration-cancelled'));}
  function load(){try{const a=JSON.parse(localStorage.getItem('poolcam-v45-cal')||'[]');return Array.isArray(a)&&a.length===4?a:[]}catch{return[]}}
  function set(p){points=Array.isArray(p)?p.slice(0,4):[];draw();}
  function get(){return points.slice();}
  function isActive(){return active;}

  function init(){
    const canvas=$('overlay');if(!canvas)return;
    // use all three event families for old/new Safari. Touch is primary on iPad.
    canvas.addEventListener('touchstart',handle,{passive:false});
    canvas.addEventListener('pointerdown',handle,{passive:false});
    canvas.addEventListener('click',handle,false);
    root.addEventListener('resize',draw);
    const saved=load();if(saved.length===4){points=saved;setTimeout(draw,50)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  root.PoolCamCalibration={start,cancel,load,set,get,draw,isActive,videoContentRect};
})(window);
