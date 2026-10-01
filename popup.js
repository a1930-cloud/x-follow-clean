const $ = id => document.getElementById(id);
let activeTab;
function report(text, error=false) { $('status').textContent=text; $('status').className=error?'error':''; }
async function init() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); activeTab=tab;
  const {owner,dataset} = await chrome.storage.local.get(['owner','dataset']);
  if (owner) { $('owner').value=owner; $('owner').readOnly=true; }
  const current=FollowReview.route(tab?.url);
  if (!current) { $('start').disabled=true; $('stop').disabled=true; report('请先在 X 打开自己的关注列表或全部粉丝列表。'); return; }
  report(`当前：@${current.owner} 的${current.kind==='following'?'关注':'粉丝'}列表。`);
  try { const s=await chrome.tabs.sendMessage(tab.id,{type:'collectorStatus'}); if(s.running) { report(s.info); $('autoScroll').checked=s.autoScroll; } } catch {}
}
$('start').onclick=async()=>{
  $('start').disabled=true;
  try {
    const owner=FollowReview.normalize($('owner').value);
    if(!owner) throw new Error('请输入你的 X 用户名，不含主页地址。');
    const current=FollowReview.route(activeTab?.url);
    if(!current || current.owner!==owner) throw new Error('当前页面与填写的用户名不一致。');
    let {dataset}=await chrome.storage.local.get('dataset');
    if(!dataset) { const result=await chrome.runtime.sendMessage({type:'newCycle',owner}); if(!result.ok) throw new Error(result.error); ({dataset}=await chrome.storage.local.get('dataset')); }
    if(dataset.owner!==owner) throw new Error('请先在本地清单中更换账号。');
    await chrome.scripting.executeScript({target:{tabId:activeTab.id},files:['core.js','collector.js']});
    const result=await chrome.tabs.sendMessage(activeTab.id,{type:'start',owner,cycle:dataset.createdAt,autoScroll:$('autoScroll').checked});
    if(!result?.ok) throw new Error(result?.error||'开启失败');
    $('owner').readOnly=true;report($('autoScroll').checked ? '已开启自动滚动。关闭小窗口，保持 X 标签页可见；按 Esc 或点击停止即可结束。45 秒无新增会停止，不表示名单完整。' : '已开启，请滚动 X 列表。刷新或换列表后需重新开启。');
  } catch(e) { report(e.message,true); } finally {$('start').disabled=false;}
};
$('stop').onclick=async()=>{try{await chrome.tabs.sendMessage(activeTab.id,{type:'stop'});report('当前页已停止，已收集数据保留。');}catch{report('当前页没有运行中的收集器。');}};
$('open').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')});
chrome.storage.onChanged.addListener((changes)=>{ if(changes.dataset?.newValue) { const d=changes.dataset.newValue;report(`已保存：关注 ${Object.keys(d.following).length} · 粉丝 ${Object.keys(d.followers).length}。`); } });
init().catch(e=>report(e.message,true));

setInterval(async()=>{if(!activeTab?.id)return;try{const s=await chrome.tabs.sendMessage(activeTab.id,{type:'collectorStatus'});report(s.info);}catch{}},1500);
