# @yg/screen-reader-feed

DSH 插件 bundle：让 agent 实时刷短视频、帖子等 feed 内容。

## 安装后在会话里做什么

安装并重启 DSH 后，会话里会出现 `screen-feed` skill。对它说「刷抖音」「实时看屏幕」即可触发；skill 会告诉 agent 用 `node index.js feed-once` 滚动抓帧，再用 read_image 逐条读图。

## 配置

脚本目录默认 `D:\AgentProject-1`。若项目在别处，设置环境变量：

```powershell
$env:SCREEN_READER_DIR = "你的项目路径"
```

## 组成

- `cordis.patch.yml`：把本插件插入 DSH
- `lib/index.js`：`apply()` 里 `ctx.skills.register()` 注册 `screen-feed` skill
- 依赖 DSH 提供的 `ctx.skills`（`dsh-skill` 服务）
