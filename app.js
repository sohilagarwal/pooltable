const $=id=>document.getElementById(id);
let stream=null,recorder=null,worker=null,match=false,startPerf=0,timer=null,frameTimer=null;
let sessionId=null,chunk=0,events=[],calibration=[],calibrating=false,currentPlayer=1;
let runs={1:0,2:0},wins={1:0,2:0},stats={1:{pots:0,misses:0,scratches:0,safeties:0,shots:0},2:{pots:0,misses:0,scratches:0,safeties:0,shots:0}};
let lastAutoShot=-99,lastPocketActivity=0,lastMotion=0,manualHighlightFor=null;

const dbp=new Promise((resolve,reject)=>{const r=indexedDB.open("poolcam-v2",1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("videos"))d.createObjectStore("videos",{keyPath:"id"});if(!d.objectStoreNames.contains("sessions"))d.createObjectStore("sessions",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function dbPut(store,v){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,"readwrite");t.objectStore(store).put(v);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function dbAll(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store);const r=t.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbClear(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,"readwrite");t.objectStore(store).clear();t.oncomplete=res;t.onerror=()=>rej(t.error)})}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nowSec=()=>match?(performance.now()-startPerf)/1000:0;
const fmt=s=>{s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
function playerName(n){return n===1?($("p1").value.trim()||"Player 1"):($("p2").value.trim()||"Player 2")}
function syncNames(){$("p1NameTop").textContent=playerName(1);$("p2NameTop").textContent=playerName(2);$("gameTypeTop").textContent=$("gameType").value;updateTurnUI()}
$("p1").oninput=$("p2").oninput=$("gameType").onchange=syncNames;syncNames();

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab,.tabpage").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab+"Tab").classList.add("active");renderAll()});
$("settingsBtn").onclick=()=>$("settingsSheet").classList.remove("hidden");
$("closeSettingsBtn").onclick=()=>{$("settingsSheet").classList.add("hidden");configureWorker()};
$("cancelCalBtn").onclick=()=>endCalibration(false);
$("resetCalBtn").onclick=()=>{calibration=[];drawOverlay();$("calStep").innerHTML="<b>Tap corner 1 of 4</b>"};

async function startCamera(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:true});
    $("preview").srcObject=stream;$("cameraPlaceholder").classList.add("hidden");$("startCameraBtn").disabled=true;$("calibrateBtn").disabled=false;
    $("engineState").textContent="Camera";$("engineState").className="status live";setupWorker();setTimeout(()=>resizeOverlay(),400);updateStorage();
  }catch(e){alert("Camera failed: "+e.message)}
}
$("startCameraBtn").onclick=startCamera;
window.onresize=resizeOverlay;
function resizeOverlay(){const r=$("videoWrap").getBoundingClientRect(),c=$("overlay");c.width=Math.floor(r.width*devicePixelRatio);c.height=Math.floor(r.height*devicePixelRatio);c.style.width=r.width+"px";c.style.height=r.height+"px";drawOverlay()}
function drawOverlay(){
  const c=$("overlay"),ctx=c.getContext("2d"),d=devicePixelRatio;ctx.clearRect(0,0,c.width,c.height);if(!calibration.length)return;
  ctx.lineWidth=3*d;ctx.strokeStyle="#4ce38a";ctx.fillStyle="#4ce38a";
  ctx.beginPath();calibration.forEach((p,i)=>{const x=p.x*c.width,y=p.y*c.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});if(calibration.length===4)ctx.closePath();ctx.stroke();
  calibration.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,7*d,0,Math.PI*2);ctx.fill();ctx.font=`${13*d}px sans-serif`;ctx.fillText(String(i+1),p.x*c.width+10*d,p.y*c.height-8*d)})
}
$("calibrateBtn").onclick=()=>{calibrating=true;calibration=[];$("calibrationSheet").classList.remove("hidden");$("overlay").style.pointerEvents="auto";drawOverlay()};
$("overlay").onclick=e=>{if(!calibrating)return;const r=$("overlay").getBoundingClientRect();calibration.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});drawOverlay();if(calibration.length<4)$("calStep").innerHTML=`<b>Tap corner ${calibration.length+1} of 4</b>`;else{localStorage.setItem("poolcam-cal",JSON.stringify(calibration));endCalibration(true)}};
function endCalibration(ok){calibrating=false;$("calibrationSheet").classList.add("hidden");$("overlay").style.pointerEvents="none";if(ok&&calibration.length===4){$("startMatchBtn").disabled=false;$("engTable").textContent="Calibrated";configureWorker()}else if(!ok){const saved=localStorage.getItem("poolcam-cal");calibration=saved?JSON.parse(saved):[];drawOverlay()}}

