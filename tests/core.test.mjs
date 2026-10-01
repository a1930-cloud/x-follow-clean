import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../core.js';
const {normalize,route,blank,merge,compare,cellRows,csvCell}=globalThis.FollowReview;
test('reject wrong sites and verified-follower subsets',()=>{
  assert.deepEqual(route('https://x.com/NorrisChen1024/followers'),{owner:'norrischen1024',kind:'followers',path:'/NorrisChen1024/followers'});
  for(const url of ['https://evil.example/a/followers','https://x.com/a/verified_followers','https://x.com/a/followers_you_follow','https://x.com/a','http://x.com/a/following']) assert.equal(route(url),null);
  assert.equal(normalize('@Example'),'example');assert.equal(normalize('https://x.com/me'),null);
});
test('7000 following and 5000 followers: unmatched are unknown, never confirmed negatives',()=>{
  const state=blank('me');
  merge(state,'following',Array.from({length:7000},(_,i)=>({handle:'user'+i,name:'Name '+i})),1);
  merge(state,'followers',Array.from({length:5000},(_,i)=>({handle:'user'+i,name:'Name '+i})),2);
  const result=compare(state);
  assert.equal(result.length,7000);
  assert.equal(result.filter(x=>x.relationship==='observed').length,5000);
  assert.equal(result.filter(x=>x.relationship==='unknown').length,2000);
});
test('deduplicates and retains positive evidence when later rendering omits badge',()=>{
  const state=blank('me');merge(state,'following',[{handle:'Alice',positiveFollow:true}],10);
  merge(state,'following',[{handle:'alice',positiveFollow:false},{handle:'me'},{handle:'constructor'},{handle:'__proto__'}],20);
  assert.equal(Object.keys(state.following).length,3);
  assert.equal(compare(state).find(x=>x.handle==='alice').relationship,'observed');
  assert.equal(state.following.alice.firstSeen,10);assert.equal(compare(state).find(x=>x.handle==='constructor').review,'pending');
  assert.equal(Object.getPrototypeOf(state.following),Object.prototype);
});
const cell=(handle,extra='')=>`<div data-testid="UserCell"><div data-testid="User-Name"><a href="/${handle}"><span>名字 ${handle}</span></a><a href="/${handle}"><span>@${handle}</span></a></div>${extra}</div>`;
test('reads primary timeline only; no badge is unknown; ignores sidebar suggestions',()=>{
  const {document}=parseHTML(`<main><div data-testid="primaryColumn"><section aria-label="Timeline: Followers">${cell('alice','<span data-testid="userFollowIndicator">Follows you</span>')}${cell('bob','<p>Bio @alice</p>')}</section>${cell('outside')}</div><aside data-testid="sidebarColumn">${cell('suggested')}</aside></main>`);
  assert.deepEqual(cellRows(document).map(x=>[x.handle,x.positiveFollow]),[['alice',true],['bob',false]]);
});
test('unknown DOM / unsupported language fails closed',()=>{
  assert.deepEqual(cellRows(parseHTML('<main><a href="/someone">@someone</a></main>').document),[]);
});
test('protect CSV readers from profile-name formula injection',()=>{
  assert.equal(csvCell('=HYPERLINK("evil")'),'"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('hello,world'),'"hello,world"');
});
