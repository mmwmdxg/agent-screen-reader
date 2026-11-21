import { homedir } from 'node:os'
import path from 'node:path'

/** Cordis 插件名：必须与 cordis.patch.yml 的 insert.id 一致。 */
export const name = 'screen-reader-feed'

/** 依赖 dsh-skill 提供的 ctx.skills 注册表。 */
export const inject = ['skills']

const SKILL_NAME = 'screen-feed'

function projectDir() {
  return process.env.SCREEN_READER_DIR || path.join('D:', 'AgentProject-1')
}

function skillBody() {
  const dir = projectDir()
  return `# 实时刷流（screen-feed）

让 agent 像人刷抖音一样，实时看屏幕上的短视频/帖子 feed：滚动 → 抓帧 → 读图 → 逐条理解内容。

## 工作目录

插件脚本位于 \`${dir}\`。所有命令先切到该目录。Windows 上若路径不同，用环境变量 \`SCREEN_READER_DIR\` 指定。

## 环境要求

- Windows 桌面 + PowerShell（抓屏用 \`System.Drawing.CopyFromScreen\`，滚动用 user32 \`mouse_event\` / \`SendKeys\`）
- Node.js 在 PATH 中
- 屏幕前台是想要刷的窗口（抖音网页版/信息流页面等），先把它切到最前

## 先确认前台窗口

刷之前确保目标窗口在前台。必要时先把浏览器/App 激活：

\`\`\`powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinTop {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '抖音|douyin|微博|reddit|X|twitter' } | Select-Object -First 1
if ($p) { [WinTop]::ShowWindow($p.MainWindowHandle, 3) | Out-Null; [WinTop]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
\`\`\`

## 刷一条（默认连抓 12 帧拼图）

\`\`\`powershell
cd "${dir}"
node index.js feed-once
\`\`\`

返回一条 feed 条目 JSON：\`seq\` / \`action\` / \`path\`（**拼图 PNG**路径）/ \`feedId\` / \`mode\`=\`montage\` / \`frameCount\`=12 / \`frames\`（各单帧路径数组）。
默认行为：**先滚动一条，再连抓 12 帧（每 400ms 一帧）拼成 4 列网格图**。这样一次读图就能看全这条视频的进程，而不是靠单帧猜。
拿到 \`path\` 后，用图像读取工具（read_image）打开拼图，读出视频/图文讲了什么 → 用中文说看到的内容 → 再刷下一条。
若只要单帧（快），传 \`montage:false\`（见 API）。

## 连续自动刷 N 秒

\`\`\`powershell
node index.js feed <秒数> [动作] [间隔毫秒]
# 例：每 2.5 秒下滑一条，刷 30 秒
node index.js feed 30 scroll 2500
\`\`\`

每条同样默认 12 帧拼图。动作可选 \`scroll\`（下滑）/ \`scrollup\` / \`pgdn\` / \`pgup\` / \`none\`。

## 结构化 API（在脚本里集成）

\`\`\`js
const { createAgentPluginHost } = require('${dir.replace(/\\/g, '\\\\')}/index')
const host = createAgentPluginHost({ outputDir: 'captures', feedOptions: { action: 'scroll', intervalMs: 1200 } })
const api = host.api
const item = await api.feedOnce()        // 滚动 + 连抓 12 帧拼图
const fast = await api.feedOnce({ montage: false })  // 只要单帧
const custom = await api.feedOnce({ frames: 8, frameIntervalMs: 300, cols: 4 }) // 自定义拼图
api.feedStart({ maxItems: 10 })          // 自动刷 10 条（每条拼图）
const st = api.feedStatus()              // 已刷条数/会话/最近动作
api.feedStop()                           // 停止
\`\`\`

## 刷哪块屏

默认自动探测非主屏（副屏）作为刷流区域，不打扰主屏工作。可用环境变量覆盖：
\`SCREEN_READER_REGION=x,y,w,h\` 与 \`SCREEN_READER_CURSOR=x,y\`（支持负坐标指向副屏）。

## 索引

- \`captures/feed-index.json\` 是指针，指向最近会话的索引文件
- \`captures/feed-index-<sessionId>.json\` 逐条记录 seq/动作/时间/截图路径/feedId
- 按 seq 顺序读 \`items[i].path\` 即可逐条消费刷过的内容

## 自检

\`\`\`powershell
node ${path.join(dir, 'test', 'selftest.js')}
\`\`\`

## 使用要点

- "刷"与"看"的区别：feed-once 先发滚动动作再连抓 12 帧拼图，不是单纯定时抓屏
- 短视频是翻页式切换：一次滚轮换一条，抓帧时机在切换后
- **默认连抓 12 帧拼成 4 列网格**：一次读图看全视频进程，避免单帧只看到某一瞬间的局限；要更快可传 montage:false
- 拼图每帧带 #序号，按序号读顺序；\`frames\` 数组保留原帧路径可放大细看
- 刷手机 App 需另配 ADB，本 skill 走 Windows 桌面抓屏
`
}

/** 注册 skill：apply 时把 screen-feed 加入 ctx.skills。 */
export function apply(ctx) {
  const dispose = ctx.skills.register({
    name: SKILL_NAME,
    description: '实时刷短视频、帖子等 feed 内容：滚动屏幕→抓帧→逐条读图理解。当用户要看/刷短视频、帖子、信息流、抖音、微博等，或要求实时看屏幕内容时使用。',
    whenToUse: '用户说"刷抖音/刷视频/看帖子/实时看屏幕/刷 feed"，或需要 agent 自动滚动浏览屏幕内容时。',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    content: skillBody(),
  })
  ctx.on('dispose', () => dispose?.())
}
