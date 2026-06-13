// ==UserScript==
// @name         B站直播弹幕防卡顿
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  分层限流：正常时细粒度拦截，弹幕极端爆发时自动关闭渲染管线(停止RAF+清除DOM)，爆发平息后自动恢复
// @author       R9
// @match        *://live.bilibili.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // === 【从油猴存储中读取配置，若无则使用默认值】 ===
    const maxOnScreen = GM_getValue('MAX_ON_SCREEN', 50);
    const maxPerBatch = GM_getValue('MAX_PER_BATCH', 3);
    const logLevel = GM_getValue('CURRENT_LOG_LEVEL', 1);
    const emergencyRate = GM_getValue('EMERGENCY_RATE', 30);
    const emergencyCooldown = GM_getValue('EMERGENCY_COOLDOWN', 3000);

    // === 【注册油猴菜单命令】 ===

    // 菜单 1：设置最大同屏弹幕数
    GM_registerMenuCommand(`⚙️ 设置最大同屏弹幕数 (当前: ${maxOnScreen})`, () => {
        const val = prompt("请输入最大同屏弹幕数 (推荐 20 - 50):", maxOnScreen);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
                GM_setValue('MAX_ON_SCREEN', num);
                location.reload();
            } else {
                alert("请输入大于 0 的有效数字");
            }
        }
    });

    // 菜单 2：设置突发限制数
    GM_registerMenuCommand(`⚡ 设置突发爆发限制 (当前: ${maxPerBatch})`, () => {
        const val = prompt("请输入极短时间(150ms)内最多放行弹幕数 (推荐 2 - 5):", maxPerBatch);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
                GM_setValue('MAX_PER_BATCH', num);
                location.reload();
            } else {
                alert("请输入大于 0 的有效数字");
            }
        }
    });

    // 菜单 3：设置日志分级
    const logDesc = logLevel === 0 ? '完全关闭' : logLevel === 1 ? '仅定时汇总' : '详细调试(Debug)';
    GM_registerMenuCommand(`📝 设置运行日志级别 (当前: ${logDesc})`, () => {
        const val = prompt("请输入日志级别数字:\n0 = 完全关闭 (性能最佳)\n1 = 仅定时汇总 (每3秒汇总报告)\n2 = 详细调试 (Debug，输出每次拦截细节)", logLevel);
        if (val !== null) {
            const num = parseInt(val, 10);
            if ([0, 1, 2].includes(num)) {
                GM_setValue('CURRENT_LOG_LEVEL', num);
                location.reload();
            } else {
                alert("无效输入！只能输入 0, 1 或 2");
            }
        }
    });

    // 菜单 4：设置紧急触发阈值
    GM_registerMenuCommand(`🚨 设置紧急触发弹幕率 (当前: ${emergencyRate}/秒)`, () => {
        const val = prompt("请输入每秒弹幕数阈值，超过则自动关闭渲染管线 (推荐 20-40):", emergencyRate);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
                GM_setValue('EMERGENCY_RATE', num);
                location.reload();
            } else {
                alert("请输入大于 0 的有效数字");
            }
        }
    });

    // 菜单 5：设置紧急冷却时间
    GM_registerMenuCommand(`⏱️ 设置紧急冷却时间 (当前: ${emergencyCooldown}ms)`, () => {
        const val = prompt("请输入紧急关闭后等待恢复的毫秒数 (推荐 2000-5000):", emergencyCooldown);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 1000) {
                GM_setValue('EMERGENCY_COOLDOWN', num);
                location.reload();
            } else {
                alert("请输入大于等于 1000 的有效数字");
            }
        }
    });

    // ==========================================
    // 动态模板注入
    // ==========================================
    const injectCode = `
        (function() {
            const MAX_ON_SCREEN = ${maxOnScreen};
            const MAX_PER_BATCH = ${maxPerBatch};
            const CURRENT_LOG_LEVEL = ${logLevel};
            const EMERGENCY_RATE = ${emergencyRate};
            const EMERGENCY_COOLDOWN = ${emergencyCooldown};

            const LOG_LEVELS = { NONE: 0, INFO: 1, DEBUG: 2 };
            let stat_discarded = 0;
            let stat_passed = 0;

            // === 速率监控 & 紧急状态 ===
            let incomingTimestamps = [];
            let inEmergency = false;
            let emergencyRecoveryTimer = null;

            function enterEmergency(core) {
                if (inEmergency) return;
                inEmergency = true;

                if (emergencyRecoveryTimer) {
                    clearTimeout(emergencyRecoveryTimer);
                    emergencyRecoveryTimer = null;
                }

                // 1. 阻断 Ge 层处理
                core.config.visible = false;
                if (core.ricId) { cancelIdleCallback(core.ricId); core.ricId = null; }
                core.renderTaskQueue = [];
                if (core.timerIdList && core.timerIdList.forEach) {
                    core.timerIdList.forEach(function(t) { clearTimeout(t); });
                }
                core.timerIdList = [];

                // 2. 关闭 CoreRenderer 渲染管线（RAF + DOM + timeController）
                var cr = core.core;
                if (cr) {
                    if (typeof cr.pause === 'function') cr.pause();
                    if (typeof cr.setSetting === 'function') cr.setSetting("visible", false);
                }

                // 3. 清除特效层
                if (core.live && typeof core.live.callMethod === 'function') core.live.callMethod("clearVisualList");
                if (core.magic && typeof core.magic.callMethod === 'function') core.magic.callMethod("clear");

                infoLog('%c🚨 [DanmakuLimit紧急] 弹幕爆发率超过 ' + EMERGENCY_RATE + '/s，已关闭渲染管线 ' + EMERGENCY_COOLDOWN + 'ms', 'color: #FF0000; font-weight: bold;');
                debugLog('紧急状态: renderTaskQueue已清, RAF已停, DOM已清除, visible=false');

                // 4. 定时自动恢复
                emergencyRecoveryTimer = setTimeout(function() {
                    leaveEmergency(core);
                }, EMERGENCY_COOLDOWN);
            }

            function leaveEmergency(core) {
                if (!inEmergency) return;
                inEmergency = false;
                emergencyRecoveryTimer = null;

                // 1. 恢复 CoreRenderer 渲染管线
                var cr = core.core;
                if (cr) {
                    if (typeof cr.setSetting === 'function') cr.setSetting("visible", true);
                    if (typeof cr.play === 'function') cr.play();
                }

                core.config.visible = true;

                // 2. 重置速率窗口（防止立即再次触发）
                incomingTimestamps = [];

                infoLog('%c✅ [DanmakuLimit恢复] 弹幕渲染管线已恢复', 'color: #00CC00; font-weight: bold;');
            }

            function debugLog(...args) {
                if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEBUG) {
                    console.log("%c[DanmakuLimit调试]", "color: #00A1D6; font-weight: bold;", ...args);
                }
            }
            function infoLog(...args) {
                if (CURRENT_LOG_LEVEL >= LOG_LEVELS.INFO) {
                    console.log(...args);
                }
            }

            debugLog(\`渲染控制服务初始化。硬上限(DOM 计数): \${MAX_ON_SCREEN} 条, 突发限制: \${MAX_PER_BATCH}条/150ms, 紧急触发: \${EMERGENCY_RATE}/s\`);

            setInterval(() => {
                if (stat_discarded > 0 || stat_passed > 0) {
                    const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;
                    infoLog(\`%c🛡️ [DanmakuLimit监控] 过去3秒内: 放行 \${stat_passed} 条，丢弃 \${stat_discarded} 条。当前同屏弹幕: \${realActive} 条。\`, "color: #FB7299; font-weight: bold;");
                    stat_discarded = 0;
                    stat_passed = 0;
                }
            }, 3000);

            let recentAllowedTimestamps = [];

            function hookCoreEngine(core) {
                if (core._hooked) return;
                core._hooked = true;
                if (emergencyRecoveryTimer) {
                    clearTimeout(emergencyRecoveryTimer);
                    emergencyRecoveryTimer = null;
                }
                inEmergency = false;
                incomingTimestamps = [];
                debugLog("🔗 成功绑定核心渲染引擎 (Inner Core)");

                const origAdd = core.add;
                if (typeof origAdd === 'function') {
                    core.add = function(dm, ...args) {
                        const now = performance.now();

                        // 速率监控（所有到达的弹幕，不论是否放行）
                        incomingTimestamps.push(now);
                        incomingTimestamps = incomingTimestamps.filter(function(t) { return now - t < 1000; });
                        const incomingRate = incomingTimestamps.length;

                        // 紧急触发检测
                        if (incomingRate > EMERGENCY_RATE && !inEmergency) {
                            enterEmergency(this);
                        }

                        // 紧急模式下阻断全部
                        if (inEmergency) {
                            stat_discarded++;
                            return;
                        }

                        const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;

                        if (realActive >= MAX_ON_SCREEN) {
                            stat_discarded++;
                            infoLog(\`🚫 [DanmakuLimit丢弃]同屏上限 同屏弹幕: \${realActive} >= 限额 \${MAX_ON_SCREEN}. 丢弃: \${dm ? dm.text : '未知'}\`);
                            return;
                        }

                        recentAllowedTimestamps = recentAllowedTimestamps.filter(t => (now - t) < 150);
                        const recentCount = recentAllowedTimestamps.length;
                        if (recentCount >= MAX_PER_BATCH) {
                            stat_discarded++;
                            infoLog(\`🚫 [DanmakuLimit丢弃]弹幕爆发 150ms内已放行 \${recentCount} 条. 丢弃: \${dm ? dm.text : '未知'}\`);
                            return;
                        }

                        if (dm) {
                            dm.border = false;
                            dm.colorful = false;
                            dm.colorfulImg = null;
                            dm.isHighLike = false;
                            dm.likes = 0;
                            dm.emoticons = null;
                        }

                        stat_passed++;
                        recentAllowedTimestamps.push(now);
                        debugLog(\`✅ [DanmakuLimit放行] 同屏弹幕: \${realActive}/\${MAX_ON_SCREEN} 条. 放行: \${dm ? dm.text : '未知'}\`);
                        return origAdd.call(this, dm, ...args);
                    };
                }

                const origAddList = core.addList;
                if (typeof origAddList === 'function') {
                    core.addList = function(list, ...args) {
                        const now = performance.now();
                        if (Array.isArray(list)) {
                            for (var _i = 0; _i < list.length; _i++) incomingTimestamps.push(now);
                        }
                        incomingTimestamps = incomingTimestamps.filter(function(t) { return now - t < 1000; });
                        const incomingRate = incomingTimestamps.length;
                        if (incomingRate > EMERGENCY_RATE && !inEmergency) {
                            enterEmergency(this);
                        }
                        if (inEmergency) {
                            if (Array.isArray(list)) stat_discarded += list.length;
                            return;
                        }

                        if (Array.isArray(list)) {
                            list = list.filter(dm => {
                                const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;
                                if (realActive >= MAX_ON_SCREEN) {
                                    stat_discarded++;
                                    return false;
                                }
                                stat_passed++;
                                return true;
                            });
                        }
                        return origAddList.call(this, list, ...args);
                    };
                }
            }

            function hookWrapper(WrapperClass) {
                let TargetClass = null;
                if (typeof WrapperClass === 'function') {
                    TargetClass = WrapperClass;
                } else if (WrapperClass && typeof WrapperClass.default === 'function') {
                    TargetClass = WrapperClass.default;
                }

                if (!TargetClass || !TargetClass.prototype || TargetClass.prototype._hooked) return;
                TargetClass.prototype._hooked = true;
                debugLog("外壳类监听成功");

                const origHandleSocketMessage = TargetClass.prototype.handleSocketMessage;
                if (typeof origHandleSocketMessage === 'function') {
                    TargetClass.prototype.handleSocketMessage = function(e, n) {
                        if (this.danmaku && !this.danmaku._hooked) {
                            hookCoreEngine(this.danmaku);
                        }
                        return origHandleSocketMessage.call(this, e, n);
                    };
                }

                const origResize = TargetClass.prototype.resize;
                if (typeof origResize === 'function') {
                    TargetClass.prototype.resize = function(...args) {
                        if (this.danmaku && !this.danmaku._hooked) {
                            hookCoreEngine(this.danmaku);
                        }
                        return origResize.call(this, ...args);
                    };
                }
            }

            let origEngine = window.LiveDanmakuEngine;
            Object.defineProperty(window, 'LiveDanmakuEngine', {
                get() { return origEngine; },
                set(val) {
                    if (val) hookWrapper(val);
                    origEngine = val;
                }
            });

            if (window.LiveDanmakuEngine) {
                hookWrapper(window.LiveDanmakuEngine);
            }
        })();
    `;

    const script = document.createElement('script');
    script.textContent = injectCode;
    document.documentElement.appendChild(script);
    script.remove();

    // === 基础视觉降级 CSS ===
    const style = document.createElement('style');
    style.innerHTML = `
        .bili-danmaku-x-dm {
            text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000 !important;
        }
        .bili-danmaku-x-high-icon,
        .bili-danmaku-x-like-icon,
        .bili-danmaku-x-dm-vip,
        .bili-danmaku-x-dm-emoji,
        .bili-danmaku-x-dm-yanwen-image {
            display: none !important;
        }
    `;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { document.head.appendChild(style); });
    } else {
        document.head.appendChild(style);
    }

})();
