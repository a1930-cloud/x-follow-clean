async function handleUnfollow(message) {
  const {dataset,unfollowRun:existing} = await chrome.storage.local.get(['dataset','unfollowRun']);
  const now=Date.now();
  if(message.type==='unfollowCreate') {
    if(!dataset || message.cycle!==dataset.createdAt) throw new Error('名单已变化，请刷新清单');
    if(existing && ['running','paused'].includes(existing.status) && existing.leaseUntil>now) throw new Error('已有任务，请先停止或回到原来的控制页');
    const handles=message.handles;
    if(!Array.isArray(handles) || !handles.length || handles.length>100 || new Set(handles).size!==handles.length || handles.some(handle=>FollowReview.normalize(handle)!==handle || !Unfollow.eligible(dataset,handle))) throw new Error('所选账号已变化、受到保护或不适合执行，请重新选择（每批最多 100 人）');
    if(typeof message.controller!=='string' || message.controller.length>100) throw new Error('控制页无效');
    if(!Number.isInteger(message.delay) || message.delay<5 || message.delay>120) throw new Error('间隔应为 5–120 秒');
    const run={id:now+'-'+Math.random().toString(36).slice(2),owner:dataset.owner,cycle:dataset.createdAt,controller:message.controller,handles,delay:message.delay,status:'running',index:0,current:null,startedAt:now,leaseUntil:now+90000,results:[]};
    await chrome.storage.local.set({unfollowRun:run});return {ok:true,run};
  }
  const run=existing;
  if(!run || run.id!==message.runId) throw new Error('任务已变化');
  if(message.type==='unfollowControl') {
    if(!['pause','resume','stop'].includes(message.action)) throw new Error('无效操作');
    if(message.action==='resume' && run.status==='stopped' && !run.current && run.index<run.handles.length){
      if(!dataset || dataset.createdAt!==run.cycle || dataset.owner!==run.owner)throw new Error('名单或账号已变化');
      if(typeof message.controller!=='string' || !message.controller || message.controller.length>100)throw new Error('控制页无效');
      run.controller=message.controller;run.status='running';run.leaseUntil=now+90000;delete run.error;
      await chrome.storage.local.set({unfollowRun:run});return {ok:true,run};
    }
    if(!['running','paused'].includes(run.status)) throw new Error('任务已结束');
    if(message.action==='resume' && (run.controller!==message.controller || run.leaseUntil<now)) throw new Error('原控制页已失效，请停止并新建任务');
    run.status={pause:'paused',resume:'running',stop:'stopped'}[message.action];
    if(message.action==='resume')delete run.error;
    await chrome.storage.local.set({unfollowRun:run});return {ok:true,run};
  }
  if(run.controller!==message.controller) throw new Error('请在启动任务的清单页操作');
  if(message.type==='unfollowHeartbeat') {
    if(['running','paused'].includes(run.status)) {
      if(run.leaseUntil<now) {run.status='stopped';run.error='控制页长时间无响应，任务已停止。';}
      else run.leaseUntil=now+90000;
      await chrome.storage.local.set({unfollowRun:run});
    }
    return {ok:true,run};
  }
  if(!dataset || dataset.createdAt!==run.cycle || dataset.owner!==run.owner) throw new Error('名单或账号已变化');
  dataset.unfollowLog ||= {};
  if(message.type==='unfollowNext') {
    if(run.status!=='running' || run.leaseUntil<now || run.current) throw new Error('任务未运行或上一项尚未结束');
    if(run.index>=run.handles.length) {run.status='completed';await chrome.storage.local.set({unfollowRun:run});return {ok:true,run};}
    const handle=run.handles[run.index++];
    if(!Unfollow.eligible(dataset,handle)) {
      run.results.push({handle,outcome:'skipped',detail:'名单已变化、已保留或找到回关证据',at:now});
      await chrome.storage.local.set({unfollowRun:run});return {ok:true,run,skipped:true};
    }
    run.current=handle;
    Object.defineProperty(dataset.unfollowLog,handle,{value:{outcome:'in_progress',runId:run.id,at:now,detail:'执行中；如果控制页关闭，请先手动核对，避免重复操作'},enumerable:true,writable:true,configurable:true});
    await chrome.storage.local.set({dataset,unfollowRun:run});return {ok:true,run,handle};
  }
  if(message.type==='unfollowResult') {
    if(!run.current || run.current!==message.handle || !['success','already','skipped','uncertain','cancelled','network_pause'].includes(message.outcome)) throw new Error('执行结果不匹配');
    const entry={handle:run.current,outcome:message.outcome,detail:String(message.detail||'').slice(0,300),at:now,runId:run.id};
    if(message.outcome==='network_pause') {
      // No page action was attempted. Keep this exact account next in line on resume.
      delete dataset.unfollowLog[run.current];
      run.current=null;run.index--;run.status='paused';run.error=entry.detail;
      await chrome.storage.local.set({dataset,unfollowRun:run});return {ok:true,run};
    }
    Object.defineProperty(dataset.unfollowLog,run.current,{value:entry,enumerable:true,writable:true,configurable:true});
    run.results.push(entry);run.current=null;
    if((entry.outcome==='uncertain' && message.continueBatch!==true) || (entry.outcome==='cancelled' && run.status!=='paused')) {run.status='stopped';run.error=entry.detail;}
    await chrome.storage.local.set({dataset,unfollowRun:run});return {ok:true,run};
  }
  throw new Error('不支持的任务操作');
}
