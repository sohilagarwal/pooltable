const $=id=>document.getElementById(id);

let stream=null, worker=null, recorder=null, recorderTimer=null;
let match=false, startPerf=0, frozenDuration=0, sessionStartedAt=null, timer=null, frameTimer=null;
let sessionId=null, chunkIndex=0, chunkStart=0, events=[], calibration=[], calibrating=false, currentPlayer=1;
let stats=blankStats(), runs={1:0,2:0}, wins={1:0,2:0};
let lastAutoShot=-99, lastPocketActivity=0, lastMotion=0;
let recordingUrls=[];

function blankStats(){return {1:{pots:0,misses:0,scratches:0,safeties:0,shots:0},2:{pots:0,misses:0,scratches:0,safeties:0,shots:0}}}
const other=p=>p===1?2:1;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const elapsed=()=>match?(performance.now()-startPerf)/1000:frozenDuration;
const fmt=s=>{s=Math.max(0,Math.floor(Number(s)||0));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
const playerName=n=>n===1?($('p1').value.trim()||'Player 1'):($('p2').value.trim()||'Player 2');

const dbp=new Promise((resolve,reject)=>{
  const r=indexedDB.open('poolcam-v3',1);
  r.onupgradeneeded=()=>{
    const d=r.result;
    if(!d.objectStoreNames.contains('videos')) d.createObjectStore('videos',{keyPath:'id'});
    if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions',{keyPath:'id'});
  };
  r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
});
async function dbPut(store,value){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
async function dbAll(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,'readonly');const r=t.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbClear(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).clear();t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}

function syncNames(){
  $('p1NameTop').textContent=playerName(1); $('p2NameTop').textContent=playerName(2); $('gameTypeTop').textContent=$('gameType').value;
  $('p1RackBtn').textContent=`+ Rack for ${playerName(1)}`; $('p2RackBtn').textContent=`+ Rack for ${playerName(2)}`;
  updateTurnUI();
}
$('p1').oninput=$('p2').oninput=$('gameType').onchange=syncNames;

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab,.tabpage').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); $(b.dataset.tab+'Tab').classList.add('active'); renderAll();
});
$('settingsBtn').onclick=()=>$('settingsSheet').classList.remove('hidden');
$('closeSettingsBtn').onclick=()=>{$('settingsSheet').classList.add('hidden');configureWorker()};

async function getCamera(){
  const video={facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}};
  try{return await navigator.mediaDevices.getUserMedia({video,audio:true})}
  catch(first){
    try{return await navigator.mediaDevices.getUserMedia({video,audio:false})}
    catch(second){throw first}
  }
}
async function startCamera(){
  try{
    stream=await getCamera();
    const v=$('preview'); v.srcObject=stream;
    await new Promise(resolve=>{if(v.readyState>=1)resolve();else v.addEventListener('loadedmetadata',resolve,{once:true})});
    try{await v.play()}catch{}
    $('cameraPlaceholder').classList.add('hidden'); $('startCameraBtn').disabled=true; $('calibrateBtn').disabled=false;
    setupWorker(); resizeOverlay();
    if(calibration.length===4){$('startMatchBtn').disabled=false;$('engTable').textContent='Calibrated';$('calibrateBtn').textContent='Recalibrate Table'}
    $('engineState').textContent='Camera'; $('engineState').className='status live'; updateStorage(); drawOverlay();
  }catch(e){alert('Camera access failed. Check Safari camera permission. '+(e?.message||''))}
}
$('startCameraBtn').onclick=startCamera;
window.addEventListener('resize',resizeOverlay);

