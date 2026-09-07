// 开片 OpenShorts — Electron 桌面壳（移植自 AO desktop/main.cjs 的成熟实现）。
// 用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）拉起现有后端 server/index.mjs，
// 再开一个原生窗口指向本地界面。用户机器不需要装 Node。
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

const ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
const DEFAULT_PORT = Number(process.env.OPENSHORTS_DESKTOP_PORT || 4174);
let port = DEFAULT_PORT; // 实际端口在启动时确定（可能因占用而顺延）
let backend = null;
let mainWindow = null;
// 引擎日志/退出现场：打包后的 app 没有终端，启动失败时这是唯一可排查的信息
let logStream = null;
let logPath = "";
let stderrTail = "";
let backendExit = null;

const base = () => `http://127.0.0.1:${port}/`;
const uiUrl = () => {
  // 中文优先产品：桌面默认中文（即便系统语言是英文）。英文可在界面右上角切换（localStorage 记住）。
  // OPENSHORTS_DESKTOP_LANG=en 可显式覆盖为英文。
  const lang = String(process.env.OPENSHORTS_DESKTOP_LANG || "").toLowerCase().startsWith("en") ? "en" : "zh";
  return `${base()}?lang=${lang}`;
};

// 启动中 / 失败时显示的本地页面（data URL，不依赖后端，避免后端没起来时白屏）。
function splashHtml(message, spinner = true) {
  const dot = spinner
    ? `<div class="s"></div>`
    : `<div style="font-size:34px;line-height:1">⚠️</div>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
       background:#171310;color:#efe9e2;font:15px/1.6 -apple-system,"PingFang SC",Segoe UI,Roboto,sans-serif}
  .b{display:grid;place-items:center;width:56px;height:56px;border-radius:14px;background:#c2410c;
     color:#fff;font-weight:800;font-size:26px}
  .s{width:22px;height:22px;border:3px solid #3a322b;border-top-color:#c2410c;border-radius:50%;
     animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  .m{color:#b0a394;max-width:420px;text-align:center;padding:0 24px}
</style></head><body>
  <div class="b">开</div>${dot}
  <div class="m">${message}</div>
</body></html>`);
}

// Finder/Dock 启动的 GUI 只继承 launchd 的最小 PATH，用户 shell 里的 ffmpeg/whisper 等
// 全都不可见。重建一份可用 PATH：登录 shell 的 PATH（尽力）+ 常见 bin 目录。
// ~/.openshorts/bin 放最前——openshorts install-ffmpeg 装的带 libass 版必须赢过系统那份。
function resolvedPath() {
  const parts = [path.join(os.homedir(), ".openshorts", "bin")];
  if (process.platform !== "win32") {
    try {
      const shellBin = process.env.SHELL || "/bin/zsh";
      const out = execFileSync(shellBin, ["-lic", "printf %s \"$PATH\""], {
        timeout: 4000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) parts.push(out);
    } catch {
      /* shell probe failed — fall back to curated dirs below */
    }
    const home = os.homedir();
    parts.push(
      "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
      path.join(home, ".local/bin"),
      path.join(home, ".npm-global/bin"),
    );
  }
  if (process.env.PATH) parts.push(process.env.PATH);
  const seen = new Set();
  const sep = process.platform === "win32" ? ";" : ":";
  return parts
    .join(sep)
    .split(sep)
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(sep);
}

// 找一个可用端口：从首选端口起顺延，避免端口被占用时后端 bind 失败导致整个 app 白屏。
function findFreePort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    let p = start;
    let left = tries;
    const tryOne = () => {
      const srv = net.createServer();
      srv.once("error", () => {
        srv.close();
        if (--left <= 0) return reject(new Error("no free port near " + start));
        p += 1;
        tryOne();
      });
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryOne();
  });
}

