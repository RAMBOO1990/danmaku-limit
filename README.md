# DanmakuLimit — B站直播弹幕防卡顿

[![GitHub](https://img.shields.io/badge/GitHub-danmaku--limit-181717?logo=github)](https://github.com/RAMBOO1990/danmaku-limit)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## 简介

**DanmakuLimit** 是一款 Tampermonkey 油猴脚本，解决 B站直播间弹幕集中爆发导致视频卡顿的问题。

采用**分层限流**策略：

- **正常时** — 细粒度拦截，同屏弹幕数量可控，突发弹幕被平滑削峰
- **极端爆发时** — 自动关闭渲染管线（停止 RAF + 清除 DOM），平息后自动恢复

无需任何外部依赖，安装即用。

## 安装

### 一键安装（推荐）

<a href="https://github.com/RAMBOO1990/danmaku-limit/raw/main/danmaku-limit.user.js">
  <img src="https://img.shields.io/badge/Install%20from-GitHub-181717?logo=github&style=for-the-badge" alt="从 GitHub 安装" height="36">
</a>

或直接点击：**[从 GitHub 安装](https://github.com/RAMBOO1990/danmaku-limit/raw/main/danmaku-limit.user.js)**

### 前置条件

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 点击上方安装链接
3. Tampermonkey 会自动识别并提示安装，确认即可

## 功能特性

| 功能 | 说明 |
|------|------|
| **同屏弹幕限制** | 限制同一屏幕最多显示的弹幕数量，超出的弹幕在上游直接丢弃 |
| **突发弹幕限制** | 时间窗口内限制放行条数，防止瞬间涌入过多弹幕 |
| **紧急保护** | 弹幕极端爆发（如抽奖/节奏）时自动关闭渲染管线，冷却后自动恢复 |
| **弹幕视觉精简** | 隐藏 VIP/表情/点赞图标，弹幕添加文字描边 |
| **可视化配置面板** | 通过油猴菜单打开配置面板，所有参数实时调整 |
| **监控日志** | 定时输出丢弃/放行统计，方便调优参数 |

## 配置项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 同屏弹幕限制开关 | 开启 | 启用/禁用同屏数量限制 |
| 最大同屏弹幕数 | 50 | 同屏最多显示的弹幕条数（推荐 20-50） |
| 弹幕突发限制开关 | 开启 | 启用/禁用突发限制 |
| 突发放行限制 | 3 | 检测窗口内最多放行条数（推荐 2-5） |
| 突发检测窗口 | 150ms | 突发检测时间窗口（推荐 100-300） |
| 紧急保护开关 | 开启 | 启用/禁用紧急保护模式 |
| 紧急触发弹幕率 | 30/s | 超过此速率触发紧急关闭（推荐 20-40） |
| 紧急冷却时间 | 3000ms | 关闭后等待恢复的时间 |
| 弹幕视觉精简 | 开启 | 隐藏多余图标、添加描边 |
| 日志级别 | 仅定时汇总 | 控制台输出详细程度 |
| 监控日志周期 | 3000ms | 控制台统计输出间隔 |

## 工作原理

```
DANMU_MSG → [上游拦截层] → [核心引擎层] → 渲染
               │                    │
               ├─ 同屏限制           ├─ 突发限制
               ├─ 紧急保护           ├─ 视觉精简
               └─ 速率监控           └─ 紧急阻断
```

- **上游拦截层**：在 `handleSocketMessage` 中拦截 `DANMU_MSG`，弹幕进入引擎解析前完成同屏检查和紧急保护触发
- **核心引擎层**：Hook `core.add` 方法，做突发窗口限制和视觉精简。紧急模式下直接阻断全部弹幕
- **紧急保护**：1 秒窗口内弹幕速率超阈值 → 停止 RAF → 清除 DOM → 设置 visible=false → 冷却后恢复

## 开发

```bash
# 克隆仓库
git clone git@github.com:RAMBOO1990/danmaku-limit.git
cd danmaku-limit

# 项目是单文件油猴脚本，直接编辑 danmaku-limit.user.js 即可
```

## License

MIT
