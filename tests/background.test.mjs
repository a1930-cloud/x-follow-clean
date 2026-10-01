import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const scripts=Object.fromEntries(await Promise.all(['core.js','unfollow-core.js','unfollow-background.js'].map(async file=>[file,await readFile(new URL('../'+file,import.meta.url),'utf8')])));
const source=await readFile(new URL('../background.js',import.meta.url),'utf8');
function harness(){
  let listener,store={};
  const context=vm.createContext({URL,console,chrome:{
    runtime:{getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>listener=fn}},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(store[key])])),set:async patch=>{await Promise.resolve();store={...store,...structuredClone(patch)};}}}
  }});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(scripts[file],context));
  vm.runInContext(source,context);
  return {send:(message,sender={url:'chrome-extension://test/popup.html'})=>new Promise(resolve=>listener(message,sender,resolve)),read:()=>structuredClone(store)};
}
test('concurrent pages persist every batch; account and cycle isolation reject stale messages',async()=>{
  const h=harness();assert.equal((await h.send({type:'newCycle',owner:'me'})).ok,true);
  const cycle=h.read().dataset.createdAt;
  const sender={tab:{id:1},url:'https://x.com/me/following'};
  const msg={type:'capture',owner:'me',kind:'following',cycle};
  const results=await Promise.all(Array.from({length:25},(_,i)=>h.send({...msg,rows:[{handle:'user'+i}]},sender)));
  assert.ok(results.every(result=>result.ok));assert.equal(Object.keys(h.read().dataset.following).length,25);
  assert.equal((await h.send({...msg,rows:[{handle:'bad'}]},{tab:{id:2},url:'https://x.com/other/following'})).ok,false);
  assert.equal((await h.send({...msg,cycle:cycle-1,rows:[{handle:'bad'}]},sender)).ok,false);
  assert.equal(Object.keys(h.read().dataset.following).length,25);
  assert.equal((await h.send({type:'review',cycle,handle:'user1',value:'keep'})).ok,true);
  assert.equal(h.read().dataset.review.user1,'keep');
  assert.equal((await h.send({type:'review',cycle,handle:'user1',value:'keep'},sender)).ok,false);
});

test('unfollow jobs protect mutuals, whitelist and uncertain results; enforce single controller',async()=>{
 const h=harness();await h.send({type:'newCycle',owner:'me'});const cycle=h.read().dataset.createdAt;
 await h.send({type:'capture',owner:'me',kind:'following',cycle,rows:[{handle:'safe'},{handle:'kept'},{handle:'mutual',positiveFollow:true},{handle:'second'}]},{tab:{id:1},url:'https://x.com/me/following'});
 await h.send({type:'review',cycle,handle:'kept',value:'keep'});
 const create={type:'unfollowCreate',cycle,controller:'page1',delay:15};
 for(const handle of ['kept','mutual','missing'])assert.equal((await h.send({...create,handles:[handle]})).ok,false);
 assert.equal((await h.send({...create,handles:['safe'],delay:4})).ok,false);
 const first=await h.send({...create,handles:['safe','second'],delay:5});assert.equal(first.ok,true);assert.equal(first.run.delay,5);
 const token={runId:first.run.id,controller:'page1'};
 assert.equal((await h.send({...create,handles:['second'],controller:'page2'})).ok,false);
 assert.equal((await h.send({type:'newCycle',owner:'other'})).ok,false);
 assert.equal((await h.send({type:'unfollowNext',...token,controller:'other'})).ok,false);
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'safe');
 assert.equal((await h.send({type:'unfollowNext',...token})).ok,false);
 assert.equal((await h.send({type:'unfollowResult',...token,handle:'second',outcome:'success'})).ok,false);
 assert.equal((await h.send({type:'unfollowResult',...token,handle:'safe',outcome:'uncertain',detail:'tab closed'})).run.status,'stopped');
 assert.equal((await h.send({...create,handles:['safe']})).ok,false);
 const second=await h.send({...create,handles:['second']});assert.equal(second.ok,true);
 const token2={runId:second.run.id,controller:'page1'};
 await h.send({type:'review',cycle,handle:'second',value:'keep'});
 assert.equal((await h.send({type:'unfollowNext',...token2})).skipped,true);
 assert.equal((await h.send({type:'unfollowNext',...token2})).run.status,'completed');
});

