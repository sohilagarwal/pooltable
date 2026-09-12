let cfg={sensitivity:5,table:null};
let prev=null,moving=false,stable=0,peak=0,peakPocket=0,lastEnd=-99;
function inside(x,y,p){if(!p)return true;let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a.y>y)!=(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))c=!c;}return c;}
function pocketZones(poly){if(!poly||poly.length!==4)return[];const [a,b,c,d]=poly,mid=(p,q)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2}),len=(p,q)=>Math.hypot(q.x-p.x,q.y-p.y);const sides=[{p:a,q:b},{p:b,q:c},{p:c,q:d},{p:d,q:a}].sort((u,v)=>len(v.p,v.q)-len(u.p,u.q));return [a,b,c,d,mid(sides[0].p,sides[0].q),mid(sides[1].p,sides[1].q)].map(x=>({...x,r:.06}));}
onmessage=e=>{
 const m=e.data;if(m.type==='config'){cfg={...cfg,...m};prev=null;moving=false;stable=0;peak=0;peakPocket=0;return}if(m.type==='reset'){prev=null;moving=false;stable=0;peak=0;peakPocket=0;return}if(m.type!=='frame')return;
 const {gray,w,h,t}=m;if(!prev){prev=gray;return}
 const zones=pocketZones(cfg.table);let changed=0,total=0,pocket=0;const pixThreshold=14+(10-cfg.sensitivity)*1.6;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(cfg.table&&!inside(x/w,y/h,cfg.table))continue;const i=y*w+x,d=Math.abs(gray[i]-prev[i]);total++;if(d>pixThreshold){changed++;for(const z of zones){const dx=x/w-z.x,dy=y/h-z.y;if(dx*dx+dy*dy<z.r*z.r){pocket++;break}}}}
 prev=gray;const ratio=total?changed/total:0,pr=total?pocket/total:0;const startThreshold=.0075+(10-cfg.sensitivity)*.0018;const strongThreshold=startThreshold*1.6;
 if(!moving&&ratio>startThreshold&&t-lastEnd>1.3){moving=true;stable=0;peak=ratio;peakPocket=pr;postMessage({type:'shotStart',t,ratio});}
 else if(moving){peak=Math.max(peak,ratio);peakPocket=Math.max(peakPocket,pr);if(ratio<startThreshold*.62)stable++;else stable=0;if(stable>=4){const valid=peak>=strongThreshold;moving=false;stable=0;lastEnd=t;if(valid)postMessage({type:'shotEnd',t,peak,peakPocket});else postMessage({type:'falseMotion',t,peak});peak=0;peakPocket=0;}}
 postMessage({type:'motion',t,moving,ratio,peak,peakPocket:pr});
};
