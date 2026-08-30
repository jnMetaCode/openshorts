import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadWithResume, pickSdcppAsset } from '../src/local/download.mjs';

test('断点续传：中断后带 Range 续传，最终字节一致', async () => {
  const body = Buffer.alloc(200000, 7); let calls = 0;
  const srv = http.createServer((req, res) => { calls++; const r = req.headers.range; if (r) { const from = Number(r.replace('bytes=', '').split('-')[0]); res.writeHead(206, { 'content-length': body.length - from }); res.end(body.subarray(from)); } else { res.writeHead(200, { 'content-length': body.length }); res.end(body); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dl-')); const dest = path.join(dir, 'f.bin');
  fs.writeFileSync(dest + '.part', body.subarray(0, 50000));   // 模拟上次中断
  const events = [];
  await downloadWithResume(`http://127.0.0.1:${port}/f`, dest, { onProgress: (p) => events.push(p) });
  assert.ok(fs.readFileSync(dest).equals(body)); assert.equal(calls, 1); assert.ok(events.at(-1).done);
  const again = []; await downloadWithResume(`http://127.0.0.1:${port}/f`, dest, { onProgress: (p) => again.push(p) });
  assert.equal(again[0].skipped, true, '已存在的文件跳过');
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('选平台预编译包：macOS arm64 / Windows 默认 vulkan / Linux 默认 x86_64', () => {
  const assets = ['sd-master-x-bin-Darwin-macOS-26.5.2-arm64.zip', 'sd-master-x-bin-win-cuda12-x64.zip', 'sd-master-x-bin-win-vulkan-x64.zip', 'sd-master-x-bin-win-cpu-x64.zip', 'sd-master-x-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip', 'sd-master-x-bin-Linux-Ubuntu-24.04-x86_64.zip'].map((name) => ({ name }));
  assert.match(pickSdcppAsset(assets, 'darwin', 'arm64').name, /Darwin.*arm64/);
  assert.match(pickSdcppAsset(assets, 'win32', 'x64').name, /vulkan/);
  assert.match(pickSdcppAsset(assets, 'win32', 'x64', 'cuda').name, /cuda12/);
  assert.match(pickSdcppAsset(assets, 'linux', 'x64').name, /vulkan/);
});
