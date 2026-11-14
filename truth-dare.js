(function(){
  const originalGame=window.openGame;
  function gameTitle(){
    return 'Truth or Dare';
  }
  window.openGamePicker=function(){
    if(!app.user){window.openAuth('signup');return}
    modal('Pick a lobby game','<div class="game-picker-intro"><span>🎲</span><h3>Choose the next game</h3><p>Games open in a separate room so lobby chat can continue.</p></div><div class="game-list"><button class="game-item" data-trude-game="truth"><span class="game-icon lilac-bg">✦</span><span><b>Truth or Dare</b><small>Two spins · 2–20 players</small></span><span>↗</span></button><button class="game-item" data-trude-game="other" data-name="This or that"><span class="game-icon peach-bg">↔</span><span><b>This or that</b><small>Pick a side together</small></span><span>↗</span></button><button class="game-item" data-trude-game="other" data-name="Guess the sound"><span class="game-icon blue-bg">♫</span><span><b>Guess the sound</b><small>Quick rounds in the room</small></span><span>↗</span></button></div>');
    $$('[data-trude-game]').forEach(function(b){b.onclick=function(){if(b.dataset.trudeGame==='truth')openTruthDareSetup();else originalGame(b.dataset.name)}});
  };
  window.openGame=function(name){if(name==='Truth or tiny dare'||name==='Truth or Dare')return openTruthDareSetup();return originalGame(name)};
  window.showRoomScores=async function(){
    if(!app.roomId)return toast('Join a lobby first');
    try{const r=await api('/api/rooms/'+app.roomId+'/scores');const rows=r.scores;const html=rows.length?'<div class="score-list">'+rows.map(function(p,i){return '<div><span>'+(!p.eligible?'✕':i===0?'🏆':i+1)+'</span><b>'+esc(p.name)+(p.eligible?'':' · spectating')+'</b><strong>'+p.score+'</strong></div>'}).join('')+'</div>':'<div class="empty-note">No game scores yet.</div>';modal('Lobby game scores',html,true)}catch(e){toast(e.message)}
  };
  async function openTruthDareSetup(){
    if(!app.roomId)return toast('Join a lobby first');
    try{
      const result=await api('/api/rooms/'+app.roomId+'/members'),scores=(await api('/api/rooms/'+app.roomId+'/scores')).scores;
      const players=result.members.filter(function(p){return !scores.some(function(s){return s.id===p.id&&!s.eligible})});
      if(players.length<2)return toast('Invite at least two eligible people to this lobby.');
      modal('Set up Truth or Dare','<div class="game-picker-intro"><span>🎲</span><h3>Take the chat into a game</h3><p>The lobby chat remains open while the game has its own space.</p></div><form id="trude-td-form" class="auth-form"><label>Players in the game<select name="count"><option>2</option><option>5</option><option>10</option><option>15</option><option>20</option></select></label><label>Prompt level<select name="level"><option>Very easy</option><option>Easy</option><option selected>Medium</option><option>Hard</option><option>Very hard</option><option disabled>18+ · unavailable until age verification</option></select></label><p class="auth-footnote">Prompts are voluntary and non-explicit. A player may pass and spectate. Explicit adult prompts are disabled because Trude does not yet verify age.</p><button class="modal-primary full-width">Create game room</button></form>',true);
      $('#trude-td-form').onsubmit=function(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));const count=Number(data.count);if(players.length<count)return toast('Invite '+(count-players.length)+' more players or choose a smaller room.');closeModal();openTruthDareRoom(players.slice(0,count),data.level)};
    }catch(e){toast(e.message)}
  }
  function openTruthDareRoom(players,level){
    const truthPrompts={
      'Very easy':['What snack do you always like?','What made you smile today?','What is your favorite color?'],
      'Easy':['What song do you play on repeat?','What small goal do you have?','What is your favorite way to relax?'],
      'Medium':['What skill would you like to learn?','What is a moment you felt proud?','Which place would you like to visit?'],
      'Hard':['What fear have you worked through?','What do you wish people understood about you?','When did you last change your mind?'],
      'Very hard':['What apology do you still owe?','What choice would you make differently?','What truth have you been avoiding telling yourself?']
    };
    const darePrompts={
      'Very easy':['Give someone a friendly wave.','Name three things you like about today.','Make a silly face for the room.'],
      'Easy':['Do a five-second seated dance.','Say something kind about another player.','Tell a joke in your best announcer voice.'],
      'Medium':['Make up a two-line song about the room.','Draw a tiny picture in the air and let the room guess.','Describe your day with sound effects.'],
      'Hard':['Tell the room about a time you tried something new.','Give a sincere compliment to another player.','Improvise a story using three words from the chat.'],
      'Very hard':['Share a lesson you learned, only if comfortable.','Tell the room about a moment you showed courage.','Name one way you have grown this year.']
    };
    let active=players.slice(),truth=null,dare=null,round=1,spinning=false;
    const prompt=function(which){const list=(which==='truth'?truthPrompts:darePrompts)[level]||truthPrompts.Medium;return list[Math.floor(Math.random()*list.length)]};
    const pick=function(avoid){const pool=active.filter(function(p){return p.id!==avoid});return pool[Math.floor(Math.random()*pool.length)]};
    const html='<div class="truth-game"><div class="game-room-top"><span class="live-pill"><i></i> '+active.length+' players · '+esc(level)+'</span><button id="td-scores" type="button">🏆 Scores</button></div><div class="spin-stage"><div class="spin-wheel" id="td-wheel">✦</div><small id="td-spin-label">Spin once for truth, again for dare</small></div><div class="truth-round-card"><small>ROUND <b id="td-round">1</b></small><div class="truth-player" id="td-truth-player">Truth player is picked randomly</div><p id="td-truth-prompt">First spin chooses the truth player.</p><div class="truth-player" id="td-dare-player">Dare player is picked randomly</div><p id="td-dare-prompt">Second spin chooses a different player.</p></div><label>Players’ responses<textarea id="td-answer" class="modal-field" rows="2" placeholder="Enter the answers to share with everyone"></textarea></label><div class="pass-row"><select id="td-pass"><option value="">A player cannot continue…</option><option value="truth">Truth player passes</option><option value="dare">Dare player passes</option></select><button type="button" class="secondary-btn" id="td-mark-pass">✕ Mark pass</button></div><div class="editor-tools"><button type="button" class="secondary-btn" id="td-spin-truth">Spin for truth</button><button type="button" class="secondary-btn" id="td-spin-dare" disabled>Spin for dare</button><button type="button" class="modal-primary" id="td-share" disabled>Share answers</button><button type="button" class="secondary-btn" id="td-next" disabled>Next round</button></div><p class="auth-footnote">A pass removes that player from future spins; they can keep watching. Scores are saved with this lobby.</p></div>';
    modal(gameTitle()+' · Game room',html,true);
    const first=$('#td-spin-truth'),second=$('#td-spin-dare'),next=$('#td-next'),wheel=$('#td-wheel');
    const animate=function(side){
      if(spinning)return;spinning=true;wheel.classList.remove('spinning');void wheel.offsetWidth;wheel.classList.add('spinning');
      setTimeout(function(){
        if(side==='truth'){truth=pick(null);$('#td-truth-player').textContent='TRUTH · '+truth.name+' (@'+truth.handle+')';$('#td-truth-prompt').textContent=prompt('truth');first.disabled=true;second.disabled=false;$('#td-spin-label').textContent='Truth player selected · spin again'}
        else{dare=pick(truth.id);$('#td-dare-player').textContent='DARE · '+dare.name+' (@'+dare.handle+')';$('#td-dare-prompt').textContent=prompt('dare');second.disabled=true;$('#td-share').disabled=false;$('#td-spin-label').textContent='Both players selected · answer in the room'}
        spinning=false;
      },1400);
    };
    first.onclick=function(){animate('truth')};second.onclick=function(){animate('dare')};$('#td-scores').onclick=window.showRoomScores;
    $('#td-share').onclick=async function(){
      const answer=$('#td-answer').value.trim();if(!truth||!dare||!answer)return toast('Enter both players’ responses first.');
      try{await send('/api/rooms/'+app.roomId+'/messages',{body:'🎲 Truth or Dare · Round '+round+' — @'+truth.handle+' (Truth): '+answer.slice(0,220)+' | @'+dare.handle+' (Dare): completed'});await send('/api/rooms/'+app.roomId+'/scores',{deltas:[{userId:truth.id,points:1},{userId:dare.id,points:1}]});await pollRoom();$('#td-share').disabled=true;next.disabled=false;$('#td-spin-label').textContent='Answers and points saved'}catch(e){toast(e.message)}
    };
    $('#td-mark-pass').onclick=async function(){
      const side=$('#td-pass').value,player=side==='truth'?truth:side==='dare'?dare:null,winner=side==='truth'?dare:truth;if(!player||!winner)return toast('Spin twice and choose who passes.');
      try{await send('/api/rooms/'+app.roomId+'/scores',{eliminate:[player.id],deltas:[{userId:winner.id,points:1}]});await send('/api/rooms/'+app.roomId+'/messages',{body:'✕ @'+player.handle+' passed and will spectate. @'+winner.handle+' earns the point.'});await pollRoom();active=active.filter(function(p){return p.id!==player.id});$('#td-'+side+'-player').textContent='✕ '+player.name+' · spectating';$('#td-mark-pass').disabled=true;next.disabled=false}catch(e){toast(e.message)}
    };
    next.onclick=async function(){
      try{const scores=(await api('/api/rooms/'+app.roomId+'/scores')).scores,blocked=new Set(scores.filter(function(x){return !x.eligible}).map(function(x){return x.id}));active=active.filter(function(p){return !blocked.has(p.id)})}catch{}
      if(active.length<2)return toast('There are not two eligible players left.');
      round++;truth=null;dare=null;$('#td-round').textContent=round;$('#td-truth-player').textContent='Truth player is picked randomly';$('#td-dare-player').textContent='Dare player is picked randomly';$('#td-truth-prompt').textContent='First spin chooses the truth player.';$('#td-dare-prompt').textContent='Second spin chooses a different player.';$('#td-answer').value='';$('#td-spin-label').textContent='Spin once for truth, again for dare';first.disabled=false;second.disabled=true;$('#td-share').disabled=true;next.disabled=true;$('#td-mark-pass').disabled=false;$('#td-pass').value='';
    };
  }
})();
