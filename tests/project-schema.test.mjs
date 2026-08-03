import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseProject, projectSchema} from '../shared/project-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = () => JSON.parse(fs.readFileSync(path.join(root, 'projects', 'sample.json'), 'utf8'));

test('仓库里所有工程和模板都符合协议', () => {
  for (const file of fs.readdirSync(path.join(root, 'projects')).filter((name) => name.endsWith('.json'))) {
    const result = parseProject(JSON.parse(fs.readFileSync(path.join(root, 'projects', file), 'utf8')));
    assert.ok(result.ok, `${file}：${result.ok ? '' : result.errors.join('; ')}`);
  }
  for (const file of fs.readdirSync(path.join(root, 'templates')).filter((name) => name.endsWith('.json'))) {
    const template = JSON.parse(fs.readFileSync(path.join(root, 'templates', file), 'utf8'));
    if (!template.project) continue;
    const result = parseProject(template.project);
    assert.ok(result.ok, `${file}：${result.ok ? '' : result.errors.join('; ')}`);
  }
});

test('校验会补齐默认值', () => {
  const bare = sample();
  delete bare.soundtrackVolume;
  delete bare.scenes[0].layers[0].opacity;
  const result = parseProject(bare);
  assert.ok(result.ok);
  assert.equal(result.project.soundtrackVolume, 0.18);
  assert.equal(result.project.scenes[0].layers[0].opacity, 1);
});

test('缺字段、类型错、越界都会被拦下并指出位置', () => {
  const broken = sample();
  broken.fps = 120;
  const result = parseProject(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.startsWith('fps：')), result.errors.join('; '));
});

test('没有镜头的工程不合法', () => {
  const result = parseProject({...sample(), scenes: []});
  assert.equal(result.ok, false);
});

test('schemaVersion 必须是 1', () => {
  const result = parseProject({...sample(), schemaVersion: 2});
  assert.equal(result.ok, false);
});

test('图层 id 重复会被拦下', () => {
  const broken = sample();
  broken.scenes[0].layers.push(structuredClone(broken.scenes[0].layers[0]));
  const result = parseProject(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes('图层 id 重复')));
});

test('镜头 id 重复会被拦下', () => {
  const broken = sample();
  broken.scenes.push(structuredClone(broken.scenes[0]));
  const result = parseProject(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes('镜头 id 重复')));
});

test('时间轴越界不在写入时拦截，留给验收阶段报告', () => {
  const shortened = sample();
  shortened.scenes[0].durationFrames = 10;
  assert.equal(parseProject(shortened).ok, true, '缩短镜头是编辑器常规操作，不应挡住存盘');
});

test('文字图层必须有 style，图片/视频图层必须有 src', () => {
  const base = sample();
  const scene = base.scenes[0];
  scene.layers.push({id: 'txt', name: '文字', kind: 'text', role: 'primary', x: 0, y: 0, width: 900, zIndex: 9,
    style: {text: '$10', fontSize: 200}});
  scene.layers.push({id: 'vid', name: '视频', kind: 'video', src: 'assets/x.mp4', startFrom: 1.2, role: 'secondary',
    x: 0, y: 0, width: 720, zIndex: 8});
  const ok = parseProject(base);
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('; '));
  assert.equal(ok.project.scenes[0].layers.at(-2).style.align, 'left', '文字样式默认值应补齐');
  assert.equal(ok.project.scenes[0].layers.at(-1).startFrom, 1.2);

  const noStyle = sample();
  noStyle.scenes[0].layers.push({id: 'bad', name: 'x', kind: 'text', role: 'primary', x: 0, y: 0, width: 100, zIndex: 1});
  assert.equal(parseProject(noStyle).ok, false, '缺 style 的文字图层应被拦下');

  const noSrc = sample();
  noSrc.scenes[0].layers.push({id: 'bad2', name: 'x', kind: 'video', role: 'primary', x: 0, y: 0, width: 100, zIndex: 1});
  assert.equal(parseProject(noSrc).ok, false, '缺 src 的视频图层应被拦下');
});

test('projectSchema 与 parseProject 是同一份定义', () => {
  assert.equal(projectSchema.safeParse(sample()).success, true);
});
