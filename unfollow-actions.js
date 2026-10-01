// Bound read-only injections: a loading renderer must not block the reload loop.
function unfollowDeadline(promise, milliseconds) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('页面响应超时')),milliseconds);
    Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}

// Read-only check before attempting any page action; safe to repeat after a reload.
function inspectProfileLoad(handle,owner){
  const path=location.pathname.replace(/\/$/,'').toLowerCase();
  if(location.origin!=='https://x.com' || (path!=='/'+handle && path!=='/'+handle+'/creator-subscriptions/subscribe'))return {state:'fatal',detail:'执行页面已变化'};
  const challenge=document.querySelector('[data-testid="ocfEnterTextTextInput"], iframe[src*="arkoselabs"]');
  const error=document.querySelector('[data-testid="error-detail"]');
  const notices=[...document.querySelectorAll('[role="alert"], [data-testid="toast"]')].map(el=>el.textContent).join(' ');
  if(challenge || /rate.?limit|verify|验证|频率|上限/i.test(notices))return {state:'fatal',detail:'X 出现限制或验证提示'};
  if(error || /try again|something went wrong|出错|稍后/i.test(notices))return {state:'loading'};
  const own=document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  const ownHandle=own?.getAttribute('href')?.split(/[?#]/)[0].replace(/^\/|\/$/g,'').toLowerCase();
  if(ownHandle && ownHandle!==owner)return {state:'fatal',detail:'登录账号与名单不一致'};
  if(!ownHandle)return {state:'loading'};
  if(path.endsWith('/creator-subscriptions/subscribe'))return {state:'ready'};
  const primary=document.querySelector('[data-testid="primaryColumn"]');
  const identity=primary?.querySelector('[data-testid="UserName"]');
  if(!identity)return {state:'loading'};
  const identified=[...identity.querySelectorAll('span')].some(el=>el.textContent.trim().toLowerCase()==='@'+handle);
  if(!identified)return {state:'loading'};
  const restricted=/caution:\s*this account is temporarily restricted/i.test(primary.textContent.replace(/\s+/g,' '));
  if(restricted){
    const proceed=[...primary.querySelectorAll('button, [role="button"]')].some(el=>/^yes,? view profile$/i.test(el.textContent.replace(/\s+/g,' ').trim()));
    return {state:proceed?'restricted':'loading'};
  }
  return {state:'ready'};
}

// Runs inside the selected X profile tab. No remote code, cookies, or private API calls.
async function performUnfollow(task) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let submitted = false, touched = false, dismissedSubscriptions = 0;
  const progress = message => {
    const text=document.getElementById('follow-review-execution-status')?.shadowRoot?.getElementById('message');
    if(text)text.textContent=message;
  };
  const result = (outcome, detail) => {
    progress(`留关 · @${task.handle}\n${detail}`);
    return {outcome, detail};
  };
  function inspect() {
    if (location.origin !== 'https://x.com' || location.pathname.replace(/\/$/,'').toLowerCase() !== '/'+task.handle) throw new Error('执行页面已变化');
    const own = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (!own) throw new Error('X 主页尚未加载登录账号');
    if (new URL(own.href).pathname.replace(/^\/|\/$/g,'').toLowerCase() !== task.owner) throw new Error('登录账号与名单不一致');
    const primary = document.querySelector('[data-testid="primaryColumn"]');
    const identity = primary?.querySelector('[data-testid="UserName"]');
    if (!identity) throw new Error('X 主页尚未加载目标账号');
    const identified = identity && [...identity.querySelectorAll('span')].some(el=>el.textContent.trim().toLowerCase()==='@'+task.handle);
    if (!identified) throw new Error('无法确认主页账号，已停止');
    const challenge = document.querySelector('[data-testid="ocfEnterTextTextInput"], iframe[src*="arkoselabs"]');
    const error = document.querySelector('[data-testid="error-detail"]');
    const notices = [...document.querySelectorAll('[role="alert"], [data-testid="toast"]')].map(el=>el.textContent).join(' ');
    if (challenge || /rate.?limit|verify|验证|频率|上限/i.test(notices)) throw new Error('X 出现限制或验证提示');
    if (error || /try again|something went wrong|出错|稍后/i.test(notices)) throw new Error('X 主页暂时出错');
    const controls = selector => [...primary.querySelectorAll(selector)].filter(el=>!el.closest('[data-testid="UserCell"], [data-testid="tweet"], aside, [aria-label^="Timeline:"], [aria-label^="时间线"]'));
    const badge = controls('[data-testid="userFollowIndicator"]').find(el=>/^(follows you|关注了你|關注你|正在关注你|跟隨你|跟随你)$/i.test(el.textContent.trim()));
    // X can put a misleading "<id>-unfollow" test id on a paid Subscribe button.
    // Action labels and the exact target handle take priority over test ids.
    const clean = value => (value || '').replace(/\s+/g,' ').trim().toLowerCase();
    const actionLabel = (value, verbs) => {
      const label=clean(value), handles=label.match(/@[a-z0-9_]+/g)||[];
      return handles.length===1 && handles[0]==='@'+task.handle
        && verbs.includes(label.replace('@'+task.handle,'').trim());
    };
    const candidates=controls('button, [role="button"]').filter(el=>{
      const label=clean(el.getAttribute('aria-label')), text=clean(el.textContent);
      return !/subscrib|subscription|订阅|訂閱|購読|购买|購買|\$/.test(label+' '+text)
        && (!el.getClientRects || el.getClientRects().length>0);
    });
    const unfollowVerbs=['following','unfollow','正在关注','已关注','取消关注','正在關注','已關注','取消關注','正在跟隨','跟隨中','取消跟隨'];
    const followVerbs=['follow','关注','關注','跟隨','跟随'];
    const matches=(el,verbs,suffix)=>{
      const label=clean(el.getAttribute('aria-label'));
      if(label)return actionLabel(label,verbs);
      return (el.getAttribute('data-testid')||'').endsWith(suffix) && verbs.includes(clean(el.textContent));
    };
    const buttons=candidates.filter(el=>matches(el,unfollowVerbs,'-unfollow'));
    const followButtons=candidates.filter(el=>matches(el,followVerbs,'-follow'));
    return {badge, buttons, followButtons};
  }
  async function guard() {
    const {dataset,unfollowRun:run} = await chrome.storage.local.get(['dataset','unfollowRun']);
    if (!run || run.id !== task.runId || run.current !== task.handle || run.status !== 'running' || run.leaseUntil < Date.now()) throw new Error('任务已暂停、停止或控制页已关闭');
    if (!dataset || dataset.owner !== task.owner || dataset.createdAt !== task.cycle || !Object.hasOwn(dataset.following,task.handle)) throw new Error('名单或账号已变化');
    if (dataset.review?.[task.handle] === 'keep' || Object.hasOwn(dataset.followers || {},task.handle) || dataset.following[task.handle].positiveFollow) return false;
    return true;
  }
  async function dismissSubscription() {
    const path=location.pathname.replace(/\/$/,'').toLowerCase();
    if(location.origin!=='https://x.com' || path!==`/${task.handle}/creator-subscriptions/subscribe`) return false;
    if(!await guard())throw new Error('账号已受到保护，停止处理订阅弹窗');
    if(++dismissedSubscriptions>2)throw new Error('订阅弹窗反复出现，已停止');
    const dialogs=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
    if(dialogs.length!==1)throw new Error('无法唯一识别订阅弹窗，已停止');
    const buttons=[...dialogs[0].querySelectorAll('button, [role="button"]')].filter(el=>/^(close|关闭|關閉)$/i.test((el.getAttribute('aria-label')||'').trim()));
    if(buttons.length!==1 || buttons[0].disabled)throw new Error('未找到订阅弹窗的关闭按钮，已停止');
    progress(`留关 · @${task.handle}\n关闭订阅推广，返回主页核对关注状态…`);
    buttons[0].click();
    for(let i=0;i<20;i++){
      if(location.origin==='https://x.com' && location.pathname.replace(/\/$/,'').toLowerCase()==='/'+task.handle && !document.querySelector('[role="dialog"], [role="alertdialog"]'))return true;
      await sleep(200);
    }
    throw new Error('订阅弹窗关闭后未返回目标主页，已停止');
  }
  try {
    // Wait for a fresh profile to finish rendering; never click a fallback control.
    let view, readyError;
    for (let attempt=0;attempt<85;attempt++) {
      if (!await guard()) return result('skipped','已保留或找到回关证据');
      try { await dismissSubscription(); view=inspect(); readyError=null; break; } catch(error) { readyError=error; }
      await sleep(300);
    }
    if (!view) throw readyError || new Error('主页加载超时');
    if (view.badge) return result('skipped','主页显示“关注了你”');
    if (!view.buttons.length && view.followButtons.length===1) return result('already','主页已显示关注按钮');
    if (view.buttons.length !== 1 || view.buttons[0].disabled) return result('skipped','未找到唯一可用的取关按钮，未点击，留待人工核对');
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) throw new Error('页面已有弹窗，请先手动处理');
    if (!await guard()) return result('skipped','已保留或找到回关证据');
    view=inspect();
    if(view.badge) return result('skipped','主页显示“关注了你”');
    if(view.buttons.length!==1 || view.buttons[0].disabled) return result('skipped','取关按钮状态已变化，未点击，留待人工核对');
    const buttonId=view.buttons[0].getAttribute('data-testid');
    progress(`留关 · @${task.handle}\n正在核对并确认取关弹窗…`);
    touched=true;
    view.buttons[0].click();
    let confirm, dialog, menuClicked=false;
    const openedMenu=view.buttons[0].getAttribute('aria-haspopup')==='menu';
    for(let attempt=0;attempt<20;attempt++) {
      if(!await guard()) return result('skipped','已保留或找到回关证据');
      if(await dismissSubscription())return result('skipped','已关闭订阅推广；本账号未提交取关，留待核对');
      inspect();
      if(openedMenu && !menuClicked){
        const menus=[...document.querySelectorAll('[role="menu"]')];
        const menu=menus.length===1?menus[0]:menus.length===0?document.querySelector('[data-testid="Dropdown"]'):null;
        if(menu){
          const items=[...menu.querySelectorAll('[role="menuitem"]')].filter(el=>{
            const label=(el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
            return ['unfollow','取消关注','取消關注','取消跟隨'].some(word=>label===word+' @'+task.handle || label===word);
          });
          if(items.length!==1)throw new Error('未找到唯一的取关菜单项，已停止');
          if(!await guard())return result('skipped','已保留或找到回关证据');
          if(inspect().badge)return result('skipped','主页显示“关注了你”');
          submitted=true;items[0].click();menuClicked=true;
          progress(`留关 · @${task.handle}\n已选择取关菜单，等待确认框…`);
        }
      }
      const dialogs=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      if(menuClicked && dialogs.length===0){
        const current=inspect();
        if(!current.badge && !current.buttons.length && current.followButtons.length===1)
          return result('success','取关菜单执行后，主页已显示“关注”');
      }
      if(dialogs.length===1) {
        dialog=dialogs[0];
        const heading=dialog.querySelector('[role="heading"], h1, h2');
        const headingText=heading?.textContent || '';
        const handles=headingText.match(/@[a-zA-Z0-9_]+/g) || [];
        if(handles.some(handle=>handle.toLowerCase()==='@'+task.handle) && /unfollow|取消关注|取消關注|取消跟隨|取消跟随/i.test(headingText)) {
          confirm=dialog.querySelector('[data-testid="confirmationSheetConfirm"]');
          if(confirm && !confirm.disabled) break;
        }
      }
      await sleep(200);
    }
    if(!confirm) throw new Error(menuClicked?'菜单操作后未确认最终关注状态，请手动核对':'未找到与目标账号一致的取关确认框');
    if(!await guard()) return result('skipped','已保留或找到回关证据');
    view=inspect();
    if(view.badge) return result('skipped','主页显示“关注了你”');
    if(!confirm.isConnected || !dialog.isConnected || document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length!==1) throw new Error('确认框已变化');
    submitted=true;
    confirm.click();
    progress(`留关 · @${task.handle}\n已提交，正在确认取关结果…`);
    const expectedFollowId=buttonId?.replace(/-unfollow$/,'-follow');
    for(let attempt=0;attempt<40;attempt++) {
      await sleep(250);
      await dismissSubscription();
      view=inspect();
      if(!document.querySelector('[role="dialog"], [role="alertdialog"]') && !view.buttons.length && view.followButtons.length===1 && (!expectedFollowId || view.followButtons[0].getAttribute('data-testid')===expectedFollowId || !!view.followButtons[0].getAttribute('aria-label'))) return result('success','X 主页已从“正在关注”变为“关注”');
    }
    throw new Error('已提交取关，但未确认最终状态，请手动核对');
  } catch(error) {
    const detail=error.message || '执行失败';
    const transient=/^X 主页(尚未加载|暂时出错)/.test(detail);
    const localFailure=/^(未找到唯一的取关菜单项|菜单操作后未确认最终关注状态|未找到与目标账号一致的取关确认框|确认框已变化|已提交取关，但未确认最终状态|页面已有弹窗)/.test(detail);
    if(localFailure)return {...result(touched?'uncertain':'skipped',detail),continueBatch:true};
    return result(submitted || (touched && transient)?'uncertain':transient?'network_pause':'cancelled',detail);
  }
}

// A visible progress label on the execution tab; no action controls or remote resources.
function showUnfollowProgress(message) {
  let host=document.getElementById('follow-review-execution-status');
  if(!host){
    host=document.createElement('div');host.id='follow-review-execution-status';
    host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:350px;pointer-events:none';
    const shadow=host.attachShadow({mode:'open'});
    const text=document.createElement('div');text.id='message';text.setAttribute('role','status');
    text.style.cssText='font:14px/1.6 system-ui,sans-serif;white-space:pre-line;background:#182236;color:#e9effb;border:1px solid #6199ff;border-radius:12px;padding:16px;box-shadow:0 4px 20px #0005';
    shadow.append(text);document.documentElement.append(host);
  }
  const text=host.shadowRoot?.getElementById('message');if(text)text.textContent=message;
}
