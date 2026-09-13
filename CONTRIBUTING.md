# 参与 OpenShorts

感谢参与。提交改动前请确保 Node.js 20+、FFmpeg 和 ImageMagick 可用。

```bash
npm ci
npm test
npm run build
npm run validate -- projects/sample.json
```

## 开发约定

- 项目 JSON 必须继续兼容 `schemaVersion: 1`；新增字段优先使用可选字段或默认值。
- 编辑器预览和 Remotion 渲染必须读取同一个协议，不能分别实现动画逻辑。
- 生成模型、TTS 和 ASR 通过适配器接入，核心代码不得依赖私有密钥。
- 素材进入时间线前应经过透明通道、裁切和审核检查。
- 修复缺陷或增加算法时需要同步增加 `node:test` 测试，并做一次变异检查（把被测逻辑故意打断，确认测试会红）。
- 改动出片链路（`src/pipeline` / `src/compose` / `src/captions` / `server/kaipian.mjs`）的 PR 请附一条真出的片子的抽帧或一览图——这个仓库里的真 bug 几乎都只在成片里看得见。
- 用户可见文案走 `src/project/lang.mjs` 的 `tt(lang)`，中英都要有；更多约定见 [AGENTS.md](AGENTS.md)。

## Pull Request

请说明问题、方案、协议兼容性、测试结果以及视觉变化。不要提交密钥、大型模型、未授权字体或版权不明的音视频素材。
