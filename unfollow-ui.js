(() => {
  const el=id=>document.getElementById(id);
  const controller=crypto.randomUUID(), selected=new Set();
  let currentDataset, filtered=[], currentPage=0, run=null, pending=[], pendingSpec=null, workerTab=null, driving=false, heartbeat=null;
  const request=async message=>{
    const response=await chrome.runtime.sendMessage(message);
    if(!response?.ok) throw new Error(response?.error || '操作失败');
    if(response.run) {run=response.run;renderRun();}
    return response;
  };
  const ownRun=()=>run?.controller===controller;
  const active=()=>run && ['running','paused'].includes(run.status) && run.leaseUntil>Date.now();
  function renderRun() {
    const names={running:'运行中',paused:'已暂停',stopped:'已停止',completed:'已完成'};
    const expired=active()===false && run && ['running','paused'].includes(run.status);
    el('runStatus').textContent=run?`${expired?'控制页已失效，请核对上次执行结果':names[run.status]} · 已处理 ${run.results.length} / ${run.handles.length} 人\n${run.current?'当前：@'+run.current:''}${run.error?'\n'+run.error:''}`:'尚未开始取关。';
    el('pauseUnfollow').disabled=!active() || run.status!=='running';
    const canContinue=run?.status==='stopped' && !run.current && run.index<run.handles.length;
    el('resumeUnfollow').disabled=!(canContinue || (active() && ownRun() && run.status==='paused'));
    el('resumeUnfollow').textContent=canContinue?'继续剩余账号':'继续';
    el('stopUnfollow').disabled=!run || !['running','paused'].includes(run.status);
    el('previewUnfollow').disabled=!selected.size || active();
    el('runResults').replaceChildren();
    for(const entry of run?.results || []) {const li=document.createElement('li');li.textContent=`@${entry.handle} · ${Unfollow.outcomes[entry.outcome]} · ${entry.detail}`;el('runResults').append(li);}
  }
  function selectionChanged() {
    el('selectionCount').textContent=`已选 ${selected.size} 人`;
    el('previewUnfollow').disabled=!selected.size || active();
  }
  globalThis.UnfollowUI={selected,select(handle,value){if(value) {if(selected.size>=100){status('每批最多 100 人，请先处理当前选择。');render();return;}selected.add(handle);}else selected.delete(handle);selectionChanged();},render(data,rows,page){currentDataset=data;filtered=rows;currentPage=page;for(const handle of selected)if(!Unfollow.eligible(data,handle))selected.delete(handle);selectionChanged();}};
  el('selectPage').onclick=()=>{for(const row of filtered.slice(currentPage*50,(currentPage+1)*50))if(Unfollow.eligible(currentDataset,row.handle)&&selected.size<100)selected.add(row.handle);render();};
  el('selectFiltered').onclick=()=>{selected.clear();for(const row of filtered)if(Unfollow.eligible(currentDataset,row.handle)&&selected.size<100)selected.add(row.handle);render();};
  el('clearSelection').onclick=()=>{selected.clear();render();};
  el('previewUnfollow').onclick=()=>{
    pending=[...selected].filter(handle=>Unfollow.eligible(currentDataset,handle));
    if(!pending.length)return;
    const delay=Number(el('unfollowDelay').value);
    if(!Number.isInteger(delay)||delay<5||delay>120)return status('每人之间的等待时间请填 5–120 秒。');
    pendingSpec={cycle:currentDataset.createdAt,owner:currentDataset.owner,delay};
    el('confirmSummary').textContent=`使用 @${currentDataset.owner}，取关以下 ${pending.length} 个账号；间隔 ${delay} 秒。`;
    el('confirmHandles').replaceChildren();
    for(const handle of pending){const li=document.createElement('li');li.textContent='@'+handle;el('confirmHandles').append(li);}
    el('confirmUnfollowCheck').checked=false;el('startUnfollow').disabled=true;el('confirmError').textContent='';el('unfollowConfirm').showModal();
  };
  el('confirmUnfollowCheck').onchange=()=>el('startUnfollow').disabled=!el('confirmUnfollowCheck').checked;
  el('cancelUnfollow').onclick=()=>el('unfollowConfirm').close();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function getRun(){const stored=await chrome.storage.local.get('unfollowRun');run=stored.unfollowRun;renderRun();return run;}
  async function waitRunning(){
    while(true){await getRun();if(!ownRun()||!active())return false;if(run.status==='running')return true;await sleep(400);}
  }
  async function showWorkerProgress(message){
    if(workerTab===null)return;
    await unfollowDeadline(chrome.scripting.executeScript({target:{tabId:workerTab},injectImmediately:true,func:showUnfollowProgress,args:[message]}),1000).catch(()=>{});
  }
  async function loadProfile(handle,owner){
    const url='https://x.com/'+handle;
    if(workerTab===null){const tab=await chrome.tabs.create({url,active:true});workerTab=tab.id;}
    else await chrome.tabs.update(workerTab,{url});
    for(let attempt=0;attempt<2;attempt++){
      const until=Date.now()+15000;
      let lastCountdown=-1;
      while(Date.now()<until){
        if(!await waitRunning())throw new Error('任务已停止');
        const seconds=Math.max(0,Math.ceil((until-Date.now())/1000));
        if(seconds!==lastCountdown){
          lastCountdown=seconds;
          const message=`@${handle} · 等待主页显示，约 ${seconds} 秒后${attempt===0?'自动刷新':'记录并跳过'}`;
          status(message);
          await showWorkerProgress(message);
        }
        let tab;
        try{tab=await chrome.tabs.get(workerTab);}catch{throw new Error('执行标签页已关闭');}
        const loadedUrl=tab.url?.split(/[?#]/)[0].replace(/\/$/,'').toLowerCase();
        if(tab.status==='complete' && loadedUrl && !loadedUrl.startsWith('chrome-error://') && loadedUrl!==url.toLowerCase() && loadedUrl!==url.toLowerCase()+'/creator-subscriptions/subscribe')throw new Error('执行页面已变化');
        if(loadedUrl===url.toLowerCase() || loadedUrl===url.toLowerCase()+'/creator-subscriptions/subscribe'){
          let state;
          try{state=(await unfollowDeadline(chrome.scripting.executeScript({target:{tabId:workerTab},injectImmediately:true,func:inspectProfileLoad,args:[handle,owner]}),2000))[0]?.result;}
          catch{state={state:'loading'};}
          if(state?.state==='ready')return 'ready';
          if(state?.state==='restricted')return 'restricted';
          if(state?.state==='fatal')throw new Error(state.detail);
        }
        await sleep(500);
      }
      if(attempt<1){
        const wait=(attempt+1)*3000;
        status(`@${handle} 页面加载缓慢，${wait/1000} 秒后重试（${attempt+1}/1）。`);
        await showWorkerProgress(`留关 · @${handle}\n页面加载缓慢，即将重新加载重试…`);
        const deadline=Date.now()+wait;
        while(Date.now()<deadline){if(!await waitRunning())throw new Error('任务已停止');await sleep(400);}
        await chrome.tabs.reload(workerTab);
      }
    }
    const error=new Error('主页多次加载失败，已跳过；未尝试取关，无法确定账号是否受限');error.networkPause=true;throw error;
  }
  async function drive(){
    if(driving)return;driving=true;
    try{
      while(await waitRunning()){
        const next=await request({type:'unfollowNext',runId:run.id,controller});
        if(run.status==='completed')break;
        if(next.skipped)continue;
        const task={runId:run.id,owner:run.owner,cycle:run.cycle,handle:next.handle};
        let outcome, injected=false;
        try{
          const profile=await loadProfile(task.handle,task.owner);
          if(!await waitRunning())throw new Error('任务已停止');
          if(profile==='restricted')outcome={outcome:'skipped',detail:'X 显示“此账号暂时受限”警告；未进入主页，也未尝试取关'};
          else {
            await showWorkerProgress(`留关 · 第 ${run.index}/${run.handles.length} 人\n@${task.handle} · 正在检查账号…`);
            injected=true;
            const responses=await chrome.scripting.executeScript({target:{tabId:workerTab},injectImmediately:true,func:performUnfollow,args:[task]});
            outcome=responses[0]?.result;
            if(!outcome)throw new Error('执行页面未返回结果');
          }
        }catch(error){outcome={outcome:error.networkPause?'skipped':injected?'uncertain':'cancelled',detail:error.message};}
        if(outcome.outcome==='network_pause')outcome={outcome:'skipped',detail:outcome.detail+'；未尝试取关，已跳过'};
        await request({type:'unfollowResult',runId:task.runId,controller,handle:task.handle,...outcome});
        if(workerTab!==null){
          const message=`留关 · 已处理 ${run.results.length}/${run.handles.length} 人\n@${task.handle} · ${Unfollow.outcomes[outcome.outcome]||'已暂停'}\n${outcome.detail}\n${run.status==='paused'?'任务已暂停；网络恢复后请在清单页点“继续”。':!active()?'任务已停止，请回到本地清单查看记录。':run.index>=run.handles.length?'本批处理结束。':`等待 ${run.delay} 秒后处理下一人；暂停或停止请回到本地清单。`}`;
          await showWorkerProgress(message);
        }
        // No retry on errors or uncertain outcomes. Every next action requires a live controller.
        if(!active())break;
        if(outcome.outcome==='network_pause')continue;
        if(run.index>=run.handles.length)continue;
        const until=Date.now()+run.delay*1000;
        while(Date.now()<until){if(!await waitRunning())return;await sleep(400);}
      }
    }catch(error){status(error.message);if(ownRun() && active())await request({type:'unfollowControl',runId:run.id,action:'stop',controller}).catch(()=>{});}
    finally{driving=false;clearInterval(heartbeat);heartbeat=null;renderRun();}
  }
  el('startUnfollow').onclick=async()=>{
    if(!el('confirmUnfollowCheck').checked)return;
    el('startUnfollow').disabled=true;
    try{
      // Must originate directly from the user's confirmation click.
      const granted=await chrome.permissions.request({origins:['https://x.com/*']});
      if(!granted)throw new Error('需要允许插件访问 x.com，才能在执行页操作取关。');
      await request({type:'unfollowCreate',controller,cycle:pendingSpec.cycle,handles:pending,delay:pendingSpec.delay});
      heartbeat=setInterval(()=>request({type:'unfollowHeartbeat',runId:run.id,controller}).catch(error=>status(error.message)),2000);
      selected.clear();el('unfollowConfirm').close();render();drive();
    }catch(error){el('confirmError').textContent=error.message;el('startUnfollow').disabled=false;}
  };
  for(const [id,action]of [['pauseUnfollow','pause'],['resumeUnfollow','resume'],['stopUnfollow','stop']])el(id).onclick=async()=>{
    try{
      await request({type:'unfollowControl',runId:run.id,action,controller});
      if(action==='resume' && !driving){
        workerTab=null;
        if(!heartbeat)heartbeat=setInterval(()=>request({type:'unfollowHeartbeat',runId:run.id,controller}).catch(error=>status(error.message)),2000);
        drive();
      }
    }catch(error){status(error.message);}
  };
  el('exportUnfollow').onclick=()=>{
    const entries=Object.entries(currentDataset?.unfollowLog||{});
    const lines=['username,outcome,detail,time',...entries.map(([handle,entry])=>[handle,entry.outcome,entry.detail,new Date(entry.at).toISOString()].map(FollowReview.csvCell).join(','))];
    download('\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8','unfollow-history.csv');
  };
  chrome.storage.onChanged.addListener(changes=>{if(changes.unfollowRun){run=changes.unfollowRun.newValue;renderRun();}});
  window.addEventListener('pagehide',()=>{if(ownRun()&&active())chrome.runtime.sendMessage({type:'unfollowControl',runId:run.id,action:'stop',controller}).catch(()=>{});});
  getRun().catch(error=>status(error.message));render();
})();
