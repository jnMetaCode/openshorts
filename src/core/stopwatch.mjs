/**
 * 报给用户的"出片耗时"不能把机器休眠算进去。
 *
 * 真机报过 39477 s：那台 Mac 中途睡了 10.8 小时，真实出片约 10 分钟。`Date.now()` 是墙上时间，
 * 合盖再打开它就跳。单调钟（hrtime / performance.now）在 macOS 上算不算休眠又取决于 libuv 版本，
 * 读代码定不了——所以不赌时钟语义，直接测"事件循环有没有断片"：每秒 tick 一次，两次 tick 之间
 * 隔了远超一秒（默认 10 秒）的，就当机器睡过去了，从耗时里扣掉并单独报出来。
 * 代价：一个同步阻塞超过 10 秒的操作也会被当成休眠——出片链路里没有这么长的同步操作。
 */
export function startStopwatch({ tickMs = 1000, gapMs = 10_000, now = Date.now } = {}) {
  const t0 = now(); let last = t0; let suspendedMs = 0;
  const settle = () => { const t = now(); const gap = t - last; if (gap > gapMs) suspendedMs += gap - tickMs; last = t; return t; };
  const timer = setInterval(settle, tickMs); timer.unref();   // 别让计时器拖着进程不退出
  return {
    stop() { clearInterval(timer); const t = settle(); const wallMs = t - t0; return { wallMs, activeMs: wallMs - suspendedMs, suspendedMs }; },
  };
}

/** "35 秒" / "12 分钟" / "1.5 小时"，中英各一套 */
export const humanDuration = (ms, lang = 'zh') => {
  const s = ms / 1000;
  if (lang === 'en') return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
  return s < 90 ? `${Math.round(s)} 秒` : s < 5400 ? `${Math.round(s / 60)} 分钟` : `${(s / 3600).toFixed(1)} 小时`;
};

/** 耗时说明：活跃时间为主，睡过就补一句，不让 39477 s 这种数字再出现 */
export const elapsedText = (r, lang = 'zh') => {
  const main = humanDuration(r.activeMs, lang);
  if (!r.suspendedMs) return main;
  return lang === 'en' ? `${main} (plus ${humanDuration(r.suspendedMs, 'en')} while the machine was asleep, not counted)` : `${main}（另有 ${humanDuration(r.suspendedMs)}机器在休眠，未计入）`;
};
