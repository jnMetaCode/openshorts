import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const now = () => new Date().toISOString();

export class PersistentJobQueue {
  constructor(file) { this.file = file; this.jobs = []; }

  async init() {
    await fs.mkdir(path.dirname(this.file), {recursive: true});
    try { this.jobs = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const job of this.jobs) if (job.status === 'running') { job.status = 'interrupted'; job.error = '进程退出导致任务中断，可手动重试'; job.updatedAt = now(); }
    await this.persist();
  }

  async persist() {
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.jobs, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.file);
  }

  async add(type, payload) {
    const job = {id: randomUUID(), type, status: 'queued', progress: 0, attempts: 0, payload, output: null, error: null, createdAt: now(), updatedAt: now()};
    this.jobs.push(job); await this.persist(); return job;
  }

  list() { return [...this.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { return this.jobs.find((job) => job.id === id) ?? null; }
  next() { return this.jobs.find((job) => job.status === 'queued') ?? null; }

  async update(id, patch) {
    const job = this.get(id); if (!job) throw new Error(`任务不存在：${id}`);
    Object.assign(job, patch, {updatedAt: now()}); await this.persist(); return job;
  }

  async retry(id) {
    const job = this.get(id); if (!job) throw new Error(`任务不存在：${id}`);
    if (!['failed', 'interrupted'].includes(job.status)) throw new Error('仅失败或中断的任务可以重试');
    return this.update(id, {status: 'queued', progress: 0, error: null});
  }

  async cancel(id) {
    const job = this.get(id); if (!job) throw new Error(`任务不存在：${id}`);
    if (job.status === 'queued') return this.update(id, {status: 'cancelled', error: null});
    if (job.status === 'running') return this.update(id, {status: 'cancel_requested'});
    throw new Error('仅等待或运行中的任务可以取消');
  }
}
