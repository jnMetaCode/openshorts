import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildStoryFiles, draftPrompt, normalizeDraft} from '../scripts/lib/story-draft.mjs';
import {parseProject} from '../shared/project-schema.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixture = {
  title: '为什么天空是蓝的',
  hook: '不是海的倒影，从来都不是',
  segments: [
    {id: 'hook', text: '天空是蓝的，跟大海一点关系都没有。真正的原因，是光被空气打散了。', purpose: '反直觉钩子', screenTitle: '不是海的倒影', screenPoints: ['瑞利散射', '波长越短越易散']},
    {id: 'why', text: '阳光里的蓝光波长最短，撞上空气分子最容易被弹开，弹得满天都是。', purpose: '机制', screenTitle: '蓝光被弹开', screenPoints: ['波长 450nm', '散射强度 ∝ 1/λ⁴']},
    {id: 'sunset', text: '傍晚阳光要斜穿更厚的大气，蓝光半路散光了，剩下红橙直达你的眼睛。', purpose: '推论', screenTitle: '所以晚霞是红的', screenPoints: ['路径更长', '蓝光耗尽']},
  ],
};

test('草稿提示词包含硬性分镜规则与段数', () => {
  const prompt = draftPrompt('天空为什么是蓝的', {segments: 5});
  assert.ok(prompt.includes('5 段'));
  assert.ok(prompt.includes('禁止背景铺垫'));
  assert.ok(prompt.includes('禁止与口播逐字重复'));
});

test('草稿归一化：合法输入通过并补齐字段', () => {
  const draft = normalizeDraft(fixture);
  assert.equal(draft.segments.length, 3);
  assert.equal(draft.segments[0].id, 'hook');
  assert.equal(draft.title, '为什么天空是蓝的');
});

test('草稿归一化：段数与字数越界被拦下并指明位置', () => {
  assert.throws(() => normalizeDraft({segments: [fixture.segments[0]]}), /期望 3-12 段/);
  const tooLong = structuredClone(fixture);
  tooLong.segments[1].text = '长'.repeat(120);
  assert.throws(() => normalizeDraft(tooLong), /第 2 段口播 120 字/);
});

test('重复 slug 自动去重，非法 slug 回落到序号', () => {
  const dup = structuredClone(fixture);
  dup.segments[1].id = 'hook';
  dup.segments[2].id = '！！！';
  const draft = normalizeDraft(dup);
  const ids = draft.segments.map((item) => item.id);
  assert.equal(new Set(ids).size, 3, `slug 重复：${ids}`);
  assert.equal(ids[2], 'seg-3');
});

// 端到端：草稿 → 写盘 → 真实 build-story → 唯一 schema 校验。
// 同一个沙箱顺便验证 16:9 画幅从 story.format 一路贯通到工程尺寸。
for (const [format, width, height] of [['9:16', 1080, 1920], ['16:9', 1920, 1080]]) {
  test(`草稿在 ${format} 画幅下可直接构建为合法工程`, async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'openshorts-draft-'));
    const name = 'sky-blue';
    const files = buildStoryFiles({draft: normalizeDraft(fixture), name, format});
    const storyDir = path.join(sandbox, 'content', name);
    await fs.mkdir(storyDir, {recursive: true});
    await fs.writeFile(path.join(storyDir, 'story.json'), JSON.stringify(files.story));
    await fs.writeFile(path.join(storyDir, 'storyboard.json'), JSON.stringify(files.storyboard));
    await fs.writeFile(path.join(storyDir, 'assets.json'), '{}');

    await run(process.execPath, [path.join(root, 'scripts', 'build-story.mjs'), `content/${name}`], {cwd: sandbox});
    const project = JSON.parse(await fs.readFile(path.join(sandbox, 'projects', `${name}.json`), 'utf8'));
    const result = parseProject(project);
    assert.ok(result.ok, result.ok ? '' : result.errors.join('; '));
    assert.equal(project.width, width);
    assert.equal(project.height, height);
    assert.equal(project.scenes.length, 3);
    assert.ok(project.scenes.at(-1).durationFrames > project.scenes.at(-1).captions.at(-1).toFrame, '末镜应有 holdSeconds 定格余量');
    assert.ok(project.scenes.every((scene) => scene.captions.length), '每镜都应有字幕');
  });
}
