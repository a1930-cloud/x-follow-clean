import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('auto-scroll pauses when hidden, stops on Escape and idle timeout', async()=>{
 let receive, tick, time=10000, scrolls=0, finishSave; let rows=[{handle:"person"}]; const events={};
 const document={hidden:false,addEventListener:(name,fn)=>events[name]=fn,querySelector:selector=>selector.includes('AppTabBar')?{href:'https://x.com/owner'}:null,body:{},scrollingElement:{scrollHeight:9000}};
 const context={document,location:{href:'https://x.com/owner/following'},window:{innerHeight:1000,scrollTo:options=>{assert.equal(options.top,9000);scrolls++;}},Date:{now:()=>time},Map,JSON,URL,Math,setTimeout:()=>1,clearTimeout:()=>{},setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{},MutationObserver:class{observe(){}disconnect(){}},FollowReview:{normalize:x=>x,route:()=>({owner:'owner',kind:'following'}),cellRows:()=>rows},chrome:{runtime:{id:'extension',onMessage:{addListener:fn=>receive=fn},sendMessage:()=>new Promise(resolve=>{finishSave=()=>resolve({ok:true,count:rows.length});})}}};
 vm.runInNewContext(readFileSync(new URL('../collector.js',import.meta.url),'utf8'),context);
 const message=value=>{let result;receive(value,{id:'extension'},r=>result=r);return result;};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 message({type:'start',owner:'owner',cycle:1,autoScroll:true});await flush();assert.equal(scrolls,0,'must save before jumping');finishSave();await flush();assert.equal(scrolls,1);
 rows=[{handle:'person'},{handle:'second'}];const capture=tick();assert.equal(scrolls,1);finishSave();await capture;assert.equal(scrolls,2,'new saved accounts trigger immediate jump without advancing clock');scrolls=1;
 document.hidden=true;time+=5000;await tick();assert.equal(scrolls,1);
 document.hidden=false;events.visibilitychange();time+=3000;await tick();assert.equal(scrolls,2);
 events.keydown({key:'Escape'});assert.equal(message({type:'collectorStatus'}).running,false);await tick();assert.equal(scrolls,2);
 message({type:'start',owner:'owner',cycle:1,autoScroll:true});finishSave();await flush();time+=46000;await tick();assert.equal(message({type:'collectorStatus'}).running,false);assert.match(message({type:'collectorStatus'}).info,/45 秒/);
 message({type:'start',owner:'owner',cycle:1,autoScroll:false});finishSave();await flush();const before=scrolls;time+=5000;await tick();assert.equal(scrolls,before);
});
