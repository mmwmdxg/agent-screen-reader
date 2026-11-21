'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { PluginManager } = require('./src/plugins/PluginManager');
const { createScreenReaderPlugin } = require('./src/plugins/ScreenReaderPlugin');

// 探测"刷流屏"：默认取非主屏（副屏），避免打扰主屏上的工作。
// 可用 SCREEN_READER_REGION='x,y,w,h' 与 SCREEN_READER_CURSOR='x,y' 显式覆盖。
function detectFeedScreen() {
  if (process.env.SCREEN_READER_REGION) {
    const [x, y, width, height] = process.env.SCREEN_READER_REGION.split(',').map(Number);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      const cursor = process.env.SCREEN_READER_CURSOR
        ? process.env.SCREEN_READER_CURSOR.split(',').map(Number)
        : [x + Math.trunc(width / 2), y + Math.trunc(height / 2)];
      return { region: { x, y, width, height }, cursorX: cursor[0], cursorY: cursor[1] };
    }
  }
  try {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  if (-not $s.Primary) {
    $b = $s.Bounds
    Write-Output ("{0},{1},{2},{3}" -f $b.X,$b.Y,$b.Width,$b.Height)
    break
  }
}`;
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
    const [x, y, width, height] = out.split(',').map(Number);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return { region: { x, y, width, height }, cursorX: x + Math.trunc(width / 2), cursorY: y + Math.trunc(height / 2) };
    }
  } catch (e) { /* 探测失败则回退到主屏全屏 */ }
  return { region: null, cursorX: null, cursorY: null };
}

function createAgentPluginHost(options = {}) {
  const manager = new PluginManager({
    captureOptions: {
      outputDir: options.outputDir || path.resolve('captures'),
      fps: options.fps || 1,
      enabled: options.enabled !== false,
      region: options.region || null
    },
    feedOptions: options.feedOptions || options.feed || {},
    onFrame: options.onFrame,
    onFeedFrame: options.onFeedFrame
  });
  manager.register(createScreenReaderPlugin());
  const api = manager.get('screen-reader').activate();
  return { manager, api };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const isFeed = command === 'feed' || command === 'feed-once';
  const screen = isFeed ? detectFeedScreen() : { region: null, cursorX: null, cursorY: null };
  const host = createAgentPluginHost(isFeed ? {
    region: screen.region,
    feedOptions: { cursorX: screen.cursorX, cursorY: screen.cursorY }
  } : {});
  const api = host.api;
  if (isFeed) {
    console.error(`[screen-feed] 目标屏 region=${JSON.stringify(screen.region)} cursor=${screen.cursorX},${screen.cursorY}`);
  }

  if (command === 'snapshot') {
    const meta = await api.snapshot();
    console.log(JSON.stringify(meta, null, 2));
    return;
  }
  if (command === 'stream') {
    const secs = Number(args[0] || 3);
    const interval = setInterval(() => console.log(JSON.stringify(api.status())), 500);
    api.streamStart({ fps: 2, maxFrames: secs * 2 });
    await new Promise(r => setTimeout(r, secs * 1000 + 1200));
    clearInterval(interval);
    console.log(JSON.stringify(api.streamStop(), null, 2));
    return;
  }
  if (command === 'feed') {
    // node index.js feed [秒数] [动作] [间隔毫秒]
    const secs = Number(args[0] || 6);
    const action = args[1] || 'scroll';
    const intervalMs = Number(args[2] || 1200);
    const started = api.feedStart({ action, intervalMs, maxItems: 0 });
    console.log(JSON.stringify({ started }));
    await new Promise(r => setTimeout(r, secs * 1000));
    console.log(JSON.stringify({
      stopped: api.feedStop(),
      status: api.feedStatus()
    }, null, 2));
    return;
  }
  if (command === 'feed-once') {
    // 单步刷一次：先滚动一屏再抓一帧，适合 agent 手动逐条消费
    const item = await api.feedOnce();
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  if (command === 'status' || !command) {
    console.log(JSON.stringify({
      plugins: host.manager.list(),
      status: api.status(),
      feed: api.feedStatus()
    }, null, 2));
    return;
  }
  console.log(`未知命令: ${command}`);
  process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });

module.exports = { createAgentPluginHost };
