'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { normalizeConfig } = require('./config');

const PS_SCRIPT = path.join(__dirname, 'capture.ps1');

function runPowerShell(script, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`抓屏进程失败: ${error.message}\n${stderr || ''}`));
        resolve(stdout.trim());
      }
    );
  });
}

class ScreenCapture extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = normalizeConfig(options);
    this.enabled = this.config.enabled;
    this._timer = null;
    this._frames = 0;
    this._lastFrame = null;
    this._streamFrames = 0;
    this._lastError = null;
  }

  status() {
    return {
      enabled: this.enabled,
      streaming: Boolean(this._timer),
      frames: this._frames,
      fps: this.config.fps,
      outputDir: this.config.outputDir,
      region: this.config.region,
      lastFrame: this._lastFrame,
      streamFrames: this._streamFrames,
      lastError: this._lastError
    };
  }

  setEnabled(value) {
    if (typeof value !== 'boolean') throw new Error('enabled 必须是布尔值');
    this.enabled = value;
    if (!value) this.stop();
    return this.enabled;
  }

  async captureOnce(overrides = {}) {
    if (!this.enabled) throw new Error('屏幕读取已关闭（enabled=false）');
    const cfg = normalizeConfig({ ...this.config, ...overrides, enabled: true });
    fs.mkdirSync(cfg.outputDir, { recursive: true });

    const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const pngPath = path.join(cfg.outputDir, `frame-${stamp}.png`);
    const jsonPath = path.join(cfg.outputDir, `frame-${stamp}.json`);

    const args = ['-OutputPath', pngPath, '-ResultPath', jsonPath];
    if (cfg.region) {
      args.push('-X', String(cfg.region.x), '-Y', String(cfg.region.y),
        '-Width', String(cfg.region.width), '-Height', String(cfg.region.height));
    }

    await runPowerShell(PS_SCRIPT, args);

    let meta;
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
      meta = JSON.parse(raw);
    } catch (e) {
      throw new Error(`抓屏元数据读取失败: ${e.message}`);
    }
    if (!meta.ok || !fs.existsSync(meta.path)) {
      throw new Error('抓屏未生成有效 PNG');
    }

    fs.writeFileSync(path.join(cfg.outputDir, 'latest.json'), JSON.stringify({
      path: meta.path,
      capturedAt: meta.capturedAt,
      width: meta.width,
      height: meta.height
    }, null, 2));

    this._frames += 1;
    this._lastFrame = meta;
    this.emit('frame', meta);
    return meta;
  }

  startStream(overrides = {}) {
    if (!this.enabled) throw new Error('屏幕读取已关闭（enabled=false）');
    if (this._timer) return { started: false, reason: 'already-streaming' };

    const cfg = normalizeConfig({ ...this.config, ...overrides, enabled: true });
    const intervalMs = Math.max(1, Math.round(1000 / cfg.fps));
    // 防抢帧靠下方 _capturing in-flight 锁，不在 start 时清 timer（此处 _timer 必为 null）
    this._streamFrames = 0;
    this._lastError = null;
    this._capturing = false;
    this.emit('stream-start', { fps: cfg.fps, intervalMs, region: cfg.region });
    this._timer = setInterval(async () => {
      // 上一帧还没抓完就跳过本次 tick，避免 PowerShell 慢时并发抢帧导致 maxFrames 超出
      if (this._capturing) return;
      if (cfg.maxFrames > 0 && this._streamFrames >= cfg.maxFrames) {
        this.stop();
        return;
      }
      this._capturing = true;
      try {
        await this.captureOnce(cfg);
        this._streamFrames += 1;
      } catch (e) {
        this._lastError = e.message;
        if (this.listenerCount('error') > 0) {
          this.emit('error', e);
        }
        this.stop();
      } finally {
        this._capturing = false;
      }
    }, intervalMs);
    return { started: true, fps: cfg.fps, intervalMs, maxFrames: cfg.maxFrames };
  }

  stop() {
    if (!this._timer) return { stopped: false, reason: 'not-streaming' };
    clearInterval(this._timer);
    this._timer = null;
    this.emit('stream-stop', { frames: this._frames });
    return { stopped: true, frames: this._frames };
  }
}

module.exports = { ScreenCapture };
