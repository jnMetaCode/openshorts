/**
 * 子进程要能"整棵树"杀掉。
 *
 * 真机坐实的病（2026-09-11）：服务进程收到 SIGTERM（桌面版 stopBackend / docker stop / Ctrl+C）
 * 直接退出，正在跑的 ffmpeg 变成 ppid=1 的孤儿继续跑——口播线一段几秒还好，
 * 短剧线 AO → sd-cli 一跑几分钟，用户点了"仍然退出"以为停了，风扇还在转。
 * 更糟的是 AO 是孙进程的爹：只 kill AO 本身，它下面的 sd-cli / ffmpeg 照样活着。
 *
 * 做法：POSIX 上 spawn 时 detached 让子进程自成进程组，杀的时候 kill(-pid) 整组一起；
 * Windows 没有进程组，用 taskkill /T 按树杀。
 */
import { spawn } from 'node:child_process';

/** 和 spawn 一样，但子进程自成进程组（Windows 无此概念，原样 spawn） */
export function spawnTree(cmd, args, opts = {}) {
  return spawn(cmd, args, { ...opts, detached: process.platform !== 'win32' });
}

/** 杀掉 child 及它下面的整棵树；已经退出的返回 false */
export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return true; }
    catch { return child.kill(); }
  }
  try { process.kill(-child.pid, signal); return true; }          // 负号 = 进程组
  catch { try { return child.kill(signal); } catch { return false; } }   // 不是组长（没 detached）就退回只杀它自己
}
