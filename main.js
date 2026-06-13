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

    // === 【注册油猴菜单命令 - 打开配置面板】 ===
    GM_registerMenuCommand('⚙️ 打开配置面板', () => showConfigPanel());

    function showConfigPanel() {
        const current = {
            MAX_ON_SCREEN: GM_getValue('MAX_ON_SCREEN', 50),
            MAX_PER_BATCH: GM_getValue('MAX_PER_BATCH', 3),
            CURRENT_LOG_LEVEL: GM_getValue('CURRENT_LOG_LEVEL', 1),
            EMERGENCY_RATE: GM_getValue('EMERGENCY_RATE', 30),
            EMERGENCY_COOLDOWN: GM_getValue('EMERGENCY_COOLDOWN', 3000),
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;min-width:420px;box-shadow:0 8px 40px rgba(0,0,0,.35);color:#222;max-height:90vh;overflow-y:auto;';

        const logLabels = ['完全关闭', '仅定时汇总', '详细调试(Debug)'];

        const fields = [
            { key: 'MAX_ON_SCREEN', label: '最大同屏弹幕数', type: 'number', attrs: { min: 1, max: 200 }, desc: '同屏幕最多显示多少条弹幕（推荐 20-50）' },
            { key: 'MAX_PER_BATCH', label: '突发放行限制', type: 'number', attrs: { min: 1, max: 20 }, desc: '150ms 内最多放行弹幕条数（推荐 2-5）' },
            { key: 'EMERGENCY_RATE', label: '紧急触发弹幕率', type: 'number', attrs: { min: 1, max: 200 }, desc: '每秒超过此数量则自动关闭渲染管线（推荐 20-40）' },
            { key: 'EMERGENCY_COOLDOWN', label: '紧急冷却时间 (ms)', type: 'number', attrs: { min: 1000, max: 30000, step: 100 }, desc: '紧急关闭后等待恢复的毫秒数（推荐 2000-5000）' },
            { key: 'CURRENT_LOG_LEVEL', label: '运行日志级别', type: 'select', options: logLabels, desc: '控制控制台输出详细程度' },
        ];

        let html = '<div style="font-size:18px;font-weight:700;margin-bottom:20px;color:#FB7299;">🛠️ DanmakuLimit 配置</div>';

        for (const f of fields) {
            const val = current[f.key];
            html += `<div style="margin-bottom:16px;">
                <label style="display:block;font-weight:600;margin-bottom:4px;color:#333;">${f.label}</label>
                <div style="font-size:12px;color:#888;margin-bottom:6px;">${f.desc}</div>`;
            if (f.type === 'select') {
                html += `<select id="dl-field-${f.key}" style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;background:#fff;">`;
                for (let i = 0; i < f.options.length; i++) {
                    html += `<option value="${i}"${i === val ? ' selected' : ''}>${f.options[i]}</option>`;
                }
                html += '</select>';
            } else {
                const attrs = Object.entries(f.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
                html += `<input id="dl-field-${f.key}" type="${f.type}" value="${val}" ${attrs} style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">`;
            }
            html += '</div>';
        }

        html += `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
            <button id="dl-btn-cancel" style="padding:8px 20px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;font-size:14px;">取消</button>
            <button id="dl-btn-save" style="padding:8px 20px;border:none;border-radius:6px;background:#FB7299;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">保存</button>
        </div>`;

        panel.innerHTML = html;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        panel.querySelector('#dl-btn-cancel').addEventListener('click', close);
        panel.querySelector('#dl-btn-save').addEventListener('click', save);

        function close() { overlay.remove(); }

        function save() {
            for (const f of fields) {
                const el = document.getElementById(`dl-field-${f.key}`);
                const val = f.type === 'select' ? parseInt(el.value, 10) : parseFloat(el.value);
                if (isNaN(val) || (f.attrs && f.attrs.min && val < parseInt(f.attrs.min, 10))) {
                    alert(`请为 "${f.label}" 输入有效值`);
                    return;
                }
                GM_setValue(f.key, val);
            }
            close();
            location.reload();
        }
    }

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