function videoContentRect(){
  const wrap=$('videoWrap'),v=$('preview'),w=wrap.clientWidth,h=wrap.clientHeight;
  const vw=v.videoWidth||w,vh=v.videoHeight||h,videoAR=vw/vh,boxAR=w/h;
  if(videoAR>boxAR){const rh=w/videoAR;return {x:0,y:(h-rh)/2,w,h:rh}}
  const rw=h*videoAR;return {x:(w-rw)/2,y:0,w:rw,h};
}
function resizeOverlay(){
  const wrap=$('videoWrap'),c=$('overlay'),d=window.devicePixelRatio||1;
  c.width=Math.max(1,Math.floor(wrap.clientWidth*d)); c.height=Math.max(1,Math.floor(wrap.clientHeight*d));
  c.style.width=wrap.clientWidth+'px';c.style.height=wrap.clientHeight+'px';drawOverlay();
}
function normToOverlay(p){
  const d=window.devicePixelRatio||1,r=videoContentRect();return {x:(r.x+p.x*r.w)*d,y:(r.y+p.y*r.h)*d};
}
function pointerToVideoNorm(e){
  const box=$('overlay').getBoundingClientRect(),r=videoContentRect();
  const lx=e.clientX-box.left,ly=e.clientY-box.top;
  if(lx<r.x||lx>r.x+r.w||ly<r.y||ly>r.y+r.h)return null;
  return {x:(lx-r.x)/r.w,y:(ly-r.y)/r.h};
}
function drawOverlay(){
  const c=$('overlay'),ctx=c.getContext('2d'),d=window.devicePixelRatio||1;ctx.clearRect(0,0,c.width,c.height);
  if(!calibration.length)return;
  ctx.lineWidth=3*d;ctx.strokeStyle='#4ce38a';ctx.fillStyle='#4ce38a';ctx.beginPath();
  calibration.forEach((p,i)=>{const q=normToOverlay(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});if(calibration.length===4)ctx.closePath();ctx.stroke();
  calibration.forEach((p,i)=>{const q=normToOverlay(p);ctx.beginPath();ctx.arc(q.x,q.y,7*d,0,Math.PI*2);ctx.fill();ctx.font=`${13*d}px sans-serif`;ctx.fillText(String(i+1),q.x+10*d,q.y-8*d)});
}
function startCalibration(){
  if(!stream)return;
  calibrating=true;calibration=[];document.body.classList.add('calibrating');$('overlay').style.pointerEvents='auto';
  $('calibrationHint').classList.remove('hidden');$('calibrationHint').textContent='Tap corner 1 of 4 — top-left';
  $('calibrateBtn').textContent='Cancel Calibration';drawOverlay();configureWorker();
}
$('calibrateBtn').onclick=()=>calibrating?endCalibration(false):startCalibration();
$('overlay').addEventListener('pointerdown',e=>{
  if(!calibrating)return;e.preventDefault();e.stopPropagation();const p=pointerToVideoNorm(e);
  if(!p){$('calibrationHint').textContent='Tap inside the actual camera picture';return}
  calibration.push(p);drawOverlay();
  const names=['top-left','top-right','bottom-right','bottom-left'];
  if(calibration.length<4)$('calibrationHint').textContent=`Tap corner ${calibration.length+1} of 4 — ${names[calibration.length]}`;
  else{localStorage.setItem('poolcam-cal-v3',JSON.stringify(calibration));endCalibration(true)}
},{passive:false});
function endCalibration(ok){
  calibrating=false;document.body.classList.remove('calibrating');$('overlay').style.pointerEvents='none';$('calibrationHint').classList.add('hidden');
  if(ok&&calibration.length===4){$('startMatchBtn').disabled=false;$('engTable').textContent='Calibrated';$('calibrateBtn').textContent='Recalibrate Table';drawOverlay();configureWorker();return}
  const saved=localStorage.getItem('poolcam-cal-v3');calibration=saved?JSON.parse(saved):[];$('calibrateBtn').textContent=calibration.length===4?'Recalibrate Table':'Calibrate Table';drawOverlay();configureWorker();
}

function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function pocketZonesFromTable(table){
  const [a,b,c,d]=table,mid=(p,q)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2});
  const horizontal=(dist(a,b)+dist(d,c))/2,vertical=(dist(a,d)+dist(b,c))/2;
  const mids=horizontal>=vertical?[mid(a,b),mid(d,c)]:[mid(a,d),mid(b,c)];
  return [a,b,c,d,...mids].map(p=>({...p,r:.055}));
}
function setupWorker(){
  if(worker)worker.terminate();worker=new Worker('./worker.js');
  worker.onmessage=e=>{
    const m=e.data;if(m.type!=='metrics')return;
    lastMotion=m.ratio;lastPocketActivity=m.pocketRatio;$('engMotion').textContent=`${(m.ratio*100).toFixed(1)}%`;$('engPocket').textContent=`${((m.pocketPeak||m.pocketRatio)*100).toFixed(2)}%`;
    if(match&&m.shot&&m.t-lastAutoShot>2.2){lastAutoShot=m.t;addAutoShot(m)}
  };
  configureWorker();
}
function configureWorker(){if(!worker)return;worker.postMessage({type:'config',sensitivity:+$('sensitivity').value,table:calibration.length===4?calibration:null,pockets:calibration.length===4?pocketZonesFromTable(calibration):[]})}
$('sensitivity').oninput=configureWorker;
function startProcessing(){
  const v=$('preview'),c=$('analysisCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});clearInterval(frameTimer);worker?.postMessage({type:'reset'});
  frameTimer=setInterval(()=>{
    if(!match||v.readyState<2||!worker)return;
    ctx.drawImage(v,0,0,c.width,c.height);const dat=ctx.getImageData(0,0,c.width,c.height).data,g=new Uint8Array(c.width*c.height);
    for(let i=0,j=0;i<dat.length;i+=4,j++)g[j]=(dat[i]*3+dat[i+1]*6+dat[i+2])/10;
    worker.postMessage({type:'frame',gray:g,w:c.width,h:c.height,t:elapsed()},[g.buffer]);
  },300);
}

function bestMime(){for(const t of ['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=h264,opus','video/webm'])if(window.MediaRecorder&&MediaRecorder.isTypeSupported(t))return t;return ''}
function createRecorder(){
  const m=bestMime(),bps=+$('quality').value;try{return m?new MediaRecorder(stream,{mimeType:m,videoBitsPerSecond:bps}):new MediaRecorder(stream)}catch{return new MediaRecorder(stream)}
}
function startRecordingChunk(){
  clearTimeout(recorderTimer);if(!match||!stream)return;
  if(!window.MediaRecorder){$('engVideo').textContent='Not supported';return}
  const pieces=[],start=elapsed();chunkStart=start;
  try{recorder=createRecorder()}catch(e){$('engVideo').textContent='Recorder failed';return}
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)pieces.push(e.data)};
  recorder.onerror=()=>{$('engVideo').textContent='Recorder error'};
  recorder.onstop=async()=>{
    clearTimeout(recorderTimer);if(pieces.length){
      const end=elapsed(),type=pieces[0]?.type||bestMime()||'video/mp4',blob=new Blob(pieces,{type});
      try{await dbPut('videos',{id:`${sessionId}-${chunkIndex}`,sessionId,index:chunkIndex,start,end,blob,type,createdAt:new Date().toISOString()});chunkIndex++;$('engVideo').textContent=`${chunkIndex} chunks`;await updateStorage();await renderRecordings()}
      catch(e){$('engVideo').textContent='Storage full/error'}
    }
    if(match)startRecordingChunk();
  };
  recorder.start();
  recorderTimer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop()},90000);
}
function stopRecording(){clearTimeout(recorderTimer);if(recorder&&recorder.state!=='inactive')recorder.stop()}

