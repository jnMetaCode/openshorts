# OpenShorts · 开片 — v2 文档索引

> v2 = 2026-08-30 定案的新方向：**两条内容线（口播短视频 / AI 短剧）× 三种画面来源（素材库 / 本地生成 / 云端 API）**，
> 编排与出片引擎复用 [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)（AO）。
> v1（剪纸动画 / 信息板，Remotion 渲染）不废弃，作为"图层动画"这一画面来源保留。

| 文档 | 读者 | 内容 |
|---|---|---|
| [01-需求文档-PRD](01-需求文档-PRD.md) | 所有人 | 定位、用户、两条线、三源、功能清单、非目标、成功指标 |
| [02-架构设计](02-架构设计.md) | 开发 | 分层、模块、与 AO 的边界、数据协议、各画面来源适配器、本地生成实测 |
| [03-开发计划](03-开发计划.md) | 开发 / 产品 | 里程碑 M0–M3、任务拆分、每个里程碑的验收标准 |
| [04-决策记录-ADR](04-决策记录-ADR.md) | 所有人 | 为什么叫这个名、为什么复用 AO、本地 H3 实测结论、为什么免费路径先行 |

**一句话产品定义**：一段文案或一个话题进去，一条能直接发抖音 / 视频号 / Shorts 的成片出来；默认零成本可跑通，画面来源可以在"素材库 → 本地 AI → 云端 AI"之间一键切换，花多少钱在按下运行之前就看见。

**先读顺序**：PRD 第 1–3 节 → 架构第 1–2 节 → 开发计划 M0。其余按需。

相关仓库与资料：
- AO 引擎：`/Users/yx/work/wenzhang/agency-orchestrator`（短剧流水线、看图验收、花费预览、视频供应商表都在那边）
- 本地 H3 实验环境：`/Users/yx/work/ai-tools/h3-local`（sd-cli Metal 版 + GGUF 模型，实测数据见 ADR-004）
- 对标项目：[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)（119k★，素材库 + TTS 路线）
