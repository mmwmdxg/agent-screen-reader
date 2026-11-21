# 实时屏幕读取插件（agent-screen-reader）

让 agent 实时读取 Windows 电脑屏幕的功能模块，支持**插件模式**加载。核心能力：定时抓屏 → 生成 PNG → agent 通过图片读取工具拿到画面 → 通过元数据索引定位最新帧。

**v1.1.0 新增「实时刷流」**：在"看屏幕"之上加了"刷屏幕"——自动滚动/翻页 → 抓帧 → 写 feed 索引，让 agent 像人刷 feed 一样逐条浏览短视频、帖子等内容流。

## 运行要求

- Windows 桌面环境（使用 .NET `System.Drawing.CopyFromScreen` 抓屏）
- Node.js（已在 PATH）
- PowerShell（Windows 自带）

## 文件结构

```
index.js                      命令行入口与插件宿主示例
plugin.json                   插件清单
src/screen-capture/
  capture.ps1                 PowerShell 抓屏脚本
  scroll.ps1                  PowerShell 输入模拟脚本（滚动/翻页，v1.1 新增）
  config.js                   配置归一化与校验（含 feed 配置）
  ScreenCapture.js            抓屏核心（单帧 / 定时流 / 开关 / 区域）
  FeedBrowser.js              刷流核心：动作→抓帧→索引（v1.1 新增）
src/plugins/
  PluginManager.js            通用插件注册管理器
  ScreenReaderPlugin.js       屏幕读取插件封装（含 feed API）
test/selftest.js              自检脚本
captures/                     默认截图输出目录
```

## 使用方式

### 命令行

```powershell
cd D:\AgentProject-1

# 查看插件状态
node index.js status

# 抓一帧（输出到 captures/，同时在 captures/latest.json 写索引）
node index.js snapshot

# 实时流 3 秒（每秒 2 帧，手动停止）
node index.js stream 3

# 刷一次（先滚动一屏再抓一帧，适合 agent 逐条消费）
node index.js feed-once

# 自动刷流 6 秒（默认每 1200ms 下滑一次并抓帧）
node index.js feed 6

# 指定动作与间隔：翻下页，每 800ms 一次，持续 10 秒
node index.js feed 10 pgdn 800

# 跑自检
node test/selftest.js
```

### 作为插件集成到 agent

```js
const { createAgentPluginHost } = require('./index');

const host = createAgentPluginHost({
  outputDir: 'captures',        // 截图输出目录
  fps: 2,                       // 每秒帧数
  enabled: true,                // 总开关
  region: { x: 0, y: 0, width: 320, height: 240 }, // 可选，限制区域
  onFrame: (meta) => console.log('新帧:', meta.path)
});

const api = host.api;
const meta = await api.snapshot();     // 单帧
api.streamStart({ fps: 2 });           // 开始定时流
api.streamStop();                      // 停止定时流
api.setEnabled(false);                 // 关闭总开关
console.log(api.status());             // 抓屏状态

// v1.1 新增：实时刷流（短视频/帖子 feed）
const item = await api.feedOnce({ action: 'scroll', amount: 1 }); // 刷一条：先滚动再抓帧
api.feedStart({ action: 'scroll', intervalMs: 1200, maxItems: 0 }); // 自动刷，0=不限
console.log(api.feedStatus());         // 刷流状态（条数、会话 id、最近动作等）
api.feedStop();                        // 停止自动刷流
```

## 配置项

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关，`false` 时所有抓屏调用被拒绝 |
| `outputDir` | string | `captures` | PNG 与 JSON 元数据输出目录 |
| `fps` | number | `1` | 定时流帧率，钳制到 0.1–30 |
| `maxFrames` | number | `0` | 定时流最多帧数，0 表示不限，上限 1000000 |
| `region` | object/null | `null` | 捕获区域 `{x,y,width,height}`，null 表示全屏 |

### 刷流配置（`feedOptions`，v1.1 新增）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `action` | string | `scroll` | 刷流动作：`scroll`下滑 / `scrollup`上滑 / `pgdn`翻下页 / `pgup`翻上页 / `none`只抓不滚 |
| `intervalMs` | number | `1200` | 自动刷流间隔毫秒，钳制 100–60000 |
| `amount` | number | `1` | 每次滚动格数，1–20 |
| `maxItems` | number | `0` | 本次刷流最多条数，0 表示不限 |
| `cursorX` / `cursorY` | number/null | `null` | 滚动前鼠标定位坐标，null 表示屏幕中央 |

## agent 如何「读到」屏幕

1. 调用 `api.snapshot()` 或启动 `stream` 得到 `meta.path`（PNG 文件路径）。
2. agent 用图像读取工具（如 `read_image`）打开该 PNG，即可看到屏幕画面。
3. `captures/latest.json` 始终指向最近一帧，便于 agent 直接取最新画面。

### v1.1 刷流模式：agent 如何"刷"内容流

1. 调 `api.feedOnce()` 或 `api.feedStart()`：每次先发一次滚动/翻页动作，再抓一帧——这就是"刷"与"看"的区别。
2. `captures/feed-index.json` 是指针文件，指向最近一次会话的索引文件名（`indexFile`）。每个会话有独立索引 `captures/feed-index-<sessionId>.json`，记录该会话的条目序列：每条含 `seq`（序号）、`action`（动作）、`capturedAt`、`path`（截图路径）、`feedId`。agent 按顺序读 `items[i].path` 即可逐条消费刷过的内容；多会话互不覆盖。`feedStatus().indexFile` 给出当前会话索引的完整路径。
3. `feedStatus()` 给出 `items`（已刷条数）、`sessionId`、`browsing`、`lastError` 等状态。

## 验证状态

`node test/selftest.js` 已在本机实跑通过（23 项全部 PASS），覆盖：配置归一化、插件注册激活、多宿主状态隔离、单帧真实抓屏（2560x1440 PNG）、区域抓屏（320x240）、最新帧索引、maxFrames 独立计数、定时流、错误路径安全、region 越界校验、总开关，以及 v1.1 的 feed 配置归一化、feedOnce 闭环、自动刷流计数与自动停止、feedStop 幂等与关闭态拒绝、scroll 动作，并含严格审查后的 7 项修复回归：停止竞态、总开关联动、cursor 坐标校验、会话索引隔离、回调异常隔离、翻页 amount、版本一致性。

CLI 闭环实测：`node index.js feed-once` 返回一条 feed 条目（scroll 动作 + 2560x1440 PNG），用图像读取工具打开该 PNG 成功看到真实桌面画面。
