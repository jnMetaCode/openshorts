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

const minimalProject = () => ({
  schemaVersion: 1, id: 'x', title: 'x', width: 1080, height: 1920, fps: 30,
  theme: {paper: '#f5eedc', ink: '#201712', accent: '#a72d24', subtitleBackground: 'rgba(31,20,15,.84)'},
  scenes: [{
    id: 'scene-01', name: '镜头 01', durationFrames: 60,
    layers: [{id: 'bg', name: '背景', src: 'assets/sample/tang-bg.svg', role: 'background', x: 0, y: 0, width: 1080, zIndex: 0}],
  }],
});

const newStore = async (label) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `openshorts-${label}-`));
  const projectsDir = path.join(root, 'projects'); const templatesDir = path.join(root, 'templates');
  await fs.mkdir(templatesDir, {recursive: true});
  return {projectsDir, templatesDir};
};

test('项目存储可从模板创建独立工程', async () => {
  const {projectsDir, templatesDir} = await newStore('store');
  await fs.writeFile(path.join(templatesDir, 'blank.json'), JSON.stringify({id: 'blank', name: '空白', project: minimalProject()}));
  const store = new ProjectStore({projectsDir, templatesDir}); await store.init();
  const created = await store.createFromTemplate({templateId: 'blank', id: 'demo', title: '测试'});
  assert.equal(created.id, 'demo'); assert.equal((await store.list()).length, 1);
});

test('写入时按协议校验，不合法的工程存不进磁盘', async () => {
  const {projectsDir, templatesDir} = await newStore('store-invalid');
  const store = new ProjectStore({projectsDir, templatesDir}); await store.init();
  const broken = minimalProject();
  broken.scenes[0].durationFrames = 0;
  await assert.rejects(() => store.save(broken), (error) => {
    assert.equal(error.name, 'ProjectValidationError');
    assert.equal(error.status, 400, '应映射为 400 而不是 500');
    assert.ok(error.errors.some((item) => item.includes('durationFrames')), error.errors.join('; '));
    return true;
  });
  assert.equal((await store.list()).length, 0, '失败的写入不应留下文件');
});

test('写入时补齐默认值，存下去的一定是渲染器能读的', async () => {
  const {projectsDir, templatesDir} = await newStore('store-defaults');
  const store = new ProjectStore({projectsDir, templatesDir}); await store.init();
  const bare = minimalProject();
  const saved = await store.save(bare);
  assert.equal(saved.soundtrackVolume, 0.18);
  assert.equal(saved.scenes[0].layers[0].entrance, 'left');
  assert.deepEqual(saved.scenes[0].captions, []);
});

test('任务队列持久化并恢复中断任务', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-queue-')); const file = path.join(root, 'jobs.json');
  const first = new PersistentJobQueue(file); await first.init(); const job = await first.add('render', {projectId: 'demo'}); await first.update(job.id, {status: 'running'});
  const recovered = new PersistentJobQueue(file); await recovered.init();
  assert.equal(recovered.get(job.id).status, 'interrupted');
  await recovered.retry(job.id); assert.equal(recovered.next().id, job.id);
});

test('排队任务可以取消且不会再次被消费', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-cancel-')); const queue = new PersistentJobQueue(path.join(root, 'jobs.json')); await queue.init();
  const job = await queue.add('render', {}); await queue.cancel(job.id);
  assert.equal(queue.get(job.id).status, 'cancelled'); assert.equal(queue.next(), null);
});
