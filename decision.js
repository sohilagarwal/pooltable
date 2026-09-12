(function(root){
  function compareTableStates(beforeBalls=[],afterBalls=[]){
    if(!Array.isArray(beforeBalls)||!Array.isArray(afterBalls)||!beforeBalls.length||!afterBalls.length){
      return {usable:false,significant:true,movedCount:0,maxDistance:0,medianDistance:0,distances:[]};
    }
    const distances=[];
    for(const b of beforeBalls){
      let nearest=Infinity;
      for(const a of afterBalls)nearest=Math.min(nearest,Math.hypot((b.x||0)-(a.x||0),(b.y||0)-(a.y||0)));
      if(Number.isFinite(nearest))distances.push(nearest);
    }
    const sorted=[...distances].sort((a,b)=>a-b),medianDistance=sorted.length?sorted[Math.floor(sorted.length/2)]:0;
    const movedCount=distances.filter(d=>d>5).length,maxDistance=distances.length?Math.max(...distances):0;
    // Hough-center jitter on a stationary table is normally only a few pixels. A real shot should move
    // at least one detected ball materially, or several detected centers beyond jitter range.
    const significant=maxDistance>8 || movedCount>=2 || medianDistance>3.5;
    return {usable:true,significant,movedCount,maxDistance,medianDistance,distances};
  }

  function inferShot({breakShot=false,beforeCount,afterCount,beforeCue=true,afterCue=true,spread=0,peakPocket=0,safety=false,positionChange=null}={}){
    const rawDelta=Number(beforeCount)-Number(afterCount);
    const cueGone=!!beforeCue&&!afterCue;
    const pocketThreshold=breakShot?.0022:.00125;
    const pocketStrong=Number(peakPocket||0)>pocketThreshold;
    const objectDrop=Math.max(0,rawDelta-(cueGone?1:0));
    let objectPots=objectDrop>0?1:0;
    let suggested='miss',ambiguous=false,reason='',noShot=false;

    if(positionChange?.usable && !positionChange.significant && !cueGone){
      noShot=true;suggested='none';objectPots=0;reason='Camera motion ended, but the detected balls did not materially move.';
    } else if(safety){suggested='safety';}
    else if(cueGone){
      suggested='scratch';
      ambiguous=!(pocketStrong&&spread<=1);
      reason=ambiguous?'Cue-ball candidate disappeared, but pocket evidence/stability is weak.':'';
    } else if(breakShot){
      // Rack-to-scatter geometry can change Hough count without a pot; require pocket evidence on the break.
      if(pocketStrong&&rawDelta>0){suggested='pot';objectPots=1;ambiguous=spread>1;}
      else if(!pocketStrong){suggested='miss';objectPots=0;ambiguous=spread>1;reason=ambiguous?'Dry-break scan is unstable.':'';}
      else{suggested='pot';objectPots=1;ambiguous=true;reason='Pocket-area movement was strong, but the ball count did not confirm a disappearance.';}
    } else if(rawDelta>0&&pocketStrong){
      suggested='pot';objectPots=1;ambiguous=spread>1;reason=ambiguous?'Possible pot, but the ball scans varied.':'';
    } else if(rawDelta>0&&!pocketStrong){
      suggested='pot';objectPots=1;ambiguous=true;reason='Ball count fell, but no convincing pocket event was seen.';
    } else if(rawDelta===0&&pocketStrong){
      suggested='pot';objectPots=1;ambiguous=true;reason='Strong pocket activity occurred but the circle count did not drop.';
    } else if(rawDelta<0||spread>1){
      suggested='miss';ambiguous=true;reason='Detector count is unstable.';
    }
    return {rawDelta,cueGone,pocketThreshold,pocketStrong,objectDrop,objectPots,suggested,ambiguous,reason,noShot,positionChange};
  }
  root.PoolDecision={inferShot,compareTableStates};
  if(typeof module!=='undefined'&&module.exports)module.exports={inferShot,compareTableStates};
})(typeof window!=='undefined'?window:globalThis);
