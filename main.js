// ==UserScript==
// @name         B站直播弹幕防卡顿
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  利用渲染层阻断技术控制弹幕，支持在油猴菜单中动态配置最大同屏数、爆发拦截数及日志级别。
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
    const maxOnScreen = GM_getValue('MAX_ON_SCREEN', 50);  // 默认同屏最多 50 条
    const maxPerBatch = GM_getValue('MAX_PER_BATCH', 3);   // 默认 150ms 内最多放行 3 条
    const logLevel = GM_getValue('CURRENT_LOG_LEVEL', 1);   // 默认日志级别为 1 (仅汇总)

    // === 【注册油猴菜单命令】 ===

    // 菜单 1：设置最大同屏弹幕数
    GM_registerMenuCommand(`⚙️ 设置最大同屏弹幕数 (当前: ${maxOnScreen})`, () => {
        const val = prompt("请输入最大同屏弹幕数 (推荐 20 - 50):", maxOnScreen);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
                GM_setValue('MAX_ON_SCREEN', num);
                location.reload(); // 刷新页面使配置生效
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

    // ==========================================
    // 动态模板注入：将上面读取到的油猴配置注入到网页中
    // ==========================================
    const injectCode = `
        (function() {
            // 通过字符串插值传入油猴沙盒中的配置值
            const MAX_ON_SCREEN = ${maxOnScreen};
            const MAX_PER_BATCH = ${maxPerBatch};
            const CURRENT_LOG_LEVEL = ${logLevel};

            const LOG_LEVELS = { NONE: 0, INFO: 1, DEBUG: 2 };
            let stat_discarded = 0;
            let stat_passed = 0;

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

            debugLog(\`渲染控制服务初始化。硬上限(DOM 计数): \${MAX_ON_SCREEN} 条, 突发限制: \${MAX_PER_BATCH}条/150ms\`);

            // 定时输出拦截日志
            setInterval(() => {
                if (stat_discarded > 0 || stat_passed > 0) {
                    const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;
                    infoLog(\`%c🛡️ [DanmakuLimit监控] 过去3秒内: 放行 \${stat_passed} 条，丢弃 \${stat_discarded} 条。当前同屏弹幕: \${realActive} 条。\`, "color: #FB7299; font-weight: bold;");
                    stat_discarded = 0;
                    stat_passed = 0;
                }
            }, 3000);

            let recentAllowedTimestamps = [];

            // 核心劫持
            function hookCoreEngine(core) {
                if (core._hooked) return;
                core._hooked = true;
                debugLog("🔗 成功绑定核心渲染引擎 (Inner Core)");

                const origAdd = core.add;
                if (typeof origAdd === 'function') {
                    core.add = function(dm, ...args) {
                        const now = performance.now();

                        // 真实扫描：活跃状态的节点数
                        const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;

                        // 数量限制拦截
                        if (realActive >= MAX_ON_SCREEN) {
                            stat_discarded++;
                            infoLog(\`🚫 [DanmakuLimit丢弃]同屏上限 同屏弹幕: \${realActive} >= 限额 \${MAX_ON_SCREEN}. 丢弃: \${dm ? dm.text : '未知'}\`);
                            return;
                        }

                        // 150ms 突发超速拦截（防止在同一个渲染帧里涌入过多弹幕）
                        recentAllowedTimestamps = recentAllowedTimestamps.filter(t => (now - t) < 150);
                        const recentCount = recentAllowedTimestamps.length;
                        if (recentCount >= MAX_PER_BATCH) {
                            stat_discarded++;
                            infoLog(\`🚫 [DanmakuLimit丢弃]弹幕爆发 150ms内已放行 \${recentCount} 条. 丢弃: \${dm ? dm.text : '未知'}\`);
                            return;
                        }

                        // 安全降级属性
                        if (dm) {
                            dm.border = false;
                            dm.colorful = false;
                            dm.colorfulImg = null;
                            dm.isHighLike = false;
                            dm.likes = 0;
                            dm.emoticons = null;
                        }

                        // 放行
                        stat_passed++;
                        recentAllowedTimestamps.push(now);
                        debugLog(\`✅ [DanmakuLimit放行] 同屏弹幕: \${realActive}/\${MAX_ON_SCREEN} 条. 放行: \${dm ? dm.text : '未知'}\`);
                        return origAdd.call(this, dm, ...args);
                    };
                }

                // 备份劫持（防止历史弹幕和批量弹幕绕过）
                const origAddList = core.addList;
                if (typeof origAddList === 'function') {
                    core.addList = function(list, ...args) {
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

            // 外壳劫持
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

            // 监听全局变量
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

    // 执行注入
    const script = document.createElement('script');
    script.textContent = injectCode;
    document.documentElement.appendChild(script);
    script.remove();

    // ==========================================
    // 基础视觉降级 CSS
    // ==========================================
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