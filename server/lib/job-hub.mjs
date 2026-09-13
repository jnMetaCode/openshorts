/**
 * 出片任务与 SSE 连接解耦。
 *
 * 以前一条 run 的生命周期就是那条 SSE：req 'close' → abort。于是刷新页面、合盖、Wi-Fi 抖一下，
 * 20 分钟的出片就作废，短剧线还在云端按秒计费。现在任务在服务端自己跑，连接只是"看"：
 * 断了活照跑；再连上从断的地方接着看（浏览器 EventSource 重连自带 Last-Event-ID，
 * 这里按事件序号补发）；页面重开也能接上正在跑的活。取消只认显式的 cancel。
 *
 * 每个 key（口播按项目、短剧全局一条）只保留最近一次任务：跑完的留着给"重开页面"补发结果，
 * 下一次 start 覆盖。日志缓冲有上限，超出从头裁。
 */
export class JobHub {
  constructor({ keepLines = 2000, keepJobs = 50 } = {}) { this.jobs = new Map(); this.keepLines = keepLines; this.keepJobs = keepJobs; }
  get(key) { return this.jobs.get(key) ?? null; }
  isRunning(key) { return this.get(key)?.status === 'running'; }
  runningKeys() { return [...this.jobs.values()].filter((j) => j.status === 'running').map((j) => j.key); }

  /** 起一个任务；同 key 还在跑就抛（调用方先查 isRunning 决定 409 还是接着看） */
  start(key, { cancel = () => {}, meta = {} } = {}) {
    if (this.isRunning(key)) throw new Error(`job ${key} is already running`);
    const job = { key, status: 'running', meta, startedAt: new Date().toISOString(), endedAt: null, seq: 0, lines: [], clients: new Set(), cancel, result: undefined };
    this.jobs.set(key, job);
    // 只留最近 keepJobs 个跑完的：长期开着的服务（桌面版）不该把每个项目的日志都攒在内存里
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
    for (const j of finished.slice(0, Math.max(0, finished.length - this.keepJobs))) this.jobs.delete(j.key);
    return job;
  }
  emit(job, ev, data) {
    if (job.status !== 'running') return;
    const line = { n: ++job.seq, ev, data };
    job.lines.push(line);
    if (job.lines.length > this.keepLines) job.lines.shift();
    const frame = format(line);
    for (const res of job.clients) res.write(frame);
  }
  /** 收尾事件（done / error）：记下结果，通知并关掉所有在看的连接 */
  finish(job, ev, data) {
    if (job.status !== 'running') return;
    const line = { n: ++job.seq, ev, data };
    job.lines.push(line);
    job.status = ev === 'done' ? 'done' : 'error'; job.endedAt = new Date().toISOString(); job.result = data;
    const frame = format(line);
    for (const res of job.clients) { res.write(frame); res.end(); }
    job.clients.clear();
  }
  cancel(key) { const job = this.get(key); if (!job || job.status !== 'running') return false; job.cancel(); return true; }
  status(key) {
    const j = this.get(key);
    return j ? { status: j.status, meta: j.meta, startedAt: j.startedAt, endedAt: j.endedAt, seq: j.seq, ...(j.status === 'running' ? {} : { result: j.result }) } : { status: 'idle' };
  }
  /** 把一条 HTTP 响应挂成这个任务的观众：先补发错过的（按 Last-Event-ID / ?after=），跑完的补完就关 */
  attach(job, req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const after = Number(req.headers?.['last-event-id'] ?? req.query?.after ?? 0) || 0;
    for (const l of job.lines) if (l.n > after) res.write(format(l));
    if (job.status !== 'running') { res.end(); return; }
    job.clients.add(res);
    req.on('close', () => job.clients.delete(res));
  }
}
const format = ({ n, ev, data }) => `id: ${n}\nevent: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