function resetMatchState(){
  events=[];chunkIndex=0;currentPlayer=1;runs={1:0,2:0};wins={1:0,2:0};stats=blankStats();frozenDuration=0;lastAutoShot=-99;lastMotion=0;lastPocketActivity=0;renderAll();
}
$('startMatchBtn').onclick=async()=>{
  if(!stream||calibration.length!==4)return;
  resetMatchState();match=true;sessionId='pool-'+Date.now();sessionStartedAt=new Date().toISOString();startPerf=performance.now();renderAll();
  $('startMatchBtn').disabled=true;$('endMatchBtn').disabled=false;$('engineState').textContent='LIVE';$('engineState').className='status live';$('turnStatus').textContent='Live';
  startRecordingChunk();startProcessing();clearInterval(timer);timer=setInterval(()=>{$('clock').textContent=fmt(elapsed())},500);await saveSession(false);
};
$('endMatchBtn').onclick=async()=>{
  if(!match)return;frozenDuration=(performance.now()-startPerf)/1000;match=false;clearInterval(timer);clearInterval(frameTimer);stopRecording();
  $('clock').textContent=fmt(frozenDuration);$('endMatchBtn').disabled=true;$('startMatchBtn').disabled=false;$('engineState').textContent='Saved';$('turnStatus').textContent='Finished';
  await saveSession(true);renderAll();
};