function setupWorker(){worker=new Worker("./worker.js");worker.onmessage=e=>{const m=e.data;if(m.type!=="metrics")return;lastMotion=m.ratio;lastPocketActivity=m.pocketRatio;$("engMotion").textContent=`${(m.ratio*100).toFixed(1)}%`;$("engPocket").textContent=`${(m.pocketRatio*100).toFixed(2)}%`;if(match&&m.shot&&m.t-lastAutoShot>2.2){lastAutoShot=m.t;addEvent("shot","Auto-detected",{confidence:Math.min(.99,.45+m.peak*7),pocketActivity:m.pocketRatio})}};configureWorker()}
function configureWorker(){if(!worker)return;const table=calibration.length===4?calibration:null;let pockets=[];if(table){const [a,b,c,d]=table;const mid=(p,q)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2});pockets=[a,b,c,d,mid(a,d),mid(b,c)].map(p=>({...p,r:.055}))}worker.postMessage({type:"config",sensitivity:+$("sensitivity").value,table,pockets})}
$("sensitivity").oninput=configureWorker;

function startProcessing(){const v=$("preview"),c=$("analysisCanvas"),ctx=c.getContext("2d",{willReadFrequently:true});clearInterval(frameTimer);frameTimer=setInterval(()=>{if(!match||v.readyState<2||!worker)return;ctx.drawImage(v,0,0,c.width,c.height);const dat=ctx.getImageData(0,0,c.width,c.height).data,g=new Uint8Array(c.width*c.height);for(let i=0,j=0;i<dat.length;i+=4,j++)g[j]=(dat[i]*3+dat[i+1]*6+dat[i+2])/10;worker.postMessage({type:"frame",gray:g,w:c.width,h:c.height,t:nowSec()},[g.buffer])},300)}

function mime(){for(const t of ["video/mp4;codecs=h264,aac","video/mp4","video/webm;codecs=h264,opus","video/webm"])if(window.MediaRecorder&&MediaRecorder.isTypeSupported(t))return t;return ""}
function startRecording(){const m=mime(),bps=+$("quality").value;try{recorder=m?new MediaRecorder(stream,{mimeType:m,videoBitsPerSecond:bps}):new MediaRecorder(stream)}catch(e){recorder=new MediaRecorder(stream)}let chunkStart=0;recorder.ondataavailable=async e=>{if(!e.data||!e.data.size)return;await dbPut("videos",{id:`${sessionId}-${chunk}`,sessionId,index:chunk,start:chunkStart,end:nowSec(),blob:e.data,type:e.data.type||m,createdAt:new Date().toISOString()});chunkStart=nowSec();chunk++;$("engVideo").textContent=`${chunk} chunks`;updateStorage();renderRecordings()};recorder.start(90000)}
function resetMatchState(){events=[];chunk=0;currentPlayer=1;runs={1:0,2:0};wins={1:0,2:0};stats={1:{pots:0,misses:0,scratches:0,safeties:0,shots:0},2:{pots:0,misses:0,scratches:0,safeties:0,shots:0}};renderAll()}
$("startMatchBtn").onclick=async()=>{if(!stream)return;resetMatchState();match=true;sessionId="pool-"+Date.now();startPerf=performance.now();$("startMatchBtn").disabled=true;$("endMatchBtn").disabled=false;$("engineState").textContent="LIVE";$("engineState").className="status live";$("turnStatus").textContent="Live";startRecording();startProcessing();timer=setInterval(()=>{$("clock").textContent=fmt(nowSec())},500);await saveSession(false)};
$("endMatchBtn").onclick=async()=>{match=false;clearInterval(timer);clearInterval(frameTimer);if(recorder&&recorder.state!=="inactive")recorder.stop();$("endMatchBtn").disabled=true;$("startMatchBtn").disabled=false;$("engineState").textContent="Saved";$("turnStatus").textContent="Finished";await saveSession(true);renderAll()};

