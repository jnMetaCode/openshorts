// 动态签名配置：按「有没有证书」自动切换，两条路都不用改代码——
//   有 CSC_LINK（Apple Developer ID 证书）→ 真签名；再有公证三件套 → 自动公证
//   没有 → 维持现状：identity:null + afterSign 的 ad-hoc 重签（未签名版照常可用）
// 这样 Apple 账号一办下来，只往仓库 Secrets 填值（见 docs/SIGNING.md），下个 tag 即出签名公证版。
// package.json 的 build 段里，node_modules 那条 extraResources 带 filter，原因写在这里
// （JSON 不能写注释）：构建期依赖（typescript/vite/@types/@vitejs/concurrently/@remotion/cli
// 共 ~52MB）运行时一行都用不到。CI 工作流有 prune 步骤而本地构建没有——同一份配置两种结果，
// 本地打出来的 dmg 白胖 52MB。改成"拷贝时过滤"后本地 = CI，且不动开发者的 node_modules。
// `.bin` 一并排除：运行时从不经过它（AO CLI 走 import.meta.resolve 拿到的绝对路径），
// 留着反而会因目标被过滤而变成悬空链接——那正是 codesign --deep --strict 的死穴
// （AO 0.4.5 的 mac 构建就死在这）。
const base = require("./package.json").build;

const hasCert = !!process.env.CSC_LINK;
const canNotarize =
  hasCert &&
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

const config = { ...base, mac: { ...base.mac } };

if (hasCert) {
  // 交回 electron-builder 用证书签（identity:null 是"禁止签名"的硬开关，必须摘掉）
  delete config.mac.identity;
  // 公证的硬性要求：Hardened Runtime + entitlements（Electron 需要 JIT 等豁免）
  config.mac.hardenedRuntime = true;
  config.mac.gatekeeperAssess = false;
  config.mac.entitlements = "build/entitlements.mac.plist";
  config.mac.entitlementsInherit = "build/entitlements.mac.plist";
  if (canNotarize) {
    // electron-builder 25.x：notarize:true 自动读 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
    config.mac.notarize = true;
  }
  console.log(`[signing] 检测到证书 → 真签名${canNotarize ? " + 公证" : "（缺公证三件套，只签不公证）"}`);
} else {
  console.log("[signing] 无证书（CSC_LINK 未设）→ 未签名版（ad-hoc 重签兜底）");
}

module.exports = config;
