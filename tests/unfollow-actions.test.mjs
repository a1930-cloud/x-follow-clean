import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../unfollow-actions.js',import.meta.url),'utf8');
test('read-only readiness waits for hydration and rejects a different signed-in account',()=>{
 const {document}=parseHTML('<html><body></body></html>');
 const location={origin:'https://x.com',pathname:'/target'};
 const context=vm.createContext({document,location});vm.runInContext(source,context);
 assert.equal(context.inspectProfileLoad('target','me').state,'loading');
 document.body.innerHTML='<a data-testid="AppTabBar_Profile_Link" href="/me"></a><main data-testid="primaryColumn"><div data-testid="UserName"><span>@target</span></div></main>';
 assert.equal(context.inspectProfileLoad('target','me').state,'ready');
 document.querySelector('a').setAttribute('href','/other');
 assert.equal(context.inspectProfileLoad('target','me').state,'fatal');
 document.querySelector('a').setAttribute('href','/me');
 const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='Something went wrong. Try again.';document.body.append(notice);
 assert.equal(context.inspectProfileLoad('target','me').state,'loading');
 notice.textContent='Rate limit exceeded';
 assert.equal(context.inspectProfileLoad('target','me').state,'fatal');
});
test('restricted account interstitial is identified without clicking through',()=>{
 const {document}=parseHTML('<html><body><a data-testid="AppTabBar_Profile_Link" href="/me"></a><main data-testid="primaryColumn"><div data-testid="UserName"><span>@target</span></div><h2>Caution: This account is temporarily restricted</h2><button>Yes, view profile</button></main></body></html>');
 const context=vm.createContext({document,location:{origin:'https://x.com',pathname:'/target'}});
 vm.runInContext(source,context);
 let clicks=0;document.querySelector('button').onclick=()=>clicks++;
 assert.equal(context.inspectProfileLoad('target','me').state,'restricted');
 assert.equal(clicks,0);
 document.querySelector('[data-testid="UserName"] span').textContent='@other';
 assert.equal(context.inspectProfileLoad('target','me').state,'loading');
});
function harness({owner='me',mutual=false,kept=false,dialogHandle='target',stopAtConfirm=false,noTransition=false,already=false,dialogRole='alertdialog',creator=false,subscriptionAtStart=false,subscriptionAfterSubmit=false,wrongMenu=false,directMenu=false,profileDelay=0,missingButton=false}={}){
 const {document}=parseHTML(`<html><body><a data-testid="AppTabBar_Profile_Link" href="https://x.com/${owner}"></a><main data-testid="primaryColumn"><div data-testid="UserName"><span>@target</span></div>${mutual?'<div data-testid="userFollowIndicator">Follows you</div>':''}<button data-testid="123-${already?'follow':'unfollow'}">${already?'Follow':'Following'}</button><section aria-label="Timeline: Tweets"><button data-testid="999-unfollow">Other</button></section><aside><button data-testid="888-unfollow">Other</button></aside></main></body></html>`);
 let clicks=0, submitted=0, wrongClicks=0, paidClicks=0, closed=0;
 const pageLocation={origin:'https://x.com',pathname:'/target'};
 function subscription(){
  pageLocation.pathname='/target/creator-subscriptions/subscribe';const popup=document.createElement('div');popup.setAttribute('role','dialog');popup.innerHTML='<button aria-label="Close">X</button><h2>Subscribe</h2><button aria-label="Subscribe · $2.00/month">Subscribe</button>';document.body.append(popup);
  popup.querySelector('[aria-label="Close"]').onclick=()=>{closed++;popup.remove();pageLocation.pathname='/target';};popup.querySelectorAll('button')[1].onclick=()=>paidClicks++;
 }
 const query=document.querySelector.bind(document);let profileChecks=0;document.querySelector=selector=>selector==='a[data-testid="AppTabBar_Profile_Link"]' && ++profileChecks<=profileDelay?null:query(selector);
 const dataset={owner:'me',createdAt:1,following:{target:{}},followers:{},review:kept?{target:'keep'}:{}};
 const run={id:'job',current:'target',status:'running',leaseUntil:Date.now()+100000};
 const button=document.querySelector('[data-testid^="123-"]');
 document.querySelectorAll('[data-testid="999-unfollow"], [data-testid="888-unfollow"]').forEach(el=>el.addEventListener('click',()=>wrongClicks++));
 const openConfirm=()=>{
  const dialog=document.createElement('div');dialog.setAttribute('role',dialogRole);dialog.innerHTML=`<div data-testid="confirmationSheetDialog"><h1 role="heading">Unfollow @${dialogHandle}?</h1><p>Their posts will no longer show up in your Following timeline.</p><button data-testid="confirmationSheetConfirm">Unfollow</button><button data-testid="confirmationSheetCancel">Cancel</button></div>`;document.body.append(dialog);
  if(stopAtConfirm)run.status='stopped';
  dialog.querySelector('button').addEventListener('click',()=>{submitted++;if(!noTransition){if(!creator)button.setAttribute('data-testid','123-follow');button.setAttribute('aria-label','Follow @target');button.textContent='Follow';dialog.remove();if(subscriptionAfterSubmit)subscription();}});
 };
 if(creator){button.removeAttribute('data-testid');button.setAttribute('aria-label',already?'Follow @target':'Unfollow @target');button.setAttribute('aria-haspopup','menu');const subscribe=document.createElement('button');subscribe.setAttribute('data-testid','123-unfollow');subscribe.setAttribute('aria-label','Subscribe to @target');subscribe.textContent='Subscribe';subscribe.onclick=()=>paidClicks++;button.after(subscribe);}
 button.onclick=()=>{clicks++;if(!creator){openConfirm();return;}const menu=document.createElement('div');menu.setAttribute('role','menu');menu.innerHTML='<div role="menuitem">Unfollow @'+(wrongMenu?'other':'target')+'</div>';document.body.append(menu);menu.firstChild.onclick=()=>{menu.remove();if(directMenu){button.setAttribute('aria-label','Follow @target');button.textContent='Follow';}else openConfirm();};};
 if(subscriptionAtStart)subscription();
 if(missingButton)button.remove();
 const context=vm.createContext({document,location:pageLocation,URL,Date,setTimeout:fn=>{queueMicrotask(fn);return 1;},chrome:{storage:{local:{get:async()=>({dataset,unfollowRun:run})}}}});
 vm.runInContext(source,context);
 return {execute:()=>context.performUnfollow({runId:'job',owner:'me',cycle:1,handle:'target'}),counts:()=>({clicks,submitted,wrongClicks}),paid:()=>paidClicks,closed:()=>closed};
}
test('unfollow only exact profile and exact confirmation; verify final state',async()=>{
 for(const dialogRole of ['alertdialog','dialog']){const h=harness({dialogRole});assert.equal((await h.execute()).outcome,'success');assert.deepEqual(h.counts(),{clicks:1,submitted:1,wrongClicks:0});}
});
test('protect logged-in account, mutuals and kept accounts',async()=>{
 for(const options of [{owner:'other'},{mutual:true},{kept:true}]){const h=harness(options);assert.notEqual((await h.execute()).outcome,'success');assert.equal(h.counts().clicks,0);}
});
test('wrong confirmation and stop before confirmation never submit',async()=>{
 for(const options of [{dialogHandle:'target_other'},{stopAtConfirm:true}]){const h=harness(options);assert.equal((await h.execute()).outcome,options.stopAtConfirm?'cancelled':'uncertain');assert.equal(h.counts().submitted,0);}
});
test('clicked without confirmation of final state is uncertain; already unfollowed is not clicked',async()=>{
 const h=harness({noTransition:true});assert.equal((await h.execute()).outcome,'uncertain');assert.equal(h.counts().submitted,1);
 const a=harness({already:true});assert.equal((await a.execute()).outcome,'already');assert.equal(a.counts().clicks,0);
});

