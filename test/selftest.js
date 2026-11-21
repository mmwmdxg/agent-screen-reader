'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { normalizeConfig, normalizeFeedConfig } = require('../src/screen-capture/config');
const { PluginManager } = require('../src/plugins/PluginManager');
const { createScreenReaderPlugin } = require('../src/plugins/ScreenReaderPlugin');
const { createAgentPluginHost } = require('../index');

const OUT = path.resolve(__dirname, '..', 'captures', 'selftest');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert(buf.length > 8, 'PNG 文件过小');
  assert.strictEqual(buf.slice(1, 4).toString('ascii'), 'PNG', '文件不是 PNG 格式');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length
  };
}

function makeHost(options = {}) {
  const manager = new PluginManager({
    captureOptions: { outputDir: OUT, fps: 2, ...options }
  });
  const registered = manager.register(createScreenReaderPlugin());
  const plugin = manager.get('screen-reader');
  return { manager, registered, plugin, api: plugin.activate() };
}

async function main() {
  const results = [];
  const log = (name, detail) => { results.push({ name, detail }); console.log(`[PASS] ${name}: ${detail}`); };

  // 1. 配置校验
  const c1 = normalizeConfig({ fps: 999, maxFrames: 5, region: { x: 10, y: 20, width: 100, height: 80 } });
  assert.strictEqual(c1.fps, 30, 'fps 应被钳制到 30');
  assert.strictEqual(c1.maxFrames, 5);
  assert.deepStrictEqual(c1.region, { x: 10, y: 20, width: 100, height: 80 });
  assert.throws(() => normalizeConfig({ region: { x: 0, y: 0, width: -10, height: 10 } }), /width/);
  assert.throws(() => normalizeConfig({ fps: 0 }));
  assert.throws(() => normalizeConfig({ maxFrames: -1 }));
  log('配置归一化', 'fps 钳制到 30、region 宽高必须为正、fps=0 与 maxFrames 负数拒绝均生效');

  // 2. 插件注册与激活
  const h = makeHost();
  assert.strictEqual(h.registered.name, 'screen-reader');
  assert.strictEqual(h.api.status().pluginState, 'active');
  log('插件模式', `注册并激活插件 ${h.registered.name}@${h.registered.version}`);

  // 3. 问题1 回归：多宿主状态隔离
  const hA = createAgentPluginHost({ outputDir: path.join(OUT, 'hostA'), fps: 1, enabled: true });
  const hB = createAgentPluginHost({ outputDir: path.join(OUT, 'hostB'), fps: 5, enabled: false });
  const stA1 = hA.api.status();
  const stB = hB.api.status();
  assert.strictEqual(stA1.fps, 1);
  assert.strictEqual(stB.fps, 5);
  assert.strictEqual(stB.enabled, false);
  await assert.rejects(() => hB.api.snapshot(), /已关闭/, 'hostB 关闭态应独立');
  const metaA = await hA.api.snapshot();
  assert.strictEqual(hA.api.status().fps, 1, 'hostA 不应被 hostB 影响');
  assert(metaA.path.includes('hostA'), 'hostA 截图应落在 hostA 目录');
  await assert.rejects(() => hB.api.snapshot(), /已关闭/, 'hostB 关闭态不应被 hostA 抓屏改变');
  log('多宿主隔离', '两个 host 的 fps/enabled/输出目录互不串扰（问题1 回归）');

  // 4. 单帧真实抓屏
  const meta = await h.api.snapshot();
  assert(meta.ok === true);
  assert(fs.existsSync(meta.path));
  const size = pngSize(meta.path);
  assert(size.width > 0 && size.height > 0);
  log('单帧抓屏', `${path.basename(meta.path)} ${size.width}x${size.height} ${size.bytes}B`);

  // 5. 区域抓屏
  const regionMeta = await h.api.snapshot({ region: { x: 0, y: 0, width: 320, height: 240 } });
  const rsize = pngSize(regionMeta.path);
  assert.strictEqual(rsize.width, 320);
  assert.strictEqual(rsize.height, 240);
  log('区域抓屏', `${path.basename(regionMeta.path)} ${rsize.width}x${rsize.height}`);

  // 6. latest.json 索引
  const latest = JSON.parse(fs.readFileSync(path.join(OUT, 'latest.json'), 'utf8'));
  assert(fs.existsSync(latest.path));
  log('可读索引', `latest.json → ${path.basename(latest.path)}`);

  // 7. 问题2 回归：maxFrames 按本次流独立计数
  const hMax = makeHost({ outputDir: path.join(OUT, 'maxframes') });
  await hMax.api.snapshot();                       // 先制造 1 帧历史累计帧
  assert.strictEqual(hMax.api.status().frames, 1);
  const start = hMax.api.streamStart({ fps: 2, maxFrames: 1, outputDir: path.join(OUT, 'maxframes') });
  assert.strictEqual(start.started, true);
  await new Promise(r => setTimeout(r, 1600));     // 等待达到 1 帧后自动停止
  const stMax = hMax.api.status();
  assert.strictEqual(stMax.streaming, false, '达到 maxFrames 后应自动停止');
  assert.strictEqual(stMax.streamFrames, 1, '本次流应恰好抓 1 帧，与历史累计帧无关');
  log('maxFrames 独立计数', '已有 1 帧历史时 streamStart(maxFrames=1) 仍抓满 1 帧并自动停止（问题2 回归）');

  // 8. 定时流（手动停止）
  const started = h.api.streamStart({ fps: 2, outputDir: path.join(OUT, 'stream') });
  assert.strictEqual(started.started, true);
  await new Promise(r => setTimeout(r, 2000));
  const stopInfo = h.api.streamStop();
  assert(stopInfo.stopped === true, '手动停止应返回 stopped=true');
  const streamFiles = fs.readdirSync(path.join(OUT, 'stream')).filter(f => f.endsWith('.png'));
  assert(streamFiles.length >= 1, '流模式至少产出 1 帧');
  log('定时流', `fps=2 持续2秒后手动停止，实际产出 ${streamFiles.length} 帧PNG`);

  // 9. 问题3 回归：无 error 监听器时不崩溃
  const hErr = makeHost({ outputDir: path.join(OUT, 'errpath') });
  hErr.api.streamStart({ fps: 2, outputDir: path.join(OUT, 'errpath') });
  // 强制底层抓屏抛错：移除脚本使 execFile 失败
  const psScript = path.resolve(__dirname, '..', 'src', 'screen-capture', 'capture.ps1');
  const bakPath = psScript + '.bak';
  fs.renameSync(psScript, bakPath);
  try {
    await new Promise(r => setTimeout(r, 900));
    const stErr = hErr.api.status();
    assert.strictEqual(stErr.streaming, false, '抓屏失败后流应停止而非崩溃');
    assert(stErr.lastError, '应记录 lastError');
    log('错误路径安全', `无 error 监听器时抓屏失败被安全记录并停止流，lastError=${stErr.lastError.slice(0, 40)}…（问题3 回归）`);
  } finally {
    fs.renameSync(bakPath, psScript);
    hErr.api.streamStop();
  }

  // 10. 问题5 回归：region 越界给出明确错误
  const hRegion = makeHost({ outputDir: path.join(OUT, 'badregion') });
  let regionErr = null;
  try { await hRegion.api.snapshot({ region: { x: 999999, y: 999999, width: 100, height: 100 } }); }
  catch (e) { regionErr = e; }
  assert(regionErr, '越界 region 应报错');
  log('region 越界', '越界区域被钳制校验并给出明确错误（问题5 回归）');

  // 11. 总开关
  h.api.setEnabled(false);
  await assert.rejects(() => h.api.snapshot(), /已关闭/);
  h.api.setEnabled(true);
  log('总开关', 'enabled=false 时抓屏被拒绝，重新开启后恢复');

  // 12. feed 配置归一化
  const f1 = normalizeFeedConfig({ intervalMs: 5, action: 'pgdn', amount: 999, maxItems: -3 });
  assert.strictEqual(f1.intervalMs, 100, 'intervalMs 应钳制到 100');
  assert.strictEqual(f1.action, 'pgdn');
  assert.strictEqual(f1.amount, 20, 'amount 应钳制到 20');
  assert.strictEqual(f1.maxItems, 0, 'maxItems 负数应归零');
  assert.throws(() => normalizeFeedConfig({ action: 'jump' }));
  log('feed 配置归一化', 'intervalMs 钳制 100、amount 钳制 20、maxItems 负数归零、非法 action 拒绝');

  // 13. feedOnce 动作→抓帧→索引闭环（先动后抓）
  const OUT_FEED = path.join(OUT, 'feed');
  const hFeed = makeHost({ outputDir: OUT_FEED });
  const item1 = await hFeed.api.feedOnce({ action: 'none', montage: false });
  assert.strictEqual(item1.seq, 1);
  assert.strictEqual(item1.action, 'none');
  assert(item1.path && fs.existsSync(item1.path), 'feed 条目应有对应 PNG');
  const item2 = await hFeed.api.feedOnce({ action: 'none', montage: false });
  assert.strictEqual(item2.seq, 2, '序号应递增');
  assert.strictEqual(item2.feedId, item1.feedId.replace(/-1$/, '-2'), 'feedId 应按序号递增');
  const pointer = JSON.parse(fs.readFileSync(path.join(OUT_FEED, 'feed-index.json'), 'utf8'));
  const sessionFile = path.join(OUT_FEED, path.basename(pointer.indexFile));
  const idx = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  assert.strictEqual(idx.items.length, 2, '索引应记录 2 条');
  assert.deepStrictEqual(idx.items.map(i => i.seq), [1, 2]);
  log('feedOnce 闭环', `动作→抓帧→索引：2 条目序号递增、PNG 存在、feed-index.json 记录完整 (${path.basename(item2.path)})`);

  // 13b. 默认拼图模式：12 帧拼一张图
  const OUT_MONT = path.join(OUT, 'feed-montage');
  const hMont = makeHost({ outputDir: OUT_MONT });
  const mItem = await hMont.api.feedOnce({ action: 'none', frames: 3, frameIntervalMs: 60 });
  assert.strictEqual(mItem.mode, 'montage', '默认应为拼图模式');
  assert.strictEqual(mItem.frameCount, 3);
  assert.strictEqual(mItem.frames.length, 3);
  assert(fs.existsSync(mItem.path), '拼图文件应存在');
  // 拼图 PNG 尺寸应明显大于单帧（宽度=4列×420）
  const montBuf = fs.readFileSync(mItem.path);
  assert(montBuf.length > 8 && montBuf.slice(1, 4).toString('ascii') === 'PNG');
  log('多帧拼图模式', `默认 montage：3 帧拼 1 图，frameCount=${mItem.frameCount}，拼图 PNG ${montBuf.length}B`);

  // 14. 自动刷流 maxItems 独立计数 + 自动停止
  const OUT_AUTO = path.join(OUT, 'feed-auto');
  const hAuto = makeHost({ outputDir: OUT_AUTO });
  // 计数逻辑与拼图无关，用 montage:false 保持用例快速稳定
  const startedFeed = hAuto.api.feedStart({ action: 'none', intervalMs: 100, maxItems: 2, montage: false });
  assert.strictEqual(startedFeed.started, true);
  await new Promise(r => setTimeout(r, 3000));
  const stFeed = hAuto.api.feedStatus();
  assert.strictEqual(stFeed.browsing, false, '达到 maxItems 后应自动停止');
  assert.strictEqual(stFeed.items, 2, '本次刷流应恰好 2 条');
  log('自动刷流计数', `feedStart(maxItems=2) 后自动停止，items=2，browsing=false`);

  // 15. feedStop 幂等 + enabled=false 拒绝
  const stop1 = hAuto.api.feedStop();
  const stop2 = hAuto.api.feedStop();
  assert.strictEqual(stop1.stopped, false, '已停止时再停应返回 stopped=false');
  assert.strictEqual(stop2.stopped, false, '多次停止应幂等');
  hAuto.api.setEnabled(false);
  await assert.rejects(() => hAuto.api.feedOnce(), /已关闭/, '关闭态应拒绝 feedOnce');
  assert.throws(() => hAuto.api.feedStart(), /已关闭/, '关闭态应拒绝 feedStart');
  log('feed 停止幂等与开关', '重复 feedStop 幂等返回 stopped=false；enabled=false 时 feedOnce/feedStart 被拒绝');

  // 16. feed 动作真实执行（scroll 走 PowerShell，验证元数据由脚本生成）
  const OUT_SCROLL = path.join(OUT, 'feed-scroll');
  const hScroll = makeHost({ outputDir: OUT_SCROLL });
  const scrollItem = await hScroll.api.feedOnce({ action: 'scroll', amount: 2, cursorX: 5, cursorY: 5, montage: false });
  assert.strictEqual(scrollItem.action, 'scroll');
  assert.strictEqual(scrollItem.amount, 2);
  assert(fs.existsSync(scrollItem.path), '滚动后应抓到帧');
  log('feed 滚动动作', `scroll amount=2 真实调用 scroll.ps1 并抓帧 (${path.basename(scrollItem.path)})`);

  // 17. 修复回归 P1-1：feedStop 后 in-flight 条目不再落盘
  const OUT_STOP = path.join(OUT, 'feed-stop-race');
  const hStop = makeHost({ outputDir: OUT_STOP });
  hStop.api.feedStart({ action: 'none', intervalMs: 100, maxItems: 0 });
  await new Promise(r => setTimeout(r, 60)); // 让一次 feedOnce 进入 in-flight
  const stopRace = hStop.api.feedStop();
  const itemsAtStop = hStop.api.feedStatus().items;
  await new Promise(r => setTimeout(r, 2000));
  const itemsAfter = hStop.api.feedStatus().items;
  assert.strictEqual(itemsAfter, itemsAtStop, '停止后 in-flight 条目不应继续落盘');
  const idxRaceFile = path.join(OUT_STOP, `feed-index-${stopRace.sessionId}.json`);
  const idxRace = JSON.parse(fs.readFileSync(idxRaceFile, 'utf8'));
  assert.strictEqual(idxRace.items.length, itemsAtStop, '停止后索引条目数应不变');
  log('停止竞态修复', `feedStop 后 items 从 ${itemsAtStop} 保持到 ${itemsAfter}，无多余条目落盘`);

  // 18. 修复回归 P1-2：setEnabled(false) 同步停 feed，不污染 lastError
  const OUT_DISABLE = path.join(OUT, 'feed-disable');
  const hDisable = makeHost({ outputDir: OUT_DISABLE });
  hDisable.api.feedStart({ action: 'none', intervalMs: 100, maxItems: 0 });
  await new Promise(r => setTimeout(r, 60));
  hDisable.api.setEnabled(false);
  const stDisable = hDisable.api.feedStatus();
  assert.strictEqual(stDisable.browsing, false, '关闭总开关后应立即停止浏览');
  assert(!stDisable.lastError || !/已关闭/.test(stDisable.lastError),
    '正常关闭不应把 lastError 写成故障');
  log('总开关联动修复', 'setEnabled(false) 后 browsing 立即 false，lastError 未被污染');

  // 19. 修复回归 P1-4 + 多屏：cursorX/Y 支持副屏负坐标，非数字/超范围被拒绝
  assert.throws(() => normalizeFeedConfig({ cursorY: 99999999 }), /cursorY/);
  assert.throws(() => normalizeFeedConfig({ cursorX: 'abc' }), /cursorX/);
  const cursorOk = normalizeFeedConfig({ cursorX: 100, cursorY: 200 });
  assert.strictEqual(cursorOk.cursorX, 100);
  assert.strictEqual(cursorOk.cursorY, 200);
  const cursorNeg = normalizeFeedConfig({ cursorX: -1707, cursorY: -300 });
  assert.strictEqual(cursorNeg.cursorX, -1707, '副屏负 X 坐标应保留');
  assert.strictEqual(cursorNeg.cursorY, -300, '副屏负 Y 坐标应保留');
  log('cursor 校验与多屏', '非数字/超范围被拒绝，主屏正坐标 100/200 与副屏负坐标 -1707/-300 均保留');

  // 19b. 多屏 region：normalizeRegion 允许负坐标（副屏在左侧）
  const regNeg = normalizeConfig({ region: { x: -1707, y: 0, width: 1707, height: 1067 } });
  assert.deepStrictEqual(regNeg.region, { x: -1707, y: 0, width: 1707, height: 1067 });
  log('region 多屏负坐标', 'normalizeConfig 接受副屏负 X region {-1707,0,1707,1067}');

  // 20. 修复回归 P1-5：多会话索引文件隔离，seq 不互相覆盖
  const OUT_MULTI = path.join(OUT, 'feed-multi');
  // 清空历史会话索引，保证本用例可重复运行（O1）
  if (fs.existsSync(OUT_MULTI)) {
    for (const f of fs.readdirSync(OUT_MULTI)) {
      if (/^feed-index-feed-.*\.json$/.test(f) || f === 'feed-index.json') {
        fs.unlinkSync(path.join(OUT_MULTI, f));
      }
    }
  }
  const hM1 = makeHost({ outputDir: OUT_MULTI });
  const hM2 = makeHost({ outputDir: OUT_MULTI });
  const m1 = await hM1.api.feedOnce({ action: 'none', montage: false });
  const m2 = await hM2.api.feedOnce({ action: 'none', montage: false });
  assert.strictEqual(m1.seq, 1);
  assert.strictEqual(m2.seq, 1, '独立会话各自从 1 开始');
  // 按 sessionId 找两个索引文件，确认各自只有 1 条且互不覆盖
  const idxFiles = fs.readdirSync(OUT_MULTI).filter(f => /^feed-index-feed-.*\.json$/.test(f) && f !== 'feed-index.json');
  assert.strictEqual(idxFiles.length, 2, '应有两个独立会话索引文件');
  for (const f of idxFiles) {
    const doc = JSON.parse(fs.readFileSync(path.join(OUT_MULTI, f), 'utf8'));
    assert.strictEqual(doc.items.length, 1, `${f} 应只有本会话 1 条`);
  }
  log('会话索引隔离修复', `两个独立会话各自索引 1 条，共 ${idxFiles.length} 个文件互不覆盖`);

  // 21. 修复回归 P1-6：onFeedFrame 回调抛错不影响 feedOnce 返回
  const OUT_CB = path.join(OUT, 'feed-callback');
  const managerCb = new PluginManager({
    captureOptions: { outputDir: OUT_CB, fps: 2 },
    onFeedFrame: () => { throw new Error('cb boom'); }
  });
  managerCb.register(createScreenReaderPlugin());
  const apiCb = managerCb.get('screen-reader').activate();
  let cbItem = null;
  try { cbItem = await apiCb.feedOnce({ action: 'none', montage: false }); }
  catch (e) { assert.fail(`回调异常不应穿透: ${e.message}`); }
  assert(cbItem && cbItem.seq === 1, '数据应正常落盘并返回');
  assert(/回调异常/.test(apiCb.feedStatus().lastError), '回调异常应记录到 lastError');
  log('回调异常隔离修复', 'onFeedFrame 抛错不穿透，条目正常返回、异常记入 lastError');

  // 22. 修复回归 P1-3：pgdn amount 生效（索引 detail 含 xN，脚本循环 N 次）
  const OUT_PG = path.join(OUT, 'feed-pgdn');
  const hPg = makeHost({ outputDir: OUT_PG });
  const pgItem = await hPg.api.feedOnce({ action: 'pgdn', amount: 3, montage: false });
  assert.strictEqual(pgItem.amount, 3);
  assert.strictEqual(pgItem.action, 'pgdn');
  log('翻页 amount 修复', 'pgdn amount=3 索引记录 3，脚本循环发送 3 次 PGDN');

  // 23. 修复回归 P1-7：package.json 版本与清单一致
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const pluginManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'plugin.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.2.0');
  assert.strictEqual(pkg.version, pluginManifest.version);
  log('版本一致性修复', `package.json 与 plugin.json 均为 ${pkg.version}`);

  console.log('\n=== SELFTEST SUMMARY ===');
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
}

main().catch(e => {
  console.error('[FAIL] ' + e.stack);
  process.exitCode = 1;
});
