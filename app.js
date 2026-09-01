const $ = id => document.getElementById(id);

let stream = null;
let recorder = null;
let sessionActive = false;
let startedAt = null;
let timerHandle = null;
let motionHandle = null;
let prevFrame = null;
let motionActive = false;
let motionPeak = 0;
let lastShotAt = -999;
let currentChunkStarted = 0;
let chunkIndex = 0;
let events = [];
let sessionId = null;

const CHUNK_MS = 120000; // 2-minute chunks
const MOTION_THRESHOLD = 18;
const MOTION_RATIO = 0.022;
const SHOT_COOLDOWN = 2.5;

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open("poolcam-db", 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", {keyPath:"id"});
    if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", {keyPath:"id"});
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function put(store, value) {
  const db = await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function all(store) {
  const db = await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readonly");
    const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function clearStore(store) {
  const db = await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

function fmt(sec){
  sec=Math.max(0,Math.floor(sec));
  const h=String(Math.floor(sec/3600)).padStart(2,"0");
  const m=String(Math.floor((sec%3600)/60)).padStart(2,"0");
  const s=String(sec%60).padStart(2,"0");
  return `${h}:${m}:${s}`;
}

function elapsed(){
  return startedAt ? (performance.now()-startedAt)/1000 : 0;
}

function setStatus(text){ $("statusPill").textContent=text; }

async function refreshStorage(){
  if (navigator.storage && navigator.storage.estimate){
    const {usage=0,quota=0}=await navigator.storage.estimate();
    $("storageText").textContent = quota ? `${(usage/1024/1024).toFixed(0)} / ${(quota/1024/1024/1024).toFixed(1)} GB` : `${(usage/1024/1024).toFixed(0)} MB`;
  }
}

function refreshPlayers(){
  const p1=$("p1").value.trim()||"Player 1";
  const p2=$("p2").value.trim()||"Player 2";
  const sel=$("currentPlayer");
  const old=sel.value;
  sel.innerHTML=`<option>${escapeHtml(p1)}</option><option>${escapeHtml(p2)}</option>`;
  if ([p1,p2].includes(old)) sel.value=old;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

$("p1").addEventListener("input",refreshPlayers);
$("p2").addEventListener("input",refreshPlayers);
refreshPlayers();

$("cameraBtn").onclick = async () => {
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},
      audio:true
    });
    $("preview").srcObject=stream;
    $("sessionBtn").disabled=false;
    $("cameraBtn").disabled=true;
    setStatus("Camera ready");
  }catch(err){
    alert("Camera access failed: "+err.message);
  }
};

$("sessionBtn").onclick = async () => {
  if(!stream) return;
  sessionActive=true;
  sessionId="session-"+Date.now();
  events=[];
  startedAt=performance.now();
  chunkIndex=0;
  currentChunkStarted=0;
  $("sessionBtn").disabled=true;
  $("stopBtn").disabled=false;
  $("highlightBtn").disabled=false;
  $("potBtn").disabled=false;
  $("missBtn").disabled=false;
  $("scratchBtn").disabled=false;
  $("jsonBtn").disabled=false;
  $("emailBtn").disabled=false;
  setStatus("Recording");
  startTimer();
  startRecorder();
  startMotionDetection();
  await saveSession();
};

function bestMime(){
  const candidates=[
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=h264,opus",
    "video/webm"
  ];
  return candidates.find(t=>window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

function startRecorder(){
  const mime=bestMime();
  try{
    recorder = mime ? new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000}) : new MediaRecorder(stream);
  }catch(e){
    recorder = new MediaRecorder(stream);
  }
  recorder.ondataavailable = async e => {
    if(e.data && e.data.size>0){
      const id=`${sessionId}-chunk-${String(chunkIndex).padStart(4,"0")}`;
      await put("videos",{
        id, sessionId, index:chunkIndex,
        startSeconds:currentChunkStarted,
        createdAt:new Date().toISOString(),
        type:e.data.type || mime || "video/mp4",
        blob:e.data
      });
      currentChunkStarted=elapsed();
      chunkIndex++;
      $("chunkCount").textContent=chunkIndex;
      await renderRecordings();
      await refreshStorage();
    }
  };
  recorder.start(CHUNK_MS);
}

function startTimer(){
  clearInterval(timerHandle);
  timerHandle=setInterval(()=>{$("timer").textContent=fmt(elapsed())},500);
}

function startMotionDetection(){
  const video=$("preview"), canvas=$("analysisCanvas"), ctx=canvas.getContext("2d",{willReadFrequently:true});
  prevFrame=null; motionActive=false; motionPeak=0; lastShotAt=-999;
  clearInterval(motionHandle);
  motionHandle=setInterval(()=>{
    if(!sessionActive || video.readyState<2) return;
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const img=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const gray=new Uint8Array(canvas.width*canvas.height);
    for(let i=0,j=0;i<img.length;i+=4,j++) gray[j]=(img[i]*3+img[i+1]*6+img[i+2])/10;
    if(prevFrame){
      let changed=0;
      for(let i=0;i<gray.length;i++) if(Math.abs(gray[i]-prevFrame[i])>MOTION_THRESHOLD) changed++;
      const ratio=changed/gray.length;
      const now=elapsed();
      if(ratio>MOTION_RATIO){
        motionActive=true;
        motionPeak=Math.max(motionPeak,ratio);
      }else if(motionActive){
        if(now-lastShotAt>SHOT_COOLDOWN){
          addEvent("probable shot",{confidence:Math.min(0.99,0.45+motionPeak*7)});
          lastShotAt=now;
        }
        motionActive=false; motionPeak=0;
      }
    }
    prevFrame=gray;
  },250);
}

function addEvent(type, extra={}){
  const e={
    id:"evt-"+Date.now()+"-"+Math.floor(Math.random()*1000),
    seconds:elapsed(),
    type,
    player:$("currentPlayer").value,
    highlight:type==="highlight",
    ...extra
  };
  events.push(e);
  $("shotCount").textContent=events.filter(x=>x.type==="probable shot").length;
  renderEvents();
  saveSession();
}

$("highlightBtn").onclick=()=>addEvent("highlight",{note:"Manual highlight"});
$("potBtn").onclick=()=>addEvent("pot");
$("missBtn").onclick=()=>addEvent("miss");
$("scratchBtn").onclick=()=>addEvent("scratch");

$("stopBtn").onclick = async () => {
  sessionActive=false;
  clearInterval(timerHandle); clearInterval(motionHandle);
  if(recorder && recorder.state!=="inactive") recorder.stop();
  $("stopBtn").disabled=true;
  $("highlightBtn").disabled=true;
  $("potBtn").disabled=true;
  $("missBtn").disabled=true;
  $("scratchBtn").disabled=true;
  setStatus("Saved");
  await saveSession(true);
  renderSummary();
};

async function saveSession(ended=false){
  if(!sessionId) return;
  const data={
    id:sessionId,
    player1:$("p1").value.trim()||"Player 1",
    player2:$("p2").value.trim()||"Player 2",
    gameType:$("gameType").value,
    reportEmail:$("reportEmail").value.trim(),
    startedAt:new Date(Date.now()-elapsed()*1000).toISOString(),
    endedAt:ended?new Date().toISOString():null,
    durationSeconds:elapsed(),
    events
  };
  await put("sessions",data);
}

function renderEvents(){
  const box=$("events");
  if(!events.length){box.innerHTML='<p class="muted">No events yet.</p>';return;}
  box.innerHTML=events.slice().reverse().map(e=>`
    <div class="event">
      <div class="eventHead"><b>${fmt(e.seconds)} — ${escapeHtml(e.type)}</b><span class="tag">${escapeHtml(e.player||"")}</span></div>
      ${e.confidence?`<small>motion confidence ${(e.confidence*100).toFixed(0)}%</small>`:""}
    </div>`).join("");
}

async function renderRecordings(){
  const vids=(await all("videos")).filter(v=>!sessionId||v.sessionId===sessionId).sort((a,b)=>a.index-b.index);
  const box=$("recordings");
  if(!vids.length){box.innerHTML='<p class="muted">No video chunks saved yet.</p>';return;}
  box.innerHTML="";
  for(const v of vids){
    const url=URL.createObjectURL(v.blob);
    const ext=(v.type||"").includes("webm")?"webm":"mp4";
    const div=document.createElement("div");
    div.className="recording";
    div.innerHTML=`<b>Chunk ${v.index+1}</b> · starts ${fmt(v.startSeconds)} · ${(v.blob.size/1024/1024).toFixed(1)} MB<br>
      <a class="download" download="${v.id}.${ext}" href="${url}">Save to Files</a>`;
    box.appendChild(div);
  }
}

function buildSummary(){
  const p1=$("p1").value.trim()||"Player 1", p2=$("p2").value.trim()||"Player 2";
  const players=[p1,p2];
  const stats={};
  players.forEach(p=>stats[p]={pots:0,misses:0,scratches:0,highlights:0});
  for(const e of events){
    if(!stats[e.player]) stats[e.player]={pots:0,misses:0,scratches:0,highlights:0};
    if(e.type==="pot")stats[e.player].pots++;
    if(e.type==="miss")stats[e.player].misses++;
    if(e.type==="scratch")stats[e.player].scratches++;
    if(e.type==="highlight")stats[e.player].highlights++;
  }
  const lines=[
    `🎱 Pool Report`,
    `${p1} vs ${p2} — ${$("gameType").value}`,
    `Duration: ${fmt(elapsed())}`,
    `Probable shots detected: ${events.filter(e=>e.type==="probable shot").length}`,
    ``,
    ...players.map(p=>{
      const s=stats[p], attempts=s.pots+s.misses+s.scratches;
      const pct=attempts?Math.round(s.pots/attempts*100):0;
      return `${p}: ${s.pots} pots, ${s.misses} misses, ${s.scratches} scratches, ${pct}% tagged-pot rate, ${s.highlights} highlights`;
    })
  ];
  return lines.join("\n");
}

function renderSummary(){$("summary").textContent=buildSummary();}

$("jsonBtn").onclick = async ()=>{
  await saveSession(!sessionActive);
  const sessions=await all("sessions");
  const s=sessions.find(x=>x.id===sessionId);
  const blob=new Blob([JSON.stringify(s,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${sessionId}.json`; a.click();
};

$("emailBtn").onclick=()=>{
  const to=$("reportEmail").value.trim();
  const subject=encodeURIComponent("🎱 Pool Night Report");
  const body=encodeURIComponent(buildSummary());
  location.href=`mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
};

$("clearBtn").onclick=async()=>{
  if(!confirm("Delete all PoolCam sessions and recordings stored in this browser?")) return;
  await clearStore("videos"); await clearStore("sessions");
  events=[]; sessionId=null; $("events").innerHTML=""; $("recordings").innerHTML="";
  $("summary").textContent=""; $("chunkCount").textContent="0"; $("shotCount").textContent="0";
  refreshStorage();
};

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
refreshStorage(); renderEvents(); renderRecordings();