function switchTurn(){currentPlayer=currentPlayer===1?2:1;updateTurnUI();saveSession(false)}
$("switchTurnBtn").onclick=switchTurn;
function updateTurnUI(){
  $("switchTurnBtn").textContent=playerName(currentPlayer);
  $("p1ScoreBox").classList.toggle("active",currentPlayer===1);$("p2ScoreBox").classList.toggle("active",currentPlayer===2);
  $("turnRun").textContent=runs[currentPlayer];$("turnPots").textContent=stats[currentPlayer].pots;$("turnMisses").textContent=stats[currentPlayer].misses;
  $("p1Wins").textContent=wins[1];$("p2Wins").textContent=wins[2];
}
function addEvent(type,note="",extra={}){
  if(!match&&type!=="highlight")return;
  const e={id:Date.now()+Math.random(),t:nowSec(),player:currentPlayer,type,note,...extra};
  events.push(e);
  if(type==="shot") stats[currentPlayer].shots++;
  if(type==="pot"){stats[currentPlayer].pots++;stats[currentPlayer].shots++;runs[currentPlayer]++}
  if(type==="miss"){stats[currentPlayer].misses++;stats[currentPlayer].shots++;runs[currentPlayer]=0;switchTurn()}
  if(type==="scratch"){stats[currentPlayer].scratches++;stats[currentPlayer].shots++;runs[currentPlayer]=0;switchTurn()}
  if(type==="safety"){stats[currentPlayer].safeties++;stats[currentPlayer].shots++;runs[currentPlayer]=0;switchTurn()}
  renderAll();saveSession(false)
}
document.querySelectorAll("[data-result]").forEach(b=>b.onclick=()=>addEvent(b.dataset.result,"Manual result"));
$("highlightBtn").onclick=()=>addEvent("highlight","Great moment",{score:10});
$("undoBtn").onclick=()=>{if(!events.length)return;const e=events.pop();rebuildStats();renderAll();saveSession(false)};
function rebuildStats(){currentPlayer=1;runs={1:0,2:0};stats={1:{pots:0,misses:0,scratches:0,safeties:0,shots:0},2:{pots:0,misses:0,scratches:0,safeties:0,shots:0}};for(const e of events){const p=e.player;if(e.type==="shot")stats[p].shots++;if(e.type==="pot"){stats[p].pots++;stats[p].shots++;runs[p]++}if(["miss","scratch","safety"].includes(e.type)){stats[p][e.type==="safety"?"safeties":e.type==="scratch"?"scratches":"misses"]++;stats[p].shots++;runs[p]=0;currentPlayer=p===1?2:1}}updateTurnUI()}