test('creator menu uses semantic action, never the Subscribe button with misleading unfollow id',async()=>{
 const h=harness({creator:true});assert.equal((await h.execute()).outcome,'success');assert.equal(h.paid(),0);assert.equal(h.counts().submitted,1);
 const wrong=harness({creator:true,wrongMenu:true});assert.equal((await wrong.execute()).outcome,'uncertain');assert.equal(wrong.counts().submitted,0);assert.equal(wrong.paid(),0);
});
test('known subscription promotion can be closed before or after unfollow, without payment clicks',async()=>{
 for(const options of [{creator:true,subscriptionAtStart:true},{creator:true,subscriptionAfterSubmit:true}]){const h=harness(options);assert.equal((await h.execute()).outcome,'success');assert.equal(h.closed(),1);assert.equal(h.paid(),0);assert.equal(h.counts().submitted,1);}
});

test('creator menu may unfollow directly without a confirmation dialog',async()=>{
 const h=harness({creator:true,directMenu:true});
 assert.equal((await h.execute()).outcome,'success');
 assert.equal(h.counts().submitted,0);
 assert.equal(h.paid(),0);
});

test('waits for X to render the signed-in profile link before deciding the account is wrong',async()=>{
 const h=harness({profileDelay:40});
 assert.equal((await h.execute()).outcome,'success');
 assert.equal(h.counts().submitted,1);
});
test('a profile that never loads pauses safely before any click',async()=>{
 const h=harness({profileDelay:1000});
 assert.equal((await h.execute()).outcome,'network_pause');
 assert.deepEqual(h.counts(),{clicks:0,submitted:0,wrongClicks:0});
});

test('missing buttons skip without clicking; uncertain local result continues without retry',async()=>{
 const missing=harness({missingButton:true});assert.equal((await missing.execute()).outcome,'skipped');assert.equal(missing.counts().clicks,0);
 const pending=harness({noTransition:true});const result=await pending.execute();assert.equal(result.outcome,'uncertain');assert.equal(result.continueBatch,true);assert.equal(pending.counts().submitted,1);
});

test('a stuck read-only injection times out so reload can proceed; late rejection is handled',async()=>{
 const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(source,context);
 let rejectLater;
 const hung=new Promise((resolve,reject)=>{rejectLater=reject;});
 await assert.rejects(context.unfollowDeadline(hung,5),/页面响应超时/);
 rejectLater(new Error('renderer later closed'));
 assert.equal(await context.unfollowDeadline(Promise.resolve('ready'),20),'ready');
 await assert.rejects(context.unfollowDeadline(Promise.reject(new Error('tab closed')),20),/tab closed/);
});