function addAutoShot(m){
  events.push({id:'shot-'+Date.now()+'-'+Math.random(),kind:'shot',result:null,t:elapsed(),player:currentPlayer,source:'auto',confidence:Math.min(.99,.45+(m.peak||0)*7),pocketPeak:m.pocketPeak||0});
  rebuildState();renderAll();saveSession(false);
}
function findPendingShot(){
  for(let i=events.length-1;i>=0;i--){const e=events[i];if(e.kind==='shot'&&e.result==null&&elapsed()-e.t<=20)return e}
  return null;
}
function recordOutcome(result){
  if(!match)return;let e=findPendingShot();
  if(e){e.result=result;e.resolvedAt=elapsed();}
  else events.push({id:'shot-'+Date.now()+'-'+Math.random(),kind:'shot',result,t:elapsed(),player:currentPlayer,source:'manual',confidence:null,pocketPeak:0});
  rebuildState();renderAll();saveSession(false);
}
document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>recordOutcome(b.dataset.result));
$('highlightBtn').onclick=()=>{if(!match)return;const shot=[...events].reverse().find(e=>e.kind==='shot'&&elapsed()-e.t<25);events.push({id:'hl-'+Date.now(),kind:'highlight',t:elapsed(),player:currentPlayer,shotId:shot?.id||null,note:'Great moment'});renderAll();saveSession(false)};
$('switchTurnBtn').onclick=()=>{if(!match)return;events.push({id:'turn-'+Date.now(),kind:'turn',t:elapsed(),from:currentPlayer,to:other(currentPlayer)});rebuildState();renderAll();saveSession(false)};
$('p1RackBtn').onclick=()=>recordRack(1);$('p2RackBtn').onclick=()=>recordRack(2);
function recordRack(winner){if(!match)return;events.push({id:'rack-'+Date.now(),kind:'rack',t:elapsed(),winner});rebuildState();renderAll();saveSession(false)}
$('undoBtn').onclick=()=>{if(!events.length)return;events.pop();rebuildState();renderAll();saveSession(false)};

