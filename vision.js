(function(root){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  class PoolVision {
    constructor(sourceCanvas,debugCanvas){
      this.sourceCanvas=sourceCanvas;this.debugCanvas=debugCanvas;this.cv=null;
      this.width=640;this.height=320;
      this.params={
        param1:Number(localStorage.getItem('poolcam-hough-p1')||60),
        param2:Number(localStorage.getItem('poolcam-hough-p2')||7),
        dp:1.1,minRadius:5,maxRadius:13,minDist:11
      };
      this.cueModel=null;
      this.ready=false;
    }
    async init(timeout=35000){
      const start=Date.now();
      while(!root.cv && Date.now()-start<timeout)await sleep(100);
      if(!root.cv)throw new Error('OpenCV did not load');
      let c=root.cv;if(c&&typeof c.then==='function')c=await c;
      while(!c.Mat && Date.now()-start<timeout)await sleep(100);
      if(!c.Mat||typeof c.HoughCircles!=='function')throw new Error('OpenCV circle detector is unavailable');
      this.cv=c;this.ready=true;return true;
    }
    drawVideo(video){
      const vw=video.videoWidth||1920,vh=video.videoHeight||1080,maxW=960;
      this.sourceCanvas.width=maxW;this.sourceCanvas.height=Math.max(1,Math.round(maxW*vh/vw));
      this.sourceCanvas.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,this.sourceCanvas.width,this.sourceCanvas.height);
    }
    warp(video,cal){
      if(!this.ready||!cal||cal.length!==4)throw new Error('Vision or table calibration not ready');
      const cv=this.cv;this.drawVideo(video);
      const src=cv.imread(this.sourceCanvas),dst=new cv.Mat();
      const sw=this.sourceCanvas.width,sh=this.sourceCanvas.height;
      const s=cv.matFromArray(4,1,cv.CV_32FC2,[cal[0].x*sw,cal[0].y*sh,cal[1].x*sw,cal[1].y*sh,cal[2].x*sw,cal[2].y*sh,cal[3].x*sw,cal[3].y*sh]);
      const d=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,this.width-1,0,this.width-1,this.height-1,0,this.height-1]);
      const M=cv.getPerspectiveTransform(s,d);
      cv.warpPerspective(src,dst,M,new cv.Size(this.width,this.height),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar());
      src.delete();s.delete();d.delete();M.delete();
      return dst;
    }
    estimateFelt(imageData){
      const d=imageData.data,w=imageData.width,h=imageData.height,bins=new Map();
      for(let y=Math.floor(h*.06);y<h*.94;y+=4)for(let x=Math.floor(w*.06);x<w*.94;x+=4){
        const i=(y*w+x)*4,r=d[i],g=d[i+1],b=d[i+2],lum=(r+g+b)/3;if(lum<20||lum>238)continue;
        const key=((r>>5)<<6)|((g>>5)<<3)|(b>>5);bins.set(key,(bins.get(key)||0)+1);
      }
      let best=-1,key=0;for(const [k,v] of bins){if(v>best){best=v;key=k}}
      return {r:(((key>>6)&7)<<5)+16,g:(((key>>3)&7)<<5)+16,b:((key&7)<<5)+16};
    }
    circleStats(imageData,c,felt){
      const d=imageData.data,w=imageData.width,h=imageData.height,r=Math.max(3,c.r*.82),r2=r*r;
      let n=0,white=0,dark=0,sumLum=0,sumLum2=0,sumDist=0,sumSat=0;
      const x0=Math.max(0,Math.floor(c.x-r)),x1=Math.min(w-1,Math.ceil(c.x+r)),y0=Math.max(0,Math.floor(c.y-r)),y1=Math.min(h-1,Math.ceil(c.y+r));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const dx=x-c.x,dy=y-c.y;if(dx*dx+dy*dy>r2)continue;
        const i=(y*w+x)*4,R=d[i],G=d[i+1],B=d[i+2],mx=Math.max(R,G,B),mn=Math.min(R,G,B),sat=mx?((mx-mn)/mx):0,lum=.299*R+.587*G+.114*B,dist=Math.hypot(R-felt.r,G-felt.g,B-felt.b);
        n++;sumLum+=lum;sumLum2+=lum*lum;sumDist+=dist;sumSat+=sat;if(lum>168&&sat<.28)white++;if(lum<70)dark++;
      }
      const mean=n?sumLum/n:0,variance=n?Math.max(0,sumLum2/n-mean*mean):0,satMean=n?sumSat/n:1,whiteFraction=n?white/n:0;
      const uniformity=1-clamp(variance/3200,0,1);
      const cueScore=clamp(.40*whiteFraction+.25*(mean/255)+.18*(1-satMean)+.17*uniformity,0,1);
      return {whiteFraction,darkFraction:n?dark/n:0,meanLum:mean,variance,contrast:n?sumDist/n:0,satMean,uniformity,cueScore};
    }
    cueModelScore(b){
      if(!this.cueModel)return b.cueScore||0;
      const m=this.cueModel;
      const white=1-clamp(Math.abs((b.whiteFraction||0)-m.whiteFraction)/.55,0,1);
      const sat=1-clamp(Math.abs((b.satMean||0)-m.satMean)/.45,0,1);
      const lum=1-clamp(Math.abs((b.meanLum||0)-m.meanLum)/120,0,1);
      const uni=1-clamp(Math.abs((b.uniformity||0)-m.uniformity)/.65,0,1);
      return clamp(.38*white+.27*sat+.20*lum+.15*uni,0,1);
    }
    isolatedCueCandidate(balls){
      if(!balls||balls.length<10)return null;
      const scored=balls.map((b,i)=>{let nearest=1e9;for(let j=0;j<balls.length;j++){if(i===j)continue;nearest=Math.min(nearest,Math.hypot(b.x-balls[j].x,b.y-balls[j].y));}return {b,nearest};}).sort((a,b)=>b.nearest-a.nearest);
      const rest=scored.slice(1).map(x=>x.nearest).sort((a,b)=>a-b),med=rest.length?rest[Math.floor(rest.length/2)]:0;
      return med>0&&scored[0].nearest/med>2.2?scored[0].b:null;
    }
    learnCueFromRack(result){
      if(!result||result.count!==16)return false;
      const b=this.isolatedCueCandidate(result.balls);if(!b)return false;
      this.cueModel={whiteFraction:b.whiteFraction||0,meanLum:b.meanLum||0,satMean:b.satMean||0,uniformity:b.uniformity||0};
      result.cue=b;result.cuePresent=true;return true;
    }
    chooseCue(balls){
      if(!balls?.length)return null;
      let best=null,bestScore=0;
      for(const b of balls){const score=this.cueModelScore(b);if(score>bestScore){bestScore=score;best=b;}}
      const threshold=this.cueModel?.whiteFraction>.35?.70:.72;
      return best&&bestScore>=threshold?{...best,cueModelScore:bestScore}:null;
    }
    detectWithParams(warped,params){
      const cv=this.cv,gray=new cv.Mat(),circles=new cv.Mat();
      cv.cvtColor(warped,gray,cv.COLOR_RGBA2GRAY);cv.medianBlur(gray,gray,5);
      cv.HoughCircles(gray,circles,cv.HOUGH_GRADIENT,params.dp??this.params.dp,params.minDist??this.params.minDist,params.param1,params.param2,params.minRadius??this.params.minRadius,params.maxRadius??this.params.maxRadius);
      cv.imshow(this.debugCanvas,warped);
      const ctx=this.debugCanvas.getContext('2d',{willReadFrequently:true}),img=ctx.getImageData(0,0,this.width,this.height),felt=this.estimateFelt(img),found=[];
      const arr=circles.data32F||[];
      for(let i=0;i+2<arr.length;i+=3){
        const c={x:arr[i],y:arr[i+1],r:arr[i+2]};
        if(c.x<c.r*.75||c.y<c.r*.75||c.x>this.width-c.r*.75||c.y>this.height-c.r*.75)continue;
        const s=this.circleStats(img,c,felt);
        // Reject smooth felt/lighting circles but retain dark/striped balls.
        if(s.contrast<14 && s.variance<110)continue;
        found.push({...c,...s});
      }
      found.sort((a,b)=>(b.contrast+b.variance*.015)-(a.contrast+a.variance*.015));
      const balls=found.slice(0,20);
      let cue=this.chooseCue(balls);
      const rs=balls.map(x=>x.r),rm=rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:0,rv=rs.length?Math.sqrt(rs.reduce((a,b)=>a+(b-rm)**2,0)/rs.length):99;
      gray.delete();circles.delete();
      return {count:balls.length,cuePresent:!!cue,cue:cue?{x:cue.x,y:cue.y,r:cue.r,cueScore:cue.cueScore}:null,balls,felt,param1:params.param1,param2:params.param2,radiusMean:rm,radiusStd:rv};
    }
    drawResult(warped,result){
      const cv=this.cv;cv.imshow(this.debugCanvas,warped);const ctx=this.debugCanvas.getContext('2d');
      ctx.lineWidth=2;ctx.font='12px -apple-system, sans-serif';
      for(let i=0;i<result.balls.length;i++){
        const b=result.balls[i],isCue=result.cue&&Math.hypot(result.cue.x-b.x,result.cue.y-b.y)<3;
        ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.strokeStyle=isCue?'#ffffff':'#55e68c';ctx.stroke();ctx.fillStyle='#ffffff';ctx.fillText(String(i+1),b.x+b.r+2,b.y-2);
      }
      ctx.fillStyle='rgba(0,0,0,.74)';ctx.fillRect(8,8,225,45);ctx.fillStyle='#fff';ctx.font='bold 15px -apple-system, sans-serif';ctx.fillText(`${result.count} balls · cue ${result.cuePresent?'YES':'NO'}`,16,27);ctx.font='11px -apple-system, sans-serif';ctx.fillText(`Hough p1 ${result.param1} · p2 ${result.param2}`,16,44);
    }
    async scan(video,cal,{expected=null,tune=false,draw=true}={}){
      if(tune)this.cueModel=null;
      const warped=this.warp(video,cal);let best=null;
      if(tune){
        // Tested across clustered and scattered synthetic pool-ball scenes. Lower Canny/accumulator thresholds are needed for dark/striped balls.
        const candidates=[
          {param1:60,param2:7},{param1:40,param2:7},{param1:80,param2:6},{param1:60,param2:6},
          {param1:80,param2:7},{param1:100,param2:6},{param1:40,param2:6},{param1:100,param2:5},
          {param1:50,param2:8},{param1:70,param2:8},{param1:40,param2:8},{param1:90,param2:7},
          {param1:60,param2:9},{param1:80,param2:8}
        ];
        const target=expected??16;
        for(const p of candidates){
          const params={...this.params,...p},r=this.detectWithParams(warped,params);
          const radiusPenalty=r.radiusMean?Math.min(6,(r.radiusStd/Math.max(1,r.radiusMean))*8):6;
          const isolated=this.isolatedCueCandidate(r.balls),cueLikely=r.cuePresent||!!isolated;
          const cuePenalty=cueLikely?0:2.5,overPenalty=r.count>18?(r.count-18)*4:0,underPenalty=r.count<12?(12-r.count)*2:0;
          const score=Math.abs(r.count-target)*6+radiusPenalty+cuePenalty+overPenalty+underPenalty;
          if(!best||score<best.score)best={...r,score};
          if(r.count===target&&cueLikely&&radiusPenalty<1.7){best={...r,score:-1};break;}
          await sleep(15);
        }
        this.params={...this.params,param1:best.param1,param2:best.param2};
        if(best.count===16)this.learnCueFromRack(best);
        localStorage.setItem('poolcam-hough-p1',String(best.param1));localStorage.setItem('poolcam-hough-p2',String(best.param2));
      }else best=this.detectWithParams(warped,this.params);
      if(draw)this.drawResult(warped,best);warped.delete();return best;
    }
    stableClusters(results){
      const clusters=[];
      for(let si=0;si<results.length;si++)for(const b of results[si].balls){
        let best=null,bestD=1e9;
        for(const c of clusters){
          if(c.samples.has(si))continue;
          const d=Math.hypot(c.x-b.x,c.y-b.y),limit=Math.max(5,Math.min(9,(c.r+b.r)*.48));
          if(d<limit&&d<bestD){best=c;bestD=d;}
        }
        if(!best){best={x:b.x,y:b.y,r:b.r,n:0,samples:new Set(),cueScore:0,contrast:0,whiteFraction:0,meanLum:0,satMean:0,uniformity:0};clusters.push(best);}
        best.n++;best.samples.add(si);best.x+=(b.x-best.x)/best.n;best.y+=(b.y-best.y)/best.n;best.r+=(b.r-best.r)/best.n;best.cueScore+=(b.cueScore||0);best.contrast+=(b.contrast||0);best.whiteFraction+=(b.whiteFraction||0);best.meanLum+=(b.meanLum||0);best.satMean+=(b.satMean||0);best.uniformity+=(b.uniformity||0);
      }
      const need=Math.ceil(results.length*.6);
      return clusters.filter(c=>c.samples.size>=need).map(c=>({x:c.x,y:c.y,r:c.r,cueScore:c.cueScore/c.n,contrast:c.contrast/c.n,whiteFraction:c.whiteFraction/c.n,meanLum:c.meanLum/c.n,satMean:c.satMean/c.n,uniformity:c.uniformity/c.n,hits:c.samples.size}));
    }
    async consensus(video,cal,{expected=null,tune=false,samples=3}={}){
      const results=[];
      for(let i=0;i<samples;i++){
        results.push(await this.scan(video,cal,{expected,tune:tune&&i===0,draw:i===samples-1}));
        if(i<samples-1)await sleep(220);
      }
      const counts=results.map(r=>r.count),med=median(counts),spread=Math.max(...counts)-Math.min(...counts),clusters=this.stableClusters(results);
      const stableCount=clusters.length;
      // Prefer position-consistent circles when close to count consensus; otherwise use the count median.
      const count=Math.abs(stableCount-med)<=2&&stableCount>0?stableCount:med;
      const cueCluster=clusters.map(c=>({...c,modelScore:this.cueModel?this.cueModelScore(c):(c.cueScore||0)})).filter(c=>c.modelScore>=(this.cueModel?.whiteFraction>.35?.70:.72)).sort((a,b)=>b.modelScore-a.modelScore)[0]||null;
      const cueVotes=results.filter(r=>r.cuePresent).length,cuePresent=!!cueCluster||cueVotes>=Math.ceil(results.length*.6);
      const chosen=results.reduce((a,b)=>Math.abs(b.count-count)<Math.abs(a.count-count)?b:a,results[0]);
      const stability=Math.max(0,1-spread*.20),clusterAgreement=med?Math.max(0,1-Math.abs(count-med)/Math.max(1,med)):0;
      const confidence=clamp(.48+.28*stability+.18*clusterAgreement+(cuePresent?.05:0),.25,.99);
      const balls=clusters.length?clusters:chosen.balls;
      return {...chosen,count,cuePresent,cue:cueCluster?{x:cueCluster.x,y:cueCluster.y,r:cueCluster.r,cueScore:cueCluster.cueScore}:chosen.cue,balls,counts,spread,stableCount,stability,confidence};
    }
  }
  root.PoolVision=PoolVision;
})(window);
