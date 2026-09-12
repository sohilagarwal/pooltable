const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=s=>{s=Math.max(0,Math.floor(s||0));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};

let stream=null,vision=null,visionReady=false,detectorReady=false,calibration=[],calibrating=false;
let motionWorker=null,frameTimer=null,clockTimer=null,gameActive=false,analysisLock=false,workerPaused=false;
let rules=null,events=[],sessionId=null,startPerf=0,finalDuration=0,safetyArmed=false;
let visionBaselineCount=16,visionBaselineCue=true,visionBaselineScan=null,lastScan=null,lastShotRecord=null,pendingVisionShot=null,awaitingCuePlacement=false,cuePollToken=0;
let recorder=null,recordTimer=null,videoChunkIndex=0,videoChunkStart=0,objectUrls=[];
let visionInitPromise=null,pendingRackBreaker=null,pendingBreakFoul=null;


const dbp=new Promise((resolve,reject)=>{
  const r=indexedDB.open('poolcam-v4',1);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('sessions'))d.createObjectStore('sessions',{keyPath:'id'});if(!d.objectStoreNames.contains('videos'))d.createObjectStore('videos',{keyPath:'id'});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
async function dbPut(store,v){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(v);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function dbAll(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store);const r=t.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbClear(store){const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).clear();t.oncomplete=res;t.onerror=()=>rej(t.error)})}

function name(i){return i===0?($('p1').value.trim()||'Player 1'):($('p2').value.trim()||'Player 2')}
function nowSec(){return gameActive?(performance.now()-startPerf)/1000:finalDuration}
function setAppStatus(text,live=false){$('appStatus').textContent=text;$('appStatus').className='chip '+(live?'live':'')}
function setupText(){
  $('hudP1Name').textContent=name(0);$('hudP2Name').textContent=name(1);
  $('breaker').options[0].textContent=name(0);$('breaker').options[1].textContent=name(1);
}
$('p1').addEventListener('input',setupText);$('p2').addEventListener('input',setupText);setupText();

// ---------- OpenCV ----------
async function initVision(){
  if(visionReady)return true;
  if(visionInitPromise)return visionInitPromise;
  visionInitPromise=(async()=>{
    if(!vision)vision=new PoolVision($('sourceCanvas'),$('debugCanvas'));
    try{
      await vision.init(35000);visionReady=true;$('opencvStatus').textContent='Vision ready';$('opencvStatus').className='chip live';$('engCv').textContent='Ready';updateButtons();return true;
    }catch(e){
      $('opencvStatus').textContent='Vision failed';$('engCv').textContent='Failed';$('setupWarning').innerHTML=`OpenCV did not load. Keep the iPad online, reload this page, and wait for <b>Vision ready</b>.`;console.error(e);return false;
    }finally{visionInitPromise=null;}
  })();
  return visionInitPromise;
}
initVision();
window.addEventListener('poolcam-opencv-runtime',()=>{if(!visionReady)initVision()},{once:true});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.page+'Page').classList.add('active');renderAll()});

// ---------- Camera ----------
$('startCameraBtn').onclick=async()=>{
  const c={video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:true};
  try{stream=await navigator.mediaDevices.getUserMedia(c)}catch(e){try{stream=await navigator.mediaDevices.getUserMedia({...c,audio:false})}catch(err){alert('Camera failed: '+err.message);return}}
  $('video').srcObject=stream;$('emptyCamera').classList.add('hidden');$('startCameraBtn').disabled=true;$('calibrateBtn').disabled=false;setAppStatus('Camera ready',true);
  const saved=localStorage.getItem('poolcam-v4-cal');if(saved){try{calibration=JSON.parse(saved)}catch{calibration=[]}}
  if(calibration.length===4){$('engCal').textContent='Calibrated';drawOverlay()}
  setupMotionWorker();resizeOverlay();updateStorage();updateButtons();
};
window.addEventListener('resize',resizeOverlay);