function startBackend() {
  const serverPath = path.join(ROOT, "server", "index.mjs");
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "engine.log");
    try { logStream && logStream.end(); } catch { /* noop */ }
    logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n===== boot ${new Date().toISOString()} port=${port} =====\n`);
  } catch {
    logStream = null;
  }
  backendExit = null;
  stderrTail = "";
  backend = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1", // 后端与它的子进程都按普通 Node 跑
      PATH: resolvedPath(),
      PORT: String(port),
      HOST: "127.0.0.1",
      // 打包后的资源目录只读：v1 编辑器的写目录整体指到 userData（首启会播种示例工程）。
      // 开片（v2）的数据一直在 ~/OpenShorts 与 ~/.openshorts，与是否打包无关。
      OPENSHORTS_V1_DATA: path.join(app.getPath("userData"), "v1"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const feed = (chunk, isErr) => {
    const text = chunk.toString();
    // stderr 末尾 2KB 常驻内存——启动失败对话框直接把崩溃原因摆到用户眼前
    if (isErr) stderrTail = (stderrTail + text).slice(-2000);
    try { logStream && logStream.write(text); } catch { /* noop */ }
  };
  backend.stdout.on("data", (c) => feed(c, false));
  backend.stderr.on("data", (c) => feed(c, true));
  backend.on("exit", (code, signal) => {
    backendExit = { code, signal };
    try { logStream && logStream.write(`===== engine exit code=${code} signal=${signal || ""} =====\n`); } catch { /* noop */ }
    backend = null;
  });
}

// 后端手上还有没有在跑的活（出片几分钟到半小时；云端短剧按秒计费）。
// 拿不到就当"不忙"——退出路径不该被一个查询卡住。
function busyInfo() {
  return new Promise((resolve) => {
    const req = http.get(`${base()}api/busy`, (r) => {
      let body = "";
      r.on("data", (c) => { body += c; });
      r.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(800, () => { req.destroy(); resolve(null); });
  });
}

function stopBackend() {
  try {
    backend && backend.kill();
  } catch {
    /* noop */
  }
  backend = null;
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${base()}api/health`, (r) => {
      r.resume();
      resolve(r.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitHealth(timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ── 更新检查：启动后静默查 GitHub 最新 desktop-v* release，有新版弹一次提示 ──
// 不做静默自动更新（需要签名/更新服务器），只提示 + 一键跳转下载页。
// OPENSHORTS_DESKTOP_NO_UPDATE_CHECK=1 可关闭。
const RELEASES_API = "https://api.github.com/repos/jnMetaCode/openshorts/releases?per_page=30";
function semverNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}
let updateChecked = false; // 每次进程只查一次
async function checkForUpdate(win) {
  if (process.env.OPENSHORTS_DESKTOP_NO_UPDATE_CHECK === "1" || updateChecked) return;
  updateChecked = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      headers: { "user-agent": "openshorts-desktop", accept: "application/vnd.github+json" },
    });
    clearTimeout(timer);
    if (!r.ok) return;
    const releases = await r.json();
    const latest = (Array.isArray(releases) ? releases : []).find(
      (rel) => rel && !rel.draft && !rel.prerelease && /^desktop-v\d/.test(rel.tag_name || ""),
    );
    if (!latest) return;
    const latestVer = latest.tag_name.replace(/^desktop-v/, "");
    if (!semverNewer(latestVer, app.getVersion())) return;
    if (win.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "开片 OpenShorts",
      message: `发现新版本 v${latestVer}（当前 v${app.getVersion()}）`,
      detail: latest.name && latest.name !== latest.tag_name ? latest.name : "包含最新功能与修复，建议更新。",
      buttons: ["前往下载", "本次忽略"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) shell.openExternal(latest.html_url);
  } catch {
    /* 离线/限流 → 静默跳过，绝不打扰启动 */
  }
}

