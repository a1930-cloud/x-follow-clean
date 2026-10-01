importScripts('core.js', 'unfollow-core.js', 'unfollow-background.js');
const {normalize, route, blank, merge} = FollowReview;
// Serialize read/modify/write operations across every tab to prevent lost updates.
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  queue = queue.catch(() => {}).then(async () => {
    const ownPage = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (message.type === 'capture') {
      const actual = route(sender.url);
      const owner = normalize(message.owner);
      const local = await chrome.storage.local.get(['owner', 'dataset']);
      if (!sender.tab || !actual || !owner || owner !== local.owner || actual.owner !== owner || actual.kind !== message.kind || local.dataset?.createdAt !== message.cycle) throw new Error('页面、账号或收集批次已变化，请重新开始收集。');
      if (!Array.isArray(message.rows) || message.rows.length > 1000) throw new Error('页面记录异常。');
      const next = merge(local.dataset, actual.kind, message.rows);
      await chrome.storage.local.set({dataset:next});
      return {ok:true, count:Object.keys(next[actual.kind]).length};
    }
    if (!ownPage) throw new Error('不支持的请求。');
    if (message.type?.startsWith('unfollow')) return handleUnfollow(message);
    if (message.type === 'newCycle') {
      const {unfollowRun}=await chrome.storage.local.get('unfollowRun');
      if(unfollowRun && ['running','paused'].includes(unfollowRun.status) && unfollowRun.leaseUntil>Date.now()) throw new Error('请先停止取关任务，再更换清单。');
      const owner = normalize(message.owner);
      if (!owner) throw new Error('请输入有效的 X 用户名。');
      await chrome.storage.local.set({owner, dataset:blank(owner)});
      return {ok:true};
    }
    const {dataset} = await chrome.storage.local.get('dataset');
    if (!dataset || message.cycle !== dataset.createdAt) throw new Error('这份清单已更换，请刷新页面。');
    if (message.type === 'review') {
      const handle = normalize(message.handle);
      if (!handle || !Object.hasOwn(dataset.following,handle) || !['pending','keep','reviewed'].includes(message.value)) throw new Error('无效的审核标记。');
      Object.defineProperty(dataset.review,handle,{value:message.value,enumerable:true,writable:true,configurable:true});
    } else if (message.type === 'coverage') {
      for (const kind of ['following','followers']) {
        const value = message.expected?.[kind];
        if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('数量必须是非负整数。');
        dataset.expected[kind] = value;
        dataset.notes[kind] = message.notes?.[kind] === true;
      }
    } else throw new Error('不支持的请求。');
    await chrome.storage.local.set({dataset});
    return {ok:true};
  });
  queue.then(respond, error => respond({ok:false,error:error.message}));
  return true;
});
