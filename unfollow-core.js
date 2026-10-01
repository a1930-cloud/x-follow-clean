(function(root) {
  function eligible(dataset, handle) {
    const row = dataset?.following && Object.hasOwn(dataset.following,handle) ? dataset.following[handle] : null;
    return Boolean(row && handle !== dataset.owner && dataset.review?.[handle] !== 'keep'
      && !Object.hasOwn(dataset.followers || {}, handle) && !row.positiveFollow
      && !['in_progress','success','already','uncertain'].includes((dataset.unfollowLog && Object.hasOwn(dataset.unfollowLog,handle) ? dataset.unfollowLog[handle].outcome : null)));
  }
  const outcomes = {in_progress:'执行中',success:'已取关',already:'已不再关注',skipped:'已跳过',uncertain:'结果待核对',cancelled:'已停止'};
  root.Unfollow = {eligible, outcomes};
})(globalThis);