function videoRect(){
  const stage=$('videoStage').getBoundingClientRect(),v=$('video'),vw=v.videoWidth||16,vh=v.videoHeight||9,sa=stage.width/stage.height,va=vw/vh;let w,h,left,top;
  if(va>sa){w=stage.width;h=w/va;left=0;top=(stage.height-h)/2}else{h=stage.height;w=h*va;top=0;left=(stage.width-w)/2}return{stage,w,h,left,top};
}
function resizeOverlay(){const c=$('overlay'),r=$('videoStage').getBoundingClientRect(),d=devicePixelRatio||1;c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=r.width+'px';c.style.height=r.height+'px';drawOverlay()}
function drawOverlay(){
  const c=$('overlay'),ctx=c.getContext('2d'),d=devicePixelRatio||1;ctx.clearRect(0,0,c.width,c.height);if(!calibration.length)return;const vr=videoRect(),map=p=>({x:(vr.left+p.x*vr.w)*d,y:(vr.top+p.y*vr.h)*d});
  ctx.strokeStyle='#50e58a';ctx.fillStyle='#50e58a';ctx.lineWidth=3*d;ctx.beginPath();calibration.forEach((p,i)=>{const q=map(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});if(calibration.length===4)ctx.closePath();ctx.stroke();
  calibration.forEach((p,i)=>{const q=map(p);ctx.beginPath();ctx.arc(q.x,q.y,7*d,0,Math.PI*2);ctx.fill();ctx.font=`${13*d}px sans-serif`;ctx.fillText(String(i+1),q.x+10*d,q.y-8*d)});
}
const cornerNames=['top-left','top-right','bottom-right','bottom-left'];
$('calibrateBtn').onclick=()=>{if(gameActive)return;calibrating=true;calibration=[];detectorReady=false;document.body.classList.add('calibrating');$('calGuide').classList.remove('hidden');$('calInstruction').textContent='Tap '+cornerNames[0]+' cloth corner';drawOverlay();updateButtons()};
$('cancelCal').onclick=()=>finishCalibration(false);
$('overlay').addEventListener('pointerdown',e=>{
  if(!calibrating)return;e.preventDefault();const stage=$('videoStage').getBoundingClientRect(),vr=videoRect(),x=e.clientX-stage.left,y=e.clientY-stage.top;if(x<vr.left||x>vr.left+vr.w||y<vr.top||y>vr.top+vr.h)return;
  calibration.push({x:(x-vr.left)/vr.w,y:(y-vr.top)/vr.h});drawOverlay();if(calibration.length===4)finishCalibration(true);else $('calInstruction').textContent='Tap '+cornerNames[calibration.length]+' cloth corner';
},{passive:false});
function finishCalibration(ok){
  calibrating=false;document.body.classList.remove('calibrating');$('calGuide').classList.add('hidden');
  if(ok&&calibration.length===4){localStorage.setItem('poolcam-v4-cal',JSON.stringify(calibration));$('engCal').textContent='Calibrated';$('calibrateBtn').textContent='Recalibrate Table';configureMotionWorker();drawOverlay();$('setupWarning').innerHTML='Now put the full rack plus cue ball on the table and tap <b>Scan Balls</b>. The Vision tab will show exactly which circles are being detected.'}
  else{const saved=localStorage.getItem('poolcam-v4-cal');calibration=saved?JSON.parse(saved):[];drawOverlay()}
  updateButtons();
}

// ---------- Ball detector calibration ----------
$('scanBtn').onclick=async()=>{
  if(!visionReady||calibration.length!==4||!stream||analysisLock||gameActive)return;analysisLock=true;$('scanBtn').disabled=true;
  $('scanOverlay').classList.remove('hidden');$('scanTitle').textContent='Scanning balls…';$('scanText').textContent='Flattening the table and automatically tuning circle detection for 16 balls.';
  try{
    const s=await vision.consensus($('video'),calibration,{expected:16,tune:true,samples:3});lastScan=s;
    $('detectedCount').textContent=s.count;$('detectedCue').textContent=s.cuePresent?'YES':'NO';$('detectorStability').textContent=s.spread===0?'HIGH':s.spread===1?'GOOD':'LOW';$('detectorParam').textContent=s.param2;$('engCircle').textContent=`${s.count} found`;
    // Automatic play is armed only when the initial table scan is genuinely usable.
    detectorReady=s.count===16&&s.spread<=1&&s.cuePresent;
    $('detectorReadyLabel').textContent=detectorReady?'Ready':'Needs re-scan';
    if(detectorReady){
      $('setupWarning').innerHTML=`Detector is armed. It sees <b>${s.count} stable balls</b> (${s.counts.join(' / ')}) and the cue ball. Start Game will perform one more verification scan and use the <b>actual detected baseline</b>, not a hard-coded 16.`;
    }else{
      $('setupWarning').innerHTML=`Not ready for automatic play: ${s.count} balls, cue ${s.cuePresent?'seen':'NOT seen'}, scans ${s.counts.join(' / ')}. Adjust the overhead view/lighting until PoolCam sees all 16 balls with stable counts, then Scan Balls again.`;
    }
  }catch(e){console.error(e);detectorReady=false;$('detectorReadyLabel').textContent='Scan failed';alert('Ball scan failed: '+e.message)}
  $('scanOverlay').classList.add('hidden');analysisLock=false;updateButtons();renderAll();
};
function updateButtons(){
  $('calibrateBtn').disabled=!(stream&&!gameActive);
  $('scanBtn').disabled=!(stream&&visionReady&&calibration.length===4&&!gameActive);
  $('startGameBtn').disabled=!(stream&&visionReady&&calibration.length===4&&detectorReady&&!gameActive);
}

// ---------- Motion detector ----------
function setupMotionWorker(){
  if(motionWorker)motionWorker.terminate();motionWorker=new Worker('./motion-worker.js');
  motionWorker.onmessage=e=>{const m=e.data;if(m.type==='motion'){$('motionHud').textContent='Table '+(m.moving?'MOVING':'STILL');$('engMotion').textContent=`${(m.ratio*100).toFixed(1)}%`;}
    else if(m.type==='shotStart'&&gameActive&&!rules?.rackOver&&!workerPaused&&!analysisLock){$('autoResult').textContent='SHOT';$('autoConfidence').textContent=`${name(rules.current)} shooting…`;setAppStatus('Shot in progress',true)}
    else if(m.type==='shotEnd'&&gameActive&&!rules?.rackOver&&!workerPaused&&!analysisLock){analyzeCompletedShot(m)}
  };
  configureMotionWorker();
}
function configureMotionWorker(){if(motionWorker)motionWorker.postMessage({type:'config',sensitivity:5,table:calibration.length===4?calibration:null})}
function startFrameLoop(){
  const v=$('video'),c=$('motionCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});clearInterval(frameTimer);
  frameTimer=setInterval(()=>{if(!gameActive||workerPaused||analysisLock||v.readyState<2||!motionWorker)return;ctx.drawImage(v,0,0,c.width,c.height);const p=ctx.getImageData(0,0,c.width,c.height).data,g=new Uint8Array(c.width*c.height);for(let i=0,j=0;i<p.length;i+=4,j++)g[j]=(p[i]*3+p[i+1]*6+p[i+2])/10;motionWorker.postMessage({type:'frame',gray:g,w:c.width,h:c.height,t:nowSec()},[g.buffer])},240);
}

// ---------- Game ----------
$('startGameBtn').onclick=async()=>{
  if(!detectorReady||!lastScan||analysisLock)return;
  analysisLock=true;setAppStatus('Verifying table…',true);$('startGameBtn').disabled=true;
  try{
    const check=await vision.consensus($('video'),calibration,{expected:lastScan.count,tune:false,samples:3});lastScan=check;
    const usable=check.count===16&&check.spread<=1&&check.cuePresent&&Math.abs(check.count-(Number($('detectedCount').textContent)||check.count))<=1;
    if(!usable){detectorReady=false;$('detectorReadyLabel').textContent='Re-scan required';$('setupWarning').innerHTML=`Final verification failed: ${check.counts.join(' / ')} balls, cue ${check.cuePresent?'seen':'NOT seen'}. Scan Balls again before starting.`;return;}
    rules=new PoolRules.EightBallGame({p1:name(0),p2:name(1),breaker:+$('breaker').value,raceTo:+$('raceTo').value});events=[];lastShotRecord=null;pendingVisionShot=null;$('visionReview').classList.add('hidden');safetyArmed=false;awaitingCuePlacement=false;cuePollToken++;
    gameActive=true;workerPaused=false;sessionId='pool-'+Date.now();startPerf=performance.now();finalDuration=0;visionBaselineCount=check.count;visionBaselineCue=check.cuePresent;visionBaselineScan=check;videoChunkIndex=0;videoChunkStart=0;
    $('endGameBtn').disabled=false;setAppStatus('GAME LIVE',true);motionWorker?.postMessage({type:'reset'});startFrameLoop();startRecordingLoop();clearInterval(clockTimer);clockTimer=setInterval(()=>{$('clock').textContent=fmt(nowSec())},500);
    addEvent('game-start',rules.current,`${name(rules.current)} breaks · vision baseline = ${visionBaselineCount} balls`);await saveSession(false);renderAll();
  }catch(e){console.error(e);alert('Could not verify the table before starting: '+e.message);}
  finally{analysisLock=false;updateButtons();}
};
$('endGameBtn').onclick=async()=>{if(!gameActive)return;finalDuration=(performance.now()-startPerf)/1000;gameActive=false;pendingRackBreaker=null;pendingVisionShot=null;$('visionReview').classList.add('hidden');analysisLock=true;workerPaused=true;cuePollToken++;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');clearInterval(frameTimer);clearInterval(clockTimer);await stopRecorder();$('endGameBtn').disabled=true;setAppStatus('Saved');addEvent('game-end',rules?.current??0,'Game ended');await saveSession(true);analysisLock=false;updateButtons();renderAll()};

async function analyzeCompletedShot(m){
  if(!rules||!gameActive||rules.rackOver||pendingVisionShot)return;
  analysisLock=true;workerPaused=true;const shooter=rules.current;setAppStatus('Analyzing shot…',true);$('autoResult').textContent='ANALYZING';$('autoConfidence').textContent='Taking stable after-shot scans';
  try{
    await sleep(700);
    let after;
    try{after=await vision.consensus($('video'),calibration,{expected:visionBaselineCount,tune:false,samples:5});}
    catch(e){console.error(e);after={count:visionBaselineCount,cuePresent:visionBaselineCue,spread:4,confidence:.25,counts:[visionBaselineCount],balls:[]};}
    if(!gameActive)return;
    lastScan=after;$('ballsHud').textContent=`Balls ${after.count}`;$('cueHud').textContent=`Cue ${after.cuePresent?'YES':'NO'}`;$('detectedCount').textContent=after.count;$('detectedCue').textContent=after.cuePresent?'YES':'NO';$('detectorStability').textContent=after.spread===0?'HIGH':after.spread===1?'GOOD':'LOW';

    const beforeCount=visionBaselineCount,beforeCue=visionBaselineCue,beforeScan=visionBaselineScan;
    const safety=safetyArmed;safetyArmed=false;$('safetyBtn').textContent='◇ Safety';
    const positionChange=PoolDecision.compareTableStates(beforeScan?.balls||[],after.balls||[]);
    const decision=PoolDecision.inferShot({breakShot:rules.breakShot,beforeCount,afterCount:after.count,beforeCue,afterCue:after.cuePresent,spread:after.spread,peakPocket:m.peakPocket,safety,positionChange});
    let {rawDelta,cueGone,pocketStrong,objectPots,suggested,ambiguous,reason,noShot}=decision;

    let confidence=after.confidence??.50;
    if(after.spread>1)confidence-=.14*(after.spread-1);
    if(rawDelta<0)confidence-=.18*Math.min(3,Math.abs(rawDelta));
    if((objectPots>0||cueGone)&&pocketStrong)confidence+=.07;
    confidence=Math.max(.20,Math.min(.98,confidence));
    $('engPocket').textContent=(m.peakPocket*100).toFixed(2)+'%';$('engConf').textContent=Math.round(confidence*100)+'%';



    const physicalAfter={count:after.count,cuePresent:after.cuePresent};
    // The physical table after the motion event becomes the next baseline, including a rejected false-motion event.
    visionBaselineCount=physicalAfter.count;visionBaselineCue=physicalAfter.cuePresent;visionBaselineScan=after;

    if(noShot){
      if(safety){safetyArmed=true;$('safetyBtn').textContent='◇ Safety ARMED';}
      $('autoResult').textContent='NO SHOT';$('autoConfidence').textContent=`Ignored camera/player movement · balls unchanged (max shift ${positionChange.maxDistance.toFixed(1)} px)`;workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);renderAll();return;
    }

    if(ambiguous){
      pendingVisionShot={shooter,beforeRules:rules.snapshot(),beforeBaselineCue:beforeCue,t:nowSec(),afterScan:after,motion:m,suggested,objectPots,scratchObjectPots:objectPots,cueGone,safety,confidence,reason,beforeCount,physicalAfter};
      $('visionReviewTitle').textContent=suggested==='scratch'?'Possible scratch':suggested==='pot'?'Possible pot':'Possible miss';
      $('visionReviewDetail').textContent=`${reason} Confidence ${Math.round(confidence*100)}%. Confirm once.`;
      $('visionReview').classList.remove('hidden');$('autoResult').textContent='CHECK SHOT';$('autoConfidence').textContent='Vision is uncertain · confirm Pot / Miss / Scratch';setAppStatus('Waiting for confirmation');renderAll();await saveSession(false);return;
    }

    applyResolvedVisionShot({shooter,beforeRules:rules.snapshot(),beforeBaselineCue:beforeCue,afterScan:after,motion:m,type:suggested,objectPots,safety,confidence,inference:'automatic',beforeCount});
    await saveSession(false);
  }catch(e){
    console.error(e);$('autoResult').textContent='VISION ERROR';$('autoConfidence').textContent='Shot analysis failed · use manual Pot/Miss/Scratch';workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);
  }finally{analysisLock=false;}
}

function applyResolvedVisionShot(d){
  if(!rules||!gameActive)return;
  const {shooter,beforeRules,afterScan,motion,type,safety=false,confidence=1,inference='confirmed',beforeCount=visionBaselineCount,beforeBaselineCue=visionBaselineCue}=d;
  let shot={objectPots:0,scratch:false,safety:false};
  if(type==='pot')shot.objectPots=Math.max(1,d.objectPots||1);
  else if(type==='scratch'){shot.scratch=true;shot.objectPots=Math.max(0,d.objectPots||0);}
  else if(type==='safety'||safety){shot.safety=true;shot.objectPots=Math.max(0,d.objectPots||0);}
  rules.applyShot(shot);
  const label=shot.scratch?'SCRATCH':shot.safety?'SAFETY':shot.objectPots>0?`POT ×${shot.objectPots}`:'MISS',next=rules.current;
  const note=shot.scratch?`Scratch${shot.objectPots?` · ${shot.objectPots} object ball${shot.objectPots>1?'s':''} also down`:''} → ${name(next)} · BALL IN HAND`:shot.safety?`Declared safety → ${name(next)}`:shot.objectPots>0?`${shot.objectPots} ball${shot.objectPots>1?'s':''} potted → ${name(next)} continues`:`No ball potted → ${name(next)}`;
  addEvent('shot',shooter,note,{result:label,confidence,objectPots:shot.objectPots,scratch:shot.scratch,inference,beforeCount,afterCount:afterScan?.count,scanCounts:afterScan?.counts,peakPocket:motion?.peakPocket});
  lastShotRecord={beforeRules,beforeBaselineCount:beforeCount,beforeBaselineCue,shooter,t:nowSec(),afterScan:afterScan||lastScan,motion,eventIndex:events.length-1};
  $('autoResult').textContent=label;$('autoConfidence').textContent=`${Math.round(confidence*100)}% · ${note}`;$('visionReview').classList.add('hidden');pendingVisionShot=null;renderAll();
  if(shot.scratch)beginBallInHandWait(true);
  else if(afterScan && !afterScan.cuePresent){workerPaused=true;refreshBaselineAndResume();}
  else{workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);}
}

