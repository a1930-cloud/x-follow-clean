(() => {
  if (globalThis.__followReviewCollector) return;
  globalThis.__followReviewCollector = true;
  let running = false, target, observer, timer, polling, seen = new Map(), count = 0, info = '尚未开始', inflight = false;
  let autoScroll = false, lastNew = 0, lastScroll = 0, generation = 0;
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && running) stop('已按 Esc 停止；名单已保留。'); });
  document.addEventListener('visibilitychange', () => { lastNew = Date.now(); });
  const selfHandle = () => {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (!link) return null;
    try { return FollowReview.normalize(new URL(link.href).pathname.replace(/^\//,'').replace(/\/$/,'')); } catch { return null; }
  };
  function stop(reason) {
    generation++; running = false; observer?.disconnect(); clearTimeout(timer); clearInterval(polling);
    info = reason || '已停止；收集数据仍在本机保存。';
  }
  async function scan() {
    if (!running || inflight) return;
    const current = FollowReview.route(location.href);
    if (!current || current.owner !== target.owner || current.kind !== target.kind || selfHandle() !== target.owner) return stop('页面或登录账号已变化，请重新开始。');
    inflight = true;
    const session = generation;
    let canAdvance = false, hasNew = false;
    try {
      if (autoScroll && document.querySelector('[data-testid="error-detail"], [data-testid="ocfEnterTextTextInput"], iframe[src*="arkoselabs"]')) return stop('页面出现错误或验证，请处理后重新开始。');
      const rows = FollowReview.cellRows(document);
      hasNew = rows.some(row => !seen.has(row.handle));
      canAdvance = rows.length > 0;
      if (hasNew) lastNew = Date.now();
      const changed = rows.filter(row => seen.get(row.handle) !== JSON.stringify(row));
      if (!changed.length) { info = rows.length ? `已收集 ${count} 个账号；${autoScroll ? '自动滚动中（切到其他标签页会暂停）' : '请正常滚动列表'}。` : '还未识别到列表账号；请等待加载，或检查是否进入正确的列表。'; return; }
      const result = await chrome.runtime.sendMessage({type:'capture',...target,rows:changed});
      if (session !== generation) return;
      if (!result?.ok) return stop(result?.error || '保存失败，请重新开启收集。');
      changed.forEach(row => seen.set(row.handle,JSON.stringify(row)));
      count = result.count;
      info = `当前名单累计 ${count} 个账号；页面没有新内容不代表名单完整。`;
    } catch { stop('扩展连接已断开，请刷新 X 页面后重试。'); }
    finally {
      inflight = false;
      if (session === generation && running && autoScroll && !document.hidden) {
        if (Date.now() - lastNew >= 45000) stop('45 秒没有新增账号，已停止。可能加载受限或已到末尾，不代表名单完整。');
        else if (canAdvance && (hasNew || Date.now() - lastScroll >= 1500)) {
          lastScroll = Date.now();
          const page = document.scrollingElement || document.documentElement;
          window.scrollTo({top: page.scrollHeight, behavior:'instant'});
          info = `已收集 ${count} 个账号；已滚到底部，等待下一批加载。`; 
        }
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'collectorStatus') { respond({running,count,info,autoScroll,route:FollowReview.route(location.href)}); return; }
    if (message.type === 'stop') { stop(); respond({ok:true}); return; }
    if (message.type !== 'start') return;
    const current = FollowReview.route(location.href);
    if (!current || current.owner !== message.owner || selfHandle() !== message.owner) {
      respond({ok:false,error:'请打开你当前登录账号自己的 /following 或 /followers 页面；不支持认证粉丝子列表。'}); return;
    }
    stop(); autoScroll = message.autoScroll === true; lastNew = Date.now(); lastScroll = 0; target = {...current,cycle:message.cycle}; seen.clear(); count = 0; running = true; info = '已开启，请正常滚动页面。';
    observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan,120); });
    observer.observe(document.querySelector('main') || document.body,{childList:true,subtree:true,characterData:true});
    polling = setInterval(scan,500);
    scan(); respond({ok:true});
  });
})();
