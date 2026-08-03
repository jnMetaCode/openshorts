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
- 修复缺陷或增加算法时需要同步增加 `node:test` 测试。

## Pull Request

请说明问题、方案、协议兼容性、测试结果以及视觉变化。不要提交密钥、大型模型、未授权字体或版权不明的音视频素材。