document.querySelectorAll('[data-vision-review]').forEach(b=>b.onclick=()=>{
  if(!pendingVisionShot||!rules||!gameActive)return;
  const p=pendingVisionShot,type=b.dataset.visionReview;
  applyResolvedVisionShot({...p,type,objectPots:type==='pot'?Math.max(1,p.objectPots||1):type==='scratch'?Math.max(0,p.scratchObjectPots||p.objectPots||0):0,confidence:1,inference:'vision + user confirmation'});
  saveSession(false);
});

function beginBallInHandWait(autoCueReturn=false){
  awaitingCuePlacement=true;workerPaused=true;cuePollToken++;$('resumeAfterBIH').textContent='Ball placed · Resume';$('resumeAfterBIH').classList.remove('hidden');$('turnReason').textContent='BALL IN HAND · place cue ball, then Resume';setAppStatus('Ball in hand',true);
  if(autoCueReturn)pollForCuePlacement();
}
function cancelBallInHandWait(){
  cuePollToken++;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');$('resumeAfterBIH').textContent='Ball placed · Resume';workerPaused=false;motionWorker?.postMessage({type:'reset'});
}
async function refreshBaselineAndResume(){
  if(!gameActive||!visionReady)return;
  workerPaused=true;const token=++cuePollToken;setAppStatus('Checking table…',true);
  try{
    const s=await vision.consensus($('video'),calibration,{expected:visionBaselineCount+(visionBaselineCue?0:1),tune:false,samples:3});
    if(token!==cuePollToken)return;lastScan=s;visionBaselineCount=s.count;visionBaselineCue=s.cuePresent;visionBaselineScan=s;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');$('resumeAfterBIH').textContent='Ball placed · Resume';workerPaused=false;motionWorker?.postMessage({type:'reset'});$('autoResult').textContent='READY';$('autoConfidence').textContent=s.cuePresent?'Cue ball placed · watching next shot':'Resumed manually · cue classifier uncertain';setAppStatus('Watching table',true);renderAll();
  }catch(e){console.warn(e);if(token===cuePollToken){awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');$('resumeAfterBIH').textContent='Ball placed · Resume';workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);}}
}
$('resumeAfterBIH').onclick=refreshBaselineAndResume;
async function pollForCuePlacement(){
  const token=cuePollToken,started=Date.now();
  while(gameActive&&awaitingCuePlacement&&token===cuePollToken&&Date.now()-started<12000){
    await sleep(900);if(!gameActive||token!==cuePollToken)return;
    try{const s=await vision.consensus($('video'),calibration,{expected:visionBaselineCount+1,tune:false,samples:2});lastScan=s;if(s.cuePresent){visionBaselineCount=s.count;visionBaselineCue=true;visionBaselineScan=s;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');$('resumeAfterBIH').textContent='Ball placed · Resume';workerPaused=false;motionWorker?.postMessage({type:'reset'});$('autoResult').textContent='READY';$('autoConfidence').textContent='Cue ball returned · watching next shot';setAppStatus('Watching table',true);renderAll();return;}}
    catch(e){console.warn(e)}
  }
  // Do not resume automatically after timeout: a ball-in-hand placement can look like a shot. The player can tap Resume.
  if(gameActive&&token===cuePollToken&&awaitingCuePlacement){$('autoResult').textContent='BALL IN HAND';$('autoConfidence').textContent='Place cue ball, then tap Ball placed · Resume';setAppStatus('Waiting for placement',true);}
}

async function syncPhysicalBaselineAfterManual(){
  if(!gameActive||!visionReady)return;
  workerPaused=true;setAppStatus('Syncing table…',true);
  try{
    const s=await vision.consensus($('video'),calibration,{expected:visionBaselineCount,tune:false,samples:3});
    lastScan=s;visionBaselineCount=s.count;visionBaselineCue=s.cuePresent;visionBaselineScan=s;$('ballsHud').textContent=`Balls ${s.count}`;$('cueHud').textContent=`Cue ${s.cuePresent?'YES':'NO'}`;
  }catch(e){console.warn('Manual baseline sync failed',e)}
  workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);renderAll();saveSession(false);
}

// ---------- Manual correction ----------
function manualCorrection(type,extra={}){
  if(!rules||!gameActive)return;
  if(pendingVisionShot){
    const p=pendingVisionShot;
    if(extra.foulType){
      pendingVisionShot=null;$('visionReview').classList.add('hidden');
      rules.restore(p.beforeRules);rules.applyShot({foulType:extra.foulType,scratch:type==='scratch',objectPots:Math.max(0,p.objectPots||0)});
      const note=`${extra.foulType.replaceAll('-',' ')} → ${name(rules.current)} · BALL IN HAND`;
      addEvent('shot',p.shooter,note,{result:'FOUL',confidence:1,inference:'manual foul',objectPots:Math.max(0,p.objectPots||0),scratch:type==='scratch',beforeCount:p.beforeCount,afterCount:p.afterScan?.count});
      lastShotRecord={beforeRules:p.beforeRules,beforeBaselineCount:p.beforeCount,beforeBaselineCue:p.beforeBaselineCue,shooter:p.shooter,t:nowSec(),eventIndex:events.length-1,afterScan:p.afterScan};
      beginBallInHandWait(type==='scratch');renderAll();saveSession(false);return;
    }
    applyResolvedVisionShot({...p,type,objectPots:type==='pot'?Math.max(1,p.objectPots||1):type==='scratch'?Math.max(0,p.scratchObjectPots||p.objectPots||0):0,confidence:1,inference:'manual confirmation'});
    saveSession(false);return;
  }
  const recent=lastShotRecord && nowSec()-lastShotRecord.t<20;
  const isFoul=!!extra.foulType||type==='scratch';
  if(recent){
    // Cancel any wait created by the automatic result before rewriting that result.
    cuePollToken++;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');
    rules.restore(lastShotRecord.beforeRules);const shooter=lastShotRecord.shooter;
    const shot={objectPots:type==='pot'?Math.max(1,extra.objectPots||1):0,scratch:type==='scratch',safety:type==='safety',foulType:extra.foulType||null};rules.applyShot(shot);
    const label=type==='pot'?'POT ×'+shot.objectPots:type==='scratch'?'SCRATCH':type==='safety'?'SAFETY':extra.foulType?'FOUL':'MISS';
    const note=extra.foulType?`${extra.foulType.replaceAll('-',' ')} → ${name(rules.current)} · BALL IN HAND`:type==='pot'?`${shot.objectPots} ball potted → ${name(rules.current)} continues`:type==='scratch'?`Scratch → ${name(rules.current)} · BALL IN HAND`:type==='safety'?`Safety → ${name(rules.current)}`:`Miss → ${name(rules.current)}`;
    const old=events[lastShotRecord.eventIndex];events[lastShotRecord.eventIndex]={...old,note,result:label,confidence:1,inference:'manual correction',objectPots:shot.objectPots,scratch:shot.scratch};$('autoResult').textContent=label;$('autoConfidence').textContent='Manual correction · '+note;
    // Keep the physical after-shot scan as the baseline. If a false scratch was corrected, refresh before resuming.
    if(lastShotRecord.afterScan){visionBaselineCount=lastShotRecord.afterScan.count;visionBaselineCue=lastShotRecord.afterScan.cuePresent;visionBaselineScan=lastShotRecord.afterScan;}
    lastShotRecord=null;
    if(isFoul)beginBallInHandWait(type==='scratch');
    else{workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);if(!visionBaselineCue)refreshBaselineAndResume();}
  }else{
    const shooter=rules.current,beforeRules=rules.snapshot(),shot={objectPots:type==='pot'?1:0,scratch:type==='scratch',safety:type==='safety',foulType:extra.foulType||null};rules.applyShot(shot);addEvent('shot',shooter,extra.foulType?`${extra.foulType.replaceAll('-',' ')} → ${name(rules.current)}`:type.toUpperCase()+` → ${name(rules.current)}`,{result:type.toUpperCase(),confidence:1,inference:'manual'});lastShotRecord={beforeRules,beforeBaselineCount:visionBaselineCount,beforeBaselineCue:visionBaselineCue,shooter,t:nowSec(),eventIndex:events.length-1,afterScan:lastScan};
    if(isFoul)beginBallInHandWait(type==='scratch');
    else syncPhysicalBaselineAfterManual();
  }
  saveSession(false);renderAll();
}

document.querySelectorAll('[data-manual]').forEach(b=>b.onclick=()=>manualCorrection(b.dataset.manual));
$('safetyBtn').onclick=()=>{if(!gameActive)return;safetyArmed=!safetyArmed;$('safetyBtn').textContent=safetyArmed?'◇ Safety ARMED':'◇ Safety';$('autoResult').textContent=safetyArmed?'SAFETY ARMED':'READY';$('autoConfidence').textContent=safetyArmed?'Next detected shot will end the inning':'Automatic turn tracking'};
$('switchBtn').onclick=()=>{if(!rules||!gameActive||pendingVisionShot)return;rules.switchPlayer();addEvent('turn',rules.current,`Manual switch → ${name(rules.current)}`);lastShotRecord=null;saveSession(false);renderAll()};
$('highlightBtn').onclick=()=>{if(gameActive)addEvent('highlight',rules.current,'★ Highlight marked');renderAll();saveSession(false)};
$('undoBtn').onclick=()=>{if(!lastShotRecord||!rules||pendingVisionShot)return;cuePollToken++;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');rules.restore(lastShotRecord.beforeRules);events.splice(lastShotRecord.eventIndex,1);if(lastShotRecord.afterScan){visionBaselineCount=lastShotRecord.afterScan.count;visionBaselineCue=lastShotRecord.afterScan.cuePresent;visionBaselineScan=lastShotRecord.afterScan;}lastShotRecord=null;workerPaused=false;motionWorker?.postMessage({type:'reset'});$('autoResult').textContent='UNDONE';$('autoConfidence').textContent='Last rule result removed · physical table baseline kept';setAppStatus('Watching table',true);saveSession(false);renderAll()};

function breakCorrectionContext(){
  if(pendingVisionShot?.beforeRules?.breakShot)return {source:'pending',shooter:pendingVisionShot.shooter,beforeRules:pendingVisionShot.beforeRules,beforeBaselineCount:pendingVisionShot.beforeCount,beforeBaselineCue:pendingVisionShot.beforeBaselineCue,afterScan:pendingVisionShot.afterScan,eventIndex:null};
  if(lastShotRecord?.beforeRules?.breakShot && nowSec()-lastShotRecord.t<25)return {source:'recent',shooter:lastShotRecord.shooter,beforeRules:lastShotRecord.beforeRules,beforeBaselineCount:lastShotRecord.beforeBaselineCount,beforeBaselineCue:lastShotRecord.beforeBaselineCue,afterScan:lastShotRecord.afterScan,eventIndex:lastShotRecord.eventIndex};
  if(rules?.breakShot)return {source:'live',shooter:rules.current,beforeRules:rules.snapshot(),beforeBaselineCount:visionBaselineCount,beforeBaselineCue:visionBaselineCue,afterScan:lastScan,eventIndex:null};
  return null;
}
function restoreBreakContext(ctx){
  if(!ctx||!rules)return null;cuePollToken++;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');
  rules.restore(ctx.beforeRules);pendingVisionShot=null;$('visionReview').classList.add('hidden');
  if(Number.isInteger(ctx.eventIndex)&&ctx.eventIndex>=0&&ctx.eventIndex<events.length)events.splice(ctx.eventIndex,1);
  if(ctx.afterScan){lastScan=ctx.afterScan;visionBaselineScan=ctx.afterScan;visionBaselineCount=ctx.afterScan.count;visionBaselineCue=ctx.afterScan.cuePresent;}
  lastShotRecord=null;return ctx;
}
function prepareBreakCorrection(){const p=pendingBreakFoul;return p?restoreBreakContext(p.ctx):null;}
function recordBreakChoice(ctx,note,extra={}){addEvent('shot',ctx.shooter,note,{confidence:1,inference:'manual break ruling',...extra});lastShotRecord={beforeRules:ctx.beforeRules,beforeBaselineCount:ctx.beforeBaselineCount,beforeBaselineCue:ctx.beforeBaselineCue,shooter:ctx.shooter,t:nowSec(),eventIndex:events.length-1,afterScan:ctx.afterScan||lastScan};saveSession(false);renderAll();}

$('foulBtn').onclick=()=>$('foulSheet').classList.remove('hidden');
$('closeFoul').onclick=()=>$('foulSheet').classList.add('hidden');
document.querySelectorAll('[data-foul]').forEach(b=>b.onclick=()=>{
  $('foulSheet').classList.add('hidden');const f=b.dataset.foul,ctx=breakCorrectionContext();
  if(ctx){pendingBreakFoul={ctx,f};if(f==='illegal-break')$('illegalBreakSheet').classList.remove('hidden');else $('breakFoulSheet').classList.remove('hidden');return;}
  manualCorrection(f==='scratch'?'scratch':'foul',{foulType:f});
});
$('closeIllegalBreak').onclick=()=>{pendingBreakFoul=null;$('illegalBreakSheet').classList.add('hidden')};
$('closeBreakFoul').onclick=()=>{pendingBreakFoul=null;$('breakFoulSheet').classList.add('hidden')};
document.querySelectorAll('[data-illegal-break]').forEach(b=>b.onclick=()=>{
  if(!pendingBreakFoul||!rules)return;const choice=b.dataset.illegalBreak,ctx=prepareBreakCorrection();$('illegalBreakSheet').classList.add('hidden');if(!ctx)return;
  const original=ctx.shooter,incoming=1-original;rules.applyIllegalBreakAccept();
  if(choice==='accept'){
    pendingBreakFoul=null;recordBreakChoice(ctx,`Illegal break · ${name(incoming)} accepts table`,{foulType:'illegal-break',breakOption:'accept'});workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);
  }else{
    pendingRackBreaker=choice==='incoming-rerack'?incoming:original;pendingBreakFoul=null;recordBreakChoice(ctx,`Illegal break · re-rack · ${name(pendingRackBreaker)} will break`,{foulType:'illegal-break',breakOption:choice});workerPaused=true;$('autoResult').textContent='RE-RACK';$('autoConfidence').textContent=`Rack all 15 balls + cue, then tap New Rack · ${name(pendingRackBreaker)} breaks`;setAppStatus('Waiting for re-rack');
  }
});
document.querySelectorAll('[data-break-foul-option]').forEach(b=>b.onclick=()=>{
  if(!pendingBreakFoul||!rules)return;const option=b.dataset.breakFoulOption,f=pendingBreakFoul.f,ctx=prepareBreakCorrection();$('breakFoulSheet').classList.add('hidden');if(!ctx)return;
  rules.applyBreakFoul(f,option);pendingBreakFoul=null;const incoming=rules.current;
  recordBreakChoice(ctx,`${f.replaceAll('-',' ')} on break · ${name(incoming)} ${option==='head-string'?'has cue-ball in hand above Head String':'accepts table'}`,{foulType:f,breakOption:option});
  if(option==='head-string')beginBallInHandWait(false);else{workerPaused=false;motionWorker?.postMessage({type:'reset'});setAppStatus('Watching table',true);}
});

$('eightBallBtn').onclick=()=>$('eightBallSheet').classList.remove('hidden');$('closeEightBall').onclick=()=>$('eightBallSheet').classList.add('hidden');document.querySelectorAll('[data-eight]').forEach(b=>b.onclick=()=>{
  if(!rules||!gameActive)return;$('eightBallSheet').classList.add('hidden');const o=b.dataset.eight;
  const isBreakOption=o.startsWith('break-'),ctx=isBreakOption?breakCorrectionContext():null;
  if(isBreakOption&&!ctx){alert('That option only applies to the break shot.');return;}
  if(!isBreakOption&&breakCorrectionContext()){alert('This was the break shot. Choose one of the 8-ball-on-break options instead.');return;}

  if(o==='break-rerack'){
    restoreBreakContext(ctx);rules.recordLegalEightBreak();pendingRackBreaker=ctx.shooter;workerPaused=true;addEvent('shot',ctx.shooter,'Legal 8-ball on break · re-rack · same breaker breaks again',{result:'8 ON BREAK',inference:'manual 8-ball ruling'});lastShotRecord=null;$('autoResult').textContent='RE-RACK';$('autoConfidence').textContent=`Rack all 15 balls + cue, then tap New Rack · ${name(pendingRackBreaker)} breaks`;setAppStatus('Waiting for re-rack');renderAll();saveSession(false);return;
  }
  if(o==='break-spot'){
    restoreBreakContext(ctx);rules.recordLegalEightBreak();workerPaused=true;addEvent('shot',ctx.shooter,'Legal 8-ball on break · spot 8 · breaker continues',{result:'8 ON BREAK',inference:'manual 8-ball ruling'});lastShotRecord=null;$('resumeAfterBIH').textContent='8-ball spotted · Resume';$('resumeAfterBIH').classList.remove('hidden');$('autoResult').textContent='SPOT 8-BALL';$('autoConfidence').textContent='Spot the 8-ball, then Resume to sync the physical table';setAppStatus('Waiting for 8-ball spot');renderAll();saveSession(false);return;
  }
  if(o==='break-foul-rerack'){
    restoreBreakContext(ctx);rules.applyBreakFoul('8-ball-break-foul','accept');pendingRackBreaker=rules.current;workerPaused=true;addEvent('shot',ctx.shooter,`8-ball pocketed on foul break · re-rack · ${name(pendingRackBreaker)} breaks`,{result:'8 + BREAK FOUL',foulType:'8-ball-break-foul',inference:'manual 8-ball ruling'});lastShotRecord=null;$('autoResult').textContent='RE-RACK';$('autoConfidence').textContent=`Rack all 15 balls + cue, then tap New Rack · ${name(pendingRackBreaker)} breaks`;setAppStatus('Waiting for re-rack');renderAll();saveSession(false);return;
  }
  if(o==='break-foul-spot'){
    restoreBreakContext(ctx);rules.applyBreakFoul('8-ball-break-foul','head-string');workerPaused=true;addEvent('shot',ctx.shooter,`8-ball pocketed on foul break · spot 8 · ${name(rules.current)} has cue-ball in hand above Head String`,{result:'8 + BREAK FOUL',foulType:'8-ball-break-foul',inference:'manual 8-ball ruling'});lastShotRecord=null;beginBallInHandWait(false);$('resumeAfterBIH').textContent='8 spotted + cue placed · Resume';$('autoResult').textContent='SPOT 8 + BALL IN HAND';$('autoConfidence').textContent='Spot the 8-ball and place cue ball above Head String, then Resume';setAppStatus('Waiting for placement');renderAll();saveSession(false);return;
  }

  const shooter=rules.current,beforeRules=rules.snapshot();const r=rules.applyShot({eightOutcome:o,objectPots:1});const ev=r.events?.[0];workerPaused=true;addEvent('rack',ev?.winner??(1-shooter),o==='legal'?`${name(shooter)} legally pockets 8-ball and wins rack`:`Illegal 8-ball (${o.replaceAll('-',' ')}) · ${name(1-shooter)} wins rack`);lastShotRecord={beforeRules,beforeBaselineCount:visionBaselineCount,beforeBaselineCue:visionBaselineCue,shooter,t:nowSec(),eventIndex:events.length-1,afterScan:lastScan};$('autoResult').textContent='RACK OVER';$('autoConfidence').textContent='Rack the balls, then tap New Rack';setAppStatus('Rack over');renderAll();saveSession(false);
});

$('p1SolidsBtn').onclick=()=>{if(!rules)return;rules.setGroups('solid');addEvent('state',rules.current,`${name(0)} = solids · ${name(1)} = stripes`);renderAll();saveSession(false)};
$('p1StripesBtn').onclick=()=>{if(!rules)return;rules.setGroups('stripe');addEvent('state',rules.current,`${name(0)} = stripes · ${name(1)} = solids`);renderAll();saveSession(false)};
$('resetGroupsBtn').onclick=()=>{if(!rules)return;rules.clearGroups();addEvent('state',rules.current,'Open table');renderAll();saveSession(false)};
$('p1RackBtn').onclick=()=>rackWin(0);$('p2RackBtn').onclick=()=>rackWin(1);function rackWin(i){if(!rules||rules.rackOver)return;rules.winRack(i,'manual rack result');workerPaused=true;pendingVisionShot=null;$('visionReview').classList.add('hidden');addEvent('rack',i,`${name(i)} wins rack`);$('autoResult').textContent='RACK OVER';$('autoConfidence').textContent='Rack the balls, then tap New Rack';setAppStatus('Rack over');renderAll();saveSession(false)}
$('newRackBtn').onclick=async()=>{
  if(!rules||!gameActive||analysisLock)return;if(rules.matchOver){alert('Match is already over. End Game and start a new match.');return;}analysisLock=true;workerPaused=true;setAppStatus('Scanning new rack…',true);let rackReady=false;
  try{
    const s=await vision.consensus($('video'),calibration,{expected:16,tune:false,samples:3});lastScan=s;
    if(!(s.count===16&&s.spread<=1&&s.cuePresent)){alert(`New rack is not ready: ${s.counts.join(' / ')} balls, cue ${s.cuePresent?'seen':'not seen'}. Finish racking/lighting, then tap New Rack again.`);$('autoResult').textContent='RACK NOT READY';$('autoConfidence').textContent='Need stable 16 balls + cue ball';setAppStatus('Finish racking');return;}
    const b=pendingRackBreaker!==null?pendingRackBreaker:1-rules.breaker;pendingRackBreaker=null;rules.startRack(b);visionBaselineCount=s.count;visionBaselineCue=s.cuePresent;visionBaselineScan=s;lastShotRecord=null;awaitingCuePlacement=false;$('resumeAfterBIH').classList.add('hidden');motionWorker?.postMessage({type:'reset'});addEvent('rack-start',b,`${name(b)} breaks new rack · baseline ${s.count}`);rackReady=true;await saveSession(false);renderAll();
  }catch(e){console.error(e);alert('New-rack scan failed: '+e.message);$('autoResult').textContent='RACK SCAN ERROR';}
  finally{analysisLock=false;workerPaused=!rackReady;if(rackReady)setAppStatus('Watching table',true);}
};

// ---------- Recording ----------
function bestMime(){for(const t of['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=h264,opus','video/webm'])if(window.MediaRecorder&&MediaRecorder.isTypeSupported(t))return t;return''}
function startRecordingLoop(){startOneRecorder()}
function startOneRecorder(){
  if(!gameActive||!stream)return;const mime=bestMime();let chunks=[];try{recorder=mime?new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2300000}):new MediaRecorder(stream)}catch{recorder=new MediaRecorder(stream)}
  recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};recorder.onstop=async()=>{if(!chunks.length)return;const blob=new Blob(chunks,{type:chunks[0]?.type||mime||'video/mp4'}),end=nowSec();await dbPut('videos',{id:`${sessionId}-v${videoChunkIndex}`,sessionId,index:videoChunkIndex,start:videoChunkStart,end,type:blob.type,createdAt:new Date().toISOString(),blob});videoChunkIndex++;videoChunkStart=end;updateStorage();renderRecordings()};recorder.start();clearTimeout(recordTimer);recordTimer=setTimeout(()=>{if(recorder?.state!=='inactive'){recorder.stop();setTimeout(()=>{if(gameActive)startOneRecorder()},300)}},90000);
}
function stopRecorder(){clearTimeout(recordTimer);return new Promise(res=>{if(recorder&&recorder.state!=='inactive'){recorder.addEventListener('stop',()=>res(),{once:true});recorder.stop()}else res()})}

