'use strict';

const path = require('path');

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRegion(region) {
  if (region === undefined || region === null) return null;
  if (typeof region !== 'object') throw new Error('region 必须是对象或 null');
  // x/y 可为负数：多显示器布局里副屏常位于主屏左侧（负 X）或上方（负 Y）
  const x = Math.trunc(toNumber(region.x, 0));
  const y = Math.trunc(toNumber(region.y, 0));
  const width = Math.trunc(toNumber(region.width, 0));
  const height = Math.trunc(toNumber(region.height, 0));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('region.x 和 region.y 必须是整数（可为负数以指向副屏）');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('region.width 和 region.height 必须是正整数');
  }
  return { x, y, width, height };
}

function normalizeConfig(input = {}) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('配置必须是对象');
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new Error('enabled 必须是布尔值');
  }
  const outputDir = path.resolve(toNumber(input.outputDir, null) || input.outputDir || 'captures');
  const fpsRaw = toNumber(input.fps, 1);
  if (fpsRaw <= 0) throw new Error('fps 必须大于 0');
  const maxFramesRaw = input.maxFrames === undefined || input.maxFrames === null || input.maxFrames === ''
    ? 0
    : toNumber(input.maxFrames, 0);
  if (maxFramesRaw < 0) throw new Error('maxFrames 不能为负数');

  return {
    enabled: input.enabled !== false,
    outputDir,
    fps: clamp(fpsRaw, 0.1, 30),
    region: normalizeRegion(input.region),
    maxFrames: Math.trunc(clamp(maxFramesRaw, 0, 1000000)),
    format: 'png'
  };
}

function normalizeFeedConfig(input = {}) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('feed 配置必须是对象');
  }
  const intervalMs = Math.trunc(clamp(toNumber(input.intervalMs, 1200), 100, 60000));
  const action = typeof input.action === 'string' && input.action ? input.action : 'scroll';
  if (!['scroll', 'scrollup', 'pgdn', 'pgup', 'none'].includes(action)) {
    throw new Error('feed.action 必须是 scroll / scrollup / pgdn / pgup / none');
  }
  const amount = Math.trunc(clamp(toNumber(input.amount, 1), 1, 20));
  const maxItems = Math.trunc(clamp(toNumber(input.maxItems, 0), 0, 1000000));
  const normalizeCursor = (value, name) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`feed.${name} 必须是整数或 null（可为负数以指向副屏）`);
    }
    const n = Math.trunc(value);
    // 允许负坐标：多显示器副屏位于主屏左侧/上方时坐标为负；绝对上限放宽到虚拟桌面范围
    if (n < -32768 || n > 32767) {
      throw new Error(`feed.${name} 必须在 -32768 到 32767 之间`);
    }
    return n;
  };
  const cursorX = normalizeCursor(input.cursorX, 'cursorX');
  const cursorY = normalizeCursor(input.cursorY, 'cursorY');
  return { intervalMs, action, amount, maxItems, cursorX, cursorY };
}

module.exports = { normalizeConfig, normalizeRegion, normalizeFeedConfig, clamp, toNumber };
