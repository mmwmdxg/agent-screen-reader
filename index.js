'use strict';

const path = require('path');
const { PluginManager } = require('./src/plugins/PluginManager');
const { createScreenReaderPlugin } = require('./src/plugins/ScreenReaderPlugin');

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
  const host = createAgentPluginHost();
  const api = host.api;

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