function rebuildState(){
  stats=blankStats();runs={1:0,2:0};wins={1:0,2:0};currentPlayer=1;
  for(const e of events){
    if(e.kind==='turn'){currentPlayer=e.to;continue}
    if(e.kind==='rack'){wins[e.winner]++;continue}
    if(e.kind!=='shot')continue;
    const p=e.player;stats[p].shots++;
    if(e.result==='pot'){stats[p].pots++;runs[p]++;currentPlayer=p}
    else if(e.result==='miss'){stats[p].misses++;runs[p]=0;currentPlayer=other(p)}
    else if(e.result==='scratch'){stats[p].scratches++;runs[p]=0;currentPlayer=other(p)}
    else if(e.result==='safety'){stats[p].safeties++;runs[p]=0;currentPlayer=other(p)}
  }
  updateTurnUI();
}
function updateTurnUI(){
  $('switchTurnBtn').textContent=playerName(currentPlayer);$('p1ScoreBox').classList.toggle('active',currentPlayer===1);$('p2ScoreBox').classList.toggle('active',currentPlayer===2);
  $('turnRun').textContent=runs[currentPlayer];$('turnPots').textContent=stats[currentPlayer].pots;$('turnMisses').textContent=stats[currentPlayer].misses;$('p1Wins').textContent=wins[1];$('p2Wins').textContent=wins[2];
}
function classifiedAttempts(p){const s=stats[p];return s.pots+s.misses+s.scratches}
function potRate(p){const n=classifiedAttempts(p);return n?Math.round(stats[p].pots/n*100):0}
function eventLabel(e){if(e.kind==='shot')return e.result?e.result.toUpperCase():'SHOT DETECTED';if(e.kind==='highlight')return 'HIGHLIGHT';if(e.kind==='rack')return `RACK → ${playerName(e.winner)}`;if(e.kind==='turn')return `TURN → ${playerName(e.to)}`;return e.kind.toUpperCase()}
function eventPlayer(e){if(e.kind==='rack')return playerName(e.winner);if(e.kind==='turn')return playerName(e.to);return playerName(e.player||1)}
function renderTimeline(){
  const x=$('timeline');if(!events.length){x.className='timeline emptyState';x.textContent='No shots yet.';return}x.className='timeline';
  x.innerHTML=events.slice().reverse().slice(0,40).map(e=>`<div class="event"><span class="time">${fmt(e.t)}</span><div><div class="etype">${esc(eventLabel(e))}</div><small>${esc(eventPlayer(e))}${e.kind==='shot'&&e.source==='auto'&&!e.result?' · tap a result to classify':''}</small></div><span>${e.kind==='highlight'?'★':e.result==='pot'?'✓':e.result==='scratch'?'↺':'•'}</span></div>`).join('');
}
function renderMetrics(){
  const shots=events.filter(e=>e.kind==='shot').length,classified=events.filter(e=>e.kind==='shot'&&e.result).length,high=events.filter(e=>e.kind==='highlight').length;
  $('shotBadge').textContent=`${shots} shots`;$('metrics').innerHTML=[['Shots',shots],['Classified',classified],['P1 pot %',potRate(1)+'%'],['P2 pot %',potRate(2)+'%'],['Scratches',stats[1].scratches+stats[2].scratches],['Highlights',high]].map(([a,b])=>`<div class="metric"><b>${b}</b><span>${a}</span></div>`).join('');
}
function renderInsights(){
  const arr=[];for(const p of [1,2]){const s=stats[p];if(classifiedAttempts(p)>=3){arr.push(`<div class="insight"><b>${esc(playerName(p))}: ${potRate(p)}% tagged pot rate</b><span>${s.pots} pots · ${s.misses} misses · ${s.scratches} scratches</span></div>`);if(s.scratches>=2)arr.push(`<div class="insight"><b>${esc(playerName(p))} has multiple scratches</b><span>Worth reviewing cue-ball speed and position.</span></div>`)}}
  const race=+$('raceTo').value;if(wins[1]>=race||wins[2]>=race){const p=wins[1]>=race?1:2;arr.push(`<div class="insight"><b>${esc(playerName(p))} reached the race-to-${race} target</b><span>Match score ${wins[1]}–${wins[2]}.</span></div>`)}
  if(lastPocketActivity>.001)arr.push(`<div class="insight"><b>Recent pocket-zone movement</b><span>The lightweight vision engine saw movement near a calibrated pocket. This is a clue, not yet proof of a pot.</span></div>`);
  $('insights').className=arr.length?'insights':'insights emptyState';$('insights').innerHTML=arr.join('')||'Play and classify a few shots to generate analysis.';
}
function renderMoments(){
  const highlights=events.filter(e=>e.kind==='highlight');const auto=events.filter(e=>e.kind==='shot'&&(e.confidence||0)>.8&&(e.pocketPeak||0)>.0005);
  const merged=[...highlights,...auto].sort((a,b)=>b.t-a.t),x=$('moments');if(!merged.length){x.className='moments emptyState';x.textContent='Highlights will appear here.';return}x.className='moments';
  x.innerHTML=merged.map(e=>`<div class="moment"><span>${fmt(e.t)}</span><div><b>${esc(playerName(e.player||1))}</b><small> ${e.kind==='highlight'?'Manual highlight':'Auto candidate: strong motion + pocket activity'}</small></div><span>★</span></div>`).join('');
}
async function renderRecordings(){
  recordingUrls.forEach(URL.revokeObjectURL);recordingUrls=[];const all=(await dbAll('videos')).filter(v=>!sessionId||v.sessionId===sessionId).sort((a,b)=>b.index-a.index),x=$('recordings');
  if(!all.length){x.className='recordings emptyState';x.textContent='No saved chunks yet.';return}x.className='recordings';x.innerHTML='';
  for(const v of all){const u=URL.createObjectURL(v.blob);recordingUrls.push(u);const ext=(v.type||'').includes('webm')?'webm':'mp4',d=document.createElement('div');d.className='rec';d.innerHTML=`<span>${fmt(v.start)}</span><div><b>Video ${v.index+1}</b><small> ${(v.blob.size/1048576).toFixed(1)} MB · ${fmt((v.end||0)-(v.start||0))}</small></div><a class="download" href="${u}" download="${v.id}.${ext}">Save</a>`;x.appendChild(d)}
}
async function renderHistory(){
  const all=(await dbAll('sessions')).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,10),x=$('history');
  if(!all.length){x.className='history emptyState';x.textContent='No sessions yet.';return}x.className='history';x.innerHTML=all.map(s=>`<div class="hist"><span>🎱</span><div><b>${esc(s.p1)} vs ${esc(s.p2)}</b><small> ${esc(s.gameType)} · ${fmt(s.duration||0)} · ${s.events?.filter?.(e=>e.kind==='shot').length||0} shots</small></div><span>${new Date(s.startedAt).toLocaleDateString()}</span></div>`).join('');
}
function renderAll(){syncNames();renderTimeline();renderMetrics();renderInsights();renderMoments();if($('momentsTab').classList.contains('active'))renderRecordings();if($('historyTab').classList.contains('active'))renderHistory()}
async function saveSession(ended){
  if(!sessionId)return;await dbPut('sessions',{id:sessionId,p1:playerName(1),p2:playerName(2),gameType:$('gameType').value,raceTo:+$('raceTo').value,startedAt:sessionStartedAt,endedAt:ended?new Date().toISOString():null,duration:elapsed(),events:(typeof structuredClone==='function'?structuredClone(events):JSON.parse(JSON.stringify(events))),stats:JSON.parse(JSON.stringify(stats)),wins:{...wins},calibration:calibration.map(p=>({...p}))});
}
async function updateStorage(){if(navigator.storage?.estimate){const e=await navigator.storage.estimate();$('storageBadge').textContent=`Storage ${(e.usage/1048576).toFixed(0)} MB / ${(e.quota/1073741824).toFixed(1)} GB`}}
$('exportBtn').onclick=async()=>{const all=await dbAll('sessions'),s=all.find(x=>x.id===sessionId)||all[all.length-1];if(!s)return alert('No session to export');const b=new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${s.id}.json`;a.click()};
$('emailBtn').onclick=()=>{const body=`PoolCam report\n${playerName(1)} vs ${playerName(2)} — ${$('gameType').value}\nScore: ${wins[1]}–${wins[2]}\nDuration: ${fmt(elapsed())}\n\n${playerName(1)}: ${stats[1].pots} pots, ${stats[1].misses} misses, ${stats[1].scratches} scratches, ${potRate(1)}% tagged pot rate\n${playerName(2)}: ${stats[2].pots} pots, ${stats[2].misses} misses, ${stats[2].scratches} scratches, ${potRate(2)}% tagged pot rate\n\nHighlights: ${events.filter(e=>e.kind==='highlight').length}`;location.href=`mailto:${encodeURIComponent($('reportEmail').value)}?subject=${encodeURIComponent('🎱 PoolCam Report')}&body=${encodeURIComponent(body)}`};
$('clearBtn').onclick=async()=>{if(!confirm('Delete all locally saved PoolCam sessions and videos?'))return;await dbClear('videos');await dbClear('sessions');sessionId=null;events=[];resetMatchState();updateStorage()};

try{const saved=localStorage.getItem('poolcam-cal-v3');if(saved){calibration=JSON.parse(saved);if(!Array.isArray(calibration)||calibration.length!==4)calibration=[]}}catch{calibration=[]}
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
navigator.storage?.persist?.().catch(()=>{});
syncNames();renderAll();updateStorage();
