'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { normalizeFeedConfig } = require('./config');

const SCROLL_SCRIPT = path.join(__dirname, 'scroll.ps1');

function runPowerShell(script, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`输入模拟进程失败: ${error.message}\n${stderr || ''}`));
        resolve(stdout.trim());
      }
    );
  });
}

function stamp() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

class FeedBrowser extends EventEmitter {
  constructor(capture, options = {}) {
    super();
    if (!capture || typeof capture.captureOnce !== 'function') {
      throw new Error('FeedBrowser 需要 ScreenCapture 实例');
    }
    this.capture = capture;
    this.config = normalizeFeedConfig(options);
    this._timer = null;
    this._items = 0;
    this._sessionId = null;
    this._index = {
      sessionId: null, startedAt: null, updatedAt: null,
      action: this.config.action, intervalMs: this.config.intervalMs,
      maxItems: this.config.maxItems, items: []
    };
    this._lastAction = null;
    this._lastError = null;
    this._stopRequested = false;
    this._browsingInFlight = false;
  }

  // 每个会话独立索引文件，避免多 host/多会话互相覆盖（P1-5）
  _indexFile() {
    const sid = this._sessionId || 'pending';
    return path.join(this.capture.config.outputDir, `feed-index-${sid}.json`);
  }

  // 兼容入口：始终指向最近一次会话的索引
  _writeLatestIndexPointer() {
    fs.writeFileSync(
      path.join(this.capture.config.outputDir, 'feed-index.json'),
      JSON.stringify({ sessionId: this._sessionId, indexFile: path.basename(this._indexFile()) }, null, 2)
    );
  }

  status() {
    return {
      enabled: this.capture.enabled,
      browsing: Boolean(this._timer),
      items: this._items,
      sessionId: this._sessionId,
      action: this.config.action,
      intervalMs: this.config.intervalMs,
      maxItems: this.config.maxItems,
      lastAction: this._lastAction,
      lastError: this._lastError,
      indexFile: this._indexFile()
    };
  }

