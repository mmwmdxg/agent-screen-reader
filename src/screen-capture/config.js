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
  const x = Math.trunc(toNumber(region.x, -1));
  const y = Math.trunc(toNumber(region.y, -1));
  const width = Math.trunc(toNumber(region.width, 0));
  const height = Math.trunc(toNumber(region.height, 0));
  if (width <= 0 || height <= 0) {
    throw new Error('region.width 和 region.height 必须是正整数');
  }
  if (x < 0 || y < 0) {
    throw new Error('region.x 和 region.y 必须是非负整数');
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
      throw new Error(`feed.${name} 必须是非负整数或 null`);
    }
    const n = Math.trunc(value);
    if (n < 0 || n > 65535) {
      throw new Error(`feed.${name} 必须在 0-65535 之间（屏幕坐标上限）`);
    }
    return n;
  };
  const cursorX = normalizeCursor(input.cursorX, 'cursorX');
  const cursorY = normalizeCursor(input.cursorY, 'cursorY');
  return { intervalMs, action, amount, maxItems, cursorX, cursorY };
}

module.exports = { normalizeConfig, normalizeRegion, normalizeFeedConfig, clamp, toNumber };