// 启动引擎并把窗口指向界面；失败时给出可重试的原生对话框，而不是静默白屏。
async function boot(win) {
  win.loadURL(splashHtml("正在启动本地引擎…"));
  // 引擎还活着且健康（macOS 关窗不退出、从 Dock 再次打开）→ 直接复用，
  // 千万别重新找端口（AO 真机教训：健康引擎占着老端口，新窗口 ping 新端口必然"启动失败"）。
  if (backend && (await ping())) {
    win.loadURL(uiUrl());
    checkForUpdate(win);
    return;
  }
  if (backend) stopBackend(); // 进程还在但不健康 → 杀掉重来，别留半死的占着端口
  try {
    port = await findFreePort(DEFAULT_PORT);
  } catch {
    port = DEFAULT_PORT;
  }
  startBackend();
  const ok = await waitHealth();
  if (win.isDestroyed()) return; // 用户在启动期间关掉了窗口
  if (ok) {
    win.loadURL(uiUrl());
    setTimeout(() => checkForUpdate(win), 3000);
    return;
  }
  // 引擎没起来：把真实原因（进程崩溃 vs 等待超时）+ 崩溃输出 + 日志路径摆出来。
  const crashed = !!backendExit;
  win.loadURL(splashHtml(crashed ? "本地引擎启动后异常退出。" : "本地引擎未能就绪（等待超时）。", false));
  const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-4).join("\n");
  const detail =
    (crashed
      ? `引擎进程启动后退出（代码 ${backendExit.code ?? "?"}${backendExit.signal ? " / " + backendExit.signal : ""}）。`
      : `等待引擎就绪超时（已自动选用空闲端口 ${port}）。`) +
    (tail ? `\n\n最近错误输出：\n${tail}` : "") +
    (logPath ? `\n\n完整日志：${logPath}` : "") +
    `\n\n提示：端口无需手动修改（从 ${DEFAULT_PORT} 起自动顺延）；如需固定端口，启动前设置环境变量 OPENSHORTS_DESKTOP_PORT。`;
  for (;;) {
    const { response } = await dialog.showMessageBox(win, {
      type: "error",
      title: "开片 OpenShorts",
      message: crashed ? "本地引擎启动后异常退出" : "本地引擎启动超时",
      detail,
      buttons: ["重试", "打开日志", "退出"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 1) {
      if (logPath) shell.showItemInFolder(logPath);
      continue;
    }
    if (response === 0) {
      stopBackend();
      await boot(win);
    } else {
      app.quit();
    }
    return;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: "开片 OpenShorts",
    backgroundColor: "#171310",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  // 外链去系统浏览器，别在 app 窗口里打开。
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  // 界面加载失败（偶发：引擎刚好还没就绪）→ 短暂重试几次再放弃。
  let reloadTries = 0;
  win.webContents.on("did-fail-load", (_e, code, _desc, failedUrl) => {
    if (code === -3 || !failedUrl.startsWith(base())) return; // -3 = 正常导航打断
    if (reloadTries++ < 5) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(uiUrl());
      }, 600);
    }
  });
  win.webContents.on("did-finish-load", () => {
    if (win.webContents.getURL().startsWith(base())) reloadTries = 0;
  });
  boot(win);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // 已有实例：退出，避免第二个后端抢端口
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // 退出前确认：Win/Linux 上关窗就是退出，一条跑了 25 分钟的本地短剧、或正在按秒
  // 计费的云端任务会被无声杀掉。preventDefault 必须**同步**调用——先 await 再拦就晚了，
  // 退出流程已经走完（Electron 的经典坑）。
  let confirmedQuit = false;
  app.on("before-quit", (e) => {
    if (confirmedQuit || !backend) return; // 已确认 / 后端根本没跑 → 放行
    e.preventDefault();
    (async () => {
      const info = await busyInfo();
      if (!info || !info.busy) { confirmedQuit = true; app.quit(); return; }
      const what = [
        info.drama ? "AI 短剧出片" : "",
        info.koubo && info.koubo.length ? `口播出片 ${info.koubo.length} 条` : "",
        info.v1 && info.v1.length ? `图层动画渲染 ${info.v1.length} 个` : "",
      ].filter(Boolean).join("、");
      const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
        type: "warning",
        title: "开片 OpenShorts",
        message: "还有任务在跑，现在退出会中断它",
        detail:
          `正在进行：${what}。\n\n退出会杀掉本地引擎：已完成的镜头会保留（下次重跑自动复用），` +
          `但当前这一镜要重来。\n\n注意：云端任务一旦创建就已经在计费，退出本程序不会取消服务商那边的任务。`,
        buttons: ["继续等它跑完", "仍然退出"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response === 1) { confirmedQuit = true; app.quit(); }
    })();
  });

  app.on("quit", stopBackend);
}