  async feedOnce(overrides = {}) {
    if (!this.capture.enabled) throw new Error('屏幕读取已关闭（enabled=false）');
    if (this._stopRequested) throw new Error('刷流已停止（stopRequested）');
    // 自动流在 timer 里调用时用 this.config（含 maxItems），别用默认覆盖把它带成 0
    const cfg = overrides && Object.keys(overrides).length
      ? normalizeFeedConfig({ ...this.config, ...overrides })
      : this.config;
    const outputDir = this.capture.config.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });

    const session = this._sessionId || `feed-${stamp()}`;
    if (!this._sessionId) {
      this._sessionId = session;
      this._index.sessionId = session;
      this._index.startedAt = new Date().toISOString();
      this._index.action = cfg.action;
      this._index.intervalMs = cfg.intervalMs;
      this._index.maxItems = cfg.maxItems;
      this._items = 0;
      this._index.items = [];
    }

    // 1) 先发动作（滚动/翻页），再抓帧——这是"刷"与"看"的区别
    const actionPath = path.join(outputDir, `feed-action-${stamp()}.json`);
    const actionArgs = ['-ResultPath', actionPath, '-Action', cfg.action, '-Amount', String(cfg.amount)];
    if (cfg.cursorX !== null) actionArgs.push('-X', String(cfg.cursorX));
    if (cfg.cursorY !== null) actionArgs.push('-Y', String(cfg.cursorY));
    await runPowerShell(SCROLL_SCRIPT, actionArgs);

    let actionMeta;
    try {
      actionMeta = JSON.parse(fs.readFileSync(actionPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      throw new Error(`输入动作元数据读取失败: ${e.message}`);
    }
    if (!actionMeta.ok) throw new Error(`输入动作失败: ${actionMeta.error || '未知错误'}`);

    // 2) 抓一帧
    const frame = await this.capture.captureOnce({ outputDir });

    // 停止请求在进入收尾前出现：丢弃这条，不再落盘/递增/发事件（P1-1）
    if (this._stopRequested) {
      throw new Error('刷流已停止（stopRequested）');
    }

    // 3) 追加一条 feed 记录并整份重写索引
    const seq = this._items + 1;
    const item = {
      seq,
      action: cfg.action,
      amount: cfg.amount,
      actionAt: actionMeta.at,
      capturedAt: frame.capturedAt,
      path: frame.path,
      width: frame.width,
      height: frame.height,
      feedId: `${this._sessionId}-${seq}`
    };
    this._items = seq;
    this._lastAction = { action: cfg.action, amount: cfg.amount, at: actionMeta.at };
    this._index.items.push(item);
    this._index.updatedAt = new Date().toISOString();
    fs.writeFileSync(this._indexFile(), JSON.stringify(this._index, null, 2));
    this._writeLatestIndexPointer();

    // 回调异常隔离：回调抛错不影响已落盘的调用结果（P1-6）
    try {
      this.emit('feed-frame', item);
    } catch (e) {
      this._lastError = `feed-frame 回调异常: ${e.message}`;
    }
    return item;
  }

  feedStart(overrides = {}) {
    if (!this.capture.enabled) throw new Error('屏幕读取已关闭（enabled=false）');
    if (this._timer) return { started: false, reason: 'already-browsing' };
    const cfg = normalizeFeedConfig({ ...this.config, ...overrides });
    this.config = cfg;
    this._sessionId = `feed-${stamp()}`;
    this._items = 0;
    this._lastError = null;
    this._stopRequested = false;
    this._index = {
      sessionId: this._sessionId,
      startedAt: new Date().toISOString(),
      updatedAt: null,
      action: cfg.action,
      intervalMs: cfg.intervalMs,
      maxItems: cfg.maxItems,
      items: []
    };
    const outputDir = this.capture.config.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(this._indexFile(), JSON.stringify(this._index, null, 2));
    this._writeLatestIndexPointer();

    try {
      this.emit('feed-start', {
        sessionId: this._sessionId, action: cfg.action,
        intervalMs: cfg.intervalMs, maxItems: cfg.maxItems
      });
    } catch (e) {
      this._lastError = `feed-start 回调异常: ${e.message}`;
    }

    this._browsingInFlight = false;
    this._timer = setInterval(async () => {
      // 动作+抓帧要走两次 PowerShell，慢时跳过 tick，避免并发抢出多余条目
      if (this._browsingInFlight) return;
      if (cfg.maxItems > 0 && this._items >= cfg.maxItems) {
        this.feedStop();
        return;
      }
      this._browsingInFlight = true;
      try {
        await this.feedOnce();
      } catch (e) {
        this._lastError = e.message;
        if (this.listenerCount('error') > 0) this.emit('error', e);
        this.feedStop();
      } finally {
        this._browsingInFlight = false;
      }
    }, cfg.intervalMs);

    return {
      started: true, sessionId: this._sessionId, action: cfg.action,
      intervalMs: cfg.intervalMs, maxItems: cfg.maxItems
    };
  }

  feedStop() {
    // 即使没有 timer，也要立起停止标志，拦住 in-flight 的 feedOnce（P1-1）
    this._stopRequested = true;
    if (!this._timer) return { stopped: false, reason: 'not-browsing' };
    clearInterval(this._timer);
    this._timer = null;
    const result = {
      stopped: true, sessionId: this._sessionId, items: this._items,
      indexFile: this._indexFile()
    };
    try {
      this.emit('feed-stop', result);
    } catch (e) {
      this._lastError = `feed-stop 回调异常: ${e.message}`;
    }
    return result;
  }

  // 总开关关闭时由插件调用：同步停 timer 并拦住 in-flight（P1-2）
  onDisabled() {
    if (this._timer) this.feedStop();
    else this._stopRequested = true;
  }

  // 供下一次 feedOnce 使用：清除停止标志（新 feedStart 会重置，手动 feedOnce 也可显式恢复）
  resume() {
    this._stopRequested = false;
  }
}

module.exports = { FeedBrowser, normalizeFeedConfig, runPowerShell };