function renderTimeline(){
  const x=$("timeline");if(!events.length){x.className="timeline emptyState";x.textContent="No shots yet.";return}x.className="timeline";x.innerHTML=events.slice().reverse().slice(0,30).map(e=>`<div class="event"><span class="time">${fmt(e.t)}</span><div><div class="etype">${esc(e.type.toUpperCase())}</div><small>${esc(playerName(e.player))}${e.note?" · "+esc(e.note):""}</small></div><span>${e.type==="highlight"?"★":e.type==="pot"?"✓":e.type==="scratch"?"↺":"•"}</span></div>`).join("")
}
function rate(p){const s=stats[p],attempt=s.pots+s.misses+s.scratches;return attempt?Math.round(s.pots/attempt*100):0}
function renderMetrics(){
  const total=stats[1].shots+stats[2].shots,high=events.filter(e=>e.type==="highlight").length;
  $("metrics").innerHTML=[
    ["Shots",total],["P1 pot %",rate(1)+"%"],["P2 pot %",rate(2)+"%"],["Scratches",stats[1].scratches+stats[2].scratches],["Highlights",high],["Motion",(lastMotion*100).toFixed(1)+"%"]
  ].map(([a,b])=>`<div class="metric"><b>${b}</b><span>${a}</span></div>`).join("")
}
function renderInsights(){
  const arr=[];for(const p of [1,2]){const s=stats[p];if(s.shots>=3){arr.push(`<div class="insight"><b>${esc(playerName(p))}: ${rate(p)}% pot rate</b><span>${s.pots} pots · ${s.misses} misses · ${s.scratches} scratches</span></div>`);if(s.scratches>=2)arr.push(`<div class="insight"><b>${esc(playerName(p))} is scratching often</b><span>Focus on cue-ball control and speed.</span></div>`)}}
  if(lastPocketActivity>.001)arr.push(`<div class="insight"><b>Pocket-area movement detected</b><span>The vision worker saw activity near a calibrated pocket zone.</span></div>`);
  $("insights").className=arr.length?"insights":"insights emptyState";$("insights").innerHTML=arr.join("")||"Play a few shots to generate analysis."
}
function renderMoments(){const ms=events.filter(e=>e.type==="highlight"||((e.confidence||0)>.8&&e.pocketActivity>.0005)).slice().reverse();const x=$("moments");if(!ms.length){x.className="moments emptyState";x.textContent="Highlights will appear here.";return}x.className="moments";x.innerHTML=ms.map(e=>`<div class="moment"><span>${fmt(e.t)}</span><div><b>${esc(playerName(e.player))}</b><small> ${esc(e.note||"Auto-highlight candidate")}</small></div><span>★</span></div>`).join("")}
async function renderRecordings(){const all=(await dbAll("videos")).filter(v=>!sessionId||v.sessionId===sessionId).sort((a,b)=>b.index-a.index);const x=$("recordings");if(!all.length){x.className="recordings emptyState";x.textContent="No saved chunks yet.";return}x.className="recordings";x.innerHTML="";for(const v of all){const u=URL.createObjectURL(v.blob),ext=(v.type||"").includes("webm")?"webm":"mp4",d=document.createElement("div");d.className="rec";d.innerHTML=`<span>${fmt(v.start)}</span><div><b>Video ${v.index+1}</b><small> ${(v.blob.size/1024/1024).toFixed(1)} MB</small></div><a class="download" href="${u}" download="${v.id}.${ext}">Save</a>`;x.appendChild(d)}}
async function renderHistory(){const all=(await dbAll("sessions")).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,10),x=$("history");if(!all.length){x.className="history emptyState";x.textContent="No sessions yet.";return}x.className="history";x.innerHTML=all.map(s=>`<div class="hist"><span>🎱</span><div><b>${esc(s.p1)} vs ${esc(s.p2)}</b><small> ${esc(s.gameType)} · ${fmt(s.duration||0)} · ${s.events?.length||0} events</small></div><span>${new Date(s.startedAt).toLocaleDateString()}</span></div>`).join("")}
function renderAll(){$("shotBadge").textContent=`${stats[1].shots+stats[2].shots} shots`;updateTurnUI();renderTimeline();renderMetrics();renderInsights();renderMoments();renderRecordings();renderHistory()}
async function saveSession(ended){if(!sessionId)return;await dbPut("sessions",{id:sessionId,p1:playerName(1),p2:playerName(2),gameType:$("gameType").value,raceTo:+$("raceTo").value,startedAt:new Date(Date.now()-nowSec()*1000).toISOString(),endedAt:ended?new Date().toISOString():null,duration:nowSec(),events,stats,wins,calibration})}
async function updateStorage(){if(navigator.storage?.estimate){const e=await navigator.storage.estimate();$("storageBadge").textContent=`Storage ${(e.usage/1048576).toFixed(0)} MB / ${(e.quota/1073741824).toFixed(1)} GB`}}
$("exportBtn").onclick=async()=>{const all=await dbAll("sessions"),s=all.find(x=>x.id===sessionId)||all[all.length-1];if(!s)return alert("No session to export");const b=new Blob([JSON.stringify(s,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`${s.id}.json`;a.click()};
$("emailBtn").onclick=()=>{const body=`PoolCam report\n${playerName(1)} vs ${playerName(2)}\n${$("gameType").value}\n\n${playerName(1)}: ${stats[1].pots} pots, ${stats[1].misses} misses, ${stats[1].scratches} scratches, ${rate(1)}% pot rate\n${playerName(2)}: ${stats[2].pots} pots, ${stats[2].misses} misses, ${stats[2].scratches} scratches, ${rate(2)}% pot rate\n\nHighlights: ${events.filter(e=>e.type==="highlight").length}`;location.href=`mailto:${encodeURIComponent($("reportEmail").value)}?subject=${encodeURIComponent("🎱 PoolCam Report")}&body=${encodeURIComponent(body)}`};
$("clearBtn").onclick=async()=>{if(!confirm("Delete all locally saved PoolCam sessions and videos?"))return;await dbClear("videos");await dbClear("sessions");renderAll();updateStorage()};
const saved=localStorage.getItem("poolcam-cal");if(saved){try{calibration=JSON.parse(saved);if(calibration.length===4)$("startMatchBtn").disabled=true}catch{}}
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
navigator.storage?.persist?.().catch(()=>{});
renderAll();updateStorage();
