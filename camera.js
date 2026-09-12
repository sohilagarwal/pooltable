(function(root){
  'use strict';
  let stream=null,busy=false;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});

  async function requestCamera(){
    if(!root.isSecureContext)throw new Error('Camera requires HTTPS. Open the GitHub Pages https:// address in Safari.');
    if(!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!=='function')throw new Error('Safari camera API is unavailable. Open this page directly in Safari and check Camera permission.');
    const attempts=[
      {video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false},
      {video:{facingMode:{ideal:'environment'}},audio:false},
      {video:true,audio:false}
    ];
    let last=null;
    for(const c of attempts){
      try{return await navigator.mediaDevices.getUserMedia(c)}catch(e){last=e;console.warn('PoolCam camera attempt failed',e)}
    }
    throw last||new Error('No camera stream available');
  }

  async function attach(media){
    const v=$('video');
    if(!v)throw new Error('Video element is missing');
    v.muted=true;v.autoplay=true;v.setAttribute('playsinline','');v.srcObject=media;
    if(v.readyState<1){
      await new Promise(function(resolve){
        let done=false;
        function finish(){if(done)return;done=true;v.removeEventListener('loadedmetadata',finish);resolve()}
        v.addEventListener('loadedmetadata',finish,{once:true});setTimeout(finish,3500);
      });
    }
    try{await v.play()}catch(e){console.warn('PoolCam video.play()',e)}
    if(!v.videoWidth||!v.videoHeight)await new Promise(r=>setTimeout(r,650));
    if(!v.videoWidth||!v.videoHeight)throw new Error('Safari granted the camera but no video frames arrived. Check iPad Settings → Safari → Camera.');
  }

  async function start(){
    if(busy)return;busy=true;
    const btn=$('startCameraBtn'),status=$('appStatus');
    if(btn){btn.disabled=true;btn.textContent='Opening Camera…'}
    if(status){status.textContent='Opening camera…';status.className='chip live'}
    try{
      if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
      stream=await requestCamera();await attach(stream);
      $('emptyCamera')?.classList.add('hidden');
      if(btn){btn.disabled=true;btn.textContent='Camera On'}
      if(status){status.textContent='Camera ready';status.className='chip live'}
      const warn=$('setupWarning');if(warn)warn.innerHTML='Camera is live. Next: <b>Calibrate Table</b>.';
      root.dispatchEvent(new CustomEvent('poolcam-camera-ready',{detail:{stream:stream,width:$('video').videoWidth,height:$('video').videoHeight}}));
    }catch(e){
      console.error('PoolCam camera startup failed',e);
      if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
      if(btn){btn.disabled=false;btn.textContent='1. Start Camera'}
      if(status){status.textContent='Camera failed';status.className='chip'}
      const msg=(e&&e.name?e.name+': ':'')+(e&&e.message?e.message:String(e));
      const warn=$('setupWarning');if(warn)warn.innerHTML='<b>Camera did not start.</b> '+esc(msg)+'<br><br>Open this GitHub Pages address directly in Safari using HTTPS. Then check iPad Settings → Safari → Camera and allow access.';
      alert('Camera did not start. '+msg);
      root.dispatchEvent(new CustomEvent('poolcam-camera-error',{detail:{message:msg}}));
    }finally{busy=false}
  }

  const btn=$('startCameraBtn');if(btn)btn.addEventListener('click',start);
  root.PoolCamCamera={start:start,getStream:()=>stream,stop:()=>{if(stream)stream.getTracks().forEach(t=>t.stop());stream=null}};
})(window);
