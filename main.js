// ==UserScript==
// @name         B站直播弹幕防卡顿
// @namespace    http://tampermonkey.net/
// @version      7.2
// @description  分层限流：正常时细粒度拦截，弹幕极端爆发时自动关闭渲染管线(停止RAF+清除DOM)，爆发平息后自动恢复
// @author       R9
// @match        *://live.bilibili.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    // 活动直播间 IIFE 可能被执行多次。防重标记设在 document.documentElement 上，
    // 这是所有 JS 上下文共享的最底层 DOM 节点，比 unsafeWindow 更可靠。
    if (document.documentElement.getAttribute('data-dl-hooked') === '1') return;
    document.documentElement.setAttribute('data-dl-hooked', '1');

    if (unsafeWindow.__dlHooked) return;
    unsafeWindow.__dlHooked = true;

    // === 【从油猴存储中读取配置，若无则使用默认值】 ===
    const maxOnScreen = GM_getValue('MAX_ON_SCREEN', 50);
    const maxPerBatch = GM_getValue('MAX_PER_BATCH', 3);
    const logLevel = GM_getValue('CURRENT_LOG_LEVEL', 1);
    const emergencyRate = GM_getValue('EMERGENCY_RATE', 30);
    const emergencyCooldown = GM_getValue('EMERGENCY_COOLDOWN', 3000);

    // ===【UI：配置面板 + 测试面板 — 仅在顶层窗口创建，iframe 内不重复】===
    if (window.self === window.top) {

    // === 【预创建配置面板 + 菜单命令】 ===
    // 参考 bilibili 页面净化大师模式：
    // 1. shadow DOM 隔离页面 CSS（修复活动直播间 position:fixed 被 CSS transform 破坏的问题）
    // 2. 面板预创建，菜单只负责显示（不创建/删除，避免同 tick 内重复触发双面板）

    const _panelWrap = document.createElement('div');
    _panelWrap.id = 'dl-config-panel';
    _panelWrap.style.cssText = 'display:none;position:fixed;z-index:999999';
    const _shadowRoot = _panelWrap.attachShadow({ mode: 'open' });

    const _panelCss = document.createElement('style');
    _panelCss.textContent = `
.dl-overlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px/1.5-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dl-panel{background:#fff;border-radius:12px;padding:28px 32px;min-width:420px;box-shadow:0 8px 40px rgba(0,0,0,.35);color:#222;max-height:90vh;overflow-y:auto}
.dl-panel h2{font-size:18px;font-weight:700;margin:0 0 20px;color:#FB7299}
.dl-field{margin-bottom:16px}
.dl-field label{display:block;font-weight:600;margin-bottom:4px;color:#333}
.dl-field .desc{font-size:12px;color:#888;margin-bottom:6px}
.dl-field input,.dl-field select{width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;background:#fff}
.dl-buttons{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid #eee}
.dl-buttons button{padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;border:none}
.dl-btn-cancel{background:#f5f5f5;border:1px solid #ccc!important;color:#222}
.dl-btn-save{background:#FB7299;color:#fff;font-weight:600}
`;
    _shadowRoot.appendChild(_panelCss);

    const _dlOverlay = document.createElement('div');
    _dlOverlay.className = 'dl-overlay';
    _dlOverlay.innerHTML = `
        <div class="dl-panel">
            <h2>🛠️ DanmakuLimit 配置</h2>
            <div class="dl-field" data-key="MAX_ON_SCREEN">
                <label>最大同屏弹幕数</label>
                <div class="desc">同屏幕最多显示多少条弹幕（推荐 20-50）</div>
                <input type="number" value="${maxOnScreen}" min="1" max="200">
            </div>
            <div class="dl-field" data-key="MAX_PER_BATCH">
                <label>突发放行限制</label>
                <div class="desc">150ms 内最多放行弹幕条数（推荐 2-5）</div>
                <input type="number" value="${maxPerBatch}" min="1" max="20">
            </div>
            <div class="dl-field" data-key="EMERGENCY_RATE">
                <label>紧急触发弹幕率</label>
                <div class="desc">每秒超过此数量则自动关闭渲染管线（推荐 20-40）</div>
                <input type="number" value="${emergencyRate}" min="1" max="200">
            </div>
            <div class="dl-field" data-key="EMERGENCY_COOLDOWN">
                <label>紧急冷却时间 (ms)</label>
                <div class="desc">紧急关闭后等待恢复的毫秒数（推荐 2000-5000）</div>
                <input type="number" value="${emergencyCooldown}" min="1000" max="30000" step="100">
            </div>
            <div class="dl-field" data-key="CURRENT_LOG_LEVEL">
                <label>运行日志级别</label>
                <div class="desc">控制控制台输出详细程度</div>
                <select>
                    <option value="0"${logLevel === 0 ? ' selected' : ''}>完全关闭</option>
                    <option value="1"${logLevel === 1 ? ' selected' : ''}>仅定时汇总</option>
                    <option value="2"${logLevel === 2 ? ' selected' : ''}>详细调试(Debug)</option>
                </select>
            </div>
            <div class="dl-buttons">
                <button class="dl-btn-cancel">取消</button>
                <button class="dl-btn-save">保存</button>
            </div>
        </div>
    `;
    _shadowRoot.appendChild(_dlOverlay);

    // 按钮事件
    _shadowRoot.querySelector('.dl-btn-cancel').addEventListener('click', () => {
        _panelWrap.style.display = 'none';
    });
    _shadowRoot.querySelector('.dl-btn-save').addEventListener('click', () => {
        const items = _shadowRoot.querySelectorAll('.dl-field');
        for (const item of items) {
            const key = item.dataset.key;
            const el = item.querySelector('input, select');
            const isSelect = el.tagName === 'SELECT';
            const val = isSelect ? parseInt(el.value, 10) : parseFloat(el.value);
            if (isNaN(val)) { alert('请输入有效值'); return; }
            GM_setValue(key, val);
        }
        _panelWrap.style.display = 'none';
        location.reload();
    });
    _dlOverlay.addEventListener('click', (e) => {
        if (e.target === _dlOverlay) _panelWrap.style.display = 'none';
    });

    // 挂载到 body
    function _waitBody(cb) {
        if (document.body) { cb(); return; }
        const obs = new MutationObserver(() => {
            if (document.body) { obs.disconnect(); cb(); }
        });
        obs.observe(document.documentElement, { childList: true });
    }
    _waitBody(() => document.body.appendChild(_panelWrap));

    // === 【菜单命令 - 只负责显示，不创建】 ===
    GM_registerMenuCommand('⚙️ 打开配置面板', () => {
        _panelWrap.style.display = 'block';
        (document.scrollingElement || document.documentElement).style.overflow = 'hidden';
    });

    } // if (window.self === window.top) 结束

    // ==========================================
    // 页面引擎 Hook（通过 unsafeWindow，避免 script 标签触发框架重跑）
    // ==========================================
    (function(uw) {
        const MAX_ON_SCREEN = maxOnScreen;
        const MAX_PER_BATCH = maxPerBatch;
        const CURRENT_LOG_LEVEL = logLevel;
        const EMERGENCY_RATE = emergencyRate;
        const EMERGENCY_COOLDOWN = emergencyCooldown;

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

        debugLog('渲染控制服务初始化。硬上限(DOM 计数): ' + MAX_ON_SCREEN + ' 条, 突发限制: ' + MAX_PER_BATCH + '条/150ms, 紧急触发: ' + EMERGENCY_RATE + '/s');

        setInterval(() => {
            if (stat_discarded > 0 || stat_passed > 0) {
                const realActive = document.querySelectorAll('.bili-danmaku-x-show').length;
                infoLog(`%c🛡️ [DanmakuLimit监控] 过去3秒内: 放行 ${stat_passed} 条，丢弃 ${stat_discarded} 条。当前同屏弹幕: ${realActive} 条。`, "color: #FB7299; font-weight: bold;");
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
                        infoLog(`🚫 [DanmakuLimit丢弃]同屏上限 同屏弹幕: ${realActive} >= 限额 ${MAX_ON_SCREEN}. 丢弃: ${dm ? dm.text : '未知'}`);
                        return;
                    }

                    recentAllowedTimestamps = recentAllowedTimestamps.filter(t => (now - t) < 150);
                    const recentCount = recentAllowedTimestamps.length;
                    if (recentCount >= MAX_PER_BATCH) {
                        stat_discarded++;
                        infoLog(`🚫 [DanmakuLimit丢弃]弹幕爆发 150ms内已放行 ${recentCount} 条. 丢弃: ${dm ? dm.text : '未知'}`);
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
                    debugLog(`✅ [DanmakuLimit放行] 同屏弹幕: ${realActive}/${MAX_ON_SCREEN} 条. 放行: ${dm ? dm.text : '未知'}`);
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

        let origEngine = uw.LiveDanmakuEngine;
        Object.defineProperty(uw, 'LiveDanmakuEngine', {
            get() { return origEngine; },
            set(val) {
                if (val) hookWrapper(val);
                origEngine = val;
            }
        });

        if (uw.LiveDanmakuEngine) {
            hookWrapper(uw.LiveDanmakuEngine);
        }
    })(unsafeWindow);

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
