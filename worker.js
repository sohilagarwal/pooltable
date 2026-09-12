let last=null, motion=false, peak=0, pocketPeak=0, stable=0, sensitivity=5, tableMask=null, pocketZones=[];

function resetDetector(){
  last=null; motion=false; peak=0; pocketPeak=0; stable=0;
}

function insidePoly(x,y,poly){
  let c=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if(((a.y>y)!=(b.y>y)) && (x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)) c=!c;
  }
  return c;
}

onmessage=e=>{
  const m=e.data;
  if(m.type==="config"){
    sensitivity=Number(m.sensitivity)||5;
    tableMask=m.table||null;
    pocketZones=m.pockets||[];
    resetDetector();
    return;
  }
  if(m.type==="reset"){
    resetDetector();
    return;
  }
  if(m.type!=="frame") return;

  const {gray,w,h,t}=m;
  const threshold=14+(10-sensitivity)*1.4;
  const ratioThreshold=0.012+(10-sensitivity)*0.0023;
  if(!last){last=gray;return;}

  let changed=0,total=0,pocketHits=0;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const nx=x/w, ny=y/h;
      if(tableMask && !insidePoly(nx,ny,tableMask)) continue;
      const i=y*w+x; total++;
      const d=Math.abs(gray[i]-last[i]);
      if(d>threshold){
        changed++;
        for(const p of pocketZones){
          const dx=nx-p.x,dy=ny-p.y;
          if(dx*dx+dy*dy < p.r*p.r){pocketHits++;break;}
        }
      }
    }
  }

  const ratio=total?changed/total:0;
  const pocketRatio=total?pocketHits/total:0;
  let shot=false, shotPeak=0, shotPocketPeak=0;

  if(ratio>ratioThreshold){
    motion=true;
    peak=Math.max(peak,ratio);
    pocketPeak=Math.max(pocketPeak,pocketRatio);
    stable=0;
  }else if(motion){
    stable++;
    if(stable>=2){
      shot=true;
      shotPeak=peak;
      shotPocketPeak=pocketPeak;
      motion=false; stable=0; peak=0; pocketPeak=0;
    }
  }

  postMessage({type:"metrics",ratio,pocketRatio,shot,peak:shot?shotPeak:peak,pocketPeak:shot?shotPocketPeak:pocketPeak,t});
  last=gray;
};