// ---------- Render / persistence ----------
function addEvent(type,player,note,extra={}){events.push({id:Date.now()+Math.random(),t:nowSec(),type,player,note,...extra})}
function potRate(p){if(!rules)return 0;const s=rules.players[p],den=s.legalPots+s.misses+s.scratches;return den?Math.round(s.legalPots/den*100):0}
function renderGame(){
  if(!rules){$('currentPlayer').textContent='—';$('turnReason').textContent='Complete setup first';return}
  $('currentPlayer').textContent=name(rules.current);$('hudP1').classList.toggle('active',rules.current===0);$('hudP2').classList.toggle('active',rules.current===1);$('hudP1Score').textContent=rules.matchScore[0];$('hudP2Score').textContent=rules.matchScore[1];
  const bihText=rules.ballInHand?(rules.ballInHandArea==='head-string'?'BALL IN HAND · above Head String':'BALL IN HAND'):'';
  $('turnReason').textContent=rules.rackOver?'Rack over':awaitingCuePlacement?(rules.ballInHandArea==='head-string'?'BALL IN HAND · place cue ball above Head String':'BALL IN HAND · place cue ball'):bihText|| (rules.breakShot?'BREAK SHOT':safetyArmed?'SAFETY DECLARED':'System knows the shooter from turn state');
  $('openTable').textContent=rules.openTable?'OPEN':'CLOSED';$('p1Group').textContent=rules.players[0].group?.toUpperCase()||'—';$('p2Group').textContent=rules.players[1].group?.toUpperCase()||'—';$('ballInHand').textContent=rules.ballInHand?'YES':'NO';
}
function renderMetrics(){const p0=rules?.players[0],p1=rules?.players[1],m=[['Shots',(p0?.shots||0)+(p1?.shots||0)],['P1 pots',p0?.legalPots||0],['P2 pots',p1?.legalPots||0],['P1 pot %',potRate(0)+'%'],['P2 pot %',potRate(1)+'%'],['Scratches',(p0?.scratches||0)+(p1?.scratches||0)],['P1 long run',p0?.longestRun||0],['P2 long run',p1?.longestRun||0]];$('metrics').innerHTML=m.map(([a,b])=>`<div class="metric"><b>${b}</b><span>${a}</span></div>`).join('')}
function renderTimeline(){const x=$('timeline'),shots=events.filter(e=>e.type==='shot');$('timelineCount').textContent=`${shots.length} shots`;if(!events.length){x.className='empty';x.textContent='No game events yet.';return}x.className='';x.innerHTML=events.slice().reverse().map(e=>`<div class="timeline-event"><span class="time">${fmt(e.t)}</span><div><b>${e.player!==undefined?esc(name(e.player))+' · ':''}${esc(e.type.replaceAll('-',' ').toUpperCase())}</b><small>${esc(e.note)}</small></div><span>${e.type==='highlight'?'★':e.type==='rack'?'🏆':e.type==='shot'?'●':'·'}</span></div>`).join('')}
async function renderRecordings(){objectUrls.forEach(URL.revokeObjectURL);objectUrls=[];const v=(await dbAll('videos')).filter(x=>!sessionId||x.sessionId===sessionId).sort((a,b)=>a.index-b.index),box=$('recordings');if(!v.length){box.className='empty';box.textContent='No recordings yet.';return}box.className='';box.innerHTML='';for(const r of v){const u=URL.createObjectURL(r.blob);objectUrls.push(u);const ext=(r.type||'').includes('webm')?'webm':'mp4',d=document.createElement('div');d.className='recording';d.innerHTML=`<span>${fmt(r.start)}</span><div><b>Video segment ${r.index+1}</b><small>${(r.blob.size/1048576).toFixed(1)} MB · ${fmt(r.end-r.start)}</small></div><a class="download" href="${u}" download="${r.id}.${ext}">Save</a>`;box.appendChild(d)}}
async function renderHistory(){const ss=(await dbAll('sessions')).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,20),x=$('history');if(!ss.length){x.className='empty';x.textContent='No saved games yet.';return}x.className='';x.innerHTML=ss.map(s=>`<div class="history-row"><span>🎱</span><div><b>${esc(s.p1)} vs ${esc(s.p2)}</b><small>${fmt(s.duration)} · ${s.events?.filter(e=>e.type==='shot').length||0} shots · ${s.score?.join('–')||'0–0'}</small></div><span>${new Date(s.startedAt).toLocaleDateString()}</span></div>`).join('')}
function renderAll(){renderGame();renderMetrics();renderTimeline();renderRecordings();renderHistory();if(lastScan){$('ballsHud').textContent=`Balls ${lastScan.count}`;$('cueHud').textContent=`Cue ${lastScan.cuePresent?'YES':'NO'}`}}
async function saveSession(ended){if(!sessionId)return;await dbPut('sessions',{id:sessionId,p1:name(0),p2:name(1),startedAt:new Date(Date.now()-nowSec()*1000).toISOString(),endedAt:ended?new Date().toISOString():null,duration:nowSec(),score:rules?.matchScore||[0,0],rules:rules?.snapshot(),calibration,detectorParams:vision?.params,events})}
async function updateStorage(){if(navigator.storage?.estimate){const e=await navigator.storage.estimate();$('storageHud').textContent=`Storage ${(e.usage/1048576).toFixed(0)}MB / ${(e.quota/1073741824).toFixed(1)}GB`}}
$('exportBtn').onclick=async()=>{const ss=await dbAll('sessions'),s=ss.find(x=>x.id===sessionId)||ss[ss.length-1];if(!s)return alert('No session');const b=new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=s.id+'.json';a.click()};
$('emailBtn').onclick=()=>{if(!rules)return alert('No game yet');const a=rules.players[0],b=rules.players[1],body=`PoolCam summary\n\n${name(0)} ${rules.matchScore[0]} - ${rules.matchScore[1]} ${name(1)}\nDuration: ${fmt(nowSec())}\n\n${name(0)}: ${a.shots} shots, ${a.legalPots} pots, ${a.misses} misses, ${a.scratches} scratches, ${potRate(0)}% pot rate, longest run ${a.longestRun}\n${name(1)}: ${b.shots} shots, ${b.legalPots} pots, ${b.misses} misses, ${b.scratches} scratches, ${potRate(1)}% pot rate, longest run ${b.longestRun}`;location.href=`mailto:?subject=${encodeURIComponent('🎱 PoolCam Game Summary')}&body=${encodeURIComponent(body)}`};
$('clearBtn').onclick=async()=>{if(!confirm('Delete all locally saved PoolCam games and videos?'))return;await dbClear('sessions');await dbClear('videos');renderAll();updateStorage()};

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);navigator.storage?.persist?.().catch(()=>{});updateStorage();renderAll();
