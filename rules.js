(function(){
  const other=i=>i===0?1:0;
  const clone=o=>JSON.parse(JSON.stringify(o));

  class EightBallRules {
    constructor(opts={}){
      this.ruleset=opts.ruleset||"wpa";
      this.raceTo=Number(opts.raceTo||5);
      this.house={eightOnBreakWin:!!opts.eightOnBreakWin,scratchKitchen:!!opts.scratchKitchen};
      this.players=[this.makePlayer(opts.p1||"Player 1"),this.makePlayer(opts.p2||"Player 2")];
      this.matchScore=[0,0];
      this.startRack(Number(opts.breaker||0));
    }
    makePlayer(name){return {name,group:null,remaining:7,shots:0,pots:0,misses:0,scratches:0,fouls:0,safeties:0,innings:0,currentRun:0,longestRun:0};}
    startRack(breaker=0){
      this.breaker=breaker;this.current=breaker;this.openTable=true;this.ballInHand=false;this.breakShot=true;this.safetyDeclared=false;
      this.rackOver=false;this.rackWinner=null;this.matchOver=this.matchScore.some(s=>s>=this.raceTo);
      this.players.forEach(p=>{p.group=null;p.remaining=7;p.currentRun=0});
      return this.snapshot();
    }
    snapshot(){return clone({ruleset:this.ruleset,raceTo:this.raceTo,house:this.house,players:this.players,matchScore:this.matchScore,breaker:this.breaker,current:this.current,openTable:this.openTable,ballInHand:this.ballInHand,breakShot:this.breakShot,safetyDeclared:this.safetyDeclared,rackOver:this.rackOver,rackWinner:this.rackWinner,matchOver:this.matchOver});}
    restore(s){Object.assign(this,clone(s));}
    setNames(p1,p2){this.players[0].name=p1;this.players[1].name=p2;}
    setSafety(v=true){this.safetyDeclared=v;}
    switchTurn(){this.players[this.current].currentRun=0;this.current=other(this.current);this.players[this.current].innings++;return this.current;}
    assignGroups(playerIndex,group){if(!["solid","stripe"].includes(group))return;this.players[playerIndex].group=group;this.players[other(playerIndex)].group=group==="solid"?"stripe":"solid";this.openTable=false;}
    clearGroups(){this.players[0].group=null;this.players[1].group=null;this.players[0].remaining=7;this.players[1].remaining=7;this.openTable=true;}
    winRack(winner,reason){this.rackOver=true;this.rackWinner=winner;this.matchScore[winner]++;this.players[0].currentRun=0;this.players[1].currentRun=0;if(this.matchScore[winner]>=this.raceTo)this.matchOver=true;return {rackOver:true,winner,reason,matchOver:this.matchOver};}

    applyShot(shot){
      if(this.rackOver)return {error:"rack-over",events:[],state:this.snapshot()};
      const p=this.current,opp=other(p),player=this.players[p];
      const result=shot.result||"miss",pottedCount=Math.max(0,Number(shot.pottedCount||0));
      const foulType=shot.foulType||null,eight=shot.eight||null,groupPotted=shot.groupPotted||null,isBreak=this.breakShot;
      const events=[];player.shots++;

      if(eight){
        if(isBreak&&eight==="break"){
          if(this.ruleset==="house"&&this.house.eightOnBreakWin)events.push({type:"rack-win",...this.winRack(p,"8-ball on break (house rule)")});
          else events.push({type:"eight-break-choice",message:"8-ball on break: spot 8 and continue, or re-rack/re-break."});
          this.breakShot=false;this.safetyDeclared=false;return {events,state:this.snapshot()};
        }
        if(eight==="legal"){
          if((player.remaining===0||shot.forceLegalEight)&&!foulType)events.push({type:"rack-win",...this.winRack(p,"legal 8-ball")});
          else events.push({type:"rack-loss",...this.winRack(opp,"8-ball pocketed before group cleared")});
          this.breakShot=false;this.safetyDeclared=false;return {events,state:this.snapshot()};
        }
        if(["early","wrong-pocket","foul","off-table"].includes(eight)){
          const why={early:"early 8-ball","wrong-pocket":"8-ball in wrong/uncalled pocket",foul:"foul while pocketing 8-ball","off-table":"8-ball driven off table"}[eight];
          events.push({type:"rack-loss",...this.winRack(opp,why)});this.breakShot=false;this.safetyDeclared=false;return {events,state:this.snapshot()};
        }
      }

      if(result==="scratch"||foulType){
        if(result==="scratch"||foulType==="scratch")player.scratches++;
        player.fouls++;player.currentRun=0;this.ballInHand=true;this.breakShot=false;this.safetyDeclared=false;this.current=opp;this.players[opp].innings++;
        events.push({type:"foul",foulType:foulType||"scratch",ballInHand:true,current:this.current});return {events,state:this.snapshot()};
      }

      if(result==="safety"||this.safetyDeclared){
        player.safeties++;player.currentRun=0;this.ballInHand=false;this.breakShot=false;this.safetyDeclared=false;this.current=opp;this.players[opp].innings++;
        events.push({type:"safety",current:this.current});return {events,state:this.snapshot()};
      }

      if(isBreak){
        this.breakShot=false;this.ballInHand=false;
        if(result==="pot"||pottedCount>0){const n=pottedCount||1;player.pots+=n;player.currentRun+=n;player.longestRun=Math.max(player.longestRun,player.currentRun);events.push({type:"break-pot",current:p,count:n});}
        else{player.misses++;player.currentRun=0;this.current=opp;this.players[opp].innings++;events.push({type:"break-no-pot",current:this.current});}
        return {events,state:this.snapshot()};
      }

      if(this.openTable&&(result==="pot"||pottedCount>0)&&groupPotted){this.assignGroups(p,groupPotted);events.push({type:"groups-assigned",player:p,group:groupPotted});}

      if(result==="pot"||pottedCount>0){
        const n=pottedCount||1;player.pots+=n;player.currentRun+=n;player.longestRun=Math.max(player.longestRun,player.currentRun);
        if(player.group&&(groupPotted===player.group||!groupPotted))player.remaining=Math.max(0,player.remaining-n);
        this.ballInHand=false;events.push({type:"legal-pot",current:p,count:n});
      }else{
        player.misses++;player.currentRun=0;this.ballInHand=false;this.current=opp;this.players[opp].innings++;events.push({type:"miss",current:this.current});
      }
      this.safetyDeclared=false;return {events,state:this.snapshot()};
    }
  }
  window.PoolRules={EightBallRules};
})();
