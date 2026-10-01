const $=id=>document.getElementById(id);
let dataset=null, page=0;
const labels={pending:'待核对',keep:'已保留',reviewed:'已审核'};
const status=text=>$('status').textContent=text;
async function send(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error||'保存失败');}
function date(value){return new Date(value).toLocaleString('zh-CN');}
function render(){
  const all=dataset?FollowReview.compare(dataset):[];
  $('account').textContent=dataset?'@'+dataset.owner:'尚未选择账号';
  if(dataset){
    $('summary').textContent=`本轮开始：${date(dataset.createdAt)}。最近收集：${dataset.updatedAt?date(dataset.updatedAt):'尚无'}。`;
    for(const kind of ['following','followers']){$(kind+'Link').hidden=false;$(kind+'Link').href=`https://x.com/${dataset.owner}/${kind}`;}
  }
  const nf=Object.keys(dataset?.following||{}).length,np=Object.keys(dataset?.followers||{}).length;
  const positives=all.filter(row=>row.relationship==='observed').length;
  $('nFollowing').textContent=nf;$('nFollowers').textContent=np;$('nObserved').textContent=positives;$('nUnknown').textContent=all.length-positives;
  $('coverageSummary').textContent=['following','followers'].map(kind=>{
    const count=Object.keys(dataset?.[kind]||{}).length,expected=dataset?.expected[kind];
    return `${kind==='following'?'关注':'粉丝'}：已收集 ${count} / ${Number.isSafeInteger(expected)?expected:'未填总数'}；${dataset?.notes[kind]?'你已标记浏览到末尾':'未标记末尾'}`;
  }).join('。');
  $('export').disabled=!all.length;$('backup').disabled=!dataset;
  const query=$('search').value.trim().toLowerCase();
  const filtered=all.filter(row=>(row.handle.includes(query)||row.name.toLowerCase().includes(query))&&($('relationship').value==='all'||row.relationship===$('relationship').value)&&($('review').value==='all'||row.review===$('review').value));
  const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages-1);$('rows').replaceChildren();
  for(const row of filtered.slice(page*50,(page+1)*50)){
    const tr=document.createElement('tr');
    const selection=document.createElement('td');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label','选择 @'+row.handle);checkbox.disabled=!Unfollow.eligible(dataset,row.handle);checkbox.checked=globalThis.UnfollowUI?.selected.has(row.handle)||false;checkbox.onchange=()=>globalThis.UnfollowUI?.select(row.handle,checkbox.checked);selection.append(checkbox);
    const identity=document.createElement('td');const name=document.createElement('strong');name.textContent=row.name;const handle=document.createElement('small');handle.textContent='@'+row.handle;identity.append(name,handle);
    const evidence=document.createElement('td');evidence.textContent=row.relationship==='unknown'?'暂未找到，不能确定':Object.hasOwn(dataset.followers,row.handle)?'已收集粉丝中有此账号':'页面显示“关注了你”';
    const reviewed=document.createElement('td');reviewed.textContent=labels[row.review];const outcome=dataset.unfollowLog?.[row.handle];if(outcome){const detail=document.createElement('small');detail.textContent=Unfollow.outcomes[outcome.outcome]||outcome.outcome;detail.title=outcome.detail||'';reviewed.append(detail);}
    const actions=document.createElement('td');actions.className='rowActions';
    const link=document.createElement('a');link.textContent='去 X 核对 ↗';link.href='https://x.com/'+row.handle;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
    for(const [text,value] of [['保留','keep'],['已审核','reviewed'],['重置','pending']]){const button=document.createElement('button');button.textContent=text;button.onclick=()=>send({type:'review',cycle:dataset.createdAt,handle:row.handle,value}).catch(e=>status(e.message));actions.append(button);}
    tr.append(selection,identity,evidence,reviewed,actions);$('rows').append(tr);
  }
  if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent=all.length?'当前筛选没有账号。':'还未收集关注名单。打开 X 的关注页面，从插件开始收集。';tr.append(td);$('rows').append(tr);}
  globalThis.UnfollowUI?.render(dataset,filtered,page);
  $('page').textContent=`${filtered.length} 条 · ${page+1}/${pages} 页`;$('prev').disabled=page===0;$('next').disabled=page===pages-1;
}
async function load(){({dataset}=await chrome.storage.local.get('dataset'));if(dataset){$('newOwner').value=dataset.owner;for(const [kind,suffix]of [['following','Following'],['followers','Followers']]){$('expected'+suffix).value=dataset.expected[kind]??'';$('end'+suffix).checked=dataset.notes[kind]===true;}}render();}
chrome.storage.onChanged.addListener(changes=>{if(changes.dataset){dataset=changes.dataset.newValue;render();}});
for(const id of ['search','relationship','review'])$(id).addEventListener('input',()=>{page=0;render();});
$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
$('coverage').onsubmit=async event=>{event.preventDefault();if(!dataset)return status('请先开启收集。');const expected={},notes={};for(const [kind,suffix]of [['following','Following'],['followers','Followers']]){expected[kind]=$('expected'+suffix).value===''?null:Number($('expected'+suffix).value);notes[kind]=$('end'+suffix).checked;}try{await send({type:'coverage',cycle:dataset.createdAt,expected,notes});status('覆盖情况已记录；待核对账号仍需在 X 确认。');}catch(e){status(e.message);}};
function download(body,type,name){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('export').onclick=()=>{if(!dataset)return;const rows=FollowReview.compare(dataset);const body=['username,name,evidence,review,profile_url,last_seen',...rows.map(row=>[row.handle,row.name,row.relationship,row.review,'https://x.com/'+row.handle,new Date(row.lastSeen).toISOString()].map(FollowReview.csvCell).join(','))].join('\r\n');download('\uFEFF'+body,'text/csv;charset=utf-8',`${dataset.owner}-review.csv`);};
$('backup').onclick=()=>{if(dataset)download(JSON.stringify({format:'follow-review-v1',dataset},null,2),'application/json',`${dataset.owner}-backup.json`);};
$('reset').onclick=async()=>{if(!$('confirmReset').checked)return status('请先备份并勾选替换本地清单。');try{await send({type:'newCycle',owner:$('newOwner').value});$('confirmReset').checked=false;page=0;await load();status('新一轮已建立；旧收集页会停止，需要重新点击开始。');}catch(e){status(e.message);}};
load().catch(e=>status(e.message));