test('network pause keeps the same account next and preserves completed results',async()=>{
 const h=harness();await h.send({type:'newCycle',owner:'me'});const cycle=h.read().dataset.createdAt;
 await h.send({type:'capture',owner:'me',kind:'following',cycle,rows:[{handle:'first'},{handle:'second'}]},{tab:{id:1},url:'https://x.com/me/following'});
 const created=await h.send({type:'unfollowCreate',cycle,controller:'page1',delay:5,handles:['first','second']});
 const token={runId:created.run.id,controller:'page1'};
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'first');
 assert.equal((await h.send({type:'unfollowResult',...token,handle:'first',outcome:'success',detail:'confirmed'})).run.status,'running');
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'second');
 const paused=await h.send({type:'unfollowResult',...token,handle:'second',outcome:'network_pause',detail:'page did not load'});
 assert.equal(paused.run.status,'paused');assert.equal(paused.run.index,1);assert.equal(paused.run.current,null);
 assert.equal(paused.run.results.length,1);assert.equal(h.read().dataset.unfollowLog.second,undefined);
 assert.equal((await h.send({type:'unfollowNext',...token})).ok,false);
 const resumed=await h.send({type:'unfollowControl',...token,action:'resume'});assert.equal(resumed.run.status,'running');assert.equal(resumed.run.error,undefined);
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'second');
 assert.equal((await h.send({type:'unfollowResult',...token,handle:'second',outcome:'success',detail:'confirmed'})).run.results.length,2);
 assert.equal((await h.send({type:'unfollowNext',...token})).run.status,'completed');
});

test('a restricted profile can be recorded as skipped and the batch continues',async()=>{
 const h=harness();await h.send({type:'newCycle',owner:'me'});const cycle=h.read().dataset.createdAt;
 await h.send({type:'capture',owner:'me',kind:'following',cycle,rows:[{handle:'restricted'},{handle:'next'}]},{tab:{id:1},url:'https://x.com/me/following'});
 const created=await h.send({type:'unfollowCreate',cycle,controller:'page1',delay:5,handles:['restricted','next']});
 const token={runId:created.run.id,controller:'page1'};
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'restricted');
 const recorded=await h.send({type:'unfollowResult',...token,handle:'restricted',outcome:'skipped',detail:'restricted warning'});
 assert.equal(recorded.run.status,'running');assert.equal(recorded.run.results[0].outcome,'skipped');
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'next');
});

test('uncertain local failures continue but remain protected from future selection',async()=>{
 const h=harness();await h.send({type:'newCycle',owner:'me'});const cycle=h.read().dataset.createdAt;
 await h.send({type:'capture',owner:'me',kind:'following',cycle,rows:[{handle:'first'},{handle:'second'}]},{tab:{id:1},url:'https://x.com/me/following'});
 const create={type:'unfollowCreate',cycle,controller:'page',delay:5,handles:['first','second']};const started=await h.send(create);const token={runId:started.run.id,controller:'page'};
 await h.send({type:'unfollowNext',...token});
 const result=await h.send({type:'unfollowResult',...token,handle:'first',outcome:'uncertain',continueBatch:true,detail:'menu result not confirmed'});assert.equal(result.run.status,'running');assert.equal(h.read().dataset.unfollowLog.first.outcome,'uncertain');
 assert.equal((await h.send({type:'unfollowNext',...token})).handle,'second');
 await h.send({type:'unfollowResult',...token,handle:'second',outcome:'success'});await h.send({type:'unfollowNext',...token});
 assert.equal((await h.send({...create,handles:['first']})).ok,false);
});

test('a new control page can resume remaining accounts after a stopped failure without replaying it',async()=>{
 const h=harness();await h.send({type:'newCycle',owner:'me'});const cycle=h.read().dataset.createdAt;
 await h.send({type:'capture',owner:'me',kind:'following',cycle,rows:[{handle:'first'},{handle:'second'}]},{tab:{id:1},url:'https://x.com/me/following'});
 const started=await h.send({type:'unfollowCreate',cycle,controller:'old',delay:5,handles:['first','second']});const token={runId:started.run.id,controller:'old'};
 await h.send({type:'unfollowNext',...token});
 await h.send({type:'unfollowControl',...token,action:'stop'});
 assert.equal((await h.send({type:'unfollowControl',...token,controller:'new',action:'resume'})).ok,false);
 await h.send({type:'unfollowResult',...token,handle:'first',outcome:'uncertain',detail:'unknown result'});
 const resumed=await h.send({type:'unfollowControl',...token,controller:'new',action:'resume'});
 assert.equal(resumed.run.status,'running');assert.equal(resumed.run.results.length,1);
 assert.equal((await h.send({type:'unfollowNext',...token})).ok,false);
 assert.equal((await h.send({type:'unfollowNext',...token,controller:'new'})).handle,'second');
});
