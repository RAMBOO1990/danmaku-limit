# DanmakuLimit — B站直播弹幕防卡顿油猴脚本

## 项目介绍
通过分层限流策略，在弹幕正常时细粒度拦截，弹幕极端爆发时自动关闭渲染管线（停止RAF+清除DOM），平息后自动恢复，解决B站直播弹幕集中爆发导致视频卡顿的问题。

## 架构分层

### 1. 配置层（`danmaku-limit.user.js` 顶部）
- 11 个配置项通过 `GM_getValue/GM_setValue` 持久化，默认值在代码中定义
- 配置面板使用 Shadow DOM 隔离页面 CSS，通过 `GM_registerMenuCommand` 菜单打开
- 功能开关使用 iOS 风格 switch 开关（`.switch` 组件），激活色 `#FB7299`

### 2. 上游拦截层（handleSocketMessage Hook）
- 在弹幕引擎解析 `DANMU_MSG` 之前做第一道拦截
- **同屏限制**：DOM 查询 `.bili-danmaku-x-show` 数量，超限直接丢弃
- **紧急保护**：1 秒窗口内弹幕速率超过阈值则关闭渲染管线，冷却后恢复

### 3. 核心引擎层（core.add Hook）
- **突发限制**：`BURST_WINDOW` 窗口内超过 `MAX_PER_BATCH` 条则丢弃
- **视觉精简**：移除 VIP/表情/点赞图标等 DOM 元素
- 紧急模式下直接阻断全部弹幕添加

## 文件结构
- `danmaku-limit.user.js` — 油猴脚本主程序（含配置面板 UI、引擎 Hook、逻辑）
- `data/danmaku-v2.js` — **禁止修改**，B站弹幕引擎源文件，仅用于分析参考

## 关键实现细节
- `unsafeWindow.LiveDanmakuEngine` 的 setter Hook 来捕获弹幕引擎实例
- `document-start` 运行时机，MutationObserver 等待 body 挂载面板
- 配置面板中的展开/折叠箭头 (▶/▼) 通过 CSS transform 旋转实现平滑过渡
