// ==UserScript==
// @name         test-panel-simple
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  测试面板：点击按钮/菜单，展示可拖拽的 Hello World 面板（提取自 bilibili-cleaner 的调用链）
// @author       R9
// @icon         https://www.bilibili.com/favicon.ico
// @match        *://*.bilibili.com/*
// @require      https://registry.npmmirror.com/vue/3.5.34/files/dist/vue.global.prod.js
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(async function(vue) {
  'use strict';

  // iframe 嵌套中不执行，防止内外层各创建一个实例导致双面板
  if (window.self !== window.top) return;

  // ============================================================
  // 1. Store — 控制面板显隐（对应 test-panel-good.js RulePanelStore）
  // ============================================================
  const panelStore = vue.reactive({
    isShow: false,
    show() { this.isShow = true },
    hide() { this.isShow = false },
    toggle() { this.isShow = !this.isShow }
  });

  // ============================================================
  // 2. PanelComp — 居中浮动面板（提取自 test-panel-good.js :2999-3075，去除拖拽）
  // ============================================================
  const PanelComp = vue.defineComponent({
    name: 'PanelComp',
    props: {
      title: { type: String, default: '' },
      width: { type: Number, default: 30 },
      height: { type: Number, default: 30 },
      minW: { type: Number, default: 300 },
      minH: { type: Number, default: 200 }
    },
    emits: ['close'],
    setup(props, { emit, slots }) {
      return () => {
        const panelW = Math.max(window.innerWidth * props.width / 100, props.minW)
        const panelH = Math.max(window.innerHeight * props.height / 100, props.minH)

        return vue.h('div', {
          style: {
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: panelW + 'px',
            height: panelH + 'px',
            minWidth: props.minW + 'px',
            minHeight: props.minH + 'px',
            zIndex: 10000000,
            background: '#fff',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
            overflow: 'auto',
            overscrollBehavior: 'none',
            display: 'flex',
            flexDirection: 'column'
          }
        }, [
          // 标题栏
          vue.h('div', {
            style: {
              position: 'sticky',
              top: 0,
              zIndex: 10,
              width: '100%',
              background: '#00AEEC',
              padding: '6px 0',
              textAlign: 'center',
              color: '#fff',
              fontSize: '20px',
              fontWeight: 900,
              flexShrink: 0,
              userSelect: 'none'
            }
          }, [
            props.title,
            // 关闭按钮
            vue.h('i', {
              style: {
                position: 'absolute',
                top: 0,
                right: 0,
                margin: '4px',
                cursor: 'pointer',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '999px',
                fontSize: '18px',
                fontStyle: 'normal',
                lineHeight: 1
              },
              onClick: () => emit('close'),
              innerHTML: '✕'
            })
          ]),
          // 内容区
          vue.h('div', {
            style: {
              flex: 1,
              padding: '8px',
              overflow: 'auto',
              color: '#000'
            }
          }, slots.default?.() || [])
        ])
      }
    }
  })

  // ============================================================
  // 3. App — 根组件：悬浮按钮 + 居中面板（对应 test-panel-good.js App_default + SideBtnView）
  // ============================================================
  const App = vue.defineComponent({
    name: 'App',
    setup() {
      return () => {
        // 悬浮按钮
        const btn = vue.h('div', {
          style: {
            position: 'fixed',
            right: '10px',
            bottom: '180px',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px'
          }
        }, [
          vue.h('div', {
            style: {
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              color: '#000',
              fontWeight: 500,
              userSelect: 'none',
              transition: 'all 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            },
            onClick: () => panelStore.toggle(),
            onMouseenter: (e) => {
              e.target.style.background = '#00AEEC'
              e.target.style.color = '#fff'
              e.target.style.borderColor = 'transparent'
            },
            onMouseleave: (e) => {
              e.target.style.background = '#fff'
              e.target.style.color = '#000'
              e.target.style.borderColor = '#e5e7eb'
            }
          }, [
            vue.h('div', { style: { fontSize: '11px', lineHeight: 1.2 } }, '测试'),
            vue.h('div', { style: { fontSize: '11px', lineHeight: 1.2 } }, '面板')
          ]),

          // 状态指示
          vue.h('div', {
            style: {
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: panelStore.isShow ? '#22c55e' : '#9ca3af',
              transition: 'background 0.2s'
            }
          })
        ])

        // 面板（居中）
        const panel = panelStore.isShow
          ? vue.h(PanelComp, {
              title: 'Hello World 测试',
              width: 30,
              height: 30,
              minW: 300,
              minH: 200,
              onClose: () => panelStore.hide()
            }, {
              default: () => vue.h('div', {
                style: {
                  padding: '24px',
                  textAlign: 'center',
                  fontSize: '18px',
                  color: '#333'
                }
              }, [
                vue.h('h2', { style: { fontSize: '24px', fontWeight: 700, marginBottom: '12px' } }, 'Hello World!'),
                vue.h('p', { style: { color: '#666', lineHeight: 1.6 } }, [
                  '这是一个居中测试面板',
                  vue.h('br'),
                  '点击 ✕ 或再次点击悬浮按钮关闭'
                ]),
                vue.h('div', {
                  style: {
                    marginTop: '20px',
                    padding: '12px',
                    background: '#f0f9ff',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#0369a1'
                  }
                }, '调用链：悬浮按钮 → store.toggle() → isShow 变化 → 面板显示')
              ])
            })
          : null

        return vue.h('div', null, [btn, panel])
      }
    }
  })

  // ============================================================
  // 4. 挂载（对应 test-panel-good.js main() 函数）
  // ============================================================
  const container = document.createElement('div')
  container.id = 'dl-test-panel-root'
  container.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647'
  document.body.appendChild(container)

  const app = vue.createApp(App)
  app.mount(container)

  // ============================================================
  // 5. GM 菜单（对应 test-panel-good.js menu()）
  // ============================================================
  GM_registerMenuCommand('🧪 测试面板 (toggle)', () => {
    panelStore.toggle()
  })

  console.log('[test-panel] 已启动 — 点击悬浮按钮或 Tampermonkey 菜单切换面板')

})(Vue);
