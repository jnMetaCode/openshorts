import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ProjectStore, applyVariables, safeId} from '../server/lib/project-store.mjs';
import {PersistentJobQueue} from '../server/lib/job-queue.mjs';

test('项目 id 会被限制为安全文件名', () => {
  assert.equal(safeId('../../我的 Project!'), 'project');
  assert.equal(safeId('Story_2026-A'), 'story_2026-a');
});

test('模板变量可递归应用到字幕和标题', () => {
  const result = applyVariables({title: '{{城市}}故事', scenes: [{captions: [{text: '欢迎来到 {{ 城市 }}'}]}]}, {城市: '长安'});
  assert.equal(result.title, '长安故事');
  assert.equal(result.scenes[0].captions[0].text, '欢迎来到 长安');
});

test('项目存储可从模板创建独立工程', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papercut-store-'));
  const projectsDir = path.join(root, 'projects'); const templatesDir = path.join(root, 'templates');
  await fs.mkdir(templatesDir, {recursive: true});
  await fs.writeFile(path.join(templatesDir, 'blank.json'), JSON.stringify({id: 'blank', name: '空白', project: {schemaVersion: 1, id: 'x', title: 'x', scenes: []}}));
  const store = new ProjectStore({projectsDir, templatesDir}); await store.init();
  const created = await store.createFromTemplate({templateId: 'blank', id: 'demo', title: '测试'});
  assert.equal(created.id, 'demo'); assert.equal((await store.list()).length, 1);
});

test('任务队列持久化并恢复中断任务', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papercut-queue-')); const file = path.join(root, 'jobs.json');
  const first = new PersistentJobQueue(file); await first.init(); const job = await first.add('render', {projectId: 'demo'}); await first.update(job.id, {status: 'running'});
  const recovered = new PersistentJobQueue(file); await recovered.init();
  assert.equal(recovered.get(job.id).status, 'interrupted');
  await recovered.retry(job.id); assert.equal(recovered.next().id, job.id);
});

test('排队任务可以取消且不会再次被消费', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papercut-cancel-')); const queue = new PersistentJobQueue(path.join(root, 'jobs.json')); await queue.init();
  const job = await queue.add('render', {}); await queue.cancel(job.id);
  assert.equal(queue.get(job.id).status, 'cancelled'); assert.equal(queue.next(), null);
});
