# 素材生成适配器

适配器只负责把提示词变成标准图片素材，不允许直接修改时间线。生成结果必须写入 `public/uploads/`，并记录提示词、尺寸、种子和供应商元数据。

## 手动上传

默认且最稳定的方式。可以使用任何生成服务，下载后通过编辑器上传。角色素材建议使用纯绿色背景，再调用本地抠图工具。

## ComfyUI

设置进程环境变量 `COMFYUI_URL` 后，工作台会把适配器标记为已配置。建议连接本机 `http://127.0.0.1:8188`。从 ComfyUI 导出 API workflow JSON 后，可在适配器区域直接提交；任务会进入持久化队列，轮询 `/history`，下载 `/view` 输出并写入 `public/uploads/comfyui-*`。不要把密钥或私有工作流提交到仓库。

## Imagegen Agent

适用于具有图像生成工具的 Codex/Agent 环境。Agent 根据 `GenerationRequest` 生成图片，将文件放入 `public/uploads/`，然后在编辑器中执行检查、抠图或拆分。此方式不要求核心项目持有 API 密钥。

## Manifest

每个适配器目录包含一个 `adapter.json`，字段与 `src/adapters/types.ts` 中的 `AdapterManifest` 一致。`GET /api/adapters` 会发现适配器并根据 `requiresEnv` 返回配置状态。
