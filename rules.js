(function(root){
  const other=i=>i===0?1:0;
  const clone=o=>JSON.parse(JSON.stringify(o));

  class EightBallGame {
    constructor(opts={}){
      this.players=[this.makePlayer(opts.p1||'Player 1'),this.makePlayer(opts.p2||'Player 2')];
      this.raceTo=Number(opts.raceTo||5);
      this.matchScore=[0,0];
      this.startRack(Number(opts.breaker||0));
    }
    makePlayer(name){return {name,group:null,remaining:7,shots:0,legalPots:0,misses:0,scratches:0,fouls:0,safeties:0,innings:0,currentRun:0,longestRun:0,objectBallsDown:0};}
    snapshot(){return clone({players:this.players,raceTo:this.raceTo,matchScore:this.matchScore,breaker:this.breaker,current:this.current,openTable:this.openTable,ballInHand:this.ballInHand,ballInHandArea:this.ballInHandArea,breakShot:this.breakShot,rackOver:this.rackOver,rackWinner:this.rackWinner,matchOver:this.matchOver});}
    restore(s){Object.assign(this,clone(s));}
    startRack(breaker=0){
      this.breaker=breaker;this.current=breaker;this.openTable=true;this.ballInHand=false;this.ballInHandArea=null;this.breakShot=true;this.rackOver=false;this.rackWinner=null;this.matchOver=this.matchScore.some(x=>x>=this.raceTo);
      this.players.forEach(p=>{p.group=null;p.remaining=7;p.currentRun=0;});
    }
    setGroups(p1Group){
      if(!['solid','stripe'].includes(p1Group))return;
      this.players[0].group=p1Group;this.players[1].group=p1Group==='solid'?'stripe':'solid';this.openTable=false;
    }
    clearGroups(){this.players[0].group=null;this.players[1].group=null;this.players[0].remaining=7;this.players[1].remaining=7;this.openTable=true;}
    switchPlayer(){this.players[this.current].currentRun=0;this.current=other(this.current);this.players[this.current].innings++;this.ballInHand=false;this.ballInHandArea=null;}
    winRack(winner,reason='rack won'){
      this.rackOver=true;this.rackWinner=winner;this.matchScore[winner]++;
      this.players[0].currentRun=0;this.players[1].currentRun=0;
      if(this.matchScore[winner]>=this.raceTo)this.matchOver=true;
      return {winner,reason,matchOver:this.matchOver};
    }
    recordLegalEightBreak(){
      if(!this.breakShot||this.rackOver)return {error:'not-break'};
      const shooter=this.current,p=this.players[shooter];p.shots++;p.currentRun=0;this.breakShot=false;this.ballInHand=false;this.ballInHandArea=null;
      return {shooter,events:[{type:'eight-on-break',current:this.current}]};
    }
    applyBreakFoul(foulType='break-foul',option='head-string'){
      if(!this.breakShot||this.rackOver)return {error:'not-break'};
      const shooter=this.current,opp=other(shooter),p=this.players[shooter];
      p.shots++;p.fouls++;if(foulType==='scratch')p.scratches++;p.currentRun=0;
      this.breakShot=false;this.current=opp;this.players[opp].innings++;
      this.ballInHand=option==='head-string';this.ballInHandArea=this.ballInHand?'head-string':null;
      return {shooter,events:[{type:'break-foul',foulType,option,current:this.current,ballInHand:this.ballInHand,ballInHandArea:this.ballInHandArea}]};
    }
    applyIllegalBreakAccept(){
      if(!this.breakShot||this.rackOver)return {error:'not-break'};
      const shooter=this.current,opp=other(shooter),p=this.players[shooter];p.shots++;p.fouls++;p.currentRun=0;
      this.breakShot=false;this.current=opp;this.players[opp].innings++;this.ballInHand=false;this.ballInHandArea=null;
      return {shooter,events:[{type:'illegal-break-accepted',current:this.current}]};
    }
    applyShot(shot={}){
      if(this.rackOver)return {error:'rack-over'};
      const shooter=this.current,opp=other(shooter),p=this.players[shooter];
      const objectPots=Math.max(0,Number(shot.objectPots||0));
      const scratch=!!shot.scratch;
      const foulType=shot.foulType||null;
      const safety=!!shot.safety;
      const first=this.breakShot;
      p.shots++;
      p.objectBallsDown+=objectPots;

      // 8-ball outcomes are manual until exact ball-number recognition is proven.
      if(shot.eightOutcome){
        const o=shot.eightOutcome;
        if(o==='legal' && !scratch && !foulType)return {shooter,events:[{type:'rack-win',...this.winRack(shooter,'legal 8-ball (manually confirmed)')}]};
        if(['early','wrong-pocket','foul','off-table'].includes(o))return {shooter,events:[{type:'rack-loss',...this.winRack(opp,'illegal 8-ball')}]};
      }

      if(scratch || foulType){
        if(scratch || foulType==='scratch')p.scratches++;
        p.fouls++;p.currentRun=0;this.ballInHand=true;this.ballInHandArea='anywhere';this.breakShot=false;this.current=opp;this.players[opp].innings++;
        return {shooter,events:[{type:'foul',foulType:foulType||'scratch',current:this.current,ballInHand:true,objectPots}]};
      }

      if(safety){
        p.safeties++;p.currentRun=0;this.ballInHand=false;this.ballInHandArea=null;this.breakShot=false;this.current=opp;this.players[opp].innings++;
        return {shooter,events:[{type:'safety',current:this.current,objectPots}]};
      }

      if(objectPots>0){
        p.legalPots+=objectPots;p.currentRun+=objectPots;p.longestRun=Math.max(p.longestRun,p.currentRun);this.ballInHand=false;this.ballInHandArea=null;this.breakShot=false;
        return {shooter,events:[{type:first?'break-pot':'pot',current:this.current,objectPots}]};
      }

      p.misses++;p.currentRun=0;this.ballInHand=false;this.ballInHandArea=null;this.breakShot=false;this.current=opp;this.players[opp].innings++;
      return {shooter,events:[{type:first?'break-miss':'miss',current:this.current}]};
    }
  }

  root.PoolRules={EightBallGame};
  if(typeof module!=='undefined'&&module.exports)module.exports={EightBallGame};
})(typeof window!=='undefined'?window:globalThis);
