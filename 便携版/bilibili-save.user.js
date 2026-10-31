// ==UserScript==
// @name         Bilibili-Plus 哔哩哔哩增强（原图/视频批量下载）（便携版·无需环境）
// @name:en      Bilibili-Plus - Enhanced Bilibili Downloader (Portable)
// @namespace    https://github.com/FNAS-496/bilibili-image-saver
// @version      0.10.2
// @author       FNAS-496 <sijiudeliu@outlook.com>
// @description  Bilibili-Plus：B 站原图/视频批量下载增强。审查模式显示全部图片并标记已下载、点赞/关注/收藏状态检测、只看大图、自定义键位、四套主题（跟随系统/云白/夜空/樱花）（默认不自动下载，需点击按钮）；便携版纯浏览器运行，无需安装任何环境）
// @description:en Bilibili-Plus: auto-download original images from Bilibili favorites, dynamics, opus and space pages; video batch download, review mode, custom keys (needs the local server started via "一键启动.bat")
// @homepageURL  https://github.com/FNAS-496/bilibili-image-saver
// @supportURL   https://github.com/FNAS-496/bilibili-image-saver/issues
// @match        *://*.bilibili.com/*
// @match        *://bilibili.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      hdslb.com
// @connect      bilibili.com
// @connect      bilivideo.com
// @connect      bilivideo.cn
// @connect      akamaized.net
// @connect      mountaintoys.cn
// @noframes
// @license      CC BY-NC-SA 4.0
// ==/UserScript==
// ⚠️ 本文件由 build.js 从 src/bilibili-save.user.js 生成，请勿直接修改；
//    改完源文件后运行 `npm run build` 重新生成（模式：portable）。



(function(){
    'use strict';

    const LOCAL_SERVER = 'http://127.0.0.1:8765/save';
    const AUTO_SAVE_PARAM = 'bili_auto_save';
    // 构建期由 build.js 替换：'full' = 环境版（配合本地服务）| 'portable' = 便携版（纯浏览器，零环境）
    const BUILD_MODE = 'portable';
    const IS_PORTABLE = BUILD_MODE === 'portable';
    const REPO_URL = 'https://github.com/FNAS-496/bilibili-image-saver';
    // 需要本地环境（Node + ffmpeg）时给出的下载地址
    const ENV_LINKS = {
        node: 'https://nodejs.org/zh-cn/download',
        ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/',
        pkg: REPO_URL
    };
    const BROWSER_CONCURRENCY = 6;
    // ZIP 每包的软上限（图片 / 视频打包都用它）。
    // 为什么不能用 ZIP 规范的 4GB：整包字节要先在内存里拼成一个 Blob 再交给浏览器下载，
    // GB 级的 Blob 既容易把标签页撑爆，也容易在下载途中被浏览器丢弃，
    // 用户看到的就是「下载到最后一步、链接已关闭」。512MB 是实测稳定的量级。
    const ZIP_SOFT_LIMIT_BYTES = 512 * 1024 * 1024;


    const AUTO_RUN = true;                                                             
    const MAX_CHILD_PAGES = 200;                                   
    const CHILD_CONCURRENCY = 6;
    const MAX_COLLECTION_PAGES = 200;                               // 合集分页安全上限（防止接口 total 异常时失控，正常合集都能拉全）
    // ────────────────────────────────────────────────────────────────────────
    // 面板视觉系统：设计 token + 组件样式。所有面板共用这一套，换主题只改 html 上的
    // data-bp-theme，不再逐个重写 inline style。源文件是 src/lib/theme.js，别在这里手改
    // ============================================================================
    // 面板视觉系统：设计 token + 组件样式
    //
    // 设计参考（公开资料，非抄代码）：
    //   · Vercel Geist 的颜色系统 —— 颜色按「用途」分档而不是按色相：
    //     background / hover-background / active-background、default/hover/active border、
    //     secondary-text / primary-text。本文件沿用这个思路命名 token，
    //     所以换主题只需要换一组值，组件样式一行都不用改。
    //   · Geist 排版 —— label（单行，紧凑）与 copy（多行，行高更大）两类分开；
    //     字号只保留 11/12/13/15/17 五档，避免现在 11~18 混杂。
    //   · Refactoring UI 的层次技巧 —— 用「背景色 + 边框 + 阴影」三层区分面板，
    //     而不是到处画重边框；文字层次靠 颜色 > 字重 > 字号。
    //
    // 该文件被 build.js 内联进 userscript，同时可直接被 Node require 做单测。
    // ============================================================================
    (function (root, factory) {
        const api = factory();
        if (typeof module !== 'undefined' && module.exports) module.exports = api;
        root.__biliTheme = api;                        // 供浏览器内自检 / 冒烟测试
    })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
        'use strict';

        // 「auto」跟随系统明暗；其余三套是固定配色
        const THEMES = ['auto', 'cloud', 'midnight', 'sakura'];
        const DEFAULT_THEME = 'auto';

        const THEME_LABELS = {
            auto: '跟随系统',
            cloud: '云白',
            midnight: '夜空',
            sakura: '樱花'
        };

        // 语义色板。键名固定，值按主题换 —— 组件只看语义，不认具体颜色。
        const PALETTES = {
            cloud: {
                surface: '#ffffff',
                surface2: '#f7f8fa',
                subtle: '#f2f3f5',
                hover: '#e9ebef',
                border: '#e5e7eb',
                borderStrong: '#d4d7dd',
                inputBg: '#ffffff',
                text: '#18191c',
                text2: '#61666d',
                text3: '#9499a0',
                accent: '#00a1d6',
                accentHover: '#00b3e6',
                accentWeak: 'rgba(0,161,214,.16)',
                accentGlow: 'rgba(0,161,214,.35)',
                danger: '#f04a5a',
                success: '#00a85d',
                warn: '#f59e0b',
                overlay: 'rgba(20,22,26,.55)',
                toastBg: 'rgba(22,24,28,.92)',
                toastFg: '#f2f3f5',
                // 「抬起一层」的表面：用在分段控件的选中项等场景。
                // 浅色主题靠白底 + 阴影抬起，深色主题必须用更亮的灰，否则选中项看起来是凹进去的
                elevated: '#ffffff',
                shadow: '0 12px 40px rgba(16,20,28,.16), 0 2px 8px rgba(16,20,28,.08)'
            },
            midnight: {
                surface: '#1b1d23',
                surface2: '#22252c',
                subtle: '#24272f',
                hover: '#2d313a',
                border: '#333844',
                borderStrong: '#444a58',
                inputBg: '#20232a',
                text: '#e9eaee',
                text2: '#a6abb7',
                text3: '#71767f',
                accent: '#00b3e6',
                accentHover: '#2ec5f0',
                accentWeak: 'rgba(0,179,230,.20)',
                accentGlow: 'rgba(0,179,230,.32)',
                danger: '#ff6b7d',
                success: '#2fd07a',
                warn: '#fbbf24',
                overlay: 'rgba(0,0,0,.66)',
                toastBg: 'rgba(38,41,49,.96)',
                toastFg: '#eef0f4',
                elevated: '#31353f',
                shadow: '0 12px 40px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35)'
            },
            sakura: {
                surface: '#fffdfd',
                surface2: '#fff6f9',
                subtle: '#fff1f5',
                hover: '#ffe4ec',
                border: '#f7dde6',
                borderStrong: '#eec9d7',
                inputBg: '#ffffff',
                text: '#2a1a21',
                text2: '#7b5a68',
                text3: '#a98b98',
                accent: '#fb7299',
                accentHover: '#ff8bad',
                accentWeak: 'rgba(251,114,153,.16)',
                accentGlow: 'rgba(251,114,153,.32)',
                danger: '#e5484d',
                success: '#2f9e63',
                warn: '#d98324',
                overlay: 'rgba(40,20,30,.5)',
                toastBg: 'rgba(46,28,36,.93)',
                toastFg: '#fff0f5',
                elevated: '#ffffff',
                shadow: '0 12px 40px rgba(190,90,125,.18), 0 2px 8px rgba(190,90,125,.10)'
            }
        };

        // 旧版本只存了 light / dark 两个值，升级后按最接近的主题接住
        const LEGACY = { light: 'cloud', dark: 'midnight' };

        function normalizeTheme(name) {
            const raw = String(name == null ? '' : name).trim();
            if (THEMES.indexOf(raw) >= 0) return raw;
            if (LEGACY[raw]) return LEGACY[raw];
            return DEFAULT_THEME;
        }

        // auto = 跟随系统：浅色用 cloud，深色用 midnight
        function resolveTheme(name, prefersDark) {
            const t = normalizeTheme(name);
            if (t !== 'auto') return t;
            return prefersDark ? 'midnight' : 'cloud';
        }

        function tokensFor(name) {
            return PALETTES[resolveTheme(name, false)];
        }

        const VARS = {
            surface: '--bp-surface',
            surface2: '--bp-surface-2',
            subtle: '--bp-subtle',
            hover: '--bp-hover',
            border: '--bp-border',
            borderStrong: '--bp-border-strong',
            inputBg: '--bp-input-bg',
            text: '--bp-text',
            text2: '--bp-text-2',
            text3: '--bp-text-3',
            accent: '--bp-accent',
            accentHover: '--bp-accent-hover',
            accentWeak: '--bp-accent-weak',
            accentGlow: '--bp-accent-glow',
            danger: '--bp-danger',
            success: '--bp-success',
            warn: '--bp-warn',
            overlay: '--bp-overlay',
            toastBg: '--bp-toast-bg',
            toastFg: '--bp-toast-fg',
            elevated: '--bp-elevated',
            shadow: '--bp-shadow-panel'
        };

        function paletteCss(p) {
            return Object.keys(VARS).map(k => '    ' + VARS[k] + ': ' + p[k] + ';').join('\n');
        }

        // 完整样式表：token + 组件。注入一次即可，之后换主题只改 html 上的 data-bp-theme。
        function buildCss() {
            return [
                '/* ===== 尺寸 / 排版阶梯（与主题无关） ===== */',
                ':root{',
                '    --bp-space-1: 4px; --bp-space-2: 8px; --bp-space-3: 12px;',
                '    --bp-space-4: 16px; --bp-space-5: 20px; --bp-space-6: 24px; --bp-space-8: 32px;',
                '    --bp-radius-sm: 6px; --bp-radius-md: 10px; --bp-radius-lg: 14px;',
                '    --bp-radius-xl: 18px; --bp-radius-full: 999px;',
                '    --bp-fs-xs: 11px; --bp-fs-sm: 12px; --bp-fs-md: 13px; --bp-fs-lg: 15px; --bp-fs-xl: 17px;',
                '    --bp-fw-normal: 400; --bp-fw-medium: 500; --bp-fw-bold: 600;',
                '    --bp-ease: cubic-bezier(.2,.8,.2,1); --bp-dur: 180ms;',
                '    --bp-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;',
                '    --bp-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
                '    --bp-z-fab: 2147483000; --bp-z-panel: 2147483100;',
                '    --bp-z-toast: 2147483200; --bp-z-overlay: 2147483300;',
                '}',
                '',
                '/* ===== 主题：颜色 token ===== */',
                ':root, :root[data-bp-theme="cloud"]{',
                paletteCss(PALETTES.cloud),
                '}',
                ':root[data-bp-theme="sakura"]{',
                paletteCss(PALETTES.sakura),
                '}',
                ':root[data-bp-theme="midnight"], :root[data-bp-theme="auto"]{',
                paletteCss(PALETTES.cloud),
                '}',
                '@media (prefers-color-scheme: dark){',
                '    :root[data-bp-theme="auto"]{',
                paletteCss(PALETTES.midnight),
                '    }',
                '}',
                ':root[data-bp-theme="midnight"]{',
                paletteCss(PALETTES.midnight),
                '}',
                '',
                '/* ===== 动画 ===== */',
                '@keyframes bp-pop{from{opacity:0;transform:translateY(8px) scale(.985);}to{opacity:1;transform:none;}}',
                '@keyframes bp-slide-in{from{opacity:0;transform:translateX(10px);}to{opacity:1;transform:none;}}',
                '@keyframes bp-fade{from{opacity:0;}to{opacity:1;}}',
                '',
                '/* ===== 基础容器 ===== */',
                '.bp-panel{',
                '    position:fixed; display:flex; flex-direction:column; box-sizing:border-box;',
                '    background:var(--bp-surface); color:var(--bp-text);',
                '    border:1px solid var(--bp-border); border-radius:var(--bp-radius-xl);',
                '    box-shadow:var(--bp-shadow-panel);',
                '    font-family:var(--bp-font); font-size:var(--bp-fs-md); line-height:1.6;',
                '    overflow:hidden; z-index:var(--bp-z-panel);',
                '    animation:bp-pop var(--bp-dur) var(--bp-ease);',
                '}',
                '.bp-panel *{box-sizing:border-box;}',
                '.bp-panel button, .bp-panel input, .bp-panel select, .bp-panel textarea{font-family:inherit;}',
                '/* 正文区必须能收缩：否则内容一长就把底部的操作区顶掉（面板是 flex column） */',
                '.bp-panel > .bp-scroll{flex:1;min-height:0;}',
                '',
                '/* ===== 面板头 ===== */',
                '.bp-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--bp-border);flex-shrink:0;}',
                '.bp-head__icon{font-size:16px;line-height:1;}',
                '.bp-head__title{flex:1;min-width:0;font-size:var(--bp-fs-lg);font-weight:var(--bp-fw-bold);',
                '    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                '.bp-head__meta{font-size:var(--bp-fs-xs);color:var(--bp-text-3);flex-shrink:0;}',
                '.bp-close{width:28px;height:28px;flex-shrink:0;display:grid;place-items:center;',
                '    border:none;border-radius:var(--bp-radius-full);background:var(--bp-hover);',
                '    color:var(--bp-text-2);font-size:14px;line-height:1;cursor:pointer;',
                '    transition:background var(--bp-dur),color var(--bp-dur);}',
                '.bp-close:hover{background:var(--bp-border);color:var(--bp-text);}',
                '',
                '/* ===== 分组 ===== */',
                '.bp-section{padding:14px 16px;border-bottom:1px solid var(--bp-border);}',
                '.bp-section:last-child{border-bottom:none;}',
                '.bp-section__title{display:flex;align-items:center;gap:6px;margin-bottom:10px;',
                '    font-size:var(--bp-fs-sm);font-weight:var(--bp-fw-bold);color:var(--bp-text-2);letter-spacing:.02em;}',
                '',
                '/* ===== 文字 ===== */',
                '.bp-label{display:block;margin-bottom:6px;font-size:var(--bp-fs-sm);color:var(--bp-text-2);}',
                '.bp-hint{font-size:var(--bp-fs-xs);color:var(--bp-text-3);line-height:1.6;}',
                '.bp-strong{font-weight:var(--bp-fw-bold);color:var(--bp-text);}',
                '.bp-muted{color:var(--bp-text-3);}',
                '.bp-code{font-family:var(--bp-mono);font-size:var(--bp-fs-xs);background:var(--bp-subtle);',
                '    padding:1px 5px;border-radius:var(--bp-radius-sm);}',
                '.bp-link{color:var(--bp-accent);text-decoration:none;font-size:var(--bp-fs-sm);}',
                '.bp-link:hover{text-decoration:underline;}',
                '.bp-feat{display:flex;gap:8px;line-height:1.75;font-size:var(--bp-fs-sm);color:var(--bp-text-2);}',
                '.bp-feat b{color:var(--bp-text);}',
                '',
                '/* ===== 按钮 ===== */',
                '.bp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;',
                '    padding:8px 14px;border:1px solid var(--bp-border);border-radius:var(--bp-radius-md);',
                '    background:var(--bp-surface-2);color:var(--bp-text);font-size:var(--bp-fs-md);',
                '    font-weight:var(--bp-fw-medium);line-height:1.2;cursor:pointer;white-space:nowrap;',
                '    transition:background var(--bp-dur),border-color var(--bp-dur),transform var(--bp-dur),box-shadow var(--bp-dur);}',
                '.bp-btn:hover{background:var(--bp-hover);border-color:var(--bp-border-strong);}',
                '.bp-btn:active{transform:scale(.98);}',
                '.bp-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}',
                '.bp-btn--primary{background:var(--bp-accent);border-color:transparent;color:#fff;}',
                '.bp-btn--primary:hover{background:var(--bp-accent-hover);border-color:transparent;box-shadow:0 4px 14px var(--bp-accent-glow);}',
                '.bp-btn--ghost{background:transparent;border-color:var(--bp-border);}',
                '.bp-btn--ghost:hover{background:var(--bp-hover);}',
                '.bp-btn--danger{background:transparent;border-color:var(--bp-danger);color:var(--bp-danger);}',
                '.bp-btn--danger:hover{background:var(--bp-hover);}',
                '.bp-btn--sm{padding:5px 10px;font-size:var(--bp-fs-sm);border-radius:var(--bp-radius-sm);}',
                '.bp-btn--block{width:100%;}',
                '.bp-btn--accent-ghost{background:transparent;border-color:var(--bp-accent);color:var(--bp-accent);text-decoration:none;}',
                '.bp-btn--accent-ghost:hover{background:var(--bp-accent-weak);}',
                '',
                '/* ===== 表单 ===== */',
                '.bp-input,.bp-select{width:100%;padding:8px 10px;border:1px solid var(--bp-border);',
                '    border-radius:var(--bp-radius-md);background:var(--bp-input-bg);color:var(--bp-text);',
                '    font-size:var(--bp-fs-md);outline:none;',
                '    transition:border-color var(--bp-dur),box-shadow var(--bp-dur);}',
                '.bp-input:focus,.bp-select:focus{border-color:var(--bp-accent);box-shadow:0 0 0 3px var(--bp-accent-weak);}',
                '.bp-input::placeholder{color:var(--bp-text-3);}',
                '.bp-check{display:flex;align-items:center;gap:8px;font-size:var(--bp-fs-sm);',
                '    color:var(--bp-text);cursor:pointer;line-height:1.5;}',
                '.bp-check input{width:15px;height:15px;margin:0;flex-shrink:0;accent-color:var(--bp-accent);cursor:pointer;}',
                '',
                '/* ===== 分段控件（主题选择那种） ===== */',
                '.bp-seg{display:flex;gap:4px;padding:4px;background:var(--bp-subtle);',
                '    border:1px solid var(--bp-border);border-radius:var(--bp-radius-md);}',
                '.bp-seg__item{flex:1;padding:6px 10px;border:none;border-radius:calc(var(--bp-radius-md) - 3px);',
                '    background:transparent;color:var(--bp-text-2);font-size:var(--bp-fs-sm);cursor:pointer;',
                '    white-space:nowrap;transition:background var(--bp-dur),color var(--bp-dur),box-shadow var(--bp-dur);}',
                '.bp-seg__item:hover{color:var(--bp-text);}',
                '.bp-seg__item[aria-pressed="true"]{background:var(--bp-elevated);color:var(--bp-accent);',
                '    font-weight:var(--bp-fw-bold);box-shadow:0 1px 3px rgba(0,0,0,.10);}',
                '',
                '/* ===== 进度条 ===== */',
                '.bp-progress{height:6px;border-radius:var(--bp-radius-full);background:var(--bp-hover);overflow:hidden;}',
                '.bp-progress__bar{height:100%;width:0;border-radius:inherit;',
                '    background:linear-gradient(90deg,var(--bp-accent),var(--bp-accent-hover));',
                '    transition:width .25s var(--bp-ease);}',
                '',
                '/* ===== 键帽 ===== */',
                '.bp-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:26px;',
                '    padding:2px 7px;border:1px solid var(--bp-border);border-radius:var(--bp-radius-sm);',
                '    background:var(--bp-surface);color:var(--bp-text-2);font-family:var(--bp-mono);',
                '    font-size:var(--bp-fs-xs);font-weight:var(--bp-fw-bold);line-height:1.6;}',
                '.bp-kbd--accent{border-color:var(--bp-accent);color:var(--bp-accent);}',
                '',
                '/* ===== 滚动区 ===== */',
                '.bp-scroll{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;',
                '    scrollbar-color:var(--bp-border-strong) transparent;}',
                '.bp-scroll::-webkit-scrollbar{width:8px;height:8px;}',
                '.bp-scroll::-webkit-scrollbar-thumb{background:var(--bp-border-strong);border-radius:var(--bp-radius-full);}',
                '.bp-scroll::-webkit-scrollbar-track{background:transparent;}',
                '',
                '/* ===== 列表项（视频 / 图片清单） ===== */',
                '.bp-item{display:flex;align-items:center;gap:8px;padding:8px 10px;',
                '    border-radius:var(--bp-radius-md);cursor:pointer;transition:background var(--bp-dur);}',
                '.bp-item:hover{background:var(--bp-hover);}',
                '.bp-item input[type="checkbox"]{width:15px;height:15px;margin:0;flex-shrink:0;',
                '    accent-color:var(--bp-accent);cursor:pointer;}',
                '.bp-item__title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
                '    font-size:var(--bp-fs-md);color:var(--bp-text);}',
                '.bp-item__meta{flex-shrink:0;display:flex;align-items:center;gap:6px;',
                '    font-size:var(--bp-fs-xs);color:var(--bp-text-3);}',
                '',
                '/* ===== 底部操作区 ===== */',
                '.bp-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;flex-shrink:0;',
                '    border-top:1px solid var(--bp-border);background:var(--bp-surface-2);}',
                '.bp-foot__spacer{flex:1;}',
                '',
                '/* ===== 进度卡片 ===== */',
                '.bp-prog{padding:10px 12px;border:1px solid var(--bp-border);',
                '    border-radius:var(--bp-radius-md);background:var(--bp-surface-2);}',
                '.bp-prog__top{display:flex;align-items:center;justify-content:space-between;gap:8px;',
                '    margin-bottom:6px;font-size:var(--bp-fs-sm);color:var(--bp-text-2);}',
                '.bp-prog__text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                '.bp-prog__pct{flex-shrink:0;color:var(--bp-accent);font-weight:var(--bp-fw-bold);}',
                '.bp-prog__sub{margin-top:6px;font-size:var(--bp-fs-xs);color:var(--bp-text-3);',
                '    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                '',
                '/* ===== 徽标 / 空状态 ===== */',
                '.bp-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;',
                '    border-radius:var(--bp-radius-full);background:var(--bp-subtle);',
                '    color:var(--bp-text-2);font-size:var(--bp-fs-xs);line-height:1.7;}',
                '.bp-badge--ok{color:var(--bp-success);}',
                '.bp-badge--accent{color:var(--bp-accent);}',
                '.bp-badge--warn{color:var(--bp-warn);}',
                '.bp-badge--danger{color:var(--bp-danger);}',
                '.bp-empty{padding:28px 16px;text-align:center;font-size:var(--bp-fs-sm);color:var(--bp-text-3);}',
                '',
                '/* ===== 收款码 / 提示条 / 图片放大 ===== */',
                '.bp-qr{width:132px;height:132px;flex-shrink:0;object-fit:contain;cursor:zoom-in;',
                '    border:1px solid var(--bp-border);border-radius:var(--bp-radius-md);background:var(--bp-subtle);}',
                '.bp-tipbox{margin-top:12px;padding:8px 10px;border-radius:var(--bp-radius-md);',
                '    background:var(--bp-accent-weak);color:var(--bp-text);font-size:var(--bp-fs-sm);text-align:center;line-height:1.6;}',
                '.bp-lightbox{display:flex;align-items:center;justify-content:center;cursor:zoom-out;}',
                '.bp-lightbox__img{max-width:min(520px,92vw);max-height:92vh;background:#fff;padding:14px;',
                '    border-radius:var(--bp-radius-lg);box-shadow:0 8px 40px rgba(0,0,0,.5);}',
                '',
                '/* ===== 悬浮按钮组 ===== */',
                '.bp-fab-wrap{position:fixed;right:20px;bottom:20px;z-index:var(--bp-z-fab);',
                '    display:flex;flex-direction:column;align-items:flex-end;gap:10px;',
                '    font-family:var(--bp-font);}',
                '.bp-fab__menu{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}',
                '.bp-fab__menu[hidden]{display:none;}',
                '.bp-fab__item{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;',
                '    border:1px solid var(--bp-border);border-radius:var(--bp-radius-full);',
                '    background:var(--bp-surface);color:var(--bp-text);font-size:var(--bp-fs-md);',
                '    font-weight:var(--bp-fw-medium);line-height:1.2;cursor:pointer;white-space:nowrap;',
                '    box-shadow:0 2px 10px rgba(0,0,0,.12);',
                '    transition:background var(--bp-dur),border-color var(--bp-dur),transform var(--bp-dur);}',
                '.bp-fab__item:hover{background:var(--bp-hover);border-color:var(--bp-border-strong);transform:translateX(-2px);}',
                '.bp-fab__item:disabled{opacity:.55;cursor:not-allowed;transform:none;}',
                '.bp-fab__item[data-tone="accent"]{border-color:var(--bp-accent);color:var(--bp-accent);}',
                '.bp-fab__item[data-tone="pink"]{border-color:#fb7299;color:#fb7299;}',
                '.bp-fab__item[data-tone="amber"]{border-color:var(--bp-warn);color:var(--bp-warn);}',
                '.bp-fab{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:none;',
                '    border-radius:var(--bp-radius-full);background:linear-gradient(135deg,var(--bp-accent),var(--bp-accent-hover));',
                '    color:#fff;font-size:var(--bp-fs-lg);font-weight:var(--bp-fw-bold);letter-spacing:.02em;',
                '    cursor:pointer;box-shadow:0 6px 20px var(--bp-accent-glow);',
                '    transition:transform var(--bp-dur),box-shadow var(--bp-dur),background var(--bp-dur);}',
                '.bp-fab:hover{transform:translateY(-1px);box-shadow:0 8px 26px var(--bp-accent-glow);}',
                '.bp-fab:active{transform:scale(.97);}',
                '.bp-fab__dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.85;}',
                '',
                '/* ===== 状态浮窗 / 提示 ===== */',
                '/* 位置用变量控制：悬浮菜单展开时（html.bp-fab-open）整体上移，',
                '   免得提示被弹出的按钮压住（两者都在右下角） */',
                ':root{--bp-toast-bottom:88px;}',
                ':root.bp-fab-open{--bp-toast-bottom:280px;}',
                '.bp-toast{position:fixed;right:20px;bottom:var(--bp-toast-bottom);z-index:var(--bp-z-toast);',
                '    max-width:360px;min-width:190px;padding:10px 14px;border-radius:var(--bp-radius-lg);',
                '    background:var(--bp-toast-bg);color:var(--bp-toast-fg);',
                '    border:1px solid rgba(255,255,255,.08);box-shadow:0 10px 32px rgba(0,0,0,.35);',
                '    font-family:var(--bp-font);font-size:var(--bp-fs-md);line-height:1.65;',
                '    white-space:pre-line;animation:bp-pop var(--bp-dur) var(--bp-ease);',
                '    transition:bottom var(--bp-dur) var(--bp-ease);}',
                '.bp-toast__stop{margin-left:10px;padding:2px 10px;border:none;border-radius:var(--bp-radius-sm);',
                '    background:var(--bp-danger);color:#fff;font-size:var(--bp-fs-sm);cursor:pointer;}',
                '',
                '/* ===== 全屏遮罩（审查模式 / 收款码放大） ===== */',
                '.bp-overlay{position:fixed;inset:0;z-index:var(--bp-z-overlay);background:var(--bp-overlay);',
                '    animation:bp-fade var(--bp-dur) var(--bp-ease);}',
                '',
                '/* ===== 审查模式：全屏三栏 ===== */',
                '.bp-review{position:fixed;inset:0;z-index:var(--bp-z-overlay);display:flex;align-items:stretch;',
                '    background:var(--bp-surface);color:var(--bp-text);font-family:var(--bp-font);',
                '    font-size:var(--bp-fs-md);line-height:1.6;animation:bp-fade var(--bp-dur) var(--bp-ease);}',
                '.bp-review *{box-sizing:border-box;}',
                '.bp-review button,.bp-review input{font-family:inherit;}',
                '.bp-review__side{width:232px;flex-shrink:0;padding:16px 14px;overflow-y:auto;',
                '    display:flex;flex-direction:column;background:var(--bp-surface-2);',
                '    scrollbar-width:thin;scrollbar-color:var(--bp-border-strong) transparent;}',
                '.bp-review__side--left{border-right:1px solid var(--bp-border);}',
                '.bp-review__side--right{border-left:1px solid var(--bp-border);width:240px;}',
                '.bp-review__center{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;overflow:hidden;}',
                '.bp-review__badge{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:3;',
                '    padding:5px 16px;border-radius:var(--bp-radius-full);background:var(--bp-surface);',
                '    border:1px solid var(--bp-border);box-shadow:0 1px 6px rgba(0,0,0,.10);',
                '    font-size:var(--bp-fs-sm);color:var(--bp-text-2);white-space:nowrap;}',
                '.bp-review__full{position:absolute;top:12px;right:14px;z-index:3;}',
                '.bp-review__frame{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;',
                '    margin:48px 16px 16px;border-radius:var(--bp-radius-lg);background:var(--bp-subtle);overflow:hidden;}',
                '.bp-review__frame img{max-width:100%;max-height:100%;object-fit:contain;display:block;',
                '    border-radius:var(--bp-radius-sm);box-shadow:0 2px 16px rgba(0,0,0,.18);}',
                '.bp-review.is-full .bp-review__frame{margin:16px;}',
                '.bp-krow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;',
                '    background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:var(--bp-radius-md);',
                '    margin-bottom:6px;font-size:var(--bp-fs-sm);cursor:pointer;',
                '    transition:border-color var(--bp-dur),background var(--bp-dur);}',
                '.bp-krow:hover{border-color:var(--bp-accent);}',
                '.bp-krow__label{flex:1;min-width:0;text-align:left;white-space:nowrap;',
                '    overflow:hidden;text-overflow:ellipsis;color:var(--bp-text);}',
                '.bp-review__progress{margin-top:auto;padding:10px 12px;background:var(--bp-surface);',
                '    border:1px solid var(--bp-border);border-radius:var(--bp-radius-md);font-size:var(--bp-fs-sm);}',
                '.bp-review__upname{font-weight:var(--bp-fw-bold);font-size:var(--bp-fs-md);',
                '    word-break:break-all;color:var(--bp-text);}',
                '.bp-review__uptext{line-height:1.75;font-size:var(--bp-fs-sm);color:var(--bp-text-2);',
                '    white-space:pre-wrap;word-break:break-word;margin-bottom:12px;padding:8px 10px;',
                '    background:var(--bp-subtle);border-radius:var(--bp-radius-md);}',
                '@media (max-width:760px){',
                '    .bp-review__side{width:150px;padding:10px;}',
                '    .bp-review__side--right{width:150px;}',
                '    .bp-review__frame{margin:44px 10px 10px;}',
                '}',
                '',
                '/* ===== 焦点可见（键盘可达性） ===== */',
                '.bp-panel :focus-visible,.bp-fab-wrap :focus-visible,.bp-toast :focus-visible{',
                '    outline:2px solid var(--bp-accent);outline-offset:2px;}',
                '',
                '/* ===== 窄屏：面板改成贴底全宽 ===== */',
                '@media (max-width:560px){',
                '    .bp-panel{left:12px !important;right:12px !important;width:auto !important;',
                '        max-width:none !important;bottom:12px !important;',
                '        max-height:calc(100vh - 24px) !important;}',
                '    .bp-toast{left:12px;right:12px;max-width:none;}',
                '}',
                '',
                '/* ===== 尊重「减少动态效果」系统设置 ===== */',
                '@media (prefers-reduced-motion: reduce){',
                '    .bp-panel,.bp-toast,.bp-overlay,.bp-fab__item{animation:none !important;}',
                '    .bp-btn,.bp-fab,.bp-progress__bar{transition:none !important;}',
                '}'
            ].join('\n');
        }

        return {
            THEMES,
            DEFAULT_THEME,
            THEME_LABELS,
            PALETTES,
            VARS,
            normalizeTheme,
            resolveTheme,
            tokensFor,
            buildCss
        };
    });
    const TH = (typeof globalThis !== 'undefined' && globalThis.__biliTheme) ? globalThis.__biliTheme : null;

    // 样式表只注入一次（同名 id 复用），主题切换不重建 DOM
    function injectUiCss(){
        if(!TH) return;
        if(document.getElementById('bili-plus-ui-css')) return;
        const el = document.createElement('style');
        el.id = 'bili-plus-ui-css';
        el.textContent = TH.buildCss();
        (document.head || document.documentElement).appendChild(el);
    }
    // ────────────────────────────────────────────────────────────────────────
    // 便携版核心：浏览器内取图 → 打 ZIP / 直写授权目录（由 build.js 内联，
    // 源文件是 src/lib/browser-save.js，别在这里手改）
    // ============================================================================
    // 便携版核心：浏览器内取图 → 打 ZIP / 直写目录
    // 该文件被 build.js 原样内联进 userscript，同时可直接被 Node require 做单测，
    // 保证「测试的代码」与「发布的代码」是同一份。
    // ============================================================================
    (function (root, factory) {
        const api = factory();
        if (typeof module !== 'undefined' && module.exports) module.exports = api;
        root.__biliBrowserSave = api;                       // 供浏览器内自检 / 冒烟测试
    })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
        'use strict';

        const DEFAULT_EXT = '.jpg';

        // 与本地服务一致的非法字符净化规则（保证两个版本产出的文件名相同）
        function sanitizeFilename(name) {
            let s = String(name == null ? '' : name)
                .replace(/[\u0000-\u001f\u007f]/g, '')
                .replace(/[\\/:*?"<>|]/g, '_')
                .replace(/\.{2,}/g, '_')
                .replace(/[. ]+$/, '');
            if (!s) s = '_';
            if (s === '.' || s === '..') s = '_';
            return s;
        }

        // 从地址推断扩展名（无扩展名时用）
        function extensionFromUrl(u) {
            try {
                const ext = new URL(u).pathname.split('@')[0].match(/\.[a-z0-9]{1,5}$/i);
                if (ext) return ext[0];
            } catch (e) { }
            return DEFAULT_EXT;
        }

        // 原图地址 → 落盘文件名（原图 hash 名，与服务端命名规则一致）
        function hashFileNameFromUrl(url) {
            let base = '';
            try {
                const pathname = new URL(url).pathname;
                base = decodeURIComponent(pathname.split('/').pop() || '');
            } catch (e) { }
            base = sanitizeFilename(base.split('@')[0]);
            if (!base || base === '_') base = 'image' + DEFAULT_EXT;
            if (!/\.[a-z0-9]{1,5}$/i.test(base)) base += extensionFromUrl(url);
            return sanitizeFilename(base);
        }

        // ZIP 包名：B站图片_20261002_181530.zip
        function buildZipName(date, prefix) {
            const d = date || new Date();
            const p = n => String(n).padStart(2, '0');
            const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
                '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
            return (prefix || 'B站图片') + '_' + stamp + '.zip';
        }

        // ------------------------------------------------------------------
        // CRC32（ZIP 必需）
        // ------------------------------------------------------------------
        const CRC_TABLE = (function () {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            return t;
        })();

        function crc32(u8) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        }

        // ------------------------------------------------------------------
        // STORE 模式 ZIP：图片本身已压缩，无需 deflate，零依赖零 CPU
        // entries: [{ name, data: Uint8Array }]  ->  Blob
        // 不做 Zip64：超过 32 位字段上限直接抛错（宁可不打包，也不产出坏包）
        // ------------------------------------------------------------------
        const MAX_U16 = 0xFFFF;
        const MAX_U32 = 0xFFFFFFFF;
        const ZIP_FLAGS_UTF8 = 0x0800;                  // EFS：声明条目名为 UTF-8

        function zipStore(entries) {
            if (entries.length > MAX_U16) throw new Error('ZIP 条目数超过 65535 上限，请减少单次保存数量后分批重试');
            const enc = new TextEncoder();
            let total = 22;                              // EOCD
            for (const e of entries) {
                const nameLen = enc.encode(e.name).length;
                if (nameLen > MAX_U16) throw new Error('ZIP 文件名过长，无法打包');
                total += 30 + nameLen + e.data.length + 46 + nameLen;
            }
            if (total > MAX_U32) throw new Error('ZIP 超过 4GB 上限，请减少单次保存数量后分批重试');

            const parts = [], central = [];
            const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
            const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
            let off = 0;
            for (const e of entries) {
                const nb = enc.encode(e.name);
                const data = e.data;
                const crc = crc32(data);
                const n = data.length;
                const local = new Uint8Array([
                    ...u32(0x04034b50), ...u16(20), ...u16(ZIP_FLAGS_UTF8), ...u16(0), ...u16(0), ...u16(0),
                    ...u32(crc), ...u32(n), ...u32(n), ...u16(nb.length), ...u16(0)
                ]);
                parts.push(local, nb, data);
                central.push(new Uint8Array([
                    ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(ZIP_FLAGS_UTF8), ...u16(0), ...u16(0), ...u16(0),
                    ...u32(crc), ...u32(n), ...u32(n), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0),
                    ...u16(0), ...u32(0), ...u32(off)
                ]), nb);
                off += local.length + nb.length + n;
            }
            const cdOff = off;
            let cdLen = 0;
            for (const p of central) cdLen += p.length;
            const eocd = new Uint8Array([
                ...u32(0x06054b50), ...u16(0), ...u16(0),
                ...u16(entries.length), ...u16(entries.length), ...u32(cdLen), ...u32(cdOff), ...u16(0)
            ]);
            // 用 concat 而不是 [...parts, ...central, eocd]：后者把每个分片当成函数实参展开，
            // 条目上万时实参个数逼近引擎上限（各引擎门槛不同），而且完全没必要
            return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
        }

        // 分批规划：单个 ZIP 受 32 位字段限制（≤65535 条、≤4GB），超了就拆成多个包；
        // maxBytes 可传更小的软上限（如视频按内存预算分批）；单条超限时会单独成批（由 zipStore 兜底校验）
        function planZipBatches(entries, maxBytes) {
            const enc = new TextEncoder();
            const limit = Math.min(maxBytes || MAX_U32, MAX_U32);
            const batches = [];
            let cur = [], total = 22;
            for (const e of entries) {
                const add = 76 + enc.encode(e.name).length * 2 + e.data.length;
                if (cur.length && (cur.length >= MAX_U16 || total + add > limit)) {
                    batches.push(cur);
                    cur = []; total = 22;
                }
                cur.push(e);
                total += add;
            }
            if (cur.length) batches.push(cur);
            return batches;
        }

        // 打包体积 / 条目数统计（用于界面提示）
        function zipOverheadBytes(entries) {
            let n = 22;                                     // EOCD
            for (const e of entries) {
                n += 30 + 46;                               // 本地头 + 中央目录头
                n += new TextEncoder().encode(e.name).length * 2;
            }
            return n;
        }

        // ------------------------------------------------------------------
        // 已下载记账（IndexedDB）：浏览器无法扫目录时的跨会话查重
        // ------------------------------------------------------------------
        const IDB_NAME = 'bili_save_browser_v1';
        const IDB_FILES = 'files';        // 文件名集合
        const IDB_KV = 'kv';              // 杂项（目录句柄等）

        function idbOpen() {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
                const req = indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(IDB_FILES)) db.createObjectStore(IDB_FILES);
                    if (!db.objectStoreNames.contains(IDB_KV)) db.createObjectStore(IDB_KV);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        function idbTx(db, store, mode, fn) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(store, mode);
                const os = tx.objectStore(store);
                let out;
                try { out = fn(os); } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }

        // 批量查询已存在记录 → Set(names)
        async function idbHasNames(names) {
            const db = await idbOpen();
            try {
                const found = new Set();
                await idbTx(db, IDB_FILES, 'readonly', os => {
                    for (const n of names) {
                        const r = os.getKey(n);
                        r.onsuccess = () => { if (r.result !== undefined) found.add(n); };
                    }
                });
                return found;
            } finally { db.close(); }
        }

        // 记账写入
        async function idbAddNames(names) {
            const db = await idbOpen();
            try {
                await idbTx(db, IDB_FILES, 'readwrite', os => {
                    for (const n of names) os.put(Date.now(), n);
                });
            } finally { db.close(); }
        }

        async function idbClearNames() {
            const db = await idbOpen();
            try { await idbTx(db, IDB_FILES, 'readwrite', os => os.clear()); } finally { db.close(); }
        }

        // 列出已记账的名字（可用前缀过滤，如 'video:'）
        async function idbListNames(prefix) {
            const db = await idbOpen();
            try {
                return await new Promise((resolve, reject) => {
                    const out = [];
                    const req = db.transaction(IDB_FILES, 'readonly').objectStore(IDB_FILES).openKeyCursor();
                    req.onsuccess = () => {
                        const cur = req.result;
                        if (!cur) { resolve(out); return; }
                        const k = String(cur.key);
                        if (!prefix || k.indexOf(prefix) === 0) out.push(k);
                        cur.continue();
                    };
                    req.onerror = () => reject(req.error);
                });
            } finally { db.close(); }
        }

        async function idbGetKV(key) {
            const db = await idbOpen();
            try {
                return await new Promise((resolve, reject) => {
                    const r = db.transaction(IDB_KV, 'readonly').objectStore(IDB_KV).get(key);
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error);
                });
            } finally { db.close(); }
        }

        async function idbSetKV(key, value) {
            const db = await idbOpen();
            try {
                await new Promise((resolve, reject) => {
                    const r = db.transaction(IDB_KV, 'readwrite').objectStore(IDB_KV).put(value, key);
                    r.onsuccess = () => resolve();
                    r.onerror = () => reject(r.error);
                });
            } finally { db.close(); }
        }

        async function idbDelKV(key) {
            const db = await idbOpen();
            try {
                await new Promise((resolve, reject) => {
                    const r = db.transaction(IDB_KV, 'readwrite').objectStore(IDB_KV).delete(key);
                    r.onsuccess = () => resolve();
                    r.onerror = () => reject(r.error);
                });
            } finally { db.close(); }
        }

        return {
            sanitizeFilename,
            extensionFromUrl,
            hashFileNameFromUrl,
            buildZipName,
            crc32,
            zipStore,
            planZipBatches,
            zipOverheadBytes,
            idbOpen,
            idbHasNames,
            idbAddNames,
            idbClearNames,
            idbListNames,
            idbGetKV,
            idbSetKV,
            idbDelKV
        };
    });
    const BS = (typeof globalThis !== 'undefined' && globalThis.__biliBrowserSave) ? globalThis.__biliBrowserSave : null;
    // ────────────────────────────────────────────────────────────────────────
    // 便携版的音视频合并：把 DASH 的 video.m4s + audio.m4s 合成单个 mp4（只重排 mp4 box，
    // 不重新编码，画质无损）。MP4Box 只在便携版内联（环境版有 ffmpeg，用不上）。
    // 源文件是 src/lib/dash-merge.js 与 src/lib/mp4box.min.js，别在这里手改
    var MP4BoxLib=(()=>{var Dn=Object.defineProperty;var jh=Object.getOwnPropertyDescriptor;var $h=Object.getOwnPropertyNames;var qh=Object.prototype.hasOwnProperty;var Ta=r=>{throw TypeError(r)};var Yh=(r,t)=>{for(var e in t)Dn(r,e,{get:t[e],enumerable:!0})},Wh=(r,t,e,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of $h(t))!qh.call(r,s)&&s!==e&&Dn(r,s,{get:()=>t[s],enumerable:!(i=jh(t,s))||i.enumerable});return r};var Kh=r=>Wh(Dn({},"__esModule",{value:!0}),r);var Ln=(r,t,e)=>t.has(r)||Ta("Cannot "+e);var Aa=(r,t,e)=>(Ln(r,t,"read from private field"),e?e.call(r):t.get(r)),Hn=(r,t,e)=>t.has(r)?Ta("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(r):t.set(r,e),Fa=(r,t,e,i)=>(Ln(r,t,"write to private field"),i?i.call(r,e):t.set(r,e),e),On=(r,t,e)=>(Ln(r,t,"access private method"),e);var sf={};Yh(sf,{AudioSampleEntry:()=>C,Box:()=>u,BoxParser:()=>ef,DIFF_BOXES_PROP_NAMES:()=>_n,DIFF_PRIMITIVE_ARRAY_PROP_NAMES:()=>qn,DataStream:()=>w,Descriptor:()=>Y,ES_Descriptor:()=>Pa,Endianness:()=>Va,FullBox:()=>f,HintSampleEntry:()=>wn,ISOFile:()=>Ia,Log:()=>l,MP4BoxBuffer:()=>H,MPEG4DescriptorParser:()=>Vh,MetadataSampleEntry:()=>j,MultiBufferStream:()=>W,SampleEntry:()=>O,SampleGroupEntry:()=>U,SampleGroupInfo:()=>un,SingleItemTypeReferenceBox:()=>Gn,SingleItemTypeReferenceBoxLarge:()=>jn,SubtitleSampleEntry:()=>V,SystemSampleEntry:()=>gn,TX3GParser:()=>pc,TextSampleEntry:()=>Kn,Textin4Parser:()=>fc,TrackGroupTypeBox:()=>Vn,TrackReferenceTypeBox:()=>$n,VTTin4Parser:()=>lc,VisualSampleEntry:()=>v,XMLSubtitlein4Parser:()=>dc,boxEqual:()=>kn,boxEqualFields:()=>Yn,createFile:()=>Dh});var Da=Object.defineProperty,Mn=(r,t)=>{let e={};for(var i in r)Da(e,i,{get:r[i],enumerable:!0});return t||Da(e,Symbol.toStringTag,{value:"Module"}),e};var Rn=Math.pow(2,32),E=Math.pow(2,32)-1,Xh=131072,Jh=1024,Qh=2048,H=class Na extends ArrayBuffer{constructor(t){super(t),this.fileStart=0,this.usedBytes=0}static fromArrayBuffer(t,e){let i=new Na(t.byteLength);return new Uint8Array(i).set(new Uint8Array(t)),i.fileStart=e,i}},Va=(function(r){return r[r.BIG_ENDIAN=1]="BIG_ENDIAN",r[r.LITTLE_ENDIAN=2]="LITTLE_ENDIAN",r})({}),xn,Nn,m,w=(m=class{constructor(t,e,i){Hn(this,xn);this._byteLength=0,this.failurePosition=0,this._dynamicSize=1,this._byteOffset=e||0,t instanceof ArrayBuffer?this.buffer=H.fromArrayBuffer(t,0):t instanceof DataView?(this.dataView=t,e&&(this._byteOffset+=e)):this.buffer=new H(t||0),this.position=0,this.endianness=i||1}getPosition(){return this.position}_realloc(t){if(!this._dynamicSize)return;let e=this._byteOffset+this.position+t,i=this._buffer.byteLength;if(e<=i){e>this._byteLength&&(this._byteLength=e);return}for(i<1&&(i=1);e>i;)i*=2;let s=new H(i),n=new Uint8Array(this._buffer);new Uint8Array(s,0,n.length).set(n),this.buffer=s,this._byteLength=e}_trimAlloc(){if(this._byteLength===this._buffer.byteLength)return;let t=new H(this._byteLength),e=new Uint8Array(t),i=new Uint8Array(this._buffer,0,e.length);e.set(i),this.buffer=t}get byteLength(){return this._byteLength-this._byteOffset}get buffer(){return this._trimAlloc(),this._buffer}set buffer(t){this._buffer=t,this._dataView=new DataView(t,this._byteOffset),this._byteLength=t.byteLength}get byteOffset(){return this._byteOffset}set byteOffset(t){this._byteOffset=t,this._dataView=new DataView(this._buffer,this._byteOffset),this._byteLength=this._buffer.byteLength}get dataView(){return this._dataView}set dataView(t){this._byteOffset=t.byteOffset,this._buffer=H.fromArrayBuffer(t.buffer,0),this._dataView=new DataView(this._buffer,this._byteOffset),this._byteLength=this._byteOffset+t.byteLength}seek(t){let e=Math.max(0,Math.min(this.byteLength,t));this.position=isNaN(e)||!isFinite(e)?0:e}isEof(){return this.position>=this._byteLength}mapUint8Array(t){this._realloc(t*1);let e=new Uint8Array(this._buffer,this.byteOffset+this.position,t);return this.position+=t*1,e}readInt32Array(t,e){t=t===void 0?this.byteLength-this.position/4:t;let i=new Int32Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readInt16Array(t,e){t=t===void 0?this.byteLength-this.position/2:t;let i=new Int16Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readInt8Array(t){t=t===void 0?this.byteLength-this.position:t;let e=new Int8Array(t);return m.memcpy(e.buffer,0,this.buffer,this.byteOffset+this.position,t*e.BYTES_PER_ELEMENT),this.position+=e.byteLength,e}readUint32Array(t,e){t=t===void 0?this.byteLength-this.position/4:t;let i=new Uint32Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readUint16Array(t,e){t=t===void 0?this.byteLength-this.position/2:t;let i=new Uint16Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readUint8Array(t){t=t===void 0?this.byteLength-this.position:t;let e=new Uint8Array(t);return m.memcpy(e.buffer,0,this.buffer,this.byteOffset+this.position,t*e.BYTES_PER_ELEMENT),this.position+=e.byteLength,e}readFloat64Array(t,e){t=t===void 0?this.byteLength-this.position/8:t;let i=new Float64Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readFloat32Array(t,e){t=t===void 0?this.byteLength-this.position/4:t;let i=new Float32Array(t);return m.memcpy(i.buffer,0,this.buffer,this.byteOffset+this.position,t*i.BYTES_PER_ELEMENT),m.arrayToNative(i,e??this.endianness),this.position+=i.byteLength,i}readInt32(t){let e=this._dataView.getInt32(this.position,(t??this.endianness)===2);return this.position+=4,e}readInt16(t){let e=this._dataView.getInt16(this.position,(t??this.endianness)===2);return this.position+=2,e}readInt8(){let t=this._dataView.getInt8(this.position);return this.position+=1,t}readUint32(t){let e=this._dataView.getUint32(this.position,(t??this.endianness)===2);return this.position+=4,e}readUint16(t){let e=this._dataView.getUint16(this.position,(t??this.endianness)===2);return this.position+=2,e}readUint8(){let t=this._dataView.getUint8(this.position);return this.position+=1,t}readFloat32(t){let e=this._dataView.getFloat32(this.position,(t??this.endianness)===2);return this.position+=4,e}readFloat64(t){let e=this._dataView.getFloat64(this.position,(t??this.endianness)===2);return this.position+=8,e}static memcpy(t,e,i,s,n){let a=new Uint8Array(t,e,n),o=new Uint8Array(i,s,n);a.set(o)}static arrayToNative(t,e){return e===m.ENDIANNESS?t:this.flipArrayEndianness(t)}static nativeToEndian(t,e){return e&&m.ENDIANNESS===2?t:this.flipArrayEndianness(t)}static flipArrayEndianness(t){let e=new Uint8Array(t.buffer,t.byteOffset,t.byteLength);for(let i=0;i<t.byteLength;i+=t.BYTES_PER_ELEMENT)for(let s=i+t.BYTES_PER_ELEMENT-1,n=i;s>n;s--,n++){let a=e[n];e[n]=e[s],e[s]=a}return t}readString(t,e){return e===void 0||e==="ASCII"?La(this.mapUint8Array(t===void 0?this.byteLength-this.position:t)):new TextDecoder(e).decode(this.mapUint8Array(t))}readCString(t){let e=0,i=this.byteLength-this.position,s=new Uint8Array(this._buffer,this._byteOffset+this.position),n=t!==void 0?Math.min(t,i):i;for(;e<n&&s[e]!==0;e++);let a=La(this.mapUint8Array(e));return t!==void 0?this.position+=n-e:e!==i&&(this.position+=1),a}readInt64(){return this.readInt32()*Rn+this.readUint32()}readUint64(){return this.readUint32()*Rn+this.readUint32()}readUint24(){return(this.readUint8()<<16)+(this.readUint8()<<8)+this.readUint8()}save(t){let e=new Blob([this.buffer]);if(typeof window<"u"&&typeof document<"u")if(window.URL&&URL.createObjectURL){let i=window.URL.createObjectURL(e),s=document.createElement("a");document.body.appendChild(s),s.setAttribute("href",i),s.setAttribute("download",t),s.setAttribute("target","_self"),s.click(),window.URL.revokeObjectURL(i),document.body.removeChild(s)}else throw new Error("DataStream.save: Can't create object URL.");return e}get dynamicSize(){return this._dynamicSize}set dynamicSize(t){t||this._trimAlloc(),this._dynamicSize=t}shift(t){let e=new H(this._byteLength-t),i=new Uint8Array(e),s=new Uint8Array(this._buffer,t,i.length);i.set(s),this.buffer=e,this.position-=t}writeInt32Array(t,e){if(this._realloc(t.length*4),t instanceof Int32Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapInt32Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeInt32(t[i],e)}writeInt16Array(t,e){if(this._realloc(t.length*2),t instanceof Int16Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapInt16Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeInt16(t[i],e)}writeInt8Array(t){if(this._realloc(t.length*1),t instanceof Int8Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapInt8Array(t.length);else for(let e=0;e<t.length;e++)this.writeInt8(t[e])}writeUint32Array(t,e){if(this._realloc(t.length*4),t instanceof Uint32Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapUint32Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeUint32(t[i],e)}writeUint16Array(t,e){if(this._realloc(t.length*2),t instanceof Uint16Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapUint16Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeUint16(t[i],e)}writeUint8Array(t){if(this._realloc(t.length*1),t instanceof Uint8Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapUint8Array(t.length);else for(let e=0;e<t.length;e++)this.writeUint8(t[e])}writeFloat64Array(t,e){if(this._realloc(t.length*8),t instanceof Float64Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapFloat64Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeFloat64(t[i],e)}writeFloat32Array(t,e){if(this._realloc(t.length*4),t instanceof Float32Array&&this.byteOffset+this.position%t.BYTES_PER_ELEMENT===0)m.memcpy(this._buffer,this.byteOffset+this.position,t.buffer,0,t.byteLength),this.mapFloat32Array(t.length,e);else for(let i=0;i<t.length;i++)this.writeFloat32(t[i],e)}writeInt64(t,e){this._realloc(8),this._dataView.setBigInt64(this.position,BigInt(t),(e??this.endianness)===2),this.position+=8}writeInt32(t,e){this._realloc(4),this._dataView.setInt32(this.position,t,(e??this.endianness)===2),this.position+=4}writeInt16(t,e){this._realloc(2),this._dataView.setInt16(this.position,t,(e??this.endianness)===2),this.position+=2}writeInt8(t){this._realloc(1),this._dataView.setInt8(this.position,t),this.position+=1}writeUint32(t,e){this._realloc(4),this._dataView.setUint32(this.position,t,(e??this.endianness)===2),this.position+=4}writeUint16(t,e){this._realloc(2),this._dataView.setUint16(this.position,t,(e??this.endianness)===2),this.position+=2}writeUint8(t){this._realloc(1),this._dataView.setUint8(this.position,t),this.position+=1}writeFloat32(t,e){this._realloc(4),this._dataView.setFloat32(this.position,t,(e??this.endianness)===2),this.position+=4}writeFloat64(t,e){this._realloc(8),this._dataView.setFloat64(this.position,t,(e??this.endianness)===2),this.position+=8}writeUCS2String(t,e,i){i===void 0&&(i=t.length);let s;for(s=0;s<t.length&&s<i;s++)this.writeUint16(t.charCodeAt(s),e);for(;s<i;s++)this.writeUint16(0)}writeString(t,e,i){let s=0;if(e===void 0||e==="ASCII")if(i!==void 0){let n=Math.min(t.length,i);for(s=0;s<n;s++)this.writeUint8(t.charCodeAt(s));for(;s<i;s++)this.writeUint8(0)}else for(s=0;s<t.length;s++)this.writeUint8(t.charCodeAt(s));else this.writeUint8Array(new TextEncoder(e).encode(t.substring(0,i)))}writeCString(t,e){let i=0;if(e!==void 0){let s=Math.min(t.length,e);for(i=0;i<s;i++)this.writeUint8(t.charCodeAt(i));for(;i<e;i++)this.writeUint8(0)}else{for(i=0;i<t.length;i++)this.writeUint8(t.charCodeAt(i));this.writeUint8(0)}}writeStruct(t,e){for(let i=0;i<t.length;i++){let[s,n]=t[i],a=e[s];this.writeType(n,a,e)}}writeType(t,e,i){if(typeof t=="function")return t(this,e);if(typeof t=="object"&&!(t instanceof Array))return t.set(this,e,i);let s,n="ASCII",a=this.position,o=t;if(typeof t=="string"&&/:/.test(t)){let h=t.split(":");o=h[0],s=parseInt(h[1])}if(typeof o=="string"&&/,/.test(o)){let h=o.split(",");o=h[0],n=h[1]}switch(o){case"uint8":this.writeUint8(e);break;case"int8":this.writeInt8(e);break;case"uint16":this.writeUint16(e,this.endianness);break;case"int16":this.writeInt16(e,this.endianness);break;case"uint32":this.writeUint32(e,this.endianness);break;case"int32":this.writeInt32(e,this.endianness);break;case"float32":this.writeFloat32(e,this.endianness);break;case"float64":this.writeFloat64(e,this.endianness);break;case"uint16be":this.writeUint16(e,1);break;case"int16be":this.writeInt16(e,1);break;case"uint32be":this.writeUint32(e,1);break;case"int32be":this.writeInt32(e,1);break;case"float32be":this.writeFloat32(e,1);break;case"float64be":this.writeFloat64(e,1);break;case"uint16le":this.writeUint16(e,2);break;case"int16le":this.writeInt16(e,2);break;case"uint32le":this.writeUint32(e,2);break;case"int32le":this.writeInt32(e,2);break;case"float32le":this.writeFloat32(e,2);break;case"float64le":this.writeFloat64(e,2);break;case"cstring":this.writeCString(e,s);break;case"string":this.writeString(e,n,s);break;case"u16string":this.writeUCS2String(e,this.endianness,s);break;case"u16stringle":this.writeUCS2String(e,2,s);break;case"u16stringbe":this.writeUCS2String(e,1,s);break;default:if(On(this,xn,Nn).call(this,o)){let[,h]=o;for(let c=0;c<e.length;c++)this.writeType(h,e[c]);break}else{this.writeStruct(o,e);break}}s&&(this.position=a,this._realloc(s),this.position=a+s)}writeUint64(t){let e=Math.floor(t/Rn);this.writeUint32(e),this.writeUint32(t&4294967295)}writeUint24(t){this.writeUint8((t&16711680)>>16),this.writeUint8((t&65280)>>8),this.writeUint8(t&255)}adjustUint32(t,e){let i=this.position;this.seek(t),this.writeUint32(e),this.seek(i)}readStruct(t){let e={},i=this.position;for(let s=0;s<t.length;s+=1){let n=t[s][1],a=this.readType(n,e);if(!a){this.failurePosition===0&&(this.failurePosition=this.position),this.position=i;return}e[t[s][0]]=a}return e}readUCS2String(t,e){return String.fromCharCode.apply(void 0,this.readUint16Array(t,e))}readType(t,e){if(typeof t=="function")return t(this,e);if(typeof t=="object"&&!(t instanceof Array))return t.get(this,e);if(t instanceof Array&&t.length!==3)return this.readStruct(t);let i,s,n="ASCII",a=this.position,o=t;if(typeof o=="string"&&/:/.test(o)){let h=o.split(":");o=h[0],s=parseInt(h[1])}if(typeof o=="string"&&/,/.test(o)){let h=o.split(",");o=h[0],n=h[1]}switch(o){case"uint8":i=this.readUint8();break;case"int8":i=this.readInt8();break;case"uint16":i=this.readUint16(this.endianness);break;case"int16":i=this.readInt16(this.endianness);break;case"uint32":i=this.readUint32(this.endianness);break;case"int32":i=this.readInt32(this.endianness);break;case"float32":i=this.readFloat32(this.endianness);break;case"float64":i=this.readFloat64(this.endianness);break;case"uint16be":i=this.readUint16(1);break;case"int16be":i=this.readInt16(1);break;case"uint32be":i=this.readUint32(1);break;case"int32be":i=this.readInt32(1);break;case"float32be":i=this.readFloat32(1);break;case"float64be":i=this.readFloat64(1);break;case"uint16le":i=this.readUint16(2);break;case"int16le":i=this.readInt16(2);break;case"uint32le":i=this.readUint32(2);break;case"int32le":i=this.readInt32(2);break;case"float32le":i=this.readFloat32(2);break;case"float64le":i=this.readFloat64(2);break;case"cstring":i=this.readCString(s);break;case"string":i=this.readString(s,n);break;case"u16string":i=this.readUCS2String(s,this.endianness);break;case"u16stringle":i=this.readUCS2String(s,2);break;case"u16stringbe":i=this.readUCS2String(s,1);break;default:if(On(this,xn,Nn).call(this,o)){let[,h,c]=o,d=typeof c=="function"?c(e,this,o):typeof c=="string"&&e[c]!==void 0?parseInt(e[c]):typeof c=="number"?c:c==="*"?void 0:parseInt(c);if(typeof h=="string"){let p=h.replace(/(le|be)$/,""),_;switch(/le$/.test(h)?_=2:/be$/.test(h)&&(_=1),p){case"uint8":i=this.readUint8Array(d);break;case"uint16":i=this.readUint16Array(d,_);break;case"uint32":i=this.readUint32Array(d,_);break;case"int8":i=this.readInt8Array(d);break;case"int16":i=this.readInt16Array(d,_);break;case"int32":i=this.readInt32Array(d,_);break;case"float32":i=this.readFloat32Array(d,_);break;case"float64":i=this.readFloat64Array(d,_);break;case"cstring":case"utf16string":case"string":if(d){i=new Array(d);for(let x=0;x<d;x++)i[x]=this.readType(h,e)}else for(i=[];!this.isEof();){let x=this.readType(h,e);if(!x)break;i.push(x)}break}}else if(d){i=new Array(d);for(let p=0;p<d;p++){let _=this.readType(h,e);if(!_)return;i[p]=_}}else for(i=[];;){let p=this.position;try{let _=this.readType(h,e);if(!_){this.position=p;break}i.push(_)}catch{this.position=p;break}}break}}return s&&(this.position=a+s),i}mapInt32Array(t,e){this._realloc(t*4);let i=new Int32Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*4,i}mapInt16Array(t,e){this._realloc(t*2);let i=new Int16Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*2,i}mapInt8Array(t,e){this._realloc(t*1);let i=new Int8Array(this._buffer,this.byteOffset+this.position,t);return this.position+=t*1,i}mapUint32Array(t,e){this._realloc(t*4);let i=new Uint32Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*4,i}mapUint16Array(t,e){this._realloc(t*2);let i=new Uint16Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*2,i}mapFloat64Array(t,e){this._realloc(t*8);let i=new Float64Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*8,i}mapFloat32Array(t,e){this._realloc(t*4);let i=new Float32Array(this._buffer,this.byteOffset+this.position,t);return m.arrayToNative(i,e??this.endianness),this.position+=t*4,i}},xn=new WeakSet,Nn=function(t){return Array.isArray(t)&&t.length===3&&t[0]==="[]"},m.ENDIANNESS=new Int8Array(new Int16Array([1]).buffer)[0]>0?2:1,m);function La(r){let t=[];for(let e=0;e<r.length;e++)t[e]=r[e];return String.fromCharCode.apply(void 0,t)}var Sn=new Date,Bn=4,Ha=3,Oa=2,Ma=1,N=Bn,l={setLogLevel(r){r===this.debug?N=Ma:r===this.info?N=Oa:r===this.warn?N=Ha:(this.error,N=Bn)},debug(r,t){console.debug===void 0&&(console.debug=console.log),Ma>=N&&console.debug("["+l.getDurationString(new Date().getTime()-Sn.getTime(),1e3)+"]","["+r+"]",t)},log(r,t){this.debug(r.msg)},info(r,t){Oa>=N&&console.info("["+l.getDurationString(new Date().getTime()-Sn.getTime(),1e3)+"]","["+r+"]",t)},warn(r,t){Ha>=N&&console.warn("["+l.getDurationString(new Date().getTime()-Sn.getTime(),1e3)+"]","["+r+"]",t)},error(r,t,e){e?.onError?e.onError(r,t):Bn>=N&&console.error("["+l.getDurationString(new Date().getTime()-Sn.getTime(),1e3)+"]","["+r+"]",t)},getDurationString(r,t){let e;function i(h,c){let d=(""+h).split(".");for(;d[0].length<c;)d[0]="0"+d[0];return d.join(".")}r<0?(e=!0,r=-r):e=!1;let s=r/(t||1),n=Math.floor(s/3600);s-=n*3600;let a=Math.floor(s/60);s-=a*60;let o=s*1e3;return s=Math.floor(s),o-=s*1e3,o=Math.floor(o),(e?"-":"")+n+":"+i(a,2)+":"+i(s,2)+"."+i(o,3)},printRanges(r){let t=r.length;if(t>0){let e="";for(let i=0;i<t;i++)i>0&&(e+=","),e+="["+l.getDurationString(r.start(i))+","+l.getDurationString(r.end(i))+"]";return e}else return"(empty)"}};function Zh(r,t){l.debug("ArrayBuffer","Trying to create a new buffer of size: "+(r.byteLength+t.byteLength));let e=new Uint8Array(r.byteLength+t.byteLength);return e.set(new Uint8Array(r),0),e.set(new Uint8Array(t),r.byteLength),e.buffer}var W=class extends w{constructor(r){super(new ArrayBuffer,0),this.buffers=[],this.bufferIndex=-1,r&&(this.insertBuffer(r),this.bufferIndex=0)}initialized(){if(this.bufferIndex>-1)return!0;if(this.buffers.length>0){let r=this.buffers[0];return r.fileStart===0?(this.buffer=r,this.bufferIndex=0,l.debug("MultiBufferStream","Stream ready for parsing"),!0):(l.warn("MultiBufferStream","The first buffer should have a fileStart of 0"),this.logBufferLevel(),!1)}else return l.warn("MultiBufferStream","No buffer to start parsing from"),this.logBufferLevel(),!1}reduceBuffer(r,t,e){let i=new Uint8Array(e);return i.set(new Uint8Array(r,t,e)),i.buffer.fileStart=r.fileStart+t,i.buffer.usedBytes=0,i.buffer}insertBuffer(r){let t=!0,e=0;for(;e<this.buffers.length;e++){let i=this.buffers[e];if(r.fileStart<=i.fileStart){if(r.fileStart===i.fileStart)if(r.byteLength>i.byteLength){this.buffers.splice(e,1),e--;continue}else l.warn("MultiBufferStream","Buffer (fileStart: "+r.fileStart+" - Length: "+r.byteLength+") already appended, ignoring");else r.fileStart+r.byteLength<=i.fileStart||(r=this.reduceBuffer(r,0,i.fileStart-r.fileStart)),l.debug("MultiBufferStream","Appending new buffer (fileStart: "+r.fileStart+" - Length: "+r.byteLength+")"),this.buffers.splice(e,0,r),e===0&&(this.buffer=r);t=!1;break}else if(r.fileStart<i.fileStart+i.byteLength){let s=i.fileStart+i.byteLength-r.fileStart,n=r.byteLength-s;if(n>0)r=this.reduceBuffer(r,s,n);else{t=!1;break}}}t&&(l.debug("MultiBufferStream","Appending new buffer (fileStart: "+r.fileStart+" - Length: "+r.byteLength+")"),this.buffers.push(r),e===0&&(this.buffer=r))}logBufferLevel(r){let t=[],e="",i,s=0,n=0;for(let o=0;o<this.buffers.length;o++){let h=this.buffers[o];o===0?(i={start:h.fileStart,end:h.fileStart+h.byteLength},t.push(i),e+="["+i.start+"-"):i.end===h.fileStart?i.end=h.fileStart+h.byteLength:(i={start:h.fileStart,end:h.fileStart+h.byteLength},e+=t[t.length-1].end-1+"], ["+i.start+"-",t.push(i)),s+=h.usedBytes,n+=h.byteLength}t.length>0&&(e+=i.end-1+"]");let a=r?l.info:l.debug;this.buffers.length===0?a("MultiBufferStream","No more buffer in memory"):a("MultiBufferStream",""+this.buffers.length+" stored buffer(s) ("+s+"/"+n+" bytes), continuous ranges: "+e)}cleanBuffers(){for(let r=0;r<this.buffers.length;r++){let t=this.buffers[r];t.usedBytes===t.byteLength&&(l.debug("MultiBufferStream","Removing buffer #"+r),this.buffers.splice(r,1),r--)}}mergeNextBuffer(){if(this.bufferIndex+1<this.buffers.length){let r=this.buffers[this.bufferIndex+1];if(r.fileStart===this.buffer.fileStart+this.buffer.byteLength){let t=this.buffer.byteLength,e=this.buffer.usedBytes,i=this.buffer.fileStart;return this.buffers[this.bufferIndex]=Zh(this.buffer,r),this.buffer=this.buffers[this.bufferIndex],this.buffers.splice(this.bufferIndex+1,1),this.buffer.usedBytes=e,this.buffer.fileStart=i,l.debug("ISOFile","Concatenating buffer for box parsing (length: "+t+"->"+this.buffer.byteLength+")"),!0}else return!1}else return!1}findPosition(r,t,e){let i=-1,s=r===!0?0:this.bufferIndex;for(;s<this.buffers.length;){let a=this.buffers[s];if(a&&a.fileStart<=t)i=s,e&&(a.fileStart+a.byteLength<=t?a.usedBytes=a.byteLength:a.usedBytes=t-a.fileStart,this.logBufferLevel());else break;s++}if(i===-1)return-1;let n=this.buffers[i];return n.fileStart+n.byteLength>=t?(l.debug("MultiBufferStream","Found position in existing buffer #"+i),i):-1}findEndContiguousBuf(r){let t=r!==void 0?r:this.bufferIndex,e=this.buffers[t];if(this.buffers.length>t+1)for(let i=t+1;i<this.buffers.length;i++){let s=this.buffers[i];if(s.fileStart===e.fileStart+e.byteLength)e=s;else break}return e.fileStart+e.byteLength}getEndFilePositionAfter(r){let t=this.findPosition(!0,r,!1);return t!==-1?this.findEndContiguousBuf(t):r}addUsedBytes(r){this.buffer.usedBytes+=r,this.logBufferLevel()}setAllUsedBytes(){this.buffer.usedBytes=this.buffer.byteLength,this.logBufferLevel()}seek(r,t,e){let i=this.findPosition(t,r,e);return i!==-1?(this.buffer=this.buffers[i],this.bufferIndex=i,this.position=r-this.buffer.fileStart,l.debug("MultiBufferStream","Repositioning parser at buffer position: "+this.position),!0):(l.debug("MultiBufferStream","Position "+r+" not found in buffered data"),!1)}getPosition(){return this.bufferIndex===-1||this.buffers[this.bufferIndex]===void 0?0:this.buffers[this.bufferIndex].fileStart+this.position}getLength(){return this.byteLength}getEndPosition(){return this.bufferIndex===-1||this.buffers[this.bufferIndex]===void 0?0:this.buffers[this.bufferIndex].fileStart+this.byteLength}getAbsoluteEndPosition(){if(this.buffers.length===0)return 0;let r=this.buffers[this.buffers.length-1];return r.fileStart+r.byteLength}},mn,J,u=(J=class{constructor(t=0){Hn(this,mn);this.size=t}get type(){return this.constructor.fourcc??Aa(this,mn)}set type(t){Fa(this,mn,t)}addBox(t){return this.boxes||(this.boxes=[]),this.boxes.push(t),this[t.type+"s"]?this[t.type+"s"].push(t):this[t.type]=t,t}set(t,e){return this[t]=e,this}addEntry(t,e){let i=e||"entries";return this[i]||(this[i]=[]),this[i].push(t),this}writeHeader(t,e){if(this.size+=8,(this.size>E||this.original_size===1)&&(this.size+=8),this.type==="uuid"&&(this.size+=16),l.debug("BoxWriter","Writing box "+this.type+" of size: "+this.size+" at position "+t.getPosition()+(e||"")),this.original_size===0?t.writeUint32(0):this.size>E||this.original_size===1?t.writeUint32(1):(this.sizePosition=t.getPosition(),t.writeUint32(this.size)),t.writeString(this.type,void 0,4),this.type==="uuid"){let i=new Uint8Array(16);for(let s=0;s<16;s++)i[s]=parseInt(this.uuid.substring(s*2,s*2+2),16);t.writeUint8Array(i)}(this.size>E||this.original_size===1)&&(this.sizePosition=t.getPosition(),t.writeUint64(this.size))}write(t){if(this.type==="mdat"){let e=this;if(e.stream){this.size=e.stream.getAbsoluteEndPosition(),this.writeHeader(t);for(let i of e.stream.buffers){let s=new Uint8Array(i);t.writeUint8Array(s)}}else e.data&&(this.size=e.data.length,this.writeHeader(t),t.writeUint8Array(e.data))}else this.size=this.data?this.data.length:0,this.writeHeader(t),this.data&&t.writeUint8Array(this.data)}printHeader(t){this.size+=8,this.size>E&&(this.size+=8),this.type==="uuid"&&(this.size+=16),t.log(t.indent+"size:"+this.size),t.log(t.indent+"type:"+this.type)}print(t){this.printHeader(t)}parse(t){this.type!=="mdat"?this.data=t.readUint8Array(this.size-this.hdr_size):this.size===0?t.seek(t.getEndPosition()):t.seek(this.start+this.size)}parseDataAndRewind(t){this.data=t.readUint8Array(this.size-this.hdr_size),t.seek(this.start+this.hdr_size)}parseLanguage(t){this.language=t.readUint16();let e=[];e[0]=this.language>>10&31,e[1]=this.language>>5&31,e[2]=this.language&31,this.languageString=String.fromCharCode(e[0]+96,e[1]+96,e[2]+96)}computeSize(t){let e=t||new W;this.write(e)}isEndOfBox(t){return t.getPosition()===this.start+this.size}},mn=new WeakMap,J.registryId=Symbol.for("BoxIdentifier"),J),f=class extends u{constructor(...r){super(...r),this.flags=0,this.version=0}writeHeader(r){this.size+=4,super.writeHeader(r," v="+this.version+" f="+this.flags),r.writeUint8(this.version),r.writeUint24(this.flags)}printHeader(r){this.size+=4,super.printHeader(r),r.log(r.indent+"version:"+this.version),r.log(r.indent+"flags:"+this.flags)}parseDataAndRewind(r){this.parseFullHeader(r),this.data=r.readUint8Array(this.size-this.hdr_size),this.hdr_size-=4,r.seek(this.start+this.hdr_size)}parseFullHeader(r){this.version=r.readUint8(),this.flags=r.readUint24(),this.hdr_size+=4}parse(r){this.parseFullHeader(r),this.data=r.readUint8Array(this.size-this.hdr_size)}},Q,U=(Q=class{constructor(t){this.grouping_type=t}write(t){t.writeUint8Array(this.data)}parse(t){l.warn("BoxParser",`Unknown sample group type: '${this.grouping_type}'`),this.data=t.readUint8Array(this.description_length)}},Q.registryId=Symbol.for("SampleGroupEntryIdentifier"),Q),Vn=class extends f{parse(r){this.parseFullHeader(r),this.track_group_id=r.readUint32()}},Gn=class extends u{constructor(r,t,e,i,s){super(t),this.box_name=e,this.hdr_size=i,this.start=s,this.type=r}parse(r){this.from_item_ID=r.readUint16();let t=r.readUint16();this.references=[];for(let e=0;e<t;e++)this.references[e]={to_item_ID:r.readUint16()}}},jn=class extends u{constructor(r,t,e,i,s){super(t),this.box_name=e,this.hdr_size=i,this.start=s,this.type=r}parse(r){this.from_item_ID=r.readUint32();let t=r.readUint16();this.references=[];for(let e=0;e<t;e++)this.references[e]={to_item_ID:r.readUint32()}}},$n=class extends u{constructor(r,t,e,i){super(t),this.hdr_size=e,this.start=i,this.type=r}parse(r){this.track_ids=r.readUint32Array((this.size-this.hdr_size)/4)}write(r){this.size=this.track_ids.length*4,this.writeHeader(r),r.writeUint32Array(this.track_ids)}},_n=["boxes","entries","references","subsamples","items","item_infos","extents","associations","subsegments","ranges","seekLists","seekPoints","esd","levels"],qn=["compatible_brands","matrix","opcolor","sample_counts","sample_deltas","first_chunk","samples_per_chunk","sample_sizes","chunk_offsets","sample_offsets","sample_description_index","sample_duration"];function Yn(r,t){if(r&&!t)return!1;let e;for(e in r)if(!_n.find(i=>i===e)){if(r[e]instanceof u||t[e]instanceof u)continue;if(typeof r[e]>"u"||typeof t[e]>"u")continue;if(typeof r[e]=="function"||typeof t[e]=="function")continue;if("subBoxNames"in r&&r.subBoxNames.indexOf(e.slice(0,4))>-1||"subBoxNames"in t&&t.subBoxNames.indexOf(e.slice(0,4))>-1)continue;if(e==="data"||e==="start"||e==="size"||e==="creation_time"||e==="modification_time")continue;if(qn.find(i=>i===e))continue;if(r[e]!==t[e])return!1}return!0}function kn(r,t){if(!Yn(r,t))return!1;for(let e=0;e<_n.length;e++){let i=_n[e];if(r[i]&&t[i]&&!kn(r[i],t[i]))return!1}return!0}function Wn(r){let t=r;for(;t;){if("registryId"in t)return t.registryId;t=Object.getPrototypeOf(t)}}var tc=r=>{let t=Symbol.for("SampleGroupEntryIdentifier");return Wn(r)===t},ec=r=>{let t=Symbol.for("SampleEntryIdentifier");return Wn(r)===t},ic=r=>{let t=Symbol.for("BoxIdentifier");return Wn(r)===t},A={uuid:{},sampleEntry:{},sampleGroupEntry:{},box:{}};function Ga(r){let t={uuid:{},sampleEntry:{},sampleGroupEntry:{},box:{}};for(let[e,i]of Object.entries(r)){if(tc(i)){let s="grouping_type"in i?i.grouping_type:void 0;if(!s)throw new Error(`SampleGroupEntry class ${e} does not have a valid static grouping_type. Please ensure it is defined correctly.`);if(s in t.sampleGroupEntry)throw new Error(`SampleGroupEntry class ${e} has a grouping_type that is already registered. Please ensure it is unique.`);t.sampleGroupEntry[s]=i;continue}if(ec(i)){let s="fourcc"in i?i.fourcc:void 0;if(!s)throw new Error(`SampleEntry class ${e} does not have a valid static fourcc. Please ensure it is defined correctly.`);if(s in t.sampleEntry)throw new Error(`SampleEntry class ${e} has a fourcc that is already registered. Please ensure it is unique.`);t.sampleEntry[s]=i;continue}if(ic(i)){let s="fourcc"in i?i.fourcc:void 0,n="uuid"in i?i.uuid:void 0;if(s==="uuid"){if(!n)throw new Error(`Box class ${e} has a fourcc of 'uuid' but does not have a valid uuid. Please ensure it is defined correctly.`);if(n in t.uuid)throw new Error(`Box class ${e} has a uuid that is already registered. Please ensure it is unique.`);t.uuid[n]=i;continue}t.box[s]=i;continue}throw new Error(`Box class ${e} does not have a valid static fourcc, uuid, or grouping_type. Please ensure it is defined correctly.`)}return A.uuid={...t.uuid},A.sampleEntry={...t.sampleEntry},A.sampleGroupEntry={...t.sampleGroupEntry},A.box={...t.box},A}var Un={};function ja(r){return Object.entries(r).forEach(([t,e])=>Un[t]=e),Un}function sc(r){return $(r)}function $(r){let t="";for(let e=0;e<16;e++){let i=r.readUint8().toString(16);t+=i.length===1?"0"+i:i}return t}function D(r,t,e){let i,s,n=r.getPosition(),a=0,o;if(r.getEndPosition()-n<8)return l.debug("BoxParser","Not enough data in stream to parse the type and size of the box"),{code:0};if(e&&e<8)return l.debug("BoxParser","Not enough bytes left in the parent box to parse a new box"),{code:0};let h=r.readUint32(),c=r.readString(4);if(c.length!==4||!/^[\x20-\x7E]{4}$/.test(c))return l.error("BoxParser",`Invalid box type: '${c}'`),{code:-1,start:n,type:c};let d=c;if(l.debug("BoxParser","Found box of type '"+c+"' and size "+h+" at position "+n),a=8,c==="uuid"){if(r.getEndPosition()-r.getPosition()<16||e-a<16)return r.seek(n),l.debug("BoxParser","Not enough bytes left in the parent box to parse a UUID box"),{code:0};o=sc(r),a+=16,d=o}if(h===1){if(r.getEndPosition()-r.getPosition()<8||e&&e-a<8)return r.seek(n),l.warn("BoxParser",'Not enough data in stream to parse the extended size of the "'+c+'" box'),{code:0};s=h,h=r.readUint64(),a+=8}else if(h===0)if(e)h=e;else{if(c!=="mdat")return l.error("BoxParser","Unlimited box size not supported for type: '"+c+"'"),i=new u(h),i.type=c,{code:1,box:i,size:i.size};h=r.getEndPosition()-n}if(h!==0&&h<a)return l.error("BoxParser","Box of type "+c+" has an invalid size "+h+" (too small to be a box)"),{code:0,type:c,size:h,hdr_size:a,start:n};if(h!==0&&e&&h>e)return l.error("BoxParser","Box of type '"+c+"' has a size "+h+" greater than its container size "+e),{code:0,type:c,size:h,hdr_size:a,start:n};if(h!==0&&n+h>r.getEndPosition())return r.seek(n),l.info("BoxParser","Not enough data in stream to parse the entire '"+c+"' box"),{code:0,type:c,size:h,hdr_size:a,start:n,original_size:s};if(t)return{code:1,type:c,size:h,hdr_size:a,start:n};c in A.box?i=new A.box[c](h):c!=="uuid"?(l.warn("BoxParser",`Unknown box type: '${c}'`),i=new u(h),i.type=c,i.has_unparsed_data=!0):o in A.uuid?i=new A.uuid[o](h):(l.warn("BoxParser",`Unknown UUID box type: '${o}'`),i=new u(h),i.type=c,i.uuid=o,i.has_unparsed_data=!0),i.original_size=s,i.hdr_size=a,i.start=n,i.write===u.prototype.write&&i.type!=="mdat"&&(l.info("BoxParser","'"+d+"' box writing not yet implemented, keeping unparsed data in memory for later write"),i.parseDataAndRewind(r)),i.parse(r);let p=r.getPosition()-(i.start+i.size);return p<0?(l.warn("BoxParser","Parsing of box '"+d+"' did not read the entire indicated box data size (missing "+-p+" bytes), seeking forward"),r.seek(i.start+i.size)):p>0&&i.size!==0&&(l.error("BoxParser","Parsing of box '"+d+"' read "+p+" more bytes than the indicated box data size, seeking backwards"),r.seek(i.start+i.size)),{code:1,box:i,size:i.size}}var y=class extends u{write(r){if(this.size=0,this.writeHeader(r),this.boxes)for(let t=0;t<this.boxes.length;t++)this.boxes[t]&&(this.boxes[t].write(r),this.size+=this.boxes[t].size);l.debug("BoxWriter","Adjusting box "+this.type+" with new size "+this.size),r.adjustUint32(this.sizePosition,this.size)}print(r){this.printHeader(r);for(let t=0;t<this.boxes.length;t++)if(this.boxes[t]){let e=r.indent;r.indent+=" ",this.boxes[t].print(r),r.indent=e}}parse(r){let t;for(;r.getPosition()<this.start+this.size;)if(t=D(r,!1,this.size-(r.getPosition()-this.start)),t.code===1){let e=t.box;if(this.boxes||(this.boxes=[]),this.boxes.push(e),this.subBoxNames&&this.subBoxNames.indexOf(e.type)!==-1){let i=this.subBoxNames[this.subBoxNames.indexOf(e.type)]+"s";this[i]||(this[i]=[]),this[i].push(e)}else{let i=e.type!=="uuid"?e.type:e.uuid;this[i]?l.warn("ContainerBox",`Box of type ${i} already exists in container box ${this.type}.`):this[i]=e}}else return}},Z,O=(Z=class extends y{constructor(t,e,i){super(t),this.hdr_size=e,this.start=i}isVideo(){return!1}isAudio(){return!1}isSubtitle(){return!1}isMetadata(){return!1}isHint(){return!1}getCodec(){return this.type.replace(".","")}getWidth(){return""}getHeight(){return""}getChannelCount(){return""}getSampleRate(){return""}getSampleSize(){return""}parseHeader(t){t.readUint8Array(6),this.data_reference_index=t.readUint16(),this.hdr_size+=8}parse(t){this.parseHeader(t),this.data=t.readUint8Array(this.size-this.hdr_size)}parseDataAndRewind(t){this.parseHeader(t),this.data=t.readUint8Array(this.size-this.hdr_size),this.hdr_size-=8,t.seek(this.start+this.hdr_size)}parseFooter(t){super.parse(t)}writeHeader(t){this.size=8,super.writeHeader(t),t.writeUint8(0),t.writeUint8(0),t.writeUint8(0),t.writeUint8(0),t.writeUint8(0),t.writeUint8(0),t.writeUint16(this.data_reference_index)}writeFooter(t){if(this.boxes)for(let e=0;e<this.boxes.length;e++)this.boxes[e].write(t),this.size+=this.boxes[e].size;l.debug("BoxWriter","Adjusting box "+this.type+" with new size "+this.size),t.adjustUint32(this.sizePosition,this.size)}write(t){this.writeHeader(t),t.writeUint8Array(this.data),this.size+=this.data.length,l.debug("BoxWriter","Adjusting box "+this.type+" with new size "+this.size),t.adjustUint32(this.sizePosition,this.size)}},Z.registryId=Symbol.for("SampleEntryIdentifier"),Z),wn=class extends O{},j=class extends O{isMetadata(){return!0}},V=class extends O{isSubtitle(){return!0}},Kn=class extends O{},v=class extends O{parse(r){this.parseHeader(r),r.readUint16(),r.readUint16(),r.readUint32Array(3),this.width=r.readUint16(),this.height=r.readUint16(),this.horizresolution=r.readUint32(),this.vertresolution=r.readUint32(),r.readUint32(),this.frame_count=r.readUint16();let t=Math.min(31,r.readUint8());this.compressorname=r.readString(t),t<31&&r.readString(31-t),this.depth=r.readUint16(),r.readUint16(),this.parseFooter(r)}isVideo(){return!0}getWidth(){return this.width}getHeight(){return this.height}write(r){this.writeHeader(r),this.size+=70,r.writeUint16(0),r.writeUint16(0),r.writeUint32(0),r.writeUint32(0),r.writeUint32(0),r.writeUint16(this.width),r.writeUint16(this.height),r.writeUint32(this.horizresolution),r.writeUint32(this.vertresolution),r.writeUint32(0),r.writeUint16(this.frame_count),r.writeUint8(Math.min(31,this.compressorname.length)),r.writeString(this.compressorname,void 0,31),r.writeUint16(this.depth),r.writeInt16(-1),this.writeFooter(r)}},C=class extends O{parse(r){this.parseHeader(r),this.version=r.readUint16(),r.readUint16(),r.readUint32(),this.channel_count=r.readUint16(),this.samplesize=r.readUint16(),r.readUint16(),r.readUint16(),this.samplerate=r.readUint32()/65536,r.isofile?.ftyp?.major_brand.includes("qt")&&(this.version===1?this.extensions=r.readUint8Array(16):this.version===2&&(this.extensions=r.readUint8Array(36))),this.parseFooter(r)}isAudio(){return!0}getChannelCount(){return this.channel_count}getSampleRate(){return this.samplerate}getSampleSize(){return this.samplesize}write(r){this.writeHeader(r),this.size+=20,r.writeUint32(0),r.writeUint32(0),r.writeUint16(this.channel_count),r.writeUint16(this.samplesize),r.writeUint16(0),r.writeUint16(0),r.writeUint32(this.samplerate<<16),this.writeFooter(r)}},gn=class extends O{parse(r){this.parseHeader(r),this.parseFooter(r)}write(r){this.writeHeader(r),this.writeFooter(r)}},Ra=class extends Array{toString(){let r="<table class='inner-table'>";r+="<thead><tr><th>length</th><th>nalu_data</th></tr></thead>",r+="<tbody>";for(let t=0;t<this.length;t++){let e=this[t];r+="<tr>",r+="<td>"+e.length+"</td>",r+="<td>",r+=e.data.reduce(function(i,s){return i+s.toString(16).padStart(2,"0")},"0x"),r+="</td></tr>"}return r+="</tbody></table>",r}},tt,Xn=(tt=class extends u{constructor(...t){super(...t),this.box_name="AVCConfigurationBox"}parse(t){this.configurationVersion=t.readUint8(),this.AVCProfileIndication=t.readUint8(),this.profile_compatibility=t.readUint8(),this.AVCLevelIndication=t.readUint8(),this.lengthSizeMinusOne=t.readUint8()&3,this.nb_SPS_nalus=t.readUint8()&31;let e=this.size-this.hdr_size-6;this.SPS=new Ra;for(let i=0;i<this.nb_SPS_nalus;i++){let s=t.readUint16();this.SPS.push({length:s,data:t.readUint8Array(s)}),e-=2+s}this.nb_PPS_nalus=t.readUint8(),e--,this.PPS=new Ra;for(let i=0;i<this.nb_PPS_nalus;i++){let s=t.readUint16();this.PPS.push({length:s,data:t.readUint8Array(s)}),e-=2+s}e>0&&(this.ext=t.readUint8Array(e))}write(t){this.size=7;for(let e=0;e<this.SPS.length;e++)this.size+=2+this.SPS[e].length;for(let e=0;e<this.PPS.length;e++)this.size+=2+this.PPS[e].length;this.ext&&(this.size+=this.ext.length),this.writeHeader(t),t.writeUint8(this.configurationVersion),t.writeUint8(this.AVCProfileIndication),t.writeUint8(this.profile_compatibility),t.writeUint8(this.AVCLevelIndication),t.writeUint8(this.lengthSizeMinusOne+252),t.writeUint8(this.SPS.length+224);for(let e=0;e<this.SPS.length;e++)t.writeUint16(this.SPS[e].length),t.writeUint8Array(this.SPS[e].data);t.writeUint8(this.PPS.length);for(let e=0;e<this.PPS.length;e++)t.writeUint16(this.PPS[e].length),t.writeUint8Array(this.PPS[e].data);this.ext&&t.writeUint8Array(this.ext)}},tt.fourcc="avcC",tt),et,dn=(et=class extends u{constructor(...t){super(...t),this.box_name="MediaDataBox"}},et.fourcc="mdat",et),it,$a=(it=class extends u{constructor(...t){super(...t),this.box_name="ItemDataBox"}},it.fourcc="idat",it),st,qa=(st=class extends u{constructor(...t){super(...t),this.box_name="FreeSpaceBox"}},st.fourcc="free",st),rt,Ya=(rt=class extends u{constructor(...t){super(...t),this.box_name="FreeSpaceBox"}},rt.fourcc="skip",rt),nt,Jn=(nt=class extends f{constructor(...t){super(...t),this.box_name="HintMediaHeaderBox"}},nt.fourcc="hmhd",nt),at,fn=(at=class extends f{constructor(...t){super(...t),this.box_name="NullMediaHeaderBox"}},at.fourcc="nmhd",at),ot,Wa=(ot=class extends f{constructor(...t){super(...t),this.box_name="ObjectDescriptorBox"}},ot.fourcc="iods",ot),ht,Ka=(ht=class extends f{constructor(...t){super(...t),this.box_name="XMLBox"}},ht.fourcc="xml ",ht),ct,Xa=(ct=class extends f{constructor(...t){super(...t),this.box_name="BinaryXMLBox"}},ct.fourcc="bxml",ct),lt,Ja=(lt=class extends f{constructor(...t){super(...t),this.box_name="ItemProtectionBox",this.sinfs=[]}get protections(){return this.sinfs}},lt.fourcc="ipro",lt),dt,pn=(dt=class extends y{constructor(...t){super(...t),this.box_name="MovieBox",this.traks=[],this.psshs=[],this.subBoxNames=["trak","pssh"]}},dt.fourcc="moov",dt),ft,Qn=(ft=class extends y{constructor(...t){super(...t),this.box_name="TrackBox",this.samples=[]}},ft.fourcc="trak",ft),pt,Qa=(pt=class extends y{constructor(...t){super(...t),this.box_name="EditBox"}},pt.fourcc="edts",pt),ut,Zn=(ut=class extends y{constructor(...t){super(...t),this.box_name="MediaBox"}},ut.fourcc="mdia",ut),_t,ta=(_t=class extends y{constructor(...t){super(...t),this.box_name="MediaInformationBox"}},_t.fourcc="minf",_t),xt,ea=(xt=class extends y{constructor(...t){super(...t),this.box_name="DataInformationBox"}},xt.fourcc="dinf",xt),mt,ia=(mt=class extends y{constructor(...t){super(...t),this.box_name="SampleTableBox",this.sgpds=[],this.sbgps=[],this.subBoxNames=["sgpd","sbgp"]}},mt.fourcc="stbl",mt),gt,En=(gt=class extends y{constructor(...t){super(...t),this.box_name="MovieExtendsBox",this.trexs=[],this.subBoxNames=["trex"]}},gt.fourcc="mvex",gt),yt,sa=(yt=class extends y{constructor(...t){super(...t),this.box_name="MovieFragmentBox",this.trafs=[],this.subBoxNames=["traf"]}},yt.fourcc="moof",yt),bt,ra=(bt=class extends y{constructor(...t){super(...t),this.box_name="TrackFragmentBox",this.truns=[],this.sgpds=[],this.sbgps=[],this.subBoxNames=["trun","sgpd","sbgp"]}},bt.fourcc="traf",bt),vt,Za=(vt=class extends y{constructor(...t){super(...t),this.box_name="VTTCueBox"}},vt.fourcc="vttc",vt),St,to=(St=class extends y{constructor(...t){super(...t),this.box_name="MovieFragmentRandomAccessBox",this.tfras=[],this.subBoxNames=["tfra"]}},St.fourcc="mfra",St),Bt,eo=(Bt=class extends y{constructor(...t){super(...t),this.box_name="AdditionalMetadataContainerBox"}},Bt.fourcc="meco",Bt),Ut,io=(Ut=class extends y{constructor(...t){super(...t),this.box_name="trackhintinformation",this.subBoxNames=["sdp ","rtp "]}},Ut.fourcc="hnti",Ut),wt,so=(wt=class extends y{constructor(...t){super(...t),this.box_name="hintstatisticsbox",this.maxrs=[],this.subBoxNames=["maxr"]}},wt.fourcc="hinf",wt),Et,ro=(Et=class extends y{constructor(...t){super(...t),this.box_name="SubTrackBox"}},Et.fourcc="strk",Et),zt,no=(zt=class extends y{constructor(...t){super(...t),this.box_name="SubTrackDefinitionBox"}},zt.fourcc="strd",zt),kt,ao=(kt=class extends y{constructor(...t){super(...t),this.box_name="ProtectionSchemeInfoBox"}},kt.fourcc="sinf",kt),It,oo=(It=class extends y{constructor(...t){super(...t),this.box_name="RestrictedSchemeInfoBox"}},It.fourcc="rinf",It),Ct,ho=(Ct=class extends y{constructor(...t){super(...t),this.box_name="SchemeInformationBox"}},Ct.fourcc="schi",Ct),Pt,co=(Pt=class extends y{constructor(...t){super(...t),this.box_name="TrackGroupBox"}},Pt.fourcc="trgr",Pt),Tt,lo=(Tt=class extends y{constructor(...t){super(...t),this.box_name="UserDataBox",this.kinds=[],this.strks=[],this.subBoxNames=["kind","strk"]}},Tt.fourcc="udta",Tt),At,fo=(At=class extends y{constructor(...t){super(...t),this.box_name="ItemPropertiesBox",this.ipmas=[],this.subBoxNames=["ipma"]}},At.fourcc="iprp",At),Ft,po=(Ft=class extends y{constructor(...t){super(...t),this.box_name="ItemPropertyContainerBox",this.hvcCs=[],this.ispes=[],this.claps=[],this.irots=[],this.subBoxNames=["hvcC","ispe","clap","irot"]}},Ft.fourcc="ipco",Ft),Dt,uo=(Dt=class extends y{constructor(...t){super(...t),this.box_name="GroupsListBox"}},Dt.fourcc="grpl",Dt),Lt,_o=(Lt=class extends y{constructor(...t){super(...t),this.box_name="J2KHeaderInfoBox"}},Lt.fourcc="j2kH",Lt),Ht,xo=(Ht=class extends y{constructor(...t){super(...t),this.box_name="ExtendedTypeBox",this.tycos=[],this.subBoxNames=["tyco"]}},Ht.fourcc="etyp",Ht),Ot,mo=(Ot=class extends y{constructor(...t){super(...t),this.box_name="ProjectedOmniVideoBox",this.subBoxNames=["prfr"]}},Ot.fourcc="povd",Ot),Mt,na=(Mt=class extends f{constructor(...t){super(...t),this.box_name="DataReferenceBox"}parse(t){this.parseFullHeader(t),this.entries=[];let e=t.readUint32();for(let i=0;i<e;i++){let s=D(t,!1,this.size-(t.getPosition()-this.start));if(s.code===1){let n=s.box;this.entries.push(n)}else return}}write(t){this.version=0,this.flags=0,this.size=4,this.writeHeader(t),t.writeUint32(this.entries.length);for(let e=0;e<this.entries.length;e++)this.entries[e].write(t),this.size+=this.entries[e].size;l.debug("BoxWriter","Adjusting box "+this.type+" with new size "+this.size),t.adjustUint32(this.sizePosition,this.size)}},Mt.fourcc="dref",Mt),Rt,aa=(Rt=class extends f{constructor(...t){super(...t),this.box_name="ExtendedLanguageBox"}parse(t){this.parseFullHeader(t),this.extended_language=t.readString(this.size-this.hdr_size)}write(t){this.version=0,this.flags=0,this.size=this.extended_language.length,this.writeHeader(t),t.writeString(this.extended_language)}},Rt.fourcc="elng",Rt),Nt,oa=(Nt=class extends u{constructor(...t){super(...t),this.box_name="FileTypeBox"}parse(t){let e=this.size-this.hdr_size;this.major_brand=t.readString(4),this.minor_version=t.readUint32();let i=String.fromCharCode(this.minor_version>>24,this.minor_version>>16&255,this.minor_version>>8&255,this.minor_version&255);i.match("[a-zA-Z0-9]{4}")&&(this.minor_version=i),e-=8,this.compatible_brands=[];let s=0;for(;e>=4;)this.compatible_brands[s]=t.readString(4),e-=4,s++}write(t){this.size=8+4*this.compatible_brands.length,this.writeHeader(t),t.writeString(this.major_brand,void 0,4),typeof this.minor_version=="number"?t.writeUint32(this.minor_version):t.writeString(this.minor_version,void 0,4);for(let e=0;e<this.compatible_brands.length;e++)t.writeString(this.compatible_brands[e],void 0,4)}},Nt.fourcc="ftyp",Nt),Vt,ha=(Vt=class extends f{constructor(...t){super(...t),this.box_name="HandlerBox"}parse(t){if(this.parseFullHeader(t),this.version===0&&(t.readUint32(),this.handler=t.readString(4),t.readUint32Array(3),!this.isEndOfBox(t))){let e=this.start+this.size-t.getPosition();this.name=t.readCString();let i=this.start+this.size-1;t.seek(i),t.readUint8()!==0&&e>1&&(l.info("BoxParser","Warning: hdlr name is not null-terminated, possibly length-prefixed string. Trimming first byte."),this.name=this.name.slice(1))}}write(t){this.size=20+this.name.length+1,this.version=0,this.flags=0,this.writeHeader(t),t.writeUint32(0),t.writeString(this.handler,void 0,4),t.writeUint32Array([0,0,0]),t.writeCString(this.name)}},Vt.fourcc="hdlr",Vt),Gt,ca=(Gt=class extends u{constructor(...t){super(...t),this.box_name="HEVCConfigurationBox"}parse(t){this.configurationVersion=t.readUint8();let e=t.readUint8();this.general_profile_space=e>>6,this.general_tier_flag=(e&32)>>5,this.general_profile_idc=e&31,this.general_profile_compatibility=t.readUint32(),this.general_constraint_indicator=t.readUint8Array(6),this.general_level_idc=t.readUint8(),this.min_spatial_segmentation_idc=t.readUint16()&4095,this.parallelismType=t.readUint8()&3,this.chroma_format_idc=t.readUint8()&3,this.bit_depth_luma_minus8=t.readUint8()&7,this.bit_depth_chroma_minus8=t.readUint8()&7,this.avgFrameRate=t.readUint16(),e=t.readUint8(),this.constantFrameRate=e>>6,this.numTemporalLayers=(e&13)>>3,this.temporalIdNested=(e&4)>>2,this.lengthSizeMinusOne=e&3,this.nalu_arrays=[];let i=t.readUint8();for(let s=0;s<i;s++){let n=[];this.nalu_arrays.push(n),e=t.readUint8(),n.completeness=(e&128)>>7,n.nalu_type=e&63;let a=t.readUint16();for(let o=0;o<a;o++){let h=t.readUint16();n.push({data:t.readUint8Array(h)})}}}write(t){this.size=23;for(let e=0;e<this.nalu_arrays.length;e++){this.size+=3;for(let i=0;i<this.nalu_arrays[e].length;i++)this.size+=2+this.nalu_arrays[e][i].data.length}this.writeHeader(t),t.writeUint8(this.configurationVersion),t.writeUint8((this.general_profile_space<<6)+(this.general_tier_flag<<5)+this.general_profile_idc),t.writeUint32(this.general_profile_compatibility),t.writeUint8Array(this.general_constraint_indicator),t.writeUint8(this.general_level_idc),t.writeUint16(this.min_spatial_segmentation_idc+(15<<24)),t.writeUint8(this.parallelismType+252),t.writeUint8(this.chroma_format_idc+252),t.writeUint8(this.bit_depth_luma_minus8+248),t.writeUint8(this.bit_depth_chroma_minus8+248),t.writeUint16(this.avgFrameRate),t.writeUint8((this.constantFrameRate<<6)+(this.numTemporalLayers<<3)+(this.temporalIdNested<<2)+this.lengthSizeMinusOne),t.writeUint8(this.nalu_arrays.length);for(let e=0;e<this.nalu_arrays.length;e++){t.writeUint8((this.nalu_arrays[e].completeness<<7)+this.nalu_arrays[e].nalu_type),t.writeUint16(this.nalu_arrays[e].length);for(let i=0;i<this.nalu_arrays[e].length;i++)t.writeUint16(this.nalu_arrays[e][i].data.length),t.writeUint8Array(this.nalu_arrays[e][i].data)}}},Gt.fourcc="hvcC",Gt),jt,la=(jt=class extends f{constructor(...t){super(...t),this.box_name="MediaHeaderBox"}parse(t){this.parseFullHeader(t),this.version===1?(this.creation_time=t.readUint64(),this.modification_time=t.readUint64(),this.timescale=t.readUint32(),this.duration=t.readUint64()):(this.creation_time=t.readUint32(),this.modification_time=t.readUint32(),this.timescale=t.readUint32(),this.duration=t.readUint32()),this.parseLanguage(t),t.readUint16()}write(t){let e=this.modification_time>E||this.creation_time>E||this.duration>E||this.version===1;this.version=e?1:0,this.size=20,this.size+=e?12:0,this.flags=0,this.writeHeader(t),e?(t.writeUint64(this.creation_time),t.writeUint64(this.modification_time),t.writeUint32(this.timescale),t.writeUint64(this.duration)):(t.writeUint32(this.creation_time),t.writeUint32(this.modification_time),t.writeUint32(this.timescale),t.writeUint32(this.duration)),t.writeUint16(this.language),t.writeUint16(0)}},jt.fourcc="mdhd",jt),$t,da=($t=class extends f{constructor(...t){super(...t),this.box_name="MovieExtendsHeaderBox"}parse(t){this.parseFullHeader(t),this.flags&1&&(l.warn("BoxParser","mehd box incorrectly uses flags set to 1, converting version to 1"),this.version=1),this.version===1?this.fragment_duration=t.readUint64():this.fragment_duration=t.readUint32()}write(t){let e=this.fragment_duration>E||this.version===1;this.version=e?1:0,this.size=4,this.size+=e?4:0,this.flags=0,this.writeHeader(t),e?t.writeUint64(this.fragment_duration):t.writeUint32(this.fragment_duration)}},$t.fourcc="mehd",$t),qt,go=(qt=class extends f{constructor(...t){super(...t),this.box_name="ItemInfoEntry"}parse(t){if(this.parseFullHeader(t),(this.version===0||this.version===1)&&(this.item_ID=t.readUint16(),this.item_protection_index=t.readUint16(),this.item_name=t.readCString(),this.content_type=t.readCString(),this.isEndOfBox(t)||(this.content_encoding=t.readCString())),this.version===1){this.extension_type=t.readString(4),l.warn("BoxParser","Cannot parse extension type"),t.seek(this.start+this.size);return}this.version>=2&&(this.version===2?this.item_ID=t.readUint16():this.version===3&&(this.item_ID=t.readUint32()),this.item_protection_index=t.readUint16(),this.item_type=t.readString(4),this.item_name=t.readCString(),this.item_type==="mime"?(this.content_type=t.readCString(),this.content_encoding=t.readCString()):this.item_type==="uri "&&(this.item_uri_type=t.readCString()))}},qt.fourcc="infe",qt),Yt,yo=(Yt=class extends f{constructor(...t){super(...t),this.box_name="ItemInfoBox"}parse(t){this.parseFullHeader(t),this.version===0?this.entry_count=t.readUint16():this.entry_count=t.readUint32(),this.item_infos=[];for(let e=0;e<this.entry_count;e++){let i=D(t,!1,this.size-(t.getPosition()-this.start));if(i.code===1){let s=i.box;s.type==="infe"?this.item_infos[e]=s:l.error("BoxParser","Expected 'infe' box, got "+i.box.type,t.isofile)}else return}}},Yt.fourcc="iinf",Yt),Wt,bo=(Wt=class extends f{constructor(...t){super(...t),this.box_name="ItemLocationBox"}parse(t){this.parseFullHeader(t);let e;e=t.readUint8(),this.offset_size=e>>4&15,this.length_size=e&15,e=t.readUint8(),this.base_offset_size=e>>4&15,this.version===1||this.version===2?this.index_size=e&15:this.index_size=0,this.items=[];let i=0;if(this.version<2)i=t.readUint16();else if(this.version===2)i=t.readUint32();else throw new Error("version of iloc box not supported");for(let s=0;s<i;s++){let n=0,a=0,o=0;if(this.version<2)n=t.readUint16();else if(this.version===2)n=t.readUint32();else throw new Error("version of iloc box not supported");this.version===1||this.version===2?a=t.readUint16()&15:a=0;let h=t.readUint16();switch(this.base_offset_size){case 0:o=0;break;case 4:o=t.readUint32();break;case 8:o=t.readUint64();break;default:throw new Error("Error reading base offset size")}let c=[],d=t.readUint16();for(let p=0;p<d;p++){let _=0,x=0,b=0;if(this.version===1||this.version===2)switch(this.index_size){case 0:_=0;break;case 4:_=t.readUint32();break;case 8:_=t.readUint64();break;default:throw new Error("Error reading extent index")}switch(this.offset_size){case 0:x=0;break;case 4:x=t.readUint32();break;case 8:x=t.readUint64();break;default:throw new Error("Error reading extent index")}switch(this.length_size){case 0:b=0;break;case 4:b=t.readUint32();break;case 8:b=t.readUint64();break;default:throw new Error("Error reading extent index")}c.push({extent_index:_,extent_length:b,extent_offset:x})}this.items.push({base_offset:o,construction_method:a,item_ID:n,data_reference_index:h,extents:c})}}},Wt.fourcc="iloc",Wt),rc={auxl:"Auxiliary image item",base:"Pre-derived image item base",cdsc:"Item describes referenced item",dimg:"Derived image item",dpnd:"Item coding dependency",eroi:"Region",evir:"EVC slice",exbl:"Scalable image item","fdl ":"File delivery",font:"Font item",iloc:"Item data location",mask:"Region mask",mint:"Data integrity",pred:"Predictively coded item",prem:"Pre-multiplied item",tbas:"HEVC tile track base item",text:"Text item",thmb:"Thumbnail image item"},G,vo=(G=class extends f{constructor(...t){super(...t),this.box_name="ItemReferenceBox",this.references=[]}parse(t){for(this.parseFullHeader(t),this.references=[];t.getPosition()<this.start+this.size;){let e=D(t,!0,this.size-(t.getPosition()-this.start));if(e.code===1){let i="Unknown item reference";G.allowed_types.includes(e.type)?i=rc[e.type]:l.warn("BoxParser",`Unknown item reference type: '${e.type}'`);let s=this.version===0?new Gn(e.type,e.size,i,e.hdr_size,e.start):new jn(e.type,e.size,i,e.hdr_size,e.start);s.write===u.prototype.write&&s.type!=="mdat"&&(l.warn("BoxParser",s.type+" box writing not yet implemented, keeping unparsed data in memory for later write"),s.parseDataAndRewind(t)),s.parse(t),this.references.push(s)}else return}}},G.fourcc="iref",G.allowed_types=["auxl","base","cdsc","dimg","dpnd","eroi","evir","exbl","fdl ","font","iloc","mask","mint","pred","prem","tbas","text","thmb"],G),Kt,So=(Kt=class extends f{constructor(...t){super(...t),this.box_name="PrimaryItemBox"}parse(t){this.parseFullHeader(t),this.version===0?this.item_id=t.readUint16():this.item_id=t.readUint32()}},Kt.fourcc="pitm",Kt),Xt,Bo=(Xt=class extends f{constructor(...t){super(...t),this.box_name="MetaBox",this.isQT=!1}parse(t){let e=t.getPosition();if(this.size>8){switch(t.readUint32(),t.readString(4)){case"hdlr":case"mhdr":case"keys":case"ilst":case"ctry":case"lang":this.isQT=!0;break;default:break}t.seek(e)}this.isQT||this.parseFullHeader(t),y.prototype.parse.call(this,t)}},Xt.fourcc="meta",Xt),Jt,fa=(Jt=class extends f{constructor(...t){super(...t),this.box_name="MovieFragmentHeaderBox"}parse(t){this.parseFullHeader(t),this.sequence_number=t.readUint32()}write(t){this.version=0,this.flags=0,this.size=4,this.writeHeader(t),t.writeUint32(this.sequence_number)}},Jt.fourcc="mfhd",Jt),Qt,pa=(Qt=class extends f{constructor(...t){super(...t),this.box_name="MovieHeaderBox"}parse(t){this.parseFullHeader(t),this.version===1?(this.creation_time=t.readUint64(),this.modification_time=t.readUint64(),this.timescale=t.readUint32(),this.duration=t.readUint64()):(this.creation_time=t.readUint32(),this.modification_time=t.readUint32(),this.timescale=t.readUint32(),this.duration=t.readUint32()),this.rate=t.readUint32(),this.volume=t.readUint16()>>8,t.readUint16(),t.readUint32Array(2),this.matrix=t.readInt32Array(9),t.readUint32Array(6),this.next_track_id=t.readUint32()}write(t){let e=this.modification_time>E||this.creation_time>E||this.duration>E||this.version===1;this.version=e?1:0,this.size=96,this.size+=e?12:0,this.flags=0,this.writeHeader(t),e?(t.writeUint64(this.creation_time),t.writeUint64(this.modification_time),t.writeUint32(this.timescale),t.writeUint64(this.duration)):(t.writeUint32(this.creation_time),t.writeUint32(this.modification_time),t.writeUint32(this.timescale),t.writeUint32(this.duration)),t.writeUint32(this.rate),t.writeUint16(this.volume<<8),t.writeUint16(0),t.writeUint32(0),t.writeUint32(0),t.writeInt32Array(this.matrix),t.writeUint32(0),t.writeUint32(0),t.writeUint32(0),t.writeUint32(0),t.writeUint32(0),t.writeUint32(0),t.writeUint32(this.next_track_id)}print(t){super.printHeader(t),t.log(t.indent+"creation_time: "+this.creation_time),t.log(t.indent+"modification_time: "+this.modification_time),t.log(t.indent+"timescale: "+this.timescale),t.log(t.indent+"duration: "+this.duration),t.log(t.indent+"rate: "+this.rate),t.log(t.indent+"volume: "+(this.volume>>8)),t.log(t.indent+"matrix: "+this.matrix.join(", ")),t.log(t.indent+"next_track_id: "+this.next_track_id)}},Qt.fourcc="mvhd",Qt),Zt,Uo=(Zt=class extends j{parse(t){this.parseHeader(t),this.content_encoding=t.readCString(),this.mime_format=t.readCString(),this.parseFooter(t)}},Zt.fourcc="mett",Zt),te,wo=(te=class extends j{parse(t){this.parseHeader(t),this.content_encoding=t.readCString(),this.namespace=t.readCString(),this.schema_location=t.readCString(),this.parseFooter(t)}},te.fourcc="metx",te),ee,Eo=(ee=class extends u{constructor(...t){super(...t),this.box_name="AV1CodecConfigurationBox"}parse(t){let e=t.readUint8();if((e>>7&1)!==1){l.error("BoxParser","av1C marker problem",t.isofile);return}if(this.version=e&127,this.version!==1){l.error("BoxParser","av1C version "+this.version+" not supported",t.isofile);return}if(e=t.readUint8(),this.seq_profile=e>>5&7,this.seq_level_idx_0=e&31,e=t.readUint8(),this.seq_tier_0=e>>7&1,this.high_bitdepth=e>>6&1,this.twelve_bit=e>>5&1,this.monochrome=e>>4&1,this.chroma_subsampling_x=e>>3&1,this.chroma_subsampling_y=e>>2&1,this.chroma_sample_position=e&3,e=t.readUint8(),this.reserved_1=e>>5&7,this.reserved_1!==0){l.error("BoxParser","av1C reserved_1 parsing problem",t.isofile);return}if(this.initial_presentation_delay_present=e>>4&1,this.initial_presentation_delay_present===1)this.initial_presentation_delay_minus_one=e&15;else if(this.reserved_2=e&15,this.reserved_2!==0){l.error("BoxParser","av1C reserved_2 parsing problem",t.isofile);return}let i=this.size-this.hdr_size-4;this.configOBUs=t.readUint8Array(i)}},ee.fourcc="av1C",ee),ie,zo=(ie=class extends f{constructor(...t){super(...t),this.box_name="ElementaryStreamDescriptorBox"}parse(t){this.parseFullHeader(t);let e=t.readUint8Array(this.size-this.hdr_size);if("MPEG4DescriptorParser"in Un){let i=new Un.MPEG4DescriptorParser;this.esd=i.parseOneDescriptor(new w(e.buffer,0))}}},ie.fourcc="esds",ie),se,ko=(se=class extends y{constructor(...t){super(...t),this.box_name="siDecompressionParamBox"}},se.fourcc="wave",se),re,Io=(re=class extends u{constructor(...t){super(...t),this.box_name="LCEVCConfigurationBox"}parse(t){if(this.configurationVersion=t.readUint8(),this.configurationVersion!==1){l.error("BoxParser","lvcC version "+this.configurationVersion+" not supported",t.isofile);return}this.LCEVCProfileIndication=t.readUint8(),this.LCEVCLevelIndication=t.readUint8();let e=t.readUint8();this.chroma_format_idc=e>>6&3,this.bit_depth_luma_minus8=e>>3&7,this.bit_depth_chroma_minus8=e&7,e=t.readUint8(),this.lengthSizeMinusOne=e>>6&3;let i=e&63;if(i!==63){l.error("BoxParser","lvcC reserved parsing problem",t.isofile);return}if(this.pic_width_in_luma_samples=t.readUint32(),this.pic_height_in_luma_samples=t.readUint32(),e=t.readUint8(),this.sc_in_stream=e>>7&1,this.gc_in_stream=e>>6&1,this.ai_in_stream=e>>5&1,i=e&31,i!==31){l.error("BoxParser","lvcC reserved parsing problem",t.isofile);return}this.nalu_arrays=[];let s=t.readUint8();for(let n=0;n<s;n++){let a=[];if(this.nalu_arrays.push(a),e=t.readUint8(),i=e>>6&3,i!==0){l.error("BoxParser","lvcC reserved parsing problem",t.isofile);return}a.nalu_type=e&63;let o=t.readUint16();for(let h=0;h<o;h++){let c=t.readUint16();a.push({data:t.readUint8Array(c)})}}}},re.fourcc="lvcC",re),ne,Co=(ne=class extends f{constructor(...t){super(...t),this.box_name="VPCodecConfigurationRecord"}parse(t){if(this.parseFullHeader(t),this.version===1){this.profile=t.readUint8(),this.level=t.readUint8();let e=t.readUint8();this.bitDepth=e>>4,this.chromaSubsampling=e>>1&7,this.videoFullRangeFlag=e&1,this.colourPrimaries=t.readUint8(),this.transferCharacteristics=t.readUint8(),this.matrixCoefficients=t.readUint8(),this.codecIntializationDataSize=t.readUint16(),this.codecIntializationData=t.readUint8Array(this.codecIntializationDataSize)}else{this.profile=t.readUint8(),this.level=t.readUint8();let e=t.readUint8();this.bitDepth=e>>4&15,this.colorSpace=e&15,e=t.readUint8(),this.chromaSubsampling=e>>4&15,this.transferFunction=e>>1&7,this.videoFullRangeFlag=e&1,this.codecIntializationDataSize=t.readUint16(),this.codecIntializationData=t.readUint8Array(this.codecIntializationDataSize)}}},ne.fourcc="vpcC",ne),ae,Po=(ae=class extends f{constructor(...t){super(...t),this.box_name="VvcConfigurationBox"}parse(t){this.parseFullHeader(t);let e={held_bits:void 0,num_held_bits:0,stream_read_1_bytes:function(a){this.held_bits=a.readUint8(),this.num_held_bits=8},stream_read_2_bytes:function(a){this.held_bits=a.readUint16(),this.num_held_bits=16},extract_bits:function(a){let o=this.held_bits>>this.num_held_bits-a&(1<<a)-1;return this.num_held_bits-=a,o}};if(e.stream_read_1_bytes(t),e.extract_bits(5),this.lengthSizeMinusOne=e.extract_bits(2),this.ptl_present_flag=e.extract_bits(1),this.ptl_present_flag){if(e.stream_read_2_bytes(t),this.ols_idx=e.extract_bits(9),this.num_sublayers=e.extract_bits(3),this.constant_frame_rate=e.extract_bits(2),this.chroma_format_idc=e.extract_bits(2),e.stream_read_1_bytes(t),this.bit_depth_minus8=e.extract_bits(3),e.extract_bits(5),e.stream_read_2_bytes(t),e.extract_bits(2),this.num_bytes_constraint_info=e.extract_bits(6),this.general_profile_idc=e.extract_bits(7),this.general_tier_flag=e.extract_bits(1),this.general_level_idc=t.readUint8(),e.stream_read_1_bytes(t),this.ptl_frame_only_constraint_flag=e.extract_bits(1),this.ptl_multilayer_enabled_flag=e.extract_bits(1),this.general_constraint_info=new Uint8Array(this.num_bytes_constraint_info),this.num_bytes_constraint_info){for(let a=0;a<this.num_bytes_constraint_info-1;a++){let o=e.extract_bits(6);e.stream_read_1_bytes(t);let h=e.extract_bits(2);this.general_constraint_info[a]=o<<2|h}this.general_constraint_info[this.num_bytes_constraint_info-1]=e.extract_bits(6)}else e.extract_bits(6);if(this.num_sublayers>1){e.stream_read_1_bytes(t),this.ptl_sublayer_present_mask=0;for(let a=this.num_sublayers-2;a>=0;--a){let o=e.extract_bits(1);this.ptl_sublayer_present_mask|=o<<a}for(let a=this.num_sublayers;a<=8&&this.num_sublayers>1;++a)e.extract_bits(1);this.sublayer_level_idc=[];for(let a=this.num_sublayers-2;a>=0;--a)this.ptl_sublayer_present_mask&1<<a&&(this.sublayer_level_idc[a]=t.readUint8())}if(this.ptl_num_sub_profiles=t.readUint8(),this.general_sub_profile_idc=[],this.ptl_num_sub_profiles)for(let a=0;a<this.ptl_num_sub_profiles;a++)this.general_sub_profile_idc.push(t.readUint32());this.max_picture_width=t.readUint16(),this.max_picture_height=t.readUint16(),this.avg_frame_rate=t.readUint16()}let i=12,s=13;this.nalu_arrays=[];let n=t.readUint8();for(let a=0;a<n;a++){let o=[];this.nalu_arrays.push(o),e.stream_read_1_bytes(t),o.completeness=e.extract_bits(1),e.extract_bits(2),o.nalu_type=e.extract_bits(5);let h=1;o.nalu_type!==s&&o.nalu_type!==i&&(h=t.readUint16());for(let c=0;c<h;c++){let d=t.readUint16();o.push({data:t.readUint8Array(d),length:d})}}}},ae.fourcc="vvcC",ae),oe,To=(oe=class extends u{constructor(...t){super(...t),this.box_name="ColourInformationBox"}parse(t){if(this.colour_type=t.readString(4),this.colour_type==="nclx"){this.colour_primaries=t.readUint16(),this.transfer_characteristics=t.readUint16(),this.matrix_coefficients=t.readUint16();let e=t.readUint8();this.full_range_flag=e>>7}else this.colour_type==="rICC"?this.ICC_profile=t.readUint8Array(this.size-4):this.colour_type==="prof"&&(this.ICC_profile=t.readUint8Array(this.size-4))}},oe.fourcc="colr",oe);function X(r,t){let e=Number(r).toString(16);for(t=typeof t>"u"?2:t;e.length<t;)e="0"+e;return e}var In=class extends v{getCodec(){let r=super.getCodec();return this.avcC?`${r}.${X(this.avcC.AVCProfileIndication)}${X(this.avcC.profile_compatibility)}${X(this.avcC.AVCLevelIndication)}`:r}},he,Ao=(he=class extends In{constructor(...t){super(...t),this.box_name="AVCSampleEntry"}},he.fourcc="avc1",he),ce,Fo=(ce=class extends In{constructor(...t){super(...t),this.box_name="AVC2SampleEntry"}},ce.fourcc="avc2",ce),le,Do=(le=class extends In{constructor(...t){super(...t),this.box_name="AVCSampleEntry"}},le.fourcc="avc3",le),de,Lo=(de=class extends In{constructor(...t){super(...t),this.box_name="AVC2SampleEntry"}},de.fourcc="avc4",de),fe,Ho=(fe=class extends v{constructor(...t){super(...t),this.box_name="AV1SampleEntry"}getCodec(){let t=super.getCodec(),e=this.av1C.seq_level_idx_0,i=e<10?"0"+e:e,s;return this.av1C.seq_profile===2&&this.av1C.high_bitdepth===1?s=this.av1C.twelve_bit===1?"12":"10":this.av1C.seq_profile<=2&&(s=this.av1C.high_bitdepth===1?"10":"08"),t+"."+this.av1C.seq_profile+"."+i+(this.av1C.seq_tier_0?"H":"M")+"."+s}},fe.fourcc="av01",fe),pe,Oo=(pe=class extends v{},pe.fourcc="dav1",pe),Cn=class extends v{getCodec(){let r=super.getCodec();if(this.hvcC){switch(r+=".",this.hvcC.general_profile_space){case 0:r+="";break;case 1:r+="A";break;case 2:r+="B";break;case 3:r+="C";break}r+=this.hvcC.general_profile_idc,r+=".";let t=this.hvcC.general_profile_compatibility,e=0;for(let n=0;n<32&&(e|=t&1,n!==31);n++)e<<=1,t>>=1;r+=X(e,0),r+=".",this.hvcC.general_tier_flag===0?r+="L":r+="H",r+=this.hvcC.general_level_idc;let i=!1,s="";for(let n=5;n>=0;n--)(this.hvcC.general_constraint_indicator[n]||i)&&(s="."+X(this.hvcC.general_constraint_indicator[n],0)+s,i=!0);r+=s}return r}},ue,Mo=(ue=class extends Cn{constructor(...t){super(...t),this.box_name="HEVCSampleEntry"}},ue.fourcc="hvc1",ue),_e,Ro=(_e=class extends Cn{},_e.fourcc="hvc2",_e),xe,No=(xe=class extends Cn{constructor(...t){super(...t),this.box_name="HEVCSampleEntry",this.colrs=[],this.subBoxNames=["colr"]}},xe.fourcc="hev1",xe),me,Vo=(me=class extends Cn{},me.fourcc="hev2",me),ge,Go=(ge=class extends v{constructor(...t){super(...t),this.box_name="HEVCTileSampleSampleEntry"}},ge.fourcc="hvt1",ge),ye,jo=(ye=class extends v{constructor(...t){super(...t),this.box_name="LHEVCSampleEntry"}},ye.fourcc="lhe1",ye),be,$o=(be=class extends v{constructor(...t){super(...t),this.box_name="LHEVCSampleEntry"}},be.fourcc="lhv1",be),ve,qo=(ve=class extends v{constructor(...t){super(...t),this.box_name="LCEVCSampleEntry"}getCodec(){let t=super.getCodec();return this.lvcC&&(t+=".",t+="vprf",t+=this.lvcC.LCEVCProfileIndication,t+=".",t+="vlev",t+=this.lvcC.LCEVCLevelIndication),t}},ve.fourcc="lvc1",ve),Se,Yo=(Se=class extends v{},Se.fourcc="dvh1",Se),Be,Wo=(Be=class extends v{},Be.fourcc="dvhe",Be),Ko=class extends v{getCodec(){let r=super.getCodec();if(this.vvcC){r+="."+this.vvcC.general_profile_idc,this.vvcC.general_tier_flag?r+=".H":r+=".L",r+=this.vvcC.general_level_idc;let t="";if(this.vvcC.general_constraint_info){let e=[],i=0;i|=this.vvcC.ptl_frame_only_constraint_flag<<7,i|=this.vvcC.ptl_multilayer_enabled_flag<<6;let s;for(let n=0;n<this.vvcC.general_constraint_info.length;++n)i|=this.vvcC.general_constraint_info[n]>>2&63,e.push(i),i&&(s=n),i=this.vvcC.general_constraint_info[n]>>2&3;if(s===void 0)t=".CA";else{t=".C";let n="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",a=0,o=0;for(let h=0;h<=s;++h)for(a=a<<8|e[h],o+=8;o>=5;){let c=a>>o-5&31;t+=n[c],o-=5,a&=(1<<o)-1}o&&(a<<=5-o,t+=n[a&31])}}r+=t}return r}},Ue,Xo=(Ue=class extends Ko{constructor(...t){super(...t),this.box_name="VvcSampleEntry"}},Ue.fourcc="vvc1",Ue),we,Jo=(we=class extends Ko{constructor(...t){super(...t),this.box_name="VvcSampleEntry"}},we.fourcc="vvi1",we),Ee,Qo=(Ee=class extends v{constructor(...t){super(...t),this.box_name="VvcSampleEntry"}},Ee.fourcc="vvs1",Ee),ze,Zo=(ze=class extends v{constructor(...t){super(...t),this.box_name="VvcNonVCLSampleEntry"}},ze.fourcc="vvcN",ze),th=class extends v{getCodec(){let r=super.getCodec(),t=this.vpcC.level;t===0&&(t="00");let e=this.vpcC.bitDepth;return e===8&&(e="08"),`${r}.0${this.vpcC.profile}.${t}.${e}`}},ke,eh=(ke=class extends th{},ke.fourcc="vp08",ke),Ie,ih=(Ie=class extends th{},Ie.fourcc="vp09",Ie),Ce,sh=(Ce=class extends v{},Ce.fourcc="avs3",Ce),Pe,rh=(Pe=class extends v{constructor(...t){super(...t),this.box_name="J2KSampleEntry"}},Pe.fourcc="j2ki",Pe),Te,nh=(Te=class extends v{},Te.fourcc="mjp2",Te),Ae,ah=(Ae=class extends v{},Ae.fourcc="mjpg",Ae),Fe,oh=(Fe=class extends v{constructor(...t){super(...t),this.box_name="UncompressedVideoSampleEntry"}},Fe.fourcc="uncv",Fe),De,hh=(De=class extends v{constructor(...t){super(...t),this.box_name="MP4VisualSampleEntry"}},De.fourcc="mp4v",De),Le,ua=(Le=class extends C{constructor(...t){super(...t),this.box_name="MP4AudioSampleEntry"}getCodec(){let t=super.getCodec(),e=this.esds??this.wave?.esds;if(e&&e.esd){let i=e.esd.getOTI(),s=e.esd.getAudioConfig();return t+"."+X(i)+(s?"."+s:"")}else return t}},Le.fourcc="mp4a",Le),He,ch=(He=class extends C{},He.fourcc="m4ae",He),Oe,lh=(Oe=class extends C{},Oe.fourcc="ac-3",Oe),Me,dh=(Me=class extends C{},Me.fourcc="ac-4",Me),Re,fh=(Re=class extends C{},Re.fourcc="ec-3",Re),Ne,ph=(Ne=class extends C{},Ne.fourcc="Opus",Ne),Ve,uh=(Ve=class extends C{},Ve.fourcc="mha1",Ve),Ge,_h=(Ge=class extends C{},Ge.fourcc="mha2",Ge),je,xh=(je=class extends C{},je.fourcc="mhm1",je),$e,mh=($e=class extends C{},$e.fourcc="mhm2",$e),qe,gh=(qe=class extends C{},qe.fourcc="fLaC",qe),Ye,yh=(Ye=class extends v{},Ye.fourcc="encv",Ye),We,bh=(We=class extends C{},We.fourcc="enca",We),Ke,vh=(Ke=class extends V{constructor(...t){super(...t),this.subBoxNames=["sinf"],this.sinfs=[]}},Ke.fourcc="encu",Ke),Xe,Sh=(Xe=class extends gn{constructor(...t){super(...t),this.subBoxNames=["sinf"],this.sinfs=[]}},Xe.fourcc="encs",Xe),Je,Bh=(Je=class extends gn{},Je.fourcc="mp4s",Je),Qe,Uh=(Qe=class extends Kn{constructor(...t){super(...t),this.subBoxNames=["sinf"],this.sinfs=[]}},Qe.fourcc="enct",Qe),Ze,wh=(Ze=class extends j{constructor(...t){super(...t),this.subBoxNames=["sinf"],this.sinfs=[]}},Ze.fourcc="encm",Ze),ti,Eh=(ti=class extends v{constructor(...t){super(...t),this.box_name="RestrictedVideoSampleEntry"}},ti.fourcc="resv",ti),ei,zh=(ei=class extends V{parse(t){this.parseHeader(t),this.content_encoding=t.readCString(),this.mime_format=t.readCString(),this.parseFooter(t)}},ei.fourcc="sbtt",ei),ii,_a=(ii=class extends V{parse(t){this.parseHeader(t),this.namespace=t.readCString(),this.schema_location=t.readCString(),this.auxiliary_mime_types=t.readCString(),this.parseFooter(t)}write(t){this.writeHeader(t),this.size+=this.namespace.length+1+this.schema_location.length+1+this.auxiliary_mime_types.length+1,t.writeCString(this.namespace),t.writeCString(this.schema_location),t.writeCString(this.auxiliary_mime_types),this.writeFooter(t)}},ii.fourcc="stpp",ii),si,kh=(si=class extends V{parse(t){this.parseHeader(t),this.content_encoding=t.readCString(),this.mime_format=t.readCString(),this.parseFooter(t)}getCodec(){let t=super.getCodec();return this.mime_format?t+"."+this.mime_format:t}},si.fourcc="stxt",si),ri,Ih=(ri=class extends V{parse(t){this.parseHeader(t),this.displayFlags=t.readUint32(),this.horizontal_justification=t.readInt8(),this.vertical_justification=t.readInt8(),this.bg_color_rgba=t.readUint8Array(4),this.box_record=t.readInt16Array(4),this.style_record=t.readUint8Array(12),this.parseFooter(t)}},ri.fourcc="tx3g",ri),ni,Ch=(ni=class extends j{parse(t){this.parseHeader(t),this.parseFooter(t)}},ni.fourcc="wvtt",ni),ai,Ph=(ai=class extends f{constructor(...t){super(...t),this.box_name="SampleToGroupBox"}parse(t){this.parseFullHeader(t),this.grouping_type=t.readString(4),this.version===1?this.grouping_type_parameter=t.readUint32():this.grouping_type_parameter=0,this.entries=[];let e=t.readUint32();for(let i=0;i<e;i++)this.entries.push({sample_count:t.readInt32(),group_description_index:t.readInt32()})}write(t){this.grouping_type_parameter?this.version=1:this.version=0,this.flags=0,this.size=8+8*this.entries.length+(this.version===1?4:0),this.writeHeader(t),t.writeString(this.grouping_type,void 0,4),this.version===1&&t.writeUint32(this.grouping_type_parameter),t.writeUint32(this.entries.length);for(let e=0;e<this.entries.length;e++){let i=this.entries[e];t.writeInt32(i.sample_count),t.writeInt32(i.group_description_index)}}},ai.fourcc="sbgp",ai),oi,Th=(oi=class extends f{constructor(...t){super(...t),this.box_name="SampleDependencyTypeBox"}parse(t){this.parseFullHeader(t);let e=this.size-this.hdr_size;this.is_leading=[],this.sample_depends_on=[],this.sample_is_depended_on=[],this.sample_has_redundancy=[];for(let i=0;i<e;i++){let s=t.readUint8();this.is_leading[i]=s>>6,this.sample_depends_on[i]=s>>4&3,this.sample_is_depended_on[i]=s>>2&3,this.sample_has_redundancy[i]=s&3}}},oi.fourcc="sdtp",oi),hi,Ah=(hi=class extends f{constructor(...t){super(...t),this.box_name="SampleGroupDescriptionBox"}parse(t){this.parseFullHeader(t),this.grouping_type=t.readString(4),l.debug("BoxParser","Found Sample Groups of type "+this.grouping_type),this.version===1?this.default_length=t.readUint32():this.default_length=0,this.version>=2&&(this.default_group_description_index=t.readUint32()),this.entries=[];let e=t.readUint32();for(let i=0;i<e;i++){let s;this.grouping_type in A.sampleGroupEntry?s=new A.sampleGroupEntry[this.grouping_type](this.grouping_type):s=new U(this.grouping_type),this.entries.push(s),this.version===1?this.default_length===0?s.description_length=t.readUint32():s.description_length=this.default_length:s.description_length=this.default_length,s.write===U.prototype.write&&(l.info("BoxParser","SampleGroup for type "+this.grouping_type+" writing not yet implemented, keeping unparsed data in memory for later write"),s.data=t.readUint8Array(s.description_length),t.seek(t.getPosition()-s.description_length)),s.parse(t)}}write(t){this.flags=0,this.size=12;for(let e=0;e<this.entries.length;e++){let i=this.entries[e];this.version===1&&(this.default_length===0&&(this.size+=4),this.size+=i.data.length)}this.writeHeader(t),t.writeString(this.grouping_type,void 0,4),this.version===1&&t.writeUint32(this.default_length),this.version>=2&&t.writeUint32(this.default_sample_description_index),t.writeUint32(this.entries.length);for(let e=0;e<this.entries.length;e++){let i=this.entries[e];this.version===1&&this.default_length===0&&t.writeUint32(i.description_length),i.write(t)}}},hi.fourcc="sgpd",hi),ci,Fh=(ci=class extends f{constructor(...t){super(...t),this.box_name="CompressedSegmentIndexBox"}parse(t){this.parseFullHeader(t),this.reference_ID=t.readUint32(),this.timescale=t.readUint32(),this.version===0?(this.earliest_presentation_time=t.readUint32(),this.first_offset=t.readUint32()):(this.earliest_presentation_time=t.readUint64(),this.first_offset=t.readUint64()),t.readUint16(),this.references=[];let e=t.readUint16();for(let i=0;i<e;i++){let s=t.readUint32(),n=t.readUint32(),a=t.readUint32();this.references.push({reference_type:s>>31&1,referenced_size:s&2147483647,subsegment_duration:n,starts_with_SAP:a>>31&1,SAP_type:a>>28&7,SAP_delta_time:a&268435455})}}write(t){let e=this.earliest_presentation_time>E||this.first_offset>E||this.version===1;this.version=e?1:0,this.size=12+12*this.references.length,this.size+=e?16:8,this.flags=0,this.writeHeader(t),t.writeUint32(this.reference_ID),t.writeUint32(this.timescale),e?(t.writeUint64(this.earliest_presentation_time),t.writeUint64(this.first_offset)):(t.writeUint32(this.earliest_presentation_time),t.writeUint32(this.first_offset)),t.writeUint16(0),t.writeUint16(this.references.length);for(let i=0;i<this.references.length;i++){let s=this.references[i];t.writeUint32(s.reference_type<<31|s.referenced_size),t.writeUint32(s.subsegment_duration),t.writeUint32(s.starts_with_SAP<<31|s.SAP_type<<28|s.SAP_delta_time)}}},ci.fourcc="sidx",ci),li,xa=(li=class extends f{constructor(...t){super(...t),this.box_name="SoundMediaHeaderBox"}parse(t){this.parseFullHeader(t),this.balance=t.readUint16(),t.readUint16()}write(t){this.version=0,this.size=4,this.writeHeader(t),t.writeUint16(this.balance),t.writeUint16(0)}},li.fourcc="smhd",li),di,ma=(di=class extends f{constructor(...t){super(...t),this.box_name="ChunkOffsetBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.chunk_offsets=[],this.version===0)for(let i=0;i<e;i++)this.chunk_offsets.push(t.readUint32())}write(t){this.version=0,this.flags=0,this.size=4+4*this.chunk_offsets.length,this.writeHeader(t),t.writeUint32(this.chunk_offsets.length),t.writeUint32Array(this.chunk_offsets)}unpack(t){for(let e=0;e<this.chunk_offsets.length;e++)t[e].offset=this.chunk_offsets[e]}},di.fourcc="stco",di),fi,ga=(fi=class extends f{constructor(...t){super(...t),this.box_name="SubtitleMediaHeaderBox"}},fi.fourcc="sthd",fi),pi,ya=(pi=class extends f{constructor(...t){super(...t),this.box_name="SampleToChunkBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.first_chunk=[],this.samples_per_chunk=[],this.sample_description_index=[],this.version===0)for(let i=0;i<e;i++)this.first_chunk.push(t.readUint32()),this.samples_per_chunk.push(t.readUint32()),this.sample_description_index.push(t.readUint32())}write(t){this.version=0,this.flags=0,this.size=4+12*this.first_chunk.length,this.writeHeader(t),t.writeUint32(this.first_chunk.length);for(let e=0;e<this.first_chunk.length;e++)t.writeUint32(this.first_chunk[e]),t.writeUint32(this.samples_per_chunk[e]),t.writeUint32(this.sample_description_index[e])}unpack(t){let e=0,i=0;for(let s=0;s<this.first_chunk.length;s++)for(let n=0;n<(s+1<this.first_chunk.length?this.first_chunk[s+1]:1/0);n++){i++;for(let a=0;a<this.samples_per_chunk[s];a++){if(t[e])t[e].description_index=this.sample_description_index[s],t[e].chunk_index=i;else return;e++}}}},pi.fourcc="stsc",pi),ui,ba=(ui=class extends f{constructor(...t){super(...t),this.box_name="SampleDescriptionBox"}parse(t){this.parseFullHeader(t),this.entries=[];let e=t.readUint32();for(let i=1;i<=e;i++){let s=D(t,!0,this.size-(t.getPosition()-this.start));if(s.code===1){let n;s.type in A.sampleEntry?(n=new A.sampleEntry[s.type](s.size),n.hdr_size=s.hdr_size,n.start=s.start):(l.warn("BoxParser",`Unknown sample entry type: '${s.type}'`),n=new O(s.size,s.hdr_size,s.start),n.type=s.type),n.write===O.prototype.write&&(l.info("BoxParser","SampleEntry "+n.type+" box writing not yet implemented, keeping unparsed data in memory for later write"),n.parseDataAndRewind(t)),n.parse(t),this.entries.push(n)}else return}}write(t){this.version=0,this.flags=0,this.size=0,this.writeHeader(t),t.writeUint32(this.entries.length),this.size+=4;for(let e=0;e<this.entries.length;e++)this.entries[e].write(t),this.size+=this.entries[e].size;l.debug("BoxWriter","Adjusting box "+this.type+" with new size "+this.size),t.adjustUint32(this.sizePosition,this.size)}},ui.fourcc="stsd",ui),_i,va=(_i=class extends f{constructor(...t){super(...t),this.box_name="SampleSizeBox"}parse(t){if(this.parseFullHeader(t),this.sample_sizes=[],this.version===0){this.sample_size=t.readUint32(),this.sample_count=t.readUint32();for(let e=0;e<this.sample_count;e++)this.sample_size===0?this.sample_sizes.push(t.readUint32()):this.sample_sizes[e]=this.sample_size}}write(t){let e=!0;this.version=0,this.flags=0,this.sample_sizes.length>0&&this.sample_size===0&&(e=!1),this.size=8,e||(this.size+=4*this.sample_sizes.length),this.writeHeader(t),t.writeUint32(this.sample_size),t.writeUint32(this.sample_sizes.length),e||t.writeUint32Array(this.sample_sizes)}unpack(t){for(let e=0;e<this.sample_sizes.length;e++)t[e].size=this.sample_sizes[e]}},_i.fourcc="stsz",_i),xi,Sa=(xi=class extends f{constructor(...t){super(...t),this.box_name="TimeToSampleBox",this.sample_counts=[],this.sample_deltas=[]}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.sample_counts.length=0,this.sample_deltas.length=0,this.version===0)for(let i=0;i<e;i++){this.sample_counts.push(t.readUint32());let s=t.readInt32();s<0&&(l.warn("BoxParser","File uses negative stts sample delta, using value 1 instead, sync may be lost!"),s=1),this.sample_deltas.push(s)}}write(t){this.version=0,this.flags=0,this.size=4+8*this.sample_counts.length,this.writeHeader(t),t.writeUint32(this.sample_counts.length);for(let e=0;e<this.sample_counts.length;e++)t.writeUint32(this.sample_counts[e]),t.writeUint32(this.sample_deltas[e])}unpack(t){let e=0;for(let i=0;i<this.sample_counts.length;i++)for(let s=0;s<this.sample_counts[i];s++)e===0?t[e].dts=0:t[e].dts=t[e-1].dts+this.sample_deltas[i],e++}},xi.fourcc="stts",xi),mi,Ba=(mi=class extends f{constructor(...t){super(...t),this.box_name="TrackFragmentBaseMediaDecodeTimeBox"}parse(t){this.parseFullHeader(t),this.version===1?this.baseMediaDecodeTime=t.readUint64():this.baseMediaDecodeTime=t.readUint32()}write(t){let e=this.baseMediaDecodeTime>E||this.version===1;this.version=e?1:0,this.size=4,this.size+=e?4:0,this.flags=0,this.writeHeader(t),e?t.writeUint64(this.baseMediaDecodeTime):t.writeUint32(this.baseMediaDecodeTime)}},mi.fourcc="tfdt",mi),gi,Ua=(gi=class extends f{constructor(...t){super(...t),this.box_name="TrackFragmentHeaderBox"}parse(t){this.parseFullHeader(t);let e=0;this.track_id=t.readUint32(),this.size-this.hdr_size>e&&this.flags&1?(this.base_data_offset=t.readUint64(),e+=8):this.base_data_offset=0,this.size-this.hdr_size>e&&this.flags&2?(this.default_sample_description_index=t.readUint32(),e+=4):this.default_sample_description_index=0,this.size-this.hdr_size>e&&this.flags&8?(this.default_sample_duration=t.readUint32(),e+=4):this.default_sample_duration=0,this.size-this.hdr_size>e&&this.flags&16?(this.default_sample_size=t.readUint32(),e+=4):this.default_sample_size=0,this.size-this.hdr_size>e&&this.flags&32?(this.default_sample_flags=t.readUint32(),e+=4):this.default_sample_flags=0}write(t){this.version=0,this.size=4,this.flags&1&&(this.size+=8),this.flags&2&&(this.size+=4),this.flags&8&&(this.size+=4),this.flags&16&&(this.size+=4),this.flags&32&&(this.size+=4),this.writeHeader(t),t.writeUint32(this.track_id),this.flags&1&&t.writeUint64(this.base_data_offset),this.flags&2&&t.writeUint32(this.default_sample_description_index),this.flags&8&&t.writeUint32(this.default_sample_duration),this.flags&16&&t.writeUint32(this.default_sample_size),this.flags&32&&t.writeUint32(this.default_sample_flags)}},gi.fourcc="tfhd",gi),yi,wa=(yi=class extends f{constructor(...t){super(...t),this.box_name="TrackHeaderBox",this.layer=0,this.alternate_group=0}parse(t){this.parseFullHeader(t),this.version===1?(this.creation_time=t.readUint64(),this.modification_time=t.readUint64(),this.track_id=t.readUint32(),t.readUint32(),this.duration=t.readUint64()):(this.creation_time=t.readUint32(),this.modification_time=t.readUint32(),this.track_id=t.readUint32(),t.readUint32(),this.duration=t.readUint32()),t.readUint32Array(2),this.layer=t.readInt16(),this.alternate_group=t.readInt16(),this.volume=t.readInt16()>>8,t.readUint16(),this.matrix=t.readInt32Array(9),this.width=t.readUint32(),this.height=t.readUint32()}write(t){let e=this.modification_time>E||this.creation_time>E||this.duration>E||this.version===1;this.version=e?1:0,this.size=80,this.size+=e?12:0,this.flags=this.flags??3,this.writeHeader(t),e?(t.writeUint64(this.creation_time),t.writeUint64(this.modification_time),t.writeUint32(this.track_id),t.writeUint32(0),t.writeUint64(this.duration)):(t.writeUint32(this.creation_time),t.writeUint32(this.modification_time),t.writeUint32(this.track_id),t.writeUint32(0),t.writeUint32(this.duration)),t.writeUint32Array([0,0]),t.writeInt16(this.layer),t.writeInt16(this.alternate_group),t.writeInt16(this.volume<<8),t.writeInt16(0),t.writeInt32Array(this.matrix),t.writeUint32(this.width),t.writeUint32(this.height)}print(t){super.printHeader(t),t.log(t.indent+"creation_time: "+this.creation_time),t.log(t.indent+"modification_time: "+this.modification_time),t.log(t.indent+"track_id: "+this.track_id),t.log(t.indent+"duration: "+this.duration),t.log(t.indent+"volume: "+(this.volume>>8)),t.log(t.indent+"matrix: "+this.matrix.join(", ")),t.log(t.indent+"layer: "+this.layer),t.log(t.indent+"alternate_group: "+this.alternate_group),t.log(t.indent+"width: "+this.width),t.log(t.indent+"height: "+this.height)}},yi.fourcc="tkhd",yi),bi,zn=(bi=class extends f{constructor(...t){super(...t),this.box_name="TrackExtendsBox"}parse(t){this.parseFullHeader(t),this.track_id=t.readUint32(),this.default_sample_description_index=t.readUint32(),this.default_sample_duration=t.readUint32(),this.default_sample_size=t.readUint32(),this.default_sample_flags=t.readUint32()}write(t){this.version=0,this.flags=0,this.size=20,this.writeHeader(t),t.writeUint32(this.track_id),t.writeUint32(this.default_sample_description_index),t.writeUint32(this.default_sample_duration),t.writeUint32(this.default_sample_size),t.writeUint32(this.default_sample_flags)}},bi.fourcc="trex",bi),vi,Ea=(vi=class extends f{constructor(...t){super(...t),this.box_name="TrackRunBox",this.sample_duration=[],this.sample_size=[],this.sample_flags=[],this.sample_composition_time_offset=[]}parse(t){this.parseFullHeader(t);let e=0;if(this.sample_count=t.readUint32(),e+=4,this.size-this.hdr_size>e&&this.flags&1?(this.data_offset=t.readInt32(),e+=4):this.data_offset=0,this.size-this.hdr_size>e&&this.flags&4?(this.first_sample_flags=t.readUint32(),e+=4):this.first_sample_flags=0,this.sample_duration=[],this.sample_size=[],this.sample_flags=[],this.sample_composition_time_offset=[],this.size-this.hdr_size>e)for(let i=0;i<this.sample_count;i++)this.flags&256&&(this.sample_duration[i]=t.readUint32()),this.flags&512&&(this.sample_size[i]=t.readUint32()),this.flags&1024&&(this.sample_flags[i]=t.readUint32()),this.flags&2048&&(this.version===0?this.sample_composition_time_offset[i]=t.readUint32():this.sample_composition_time_offset[i]=t.readInt32())}write(t){this.size=4,this.flags&1&&(this.size+=4),this.flags&4&&(this.size+=4),this.flags&256&&(this.size+=4*this.sample_duration.length),this.flags&512&&(this.size+=4*this.sample_size.length),this.flags&1024&&(this.size+=4*this.sample_flags.length),this.flags&2048&&(this.size+=4*this.sample_composition_time_offset.length),this.writeHeader(t),t.writeUint32(this.sample_count),this.flags&1&&(this.data_offset_position=t.getPosition(),t.writeInt32(this.data_offset)),this.flags&4&&t.writeUint32(this.first_sample_flags);for(let e=0;e<this.sample_count;e++)this.flags&256&&t.writeUint32(this.sample_duration[e]),this.flags&512&&t.writeUint32(this.sample_size[e]),this.flags&1024&&t.writeUint32(this.sample_flags[e]),this.flags&2048&&(this.version===0?t.writeUint32(this.sample_composition_time_offset[e]):t.writeInt32(this.sample_composition_time_offset[e]))}},vi.fourcc="trun",vi),Si,za=(Si=class extends f{constructor(...t){super(...t),this.box_name="DataEntryUrlBox"}parse(t){this.parseFullHeader(t),this.flags!==1&&(this.location=t.readCString())}write(t){this.version=0,this.location?(this.flags=0,this.size=this.location.length+1):(this.flags=1,this.size=0),this.writeHeader(t),this.location&&t.writeCString(this.location)}},Si.fourcc="url ",Si),Bi,ka=(Bi=class extends f{constructor(...t){super(...t),this.box_name="VideoMediaHeaderBox"}parse(t){this.parseFullHeader(t),this.graphicsmode=t.readUint16(),this.opcolor=t.readUint16Array(3)}write(t){this.version=0,this.size=8,this.writeHeader(t),t.writeUint16(this.graphicsmode),t.writeUint16Array(this.opcolor)}},Bi.fourcc="vmhd",Bi),un=class{constructor(r,t,e){this.grouping_type=r,this.grouping_type_parameter=t,this.sbgp=e,this.last_sample_in_run=-1,this.entry_index=-1}},Ia=class R{constructor(t,e=!0){this.boxes=[],this.mdats=[],this.moofs=[],this.isProgressive=!1,this.moovStartFound=!1,this.moovStartSent=!1,this.readySent=!1,this.sampleListBuilt=!1,this.fragmentedTracks=[],this.extractedTracks=[],this.isFragmentationInitialized=!1,this.sampleProcessingStarted=!1,this.nextMoofNumber=0,this.itemListBuilt=!1,this.sidxSent=!1,this.items=[],this.entity_groups=[],this.itemsDataSize=0,this.lastMoofIndex=0,this.samplesDataSize=0,this.lastBoxStartPosition=0,this.nextParsePosition=0,this.discardMdatData=!0,this.discardMdatData=e,t?(this.stream=t,this.parse()):this.stream=new W,this.stream.isofile=this}setSegmentOptions(t,e,i){let{sizePerSegment:s=Number.MAX_SAFE_INTEGER,rapAlignement:n=!0,normalizeAudioSampleEntriesForMSE:a=!0}=i,o=i.nbSamples??i.nbSamplesPerFragment??1e3,h=i.nbSamplesPerFragment??o;if(o<=0||h<=0||s<=0){l.error("ISOFile",`Invalid segment options: nbSamples=${o}, nbSamplesPerFragment=${h}, sizePerSegment=${s}`);return}if(o<h&&(l.warn("ISOFile",`nbSamples (${o}) is less than nbSamplesPerFragment (${h}), setting nbSamples to nbSamplesPerFragment`),o=h),this.fragmentedTracks.some(d=>d.nb_samples!==o)){l.error("ISOFile",`Cannot set segment options for track ${t}: nbSamples (${o}) does not match existing tracks`);return}let c=this.getTrackById(t);if(c){let d={id:t,user:e,trak:c,segmentStream:void 0,nb_samples:o,nb_samples_per_fragment:h,size_per_segment:s,rapAlignement:n,normalizeAudioSampleEntriesForMSE:a,state:{lastFragmentSampleNumber:0,lastSegmentSampleNumber:0,accumulatedSize:0}};this.fragmentedTracks.push(d),c.nextSample=0}this.discardMdatData&&l.warn("ISOFile","Segmentation options set but discardMdatData is true, samples will not be segmented")}unsetSegmentOptions(t){let e=-1;for(let i=0;i<this.fragmentedTracks.length;i++)this.fragmentedTracks[i].id===t&&(e=i);e>-1&&this.fragmentedTracks.splice(e,1)}setExtractionOptions(t,e,{nbSamples:i=1e3}={}){let s=this.getTrackById(t);s&&(this.extractedTracks.push({id:t,user:e,trak:s,nb_samples:i,samples:[]}),s.nextSample=0),this.discardMdatData&&l.warn("ISOFile","Extraction options set but discardMdatData is true, samples will not be extracted")}unsetExtractionOptions(t){let e=-1;for(let i=0;i<this.extractedTracks.length;i++)this.extractedTracks[i].id===t&&(e=i);e>-1&&this.extractedTracks.splice(e,1)}parse(){if(!(this.restoreParsePosition&&!this.restoreParsePosition()))for(;;)if(this.hasIncompleteMdat&&this.hasIncompleteMdat()){if(this.processIncompleteMdat())continue;return}else{this.saveParsePosition&&this.saveParsePosition();let e=D(this.stream,!1);if(e.code===0)if(this.processIncompleteBox){if(this.processIncompleteBox(e))continue;return}else return;else if(e.code===1){let i=e.box;if(this.boxes.push(i),i.type==="uuid")this[i.uuid]!==void 0&&l.warn("ISOFile","Duplicate Box of uuid: "+i.uuid+", overriding previous occurrence"),this[i.uuid]=i;else switch(i.type){case"mdat":this.mdats.push(i),this.transferMdatData(i);break;case"moof":this.moofs.push(i);break;case"free":case"skip":break;case"moov":this.moovStartFound=!0,this.mdats.length===0&&(this.isProgressive=!0);default:this[i.type]!==void 0?Array.isArray(this[i.type+"s"])?(l.info("ISOFile",`Found multiple boxes of type ${i.type} in ISOFile, adding to array`),this[i.type+"s"].push(i)):(l.warn("ISOFile",`Found multiple boxes of type ${i.type} but no array exists. Creating array dynamically.`),this[i.type+"s"]=[this[i.type],i]):(this[i.type]=i,Array.isArray(this[i.type+"s"])&&this[i.type+"s"].push(i));break}this.updateUsedBytes&&this.updateUsedBytes(i,e)}else if(e.code===-1){l.error("ISOFile",`Invalid data found while parsing box of type '${e.type}' at position ${e.start}. Aborting parsing.`,this);break}}}checkBuffer(t){if(!t)throw new Error("Buffer must be defined and non empty");return t.byteLength===0?(l.warn("ISOFile","Ignoring empty buffer (fileStart: "+t.fileStart+")"),this.stream.logBufferLevel(),!1):(l.info("ISOFile","Processing buffer (fileStart: "+t.fileStart+")"),t.usedBytes=0,this.stream.insertBuffer(t),this.stream.logBufferLevel(),this.stream.initialized()?!0:(l.warn("ISOFile","Not ready to start parsing"),!1))}appendBuffer(t,e){let i;if(this.checkBuffer(t))return this.parse(),this.moovStartFound&&!this.moovStartSent&&(this.moovStartSent=!0,this.onMoovStart&&this.onMoovStart()),this.moov?(this.sampleListBuilt||(this.buildSampleLists(),this.sampleListBuilt=!0),this.updateSampleLists(),this.onReady&&!this.readySent&&(this.readySent=!0,this.onReady(this.getInfo())),this.processSamples(e),this.nextSeekPosition?(i=this.nextSeekPosition,this.nextSeekPosition=void 0):i=this.nextParsePosition,this.stream.getEndFilePositionAfter&&(i=this.stream.getEndFilePositionAfter(i))):this.nextParsePosition?i=this.nextParsePosition:i=0,this.sidx&&this.onSidx&&!this.sidxSent&&(this.onSidx(this.sidx),this.sidxSent=!0),this.meta&&(this.flattenItemInfo&&!this.itemListBuilt&&(this.flattenItemInfo(),this.itemListBuilt=!0),this.processItems&&this.processItems(this.onItem)),this.stream.cleanBuffers&&(l.info("ISOFile","Done processing buffer (fileStart: "+t.fileStart+") - next buffer to fetch should have a fileStart position of "+i),this.stream.logBufferLevel(),this.stream.cleanBuffers(),this.stream.logBufferLevel(!0),l.info("ISOFile","Sample data size in memory: "+this.getAllocatedSampleDataSize())),i}getFragmentDuration(){let t=this.getBox("mvex");if(!t)return;if(t.mehd)return{num:t.mehd.fragment_duration,den:this.moov.mvhd.timescale};let e=this.getBoxes("trak",!1),i={num:0,den:1};for(let s of e){let n=s.samples_duration,a=s.mdia.mdhd.timescale;n&&a&&n/a>i.num/i.den&&(i={num:n,den:a})}return i}getInfo(){if(!this.moov)return{hasMoov:!1,mime:""};let t=new Date("1904-01-01T00:00:00Z").getTime(),e=this.getBox("mvex")!==void 0,i={hasMoov:!0,duration:this.moov.mvhd.duration,timescale:this.moov.mvhd.timescale,isFragmented:e,fragment_duration:this.getFragmentDuration(),isProgressive:this.isProgressive,hasIOD:this.moov.iods!==void 0,brands:[this.ftyp.major_brand].concat(this.ftyp.compatible_brands),created:new Date(t+this.moov.mvhd.creation_time*1e3),modified:new Date(t+this.moov.mvhd.modification_time*1e3),tracks:[],audioTracks:[],videoTracks:[],subtitleTracks:[],metadataTracks:[],hintTracks:[],otherTracks:[],mime:""};for(let s=0;s<this.moov.traks.length;s++){let n=this.moov.traks[s],a=n.mdia.minf.stbl.stsd.entries[0],o=n.samples_size,h=n.mdia.mdhd.timescale,c=n.samples_duration,d={samples_duration:c,bitrate:o*8*h/c,size:o,timescale:h,alternate_group:n.tkhd.alternate_group,codec:a.getCodec(),created:new Date(t+n.tkhd.creation_time*1e3),cts_shift:n.mdia.minf.stbl.cslg,duration:n.mdia.mdhd.duration,id:n.tkhd.track_id,kind:n.udta&&n.udta.kinds.length?n.udta.kinds[0]:{schemeURI:"",value:""},language:n.mdia.elng?n.mdia.elng.extended_language:n.mdia.mdhd.languageString,layer:n.tkhd.layer,matrix:n.tkhd.matrix,modified:new Date(t+n.tkhd.modification_time*1e3),movie_duration:n.tkhd.duration,movie_timescale:i.timescale,name:n.mdia.hdlr.name,nb_samples:n.samples.length,references:[],track_height:n.tkhd.height/65536,track_width:n.tkhd.width/65536,volume:n.tkhd.volume};if(i.tracks.push(d),n.tref)for(let p=0;p<n.tref.references.length;p++)d.references.push({type:n.tref.references[p].type,track_ids:n.tref.references[p].track_ids});n.edts!==void 0&&n.edts.elst!==void 0&&(d.edits=n.edts.elst.entries),a instanceof C?(d.type="audio",i.audioTracks.push(d),d.audio={sample_rate:a.getSampleRate(),channel_count:a.getChannelCount(),sample_size:a.getSampleSize()}):a instanceof v?(d.type="video",i.videoTracks.push(d),d.video={width:a.getWidth(),height:a.getHeight()}):a instanceof V?(d.type="subtitles",i.subtitleTracks.push(d)):a instanceof wn?(d.type="metadata",i.hintTracks.push(d)):a instanceof j?(d.type="metadata",i.metadataTracks.push(d)):(d.type="metadata",i.otherTracks.push(d))}i.videoTracks&&i.videoTracks.length>0?i.mime+='video/mp4; codecs="':i.audioTracks&&i.audioTracks.length>0?i.mime+='audio/mp4; codecs="':i.mime+='application/mp4; codecs="';for(let s=0;s<i.tracks.length;s++)s!==0&&(i.mime+=","),i.mime+=i.tracks[s].codec;return i.mime+='"; profiles="',i.mime+=this.ftyp.compatible_brands.join(),i.mime+='"',i}setNextSeekPositionFromSample(t){t&&(this.nextSeekPosition?this.nextSeekPosition=Math.min(t.offset+t.alreadyRead,this.nextSeekPosition):this.nextSeekPosition=t.offset+t.alreadyRead)}processSamples(t){if(this.sampleProcessingStarted){if(this.isFragmentationInitialized&&this.onSegment!==void 0){let e=new Set;for(;e.size<this.fragmentedTracks.length&&this.fragmentedTracks.some(i=>i.trak.nextSample<i.trak.samples.length)&&this.sampleProcessingStarted;)for(let i of this.fragmentedTracks){let s=i.trak;if(!e.has(i.id)){let n=s.nextSample<s.samples.length?this.getSample(s,s.nextSample):void 0;if(!n){this.setNextSeekPositionFromSample(s.samples[s.nextSample]),e.add(i.id);continue}i.state.accumulatedSize+=n.size;let a=s.nextSample+1,o=a-i.state.lastFragmentSampleNumber>i.nb_samples_per_fragment,h=a-i.state.lastSegmentSampleNumber>i.nb_samples,c=o||a%i.nb_samples_per_fragment===0,d=h||a%i.nb_samples===0,p=i.state.accumulatedSize>=i.size_per_segment,_=!i.rapAlignement||n.is_sync,x=t||s.nextSample+1>=s.samples.length;if(x&&!_&&l.warn("ISOFile","Flushing track #"+i.id+" at sample #"+s.nextSample+" which is not a RAP, this may lead to playback issues"),c=c&&_,d=d&&_,p=p&&_,c||p||x){o?l.warn("ISOFile","Fragment on track #"+i.id+" is overdue, creating it with samples ["+i.state.lastFragmentSampleNumber+", "+s.nextSample+"]"):l.debug("ISOFile","Creating media fragment on track #"+i.id+" for samples ["+i.state.lastFragmentSampleNumber+", "+s.nextSample+"]");let b=this.createFragment(i.id,i.state.lastFragmentSampleNumber,s.nextSample,i.segmentStream);if(b)i.segmentStream=b,i.state.lastFragmentSampleNumber=s.nextSample+1;else{e.add(i.id);continue}}(d||p||x)&&(h?l.warn("ISOFile","Segment on track #"+i.id+" is overdue, sending it with samples ["+Math.max(0,s.nextSample-i.nb_samples)+", "+(s.nextSample-1)+"]"):l.info("ISOFile","Sending fragmented data on track #"+i.id+" for samples ["+Math.max(0,s.nextSample-i.nb_samples)+", "+(s.nextSample-1)+"]"),l.info("ISOFile","Sample data size in memory: "+this.getAllocatedSampleDataSize()),this.onSegment&&this.onSegment(i.id,i.user,i.segmentStream.buffer,s.nextSample+1,t||s.nextSample+1>=s.samples.length),i.segmentStream=void 0,i.state.accumulatedSize=0,i.state.lastSegmentSampleNumber=s.nextSample+1),s.nextSample++}}}if(this.onSamples!==void 0)for(let e=0;e<this.extractedTracks.length;e++){let i=this.extractedTracks[e],s=i.trak;for(;s.nextSample<s.samples.length&&this.sampleProcessingStarted;){l.debug("ISOFile","Exporting on track #"+i.id+" sample #"+s.nextSample);let n=this.getSample(s,s.nextSample);if(n)s.nextSample++,i.samples.push(n);else{this.setNextSeekPositionFromSample(s.samples[s.nextSample]);break}if((s.nextSample%i.nb_samples===0||s.nextSample>=s.samples.length)&&(l.debug("ISOFile","Sending samples on track #"+i.id+" for sample "+s.nextSample),this.onSamples&&this.onSamples(i.id,i.user,i.samples),i.samples=[],i!==this.extractedTracks[e]))break}}}}getBox(t){let e=this.getBoxes(t,!0);return e.length?e[0]:void 0}getBoxes(t,e){let i=[],s=n=>{n instanceof u&&n.type&&n.type===t&&i.push(n);let a=[];n.boxes&&a.push(...n.boxes),n.entries&&a.push(...n.entries),n.item_infos&&a.push(...n.item_infos),n.references&&a.push(...n.references);for(let o of a){if(i.length&&e)return;s(o)}};return s(this),i}getTrackSamplesInfo(t){let e=this.getTrackById(t);if(e)return e.samples}getTrackSample(t,e){let i=this.getTrackById(t);return this.getSample(i,e)}releaseUsedSamples(t,e){let i=0,s=this.getTrackById(t);s.lastValidSample||(s.lastValidSample=0);for(let n=s.lastValidSample;n<e;n++)i+=this.releaseSample(s,n);l.info("ISOFile","Track #"+t+" released samples up to "+e+" (released size: "+i+", remaining: "+this.samplesDataSize+")"),s.lastValidSample=e}start(){this.sampleProcessingStarted=!0,this.processSamples(!1)}stop(){this.sampleProcessingStarted=!1}flush(){l.info("ISOFile","Flushing remaining samples"),this.updateSampleLists(),this.processSamples(!0),this.stream.cleanBuffers(),this.stream.logBufferLevel(!0)}seekTrack(t,e,i){let s=0,n=0,a;if(i.samples.length===0)return l.info("ISOFile","No sample in track, cannot seek! Using time "+l.getDurationString(0,1)+" and offset: 0"),{offset:0,time:0};for(let h=0;h<i.samples.length;h++){let c=i.samples[h];if(h===0)n=0,a=c.timescale;else if(c.cts>t*c.timescale){n=h-1;break}e&&c.is_sync&&(s=h)}for(e&&(n=s),t=i.samples[n].cts,i.nextSample=n,this.resetFragmentedTrackStateAfterSeek(i,n),this.resetExtractedTrackStateAfterSeek(i);i.samples[n].alreadyRead===i.samples[n].size&&i.samples[n+1];)n++;let o=i.samples[n].offset+i.samples[n].alreadyRead;return l.info("ISOFile","Seeking to "+(e?"RAP":"")+" sample #"+i.nextSample+" on track "+i.tkhd.track_id+", time "+l.getDurationString(t,a)+" and offset: "+o),{offset:o,time:t/a}}resetFragmentedTrackStateAfterSeek(t,e){let i=this.fragmentedTracks.find(s=>s.trak===t);i&&(i.state.lastFragmentSampleNumber=e,i.state.lastSegmentSampleNumber=e,i.state.accumulatedSize=0,i.segmentStream=void 0)}resetExtractedTrackStateAfterSeek(t){let e=this.extractedTracks.find(i=>i.trak===t);e&&(e.samples=[])}getTrackDuration(t){if(!t.samples)return 1/0;let e=t.samples[t.samples.length-1];return(e.cts+e.duration)/e.timescale}seek(t,e){let i=this.moov,s={offset:1/0,time:1/0};if(this.moov){for(let n=0;n<i.traks.length;n++){let a=i.traks[n];if(t>this.getTrackDuration(a))continue;let o=this.seekTrack(t,e,a);o.offset<s.offset&&(s.offset=o.offset),o.time<s.time&&(s.time=o.time)}return l.info("ISOFile","Seeking at time "+l.getDurationString(s.time,1)+" needs a buffer with a fileStart position of "+s.offset),s.offset===1/0?s={offset:this.nextParsePosition,time:0}:s.offset=this.stream.getEndFilePositionAfter(s.offset),l.info("ISOFile","Adjusted seek position (after checking data already in buffer): "+s.offset),s}else throw new Error("Cannot seek: moov not received!")}equal(t){let e=0;for(;e<this.boxes.length&&e<t.boxes.length;){let i=this.boxes[e],s=t.boxes[e];if(!kn(i,s))return!1;e++}return!0}write(t){for(let e=0;e<this.boxes.length;e++)this.boxes[e].write(t)}createFragment(t,e,i,s){if(i<e)return l.warn("ISOFile",`Skipping fragment creation on track #${t}: invalid sample range [${e}, ${i}]`),s||new w;let n=[];for(let d=e;d<=i;d++){let p=this.getTrackById(t),_=this.getSample(p,d);if(!_){this.setNextSeekPositionFromSample(p.samples[d]);return}n.push(_)}let a=s||new w,o=this.createMoof(n);o.write(a),o.trafs[0].truns[0].data_offset=o.size+8,l.debug("MP4Box","Adjusting data_offset with new value "+o.trafs[0].truns[0].data_offset),a.adjustUint32(o.trafs[0].truns[0].data_offset_position,o.trafs[0].truns[0].data_offset);let h=new dn;h.stream=new W;let c=0;for(let d of n)if(d.data){let p=H.fromArrayBuffer(d.data.buffer,c);h.stream.insertBuffer(p),c+=d.data.byteLength}return h.write(a),a}static writeInitializationSegment(t,e,i,s){l.debug("ISOFile","Generating initialization segment");let n=new w;t.write(n);let a=R.normalizeAudioSampleEntriesForMSEFragmentedInit(e.traks,s);try{let o=e.addBox(new En);if(i){let h=o.addBox(new da);h.fragment_duration=i}for(let h=0;h<e.traks.length;h++){let c=o.addBox(new zn);c.track_id=e.traks[h].tkhd.track_id,c.default_sample_description_index=1,c.default_sample_duration=e.traks[h].samples[0]?.duration??0,c.default_sample_size=0,c.default_sample_flags=65536}e.write(n)}finally{for(let o=a.length-1;o>=0;o--)a[o]()}return n.buffer}save(t){let e=new w;return e.isofile=this,this.write(e),e.save(t)}getBuffer(){let t=new w;return t.isofile=this,this.write(t),t}static normalizeAudioSampleEntriesForMSEFragmentedInit(t,e){let i=[];for(let s of t)if(e?.has(s.tkhd.track_id))for(let n of s.mdia.minf.stbl.stsd?.entries??[]){if(!(n instanceof ua))continue;let a=n.wave?.esds;if(n.esds||!a)continue;let o=n.esds,h=n.wave,c=n.boxes;i.push(()=>{n.esds=o,n.wave=h,n.boxes=c});let d=Array.isArray(n.boxes)?n.boxes.filter(p=>p?.type!=="wave"&&p?.type!=="esds"):[];n.esds=a,n.boxes=[...d,a],n.wave=void 0}return i}initializeSegmentation(t){if(this.onSegment||l.warn("MP4Box","No segmentation callback set!"),t!==void 0&&t!=="combined"&&t!=="per-track")throw new Error(`Invalid segmentation mode: ${t}`);this.isFragmentationInitialized||(this.isFragmentationInitialized=!0,this.resetTables());let e=[];for(let a of this.fragmentedTracks){let o=this.getTrackById(a.id);if(!o){l.warn("ISOFile",`Track with id ${a.id} not found, skipping fragmentation initialization`);continue}e.push({id:a.id,user:a.user,trak:o})}let i=this.moov?.mvex?.mehd?.fragment_duration,s=new Set(this.fragmentedTracks.filter(a=>a.normalizeAudioSampleEntriesForMSE!==!1).map(a=>a.id));if(t==="per-track")return e.map(({id:a,user:o,trak:h})=>{let c=new pn;return c.addBox(this.moov.mvhd),c.addBox(h),{id:a,user:o,buffer:R.writeInitializationSegment(this.ftyp,c,i,s)}});let n=new pn;n.addBox(this.moov.mvhd);for(let a of e)n.addBox(a.trak);return{tracks:e.map(({id:a,user:o})=>({id:a,user:o})),buffer:R.writeInitializationSegment(this.ftyp,n,i,s)}}resetTables(){this.initial_duration=this.moov.mvhd.duration,this.moov.mvhd.duration=0;for(let t=0;t<this.moov.traks.length;t++){let e=this.moov.traks[t];e.tkhd.duration=0,e.mdia.mdhd.duration=0;let i=e.mdia.minf.stbl.stco||e.mdia.minf.stbl.co64;i.chunk_offsets=[];let s=e.mdia.minf.stbl.stsc;s.first_chunk=[],s.samples_per_chunk=[],s.sample_description_index=[];let n=e.mdia.minf.stbl.stsz||e.mdia.minf.stbl.stz2;n.sample_sizes=[];let a=e.mdia.minf.stbl.stts;a.sample_counts=[],a.sample_deltas=[];let o=e.mdia.minf.stbl.ctts;o&&(o.sample_counts=[],o.sample_offsets=[]);let h=e.mdia.minf.stbl.stss,c=e.mdia.minf.stbl.boxes.indexOf(h);c!==-1&&(e.mdia.minf.stbl.boxes[c]=void 0)}}static initSampleGroups(t,e,i,s,n){e&&(e.sample_groups_info=[]),t.sample_groups_info||(t.sample_groups_info=[]);for(let a=0;a<i.length;a++){let o=i[a].grouping_type+"/"+i[a].grouping_type_parameter,h=new un(i[a].grouping_type,i[a].grouping_type_parameter,i[a]);e&&(e.sample_groups_info[o]=h),t.sample_groups_info[o]||(t.sample_groups_info[o]=h);for(let c=0;c<s.length;c++)s[c].grouping_type===i[a].grouping_type&&(h.description=s[c],h.description.used=!0);if(n)for(let c=0;c<n.length;c++)n[c].grouping_type===i[a].grouping_type&&(h.fragment_description=n[c],h.fragment_description.used=!0,h.is_fragment=!0)}if(e){if(n){for(let a=0;a<n.length;a++)if(!n[a].used&&n[a].version>=2){let o=n[a].grouping_type+"/0",h=new un(n[a].grouping_type,0);h.is_fragment=!0,e.sample_groups_info[o]||(e.sample_groups_info[o]=h)}}}else for(let a=0;a<s.length;a++)if(!s[a].used&&s[a].version>=2){let o=s[a].grouping_type+"/0",h=new un(s[a].grouping_type,0);t.sample_groups_info[o]||(t.sample_groups_info[o]=h)}}static setSampleGroupProperties(t,e,i,s){e.sample_groups=[];for(let n in s)if(e.sample_groups[n]={grouping_type:s[n].grouping_type,grouping_type_parameter:s[n].grouping_type_parameter},i>=s[n].last_sample_in_run&&(s[n].last_sample_in_run<0&&(s[n].last_sample_in_run=0),s[n].entry_index++,s[n].entry_index<=s[n].sbgp.entries.length-1&&(s[n].last_sample_in_run+=s[n].sbgp.entries[s[n].entry_index].sample_count)),s[n].entry_index<=s[n].sbgp.entries.length-1?e.sample_groups[n].group_description_index=s[n].sbgp.entries[s[n].entry_index].group_description_index:e.sample_groups[n].group_description_index=-1,e.sample_groups[n].group_description_index!==0){let a;if(s[n].fragment_description?a=s[n].fragment_description:a=s[n].description,e.sample_groups[n].group_description_index>0){let o;e.sample_groups[n].group_description_index>65535?o=(e.sample_groups[n].group_description_index>>16)-1:o=e.sample_groups[n].group_description_index-1,a&&o>=0&&(e.sample_groups[n].description=a.entries[o])}else a&&a.version>=2&&a.default_group_description_index>0&&(e.sample_groups[n].description=a.entries[a.default_group_description_index-1])}}static process_sdtp(t,e,i){e&&(t?(e.is_leading=t.is_leading[i],e.depends_on=t.sample_depends_on[i],e.is_depended_on=t.sample_is_depended_on[i],e.has_redundancy=t.sample_has_redundancy[i]):(e.is_leading=0,e.depends_on=0,e.is_depended_on=0,e.has_redundancy=0))}buildSampleLists(){for(let t=0;t<this.moov.traks.length;t++)this.buildTrakSampleLists(this.moov.traks[t])}buildTrakSampleLists(t){let e,i,s,n,a,o;t.samples=[],t.samples_duration=0,t.samples_size=0;let h=t.mdia.minf.stbl.stco||t.mdia.minf.stbl.co64,c=t.mdia.minf.stbl.stsc,d=t.mdia.minf.stbl.stsz||t.mdia.minf.stbl.stz2,p=t.mdia.minf.stbl.stts,_=t.mdia.minf.stbl.ctts,x=t.mdia.minf.stbl.stss,b=t.mdia.minf.stbl.stsd,S=t.mdia.minf.stbl.subs,k=t.mdia.minf.stbl.stdp,P=t.mdia.minf.stbl.sbgps,F=t.mdia.minf.stbl.sgpds,z=-1,B=-1,L=-1,ln=-1,vn=0,T=0,M=0;if(R.initSampleGroups(t,void 0,P,F),!(typeof d>"u")){for(e=0;e<d.sample_sizes.length;e++){let g={number:e,track_id:t.tkhd.track_id,timescale:t.mdia.mdhd.timescale,alreadyRead:0,size:d.sample_sizes[e]};t.samples[e]=g,t.samples_size+=g.size,e===0?(s=1,i=0,g.chunk_index=s,g.chunk_run_index=i,o=c.samples_per_chunk[i],a=0,i+1<c.first_chunk.length?n=c.first_chunk[i+1]-1:n=1/0):e<o?(g.chunk_index=s,g.chunk_run_index=i):(s++,g.chunk_index=s,a=0,s<=n||(i++,i+1<c.first_chunk.length?n=c.first_chunk[i+1]-1:n=1/0),g.chunk_run_index=i,o+=c.samples_per_chunk[i]),g.description_index=c.sample_description_index[g.chunk_run_index]-1,g.description=b.entries[g.description_index],g.offset=h.chunk_offsets[g.chunk_index-1]+a,a+=g.size,e>z&&(B++,z<0&&(z=0),z+=p.sample_counts[B]),e>0?(t.samples[e-1].duration=p.sample_deltas[B],t.samples_duration+=t.samples[e-1].duration,g.dts=t.samples[e-1].dts+t.samples[e-1].duration):g.dts=0,_?(e>=L&&(ln++,L<0&&(L=0),L+=_.sample_counts[ln]),g.cts=t.samples[e].dts+_.sample_offsets[ln]):g.cts=g.dts,x?(e===x.sample_numbers[vn]-1?(g.is_sync=!0,vn++):(g.is_sync=!1,g.degradation_priority=0),S&&S.entries[T].sample_delta+M===e+1&&(g.subsamples=S.entries[T].subsamples,M+=S.entries[T].sample_delta,T++)):g.is_sync=!0,R.process_sdtp(t.mdia.minf.stbl.sdtp,g,g.number),k?g.degradation_priority=k.priority[e]:g.degradation_priority=0,S&&S.entries[T].sample_delta+M===e&&(g.subsamples=S.entries[T].subsamples,M+=S.entries[T].sample_delta),(P.length>0||F.length>0)&&R.setSampleGroupProperties(t,g,e,t.sample_groups_info)}e>0&&(t.samples[e-1].duration=Math.max(t.mdia.mdhd.duration-t.samples[e-1].dts,0),t.samples_duration+=t.samples[e-1].duration)}}updateSampleLists(){let t,e,i,s,n;if(this.moov!==void 0)for(;this.lastMoofIndex<this.moofs.length;){let a=this.moofs[this.lastMoofIndex];if(this.lastMoofIndex++,a.type==="moof"){let o=a;for(let h=0;h<o.trafs.length;h++){let c=o.trafs[h],d=this.getTrackById(c.tfhd.track_id),p=this.getTrexById(c.tfhd.track_id);c.tfhd.flags&2?t=c.tfhd.default_sample_description_index:t=p?p.default_sample_description_index:1,c.tfhd.flags&8?e=c.tfhd.default_sample_duration:e=p?p.default_sample_duration:0,c.tfhd.flags&16?i=c.tfhd.default_sample_size:i=p?p.default_sample_size:0,c.tfhd.flags&32?s=c.tfhd.default_sample_flags:s=p?p.default_sample_flags:0,c.sample_number=0,c.sbgps.length>0&&R.initSampleGroups(d,c,c.sbgps,d.mdia.minf.stbl.sgpds,c.sgpds);for(let _=0;_<c.truns.length;_++){let x=c.truns[_];for(let b=0;b<x.sample_count;b++){let S=t-1,k=s;x.flags&1024?k=x.sample_flags[b]:b===0&&x.flags&4&&(k=x.first_sample_flags);let P=i;x.flags&512&&(P=x.sample_size[b]),d.samples_size+=P;let F=e;x.flags&256&&(F=x.sample_duration[b]),d.samples_duration+=F;let z;d.first_traf_merged||b>0?z=d.samples[d.samples.length-1].dts+d.samples[d.samples.length-1].duration:(c.tfdt?z=c.tfdt.baseMediaDecodeTime:z=0,d.first_traf_merged=!0);let B=z;x.flags&2048&&(B=z+x.sample_composition_time_offset[b]);let L=!!(c.tfhd.flags&1),ln=!!(c.tfhd.flags&131072),vn=!!(x.flags&1),T=0;L?T=c.tfhd.base_data_offset:ln||_===0?T=o.start:T=n;let M;_===0&&b===0?vn?M=T+x.data_offset:M=T:M=n,n=M+P;let g=c.sample_number;c.sample_number++;let Fn={cts:B,description_index:S,description:d.mdia.minf.stbl.stsd.entries[S],dts:z,duration:F,moof_number:this.lastMoofIndex,number_in_traf:g,number:d.samples.length,offset:M,size:P,timescale:d.mdia.mdhd.timescale,track_id:d.tkhd.track_id,is_sync:!(k>>16&1),is_leading:k>>26&3,depends_on:k>>24&3,is_depended_on:k>>22&3,has_redundancy:k>>20&3,degradation_priority:k&65535};c.first_sample_index=d.samples.length,d.samples.push(Fn),(c.sbgps.length>0||c.sgpds.length>0||d.mdia.minf.stbl.sbgps.length>0||d.mdia.minf.stbl.sgpds.length>0)&&R.setSampleGroupProperties(d,Fn,Fn.number_in_traf,c.sample_groups_info)}}if(c.subs){d.has_fragment_subsamples=!0;let _=c.first_sample_index;for(let x=0;x<c.subs.entries.length;x++){_+=c.subs.entries[x].sample_delta;let b=d.samples[_-1];b.subsamples=c.subs.entries[x].subsamples}}}}}}getSample(t,e){let i=t.samples[e];if(this.moov){if(!i.data)i.data=new Uint8Array(i.size),i.alreadyRead=0,this.samplesDataSize+=i.size,l.debug("ISOFile","Allocating sample #"+e+" on track #"+t.tkhd.track_id+" of size "+i.size+" (total: "+this.samplesDataSize+")");else if(i.alreadyRead===i.size)return i;for(;;){let s=this.stream,n=s.findPosition(!0,i.offset+i.alreadyRead,!1),a,o;if(n>-1)a=s.buffers[n],o=a.fileStart;else for(let h of this.mdats){if(!h.stream){l.debug("ISOFile","mdat stream not yet fully read for #"+this.mdats.indexOf(h)+" mdat");continue}if(n=h.stream.findPosition(!0,i.offset+i.alreadyRead-h.start-h.hdr_size,!1),n>-1){s=h.stream,a=h.stream.buffers[n],o=h.start+h.hdr_size+a.fileStart;break}}if(a){let h=a.byteLength-(i.offset+i.alreadyRead-o);if(i.size-i.alreadyRead<=h)return l.debug("ISOFile","Getting sample #"+e+" data (alreadyRead: "+i.alreadyRead+" offset: "+(i.offset+i.alreadyRead-o)+" read size: "+(i.size-i.alreadyRead)+" full size: "+i.size+")"),w.memcpy(i.data.buffer,i.alreadyRead,a,i.offset+i.alreadyRead-o,i.size-i.alreadyRead),a.usedBytes+=i.size-i.alreadyRead,s.logBufferLevel(),i.alreadyRead=i.size,i;if(h===0)return;l.debug("ISOFile","Getting sample #"+e+" partial data (alreadyRead: "+i.alreadyRead+" offset: "+(i.offset+i.alreadyRead-o)+" read size: "+h+" full size: "+i.size+")"),w.memcpy(i.data.buffer,i.alreadyRead,a,i.offset+i.alreadyRead-o,h),i.alreadyRead+=h,a.usedBytes+=h,s.logBufferLevel()}else return}}}releaseSample(t,e){let i=t.samples[e];return i.data?(this.samplesDataSize-=i.size,i.data=void 0,i.alreadyRead=0,i.size):0}getAllocatedSampleDataSize(){return this.samplesDataSize}getCodecs(){let t="";for(let e=0;e<this.moov.traks.length;e++){let i=this.moov.traks[e];e>0&&(t+=","),t+=i.mdia.minf.stbl.stsd.entries[0].getCodec()}return t}getTrexById(t){if(!(!this.moov||!this.moov.mvex))for(let e=0;e<this.moov.mvex.trexs.length;e++){let i=this.moov.mvex.trexs[e];if(i.track_id===t)return i}}getTrackById(t){if(this.moov)for(let e=0;e<this.moov.traks.length;e++){let i=this.moov.traks[e];if(i.tkhd.track_id===t)return i}}flattenItemInfo(){let t=this.items,e=this.entity_groups,i=this.meta;if(!(!i||!i.hdlr||!i.iinf)){for(let s=0;s<i.iinf.item_infos.length;s++){let n=i.iinf.item_infos[s].item_ID;t[n]={id:n,name:i.iinf.item_infos[s].item_name,ref_to:[],content_type:i.iinf.item_infos[s].content_type,content_encoding:i.iinf.item_infos[s].content_encoding,item_uri_type:i.iinf.item_infos[s].item_uri_type,type:i.iinf.item_infos[s].item_type?i.iinf.item_infos[s].item_type:"mime",protection:i.iinf.item_infos[s].item_protection_index>0?i.ipro.protections[i.iinf.item_infos[s].item_protection_index-1]:void 0}}if(i.grpl)for(let s=0;s<i.grpl.boxes.length;s++){let n=i.grpl.boxes[s];e[n.group_id]={id:n.group_id,entity_ids:n.entity_ids,type:n.type}}if(i.iloc)for(let s=0;s<i.iloc.items.length;s++){let n=i.iloc.items[s],a=t[n.item_ID];n.data_reference_index!==0&&(l.warn("Item storage with reference to other files: not supported"),a.source=i.dinf.boxes[n.data_reference_index-1]),a.extents=[],a.size=0;for(let o=0;o<n.extents.length;o++)a.extents[o]={offset:n.extents[o].extent_offset+n.base_offset,length:n.extents[o].extent_length,alreadyRead:0},n.construction_method===1&&(a.extents[o].offset+=i.idat.start+i.idat.hdr_size),a.size+=a.extents[o].length}if(i.pitm){let s=i.pitm.item_id;t[s]?t[s].primary=!0:l.warn("ISOFile","Primary item_id #"+s+" does not exist in items")}if(i.iref)for(let s=0;s<i.iref.references.length;s++){let n=i.iref.references[s];for(let a=0;a<n.references.length;a++)t[n.from_item_ID].ref_to.push({type:n.type,id:n.references[a]})}if(i.iprp)for(let s=0;s<i.iprp.ipmas.length;s++){let n=i.iprp.ipmas[s];for(let a=0;a<n.associations.length;a++){let o=n.associations[a],h=t[o.id]??e[o.id];if(h){h.properties===void 0&&(h.properties={boxes:[]});for(let c=0;c<o.props.length;c++){let d=o.props[c];if(d.property_index>0&&d.property_index-1<i.iprp.ipco.boxes.length){let p=i.iprp.ipco.boxes[d.property_index-1];h.properties[p.type]=p,h.properties.boxes.push(p)}}}}}}}getItem(t){if(!this.meta)return;let e=this.items[t];if(!e.data&&e.size)e.data=new Uint8Array(e.size),e.alreadyRead=0,this.itemsDataSize+=e.size,l.debug("ISOFile","Allocating item #"+t+" of size "+e.size+" (total: "+this.itemsDataSize+")");else if(e.alreadyRead===e.size)return e;for(let i=0;i<e.extents.length;i++){let s=e.extents[i];if(s.alreadyRead!==s.length){let n=this.stream.findPosition(!0,s.offset+s.alreadyRead,!1);if(n>-1){let a=this.stream.buffers[n],o=a.byteLength-(s.offset+s.alreadyRead-a.fileStart);if(s.length-s.alreadyRead<=o)l.debug("ISOFile","Getting item #"+t+" extent #"+i+" data (alreadyRead: "+s.alreadyRead+" offset: "+(s.offset+s.alreadyRead-a.fileStart)+" read size: "+(s.length-s.alreadyRead)+" full extent size: "+s.length+" full item size: "+e.size+")"),w.memcpy(e.data.buffer,e.alreadyRead,a,s.offset+s.alreadyRead-a.fileStart,s.length-s.alreadyRead),(!this.parsingMdat||this.discardMdatData)&&(a.usedBytes+=s.length-s.alreadyRead),this.stream.logBufferLevel(),e.alreadyRead+=s.length-s.alreadyRead,s.alreadyRead=s.length;else{l.debug("ISOFile","Getting item #"+t+" extent #"+i+" partial data (alreadyRead: "+s.alreadyRead+" offset: "+(s.offset+s.alreadyRead-a.fileStart)+" read size: "+o+" full extent size: "+s.length+" full item size: "+e.size+")"),w.memcpy(e.data.buffer,e.alreadyRead,a,s.offset+s.alreadyRead-a.fileStart,o),s.alreadyRead+=o,e.alreadyRead+=o,(!this.parsingMdat||this.discardMdatData)&&(a.usedBytes+=o),this.stream.logBufferLevel();return}}else return}}if(e.alreadyRead===e.size)return e}releaseItem(t){let e=this.items[t];if(e.data){this.itemsDataSize-=e.size,e.data=void 0,e.alreadyRead=0;for(let i=0;i<e.extents.length;i++){let s=e.extents[i];s.alreadyRead=0}return e.size}else return 0}processItems(t){for(let e in this.items){let i=this.items[e];this.getItem(i.id),t&&!i.sent&&(t(i),i.sent=!0,i.data=void 0)}}hasItem(t){for(let e in this.items){let i=this.items[e];if(i.name===t)return i.id}return-1}getMetaHandler(){if(this.meta)return this.meta.hdlr.handler}getPrimaryItem(){if(this.meta&&this.meta.pitm)return this.getItem(this.meta.pitm.item_id)}itemToFragmentedTrackFile({itemId:t}={}){let e;if(t?e=this.getItem(t):e=this.getPrimaryItem(),!e)return;let i=new R;i.discardMdatData=!1;let s={type:e.type,description_boxes:e.properties.boxes};e.properties.ispe&&(s.width=e.properties.ispe.image_width,s.height=e.properties.ispe.image_height);let n=i.addTrack(s);if(n)return i.addSample(n,e.data),i}processIncompleteBox(t){if(t.type==="mdat"){let e=new dn(t.size);return this.parsingMdat=e,this.boxes.push(e),this.mdats.push(e),e.start=t.start,e.hdr_size=t.hdr_size,e.original_size=t.original_size,this.stream.addUsedBytes(e.hdr_size),this.lastBoxStartPosition=e.start+e.size,this.stream.seek(e.start+e.size,!1,this.discardMdatData)?(this.transferMdatData(),this.parsingMdat=void 0,!0):(this.moovStartFound?this.nextParsePosition=this.stream.findEndContiguousBuf():this.nextParsePosition=e.start+e.size,!1)}else return t.type==="moov"&&(this.moovStartFound=!0,this.mdats.length===0&&(this.isProgressive=!0)),this.stream.mergeNextBuffer&&this.stream.mergeNextBuffer()?(this.nextParsePosition=this.stream.getEndPosition(),!0):(t.type?this.moovStartFound?this.nextParsePosition=this.stream.getEndPosition():this.nextParsePosition=this.stream.getPosition()+t.size:this.nextParsePosition=this.stream.getEndPosition(),!1)}hasIncompleteMdat(){return this.parsingMdat!==void 0}transferMdatData(t){let e=t??this.parsingMdat;if(this.discardMdatData){l.debug("ISOFile","Discarding 'mdat' data, not transferring it to the mdat box stream");return}if(!e){l.warn("ISOFile","Cannot transfer 'mdat' data, no mdat box is being parsed");return}let i=this.stream.findPosition(!0,e.start+e.hdr_size,!1),s=this.stream.findPosition(!0,e.start+e.size,!1);if(i===-1||s===-1){l.warn("ISOFile","Cannot transfer 'mdat' data, start or end buffer not found");return}e.stream=new W;for(let n=i;n<=s;n++){let a=this.stream.buffers[n],o=n===i?e.start+e.hdr_size-a.fileStart:0,h=n===s?e.start+e.size-a.fileStart:a.byteLength;if(h>o){l.debug("ISOFile","Transferring 'mdat' data from buffer #"+n+" ("+o+" to "+h+")");let c=h-o,d=new H(c),p=e.stream.getAbsoluteEndPosition();w.memcpy(d,0,a,o,c),d.fileStart=p,e.stream.insertBuffer(d),a.usedBytes+=c}}}processIncompleteMdat(){let t=this.parsingMdat;return this.stream.seek(t.start+t.size,!1,this.discardMdatData)?(l.debug("ISOFile","Found 'mdat' end in buffered data"),this.transferMdatData(),this.parsingMdat=void 0,!0):(this.nextParsePosition=this.stream.findEndContiguousBuf(),!1)}restoreParsePosition(){return this.stream.seek(this.lastBoxStartPosition,!0,this.discardMdatData)}saveParsePosition(){this.lastBoxStartPosition=this.stream.getPosition()}updateUsedBytes(t,e){this.stream.addUsedBytes&&(t.type==="mdat"?(this.stream.addUsedBytes(t.hdr_size),this.discardMdatData&&this.stream.addUsedBytes(t.size-t.hdr_size)):this.stream.addUsedBytes(t.size))}addBox(t){return u.prototype.addBox.call(this,t)}init(t={}){let e=this.addBox(new oa);e.major_brand=t.brands&&t.brands[0]||"iso4",e.minor_version=0,e.compatible_brands=t.brands||["iso4"];let i=this.addBox(new pn);i.addBox(new En);let s=i.addBox(new pa);return s.timescale=t.timescale||600,s.rate=t.rate||65536,s.creation_time=0,s.modification_time=0,s.duration=t.duration||0,s.volume=t.width?0:256,s.matrix=[65536,0,0,0,65536,0,0,0,1073741824],s.next_track_id=1,this}addTrack(t={}){this.moov||this.init(t);let e=t||{};e.width=e.width||320,e.height=e.height||320,e.id=e.id||this.moov.mvhd.next_track_id,e.type=e.type||"avc1";let i=this.moov.addBox(new Qn);this.moov.mvhd.next_track_id=e.id+1;let s=i.addBox(new wa);s.flags=7,s.creation_time=0,s.modification_time=0,s.track_id=e.id,s.duration=e.duration||0,s.layer=e.layer||0,s.alternate_group=0,s.volume=1,s.matrix=[65536,0,0,0,65536,0,0,0,1073741824],s.width=e.width<<16,s.height=e.height<<16;let n=i.addBox(new Zn),a=n.addBox(new la);a.creation_time=0,a.modification_time=0,a.timescale=e.timescale||1,a.duration=e.media_duration||0,a.language=e.language||"und";let o=n.addBox(new ha);o.handler=e.hdlr||"vide",o.name=e.name||"Track created with MP4Box.js";let h=n.addBox(new aa);h.extended_language=e.language||"fr-FR";let c=n.addBox(new ta),d=A.sampleEntry[e.type];if(!d)return;let p=new d;if(p.data_reference_index=1,p instanceof v){let B=p,L=c.addBox(new ka);L.graphicsmode=0,L.opcolor=[0,0,0],B.width=e.width,B.height=e.height,B.horizresolution=72<<16,B.vertresolution=72<<16,B.frame_count=1,B.compressorname=e.type+" Compressor",B.depth=24,e.avcDecoderConfigRecord?B.addBox(new Xn(e.avcDecoderConfigRecord.byteLength)).parse(new w(e.avcDecoderConfigRecord)):e.hevcDecoderConfigRecord&&B.addBox(new ca(e.hevcDecoderConfigRecord.byteLength)).parse(new w(e.hevcDecoderConfigRecord))}else if(p instanceof C){let B=p,L=c.addBox(new xa);L.balance=e.balance||0,B.channel_count=e.channel_count||2,B.samplesize=e.samplesize||16,B.samplerate=e.samplerate||65536}else p instanceof wn?c.addBox(new Jn):p instanceof V?(c.addBox(new ga),p instanceof _a&&(p.namespace=e.namespace||"nonamespace",p.schema_location=e.schema_location||"",p.auxiliary_mime_types=e.auxiliary_mime_types||"")):p instanceof j?c.addBox(new fn):p instanceof gn?c.addBox(new fn):c.addBox(new fn);e.description&&p.addBox.call(p,e.description),e.description_boxes&&e.description_boxes.forEach(function(B){p.addBox.call(p,B)});let _=c.addBox(new ea).addBox(new na),x=new za;x.flags=1,_.addEntry(x);let b=c.addBox(new ia);b.addBox(new ba).addEntry(p);let S=b.addBox(new Sa);S.sample_counts=[],S.sample_deltas=[];let k=b.addBox(new ya);k.first_chunk=[],k.samples_per_chunk=[],k.sample_description_index=[];let P=b.addBox(new ma);P.chunk_offsets=[];let F=b.addBox(new va);F.sample_sizes=[];let z=this.moov.mvex.addBox(new zn);return z.track_id=e.id,z.default_sample_description_index=e.default_sample_description_index||1,z.default_sample_duration=e.default_sample_duration||0,z.default_sample_size=e.default_sample_size||0,z.default_sample_flags=e.default_sample_flags||0,this.buildTrakSampleLists(i),e.id}addSample(t,e,{sample_description_index:i,duration:s=1,cts:n=0,dts:a=0,is_sync:o=!1,is_leading:h=0,depends_on:c=0,is_depended_on:d=0,has_redundancy:p=0,degradation_priority:_=0,subsamples:x,offset:b=0}={}){let S=this.getTrackById(t);if(S===void 0)return;let k=i?i-1:0,P={number:S.samples.length,track_id:S.tkhd.track_id,timescale:S.mdia.mdhd.timescale,description_index:k,description:S.mdia.minf.stbl.stsd.entries[k],data:e,size:e.byteLength,alreadyRead:e.byteLength,duration:s,cts:n,dts:a,is_sync:o,is_leading:h,depends_on:c,is_depended_on:d,has_redundancy:p,degradation_priority:_,offset:b,subsamples:x};S.samples.push(P),S.samples_size+=P.size,S.samples_duration+=P.duration,S.first_dts===void 0&&(S.first_dts=a),this.processSamples();let F=this.addBox(this.createMoof([P]));F.computeSize(),F.trafs[0].truns[0].data_offset=F.size+8;let z=this.addBox(new dn);return z.data=new Uint8Array(e),P}createMoof(t){if(t.length===0)return;if(t.some(d=>d.track_id!==t[0].track_id))throw new Error("Cannot create moof for samples from different tracks: "+t.map(d=>d.track_id).join(", "));let e=t[0].track_id,i=this.getTrackById(e);if(!i)throw new Error("Cannot create moof for non-existing track: "+e);let s=new sa,n=s.addBox(new fa);n.sequence_number=++this.nextMoofNumber;let a=s.addBox(new ra),o=a.addBox(new Ua);o.track_id=e,o.flags=Xh;let h=a.addBox(new Ba);h.baseMediaDecodeTime=t[0].dts-(i.first_dts||0);let c=a.addBox(new Ea);c.flags=769|Jh|Qh,c.data_offset=0,c.first_sample_flags=0,c.sample_count=t.length;for(let d of t){let p=0;d.is_sync?p=1<<25:p=65536,c.sample_duration.push(d.duration),c.sample_size.push(d.size),c.sample_flags.push(p),c.sample_composition_time_offset.push(d.cts-d.dts)}return s}print(t){t.indent="";for(let e=0;e<this.boxes.length;e++)this.boxes[e]&&this.boxes[e].print(t)}};function Dh(r=!1,t){return new Ia(t,!r)}var Ui,Lh=(Ui=class extends f{constructor(...t){super(...t),this.box_name="EventMessageBox"}parse(t){this.parseFullHeader(t),this.version===1?(this.timescale=t.readUint32(),this.presentation_time=t.readUint64(),this.event_duration=t.readUint32(),this.id=t.readUint32(),this.scheme_id_uri=t.readCString(),this.value=t.readCString()):(this.scheme_id_uri=t.readCString(),this.value=t.readCString(),this.timescale=t.readUint32(),this.presentation_time_delta=t.readUint32(),this.event_duration=t.readUint32(),this.id=t.readUint32());let e=this.size-this.hdr_size-(16+(this.scheme_id_uri.length+1)+(this.value.length+1));this.version===1&&(e-=4),this.message_data=t.readUint8Array(e)}write(t){this.version=0,this.flags=0,this.size=16+this.message_data.length+(this.scheme_id_uri.length+1)+(this.value.length+1),this.writeHeader(t),t.writeCString(this.scheme_id_uri),t.writeCString(this.value),t.writeUint32(this.timescale),t.writeUint32(this.presentation_time_delta),t.writeUint32(this.event_duration),t.writeUint32(this.id),t.writeUint8Array(this.message_data)}},Ui.fourcc="emsg",Ui),wi,Hh=(wi=class extends f{constructor(...t){super(...t),this.box_name="CompressedSubsegmentIndexBox"}parse(t){this.parseFullHeader(t),this.subsegments=[];let e=t.readUint32();for(let i=0;i<e;i++){let s={};this.subsegments.push(s),s.ranges=[];let n=t.readUint32();for(let a=0;a<n;a++){let o={};s.ranges.push(o),o.level=t.readUint8(),o.range_size=t.readUint24()}}}},wi.fourcc="ssix",wi),Ei,Oh=(Ei=class extends u{constructor(...t){super(...t),this.box_name="SegmentTypeBox"}parse(t){let e=this.size-this.hdr_size;this.major_brand=t.readString(4),this.minor_version=t.readUint32(),e-=8,this.compatible_brands=[];let i=0;for(;e>=4;)this.compatible_brands[i]=t.readString(4),e-=4,i++}write(t){this.size=8+4*this.compatible_brands.length,this.writeHeader(t),t.writeString(this.major_brand,void 0,4),t.writeUint32(this.minor_version);for(let e=0;e<this.compatible_brands.length;e++)t.writeString(this.compatible_brands[e],void 0,4)}},Ei.fourcc="styp",Ei);var nc=Mn({Descriptor:()=>Y,ES_Descriptor:()=>Pa,MPEG4DescriptorParser:()=>Vh}),Mh=3,An=4,Ca=5,Rh=6,Y=class Nh{constructor(t,e){this.tag=t,this.size=e,this.descs=[]}parse(t){this.data=t.readUint8Array(this.size)}findDescriptor(t){for(let e=0;e<this.descs.length;e++)if(this.descs[e].tag===t)return this.descs[e]}parseOneDescriptor(t){let e=0,i=t.readUint8(),s=t.readUint8();for(;s&128;)e=(e<<7)+(s&127),s=t.readUint8();e=(e<<7)+(s&127),l.debug("Descriptor","Found "+(Tn[i]||"Descriptor "+i)+", size "+e+" at position "+t.getPosition());let n=Tn[i]?new cc[Tn[i]](e):new Nh(e);return n.parse(t),n}parseRemainingDescriptors(t){let e=t.getPosition();for(;t.getPosition()<e+this.size;){let i=this.parseOneDescriptor?.(t);this.descs.push(i)}}},Pa=class extends Y{constructor(r){super(Mh,r)}parse(r){if(this.ES_ID=r.readUint16(),this.flags=r.readUint8(),this.size-=3,this.flags&128?(this.dependsOn_ES_ID=r.readUint16(),this.size-=2):this.dependsOn_ES_ID=0,this.flags&64){let t=r.readUint8();this.URL=r.readString(t),this.size-=t+1}else this.URL="";this.flags&32?(this.OCR_ES_ID=r.readUint16(),this.size-=2):this.OCR_ES_ID=0,this.parseRemainingDescriptors(r)}getOTI(){let r=this.findDescriptor(An);return r?r.oti:0}getAudioConfig(){let r=this.findDescriptor(An);if(!r)return;let t=r.findDescriptor(Ca);if(t&&t.data){let e=(t.data[0]&248)>>3;return e===31&&t.data.length>=2&&(e=32+((t.data[0]&7)<<3)+((t.data[1]&224)>>5)),e}}},ac=class extends Y{constructor(r){super(An,r)}parse(r){this.oti=r.readUint8(),this.streamType=r.readUint8(),this.upStream=(this.streamType>>1&1)!==0,this.streamType=this.streamType>>>2,this.bufferSize=r.readUint24(),this.maxBitrate=r.readUint32(),this.avgBitrate=r.readUint32(),this.size-=13,this.parseRemainingDescriptors(r)}},oc=class extends Y{constructor(r){super(Ca,r)}},hc=class extends Y{constructor(r){super(Rh,r)}},cc={Descriptor:Y,ES_Descriptor:Pa,DecoderConfigDescriptor:ac,DecoderSpecificInfo:oc,SLConfigDescriptor:hc},Tn={[Mh]:"ES_Descriptor",[An]:"DecoderConfigDescriptor",[Ca]:"DecoderSpecificInfo",[Rh]:"SLConfigDescriptor"},Vh=class{constructor(){this.parseOneDescriptor=Y.prototype.parseOneDescriptor}getDescriptorName(r){return Tn[r]}},lc=class{parseSample(r){let t=[],e=new W(H.fromArrayBuffer(r.buffer,0));for(;!e.isEof();){let i=D(e,!1);i.code===1&&i.box?.type==="vttc"&&t.push(i.box)}return t}getText(r,t,e){function i(o,h){let c=o.toString();return c.length>=h?c:new Array(h-c.length+1).join("0")+c}function s(o){let h=Math.floor(o/3600),c=Math.floor((o-h*3600)/60),d=Math.floor(o-h*3600-c*60),p=Math.floor((o-h*3600-c*60-d)*1e3);return""+i(h,2)+":"+i(c,2)+":"+i(d,2)+"."+i(p,3)}let n=this.parseSample(e),a="";for(let o=0;o<n.length;o++){let h=n[o];a+=s(r)+" --> "+s(t)+`\r
    `,a+=h.payl.text}return a}},dc=class{parseSample(r){let t={resources:[],documentString:"",document:void 0},e=new w(r.data.buffer);if(!r.subsamples||r.subsamples.length===0)t.documentString=e.readString(r.data.length);else if(t.documentString=e.readString(r.subsamples[0].size),r.subsamples.length>1)for(let i=1;i<r.subsamples.length;i++)t.resources[i]=e.readUint8Array(r.subsamples[i].size);return typeof DOMParser<"u"&&(t.document=new DOMParser().parseFromString(t.documentString,"application/xml")),t}},fc=class{parseSample(r){return new w(r.data.buffer).readString(r.data.length)}parseConfig(r){let t=new w(r.buffer);return t.readUint32(),t.readCString()}},pc=class{parseSample(r){let t=new w(r.data.buffer),e=t.readUint16();if(e!==0)return t.readString(e)}},zi,uc=(zi=class extends u{constructor(...t){super(...t),this.box_name="AV1LayeredImageIndexingProperty"}parse(t){let e=((t.readUint8()&1)+1)*16;this.layer_size=[];for(let i=0;i<3;i++)e===16?this.layer_size[i]=t.readUint16():this.layer_size[i]=t.readUint32()}},zi.fourcc="a1lx",zi),ki,_c=(ki=class extends u{constructor(...t){super(...t),this.box_name="OperatingPointSelectorProperty"}parse(t){this.op_index=t.readUint8()}},ki.fourcc="a1op",ki),Ii,xc=(Ii=class extends f{constructor(...t){super(...t),this.box_name="AuxiliaryTypeProperty"}parse(t){this.parseFullHeader(t),this.aux_type=t.readCString();let e=this.size-this.hdr_size-(this.aux_type.length+1);this.aux_subtype=t.readUint8Array(e)}},Ii.fourcc="auxC",Ii),Ci,mc=(Ci=class extends u{constructor(...t){super(...t),this.box_name="BitRateBox"}parse(t){this.bufferSizeDB=t.readUint32(),this.maxBitrate=t.readUint32(),this.avgBitrate=t.readUint32()}},Ci.fourcc="btrt",Ci),Pi,gc=(Pi=class extends f{constructor(...t){super(...t),this.box_name="CodingConstraintsBox"}parse(t){this.parseFullHeader(t);let e=t.readUint8();this.all_ref_pics_intra=(e&128)===128,this.intra_pred_used=(e&64)===64,this.max_ref_per_pic=(e&63)>>2,t.readUint24()}},Pi.fourcc="ccst",Pi),Ti,yc=(Ti=class extends u{constructor(...t){super(...t),this.box_name="ComponentDefinitionBox"}parse(t){this.channel_count=t.readUint16(),this.channel_indexes=[],this.channel_types=[],this.channel_associations=[];for(let e=0;e<this.channel_count;e++)this.channel_indexes.push(t.readUint16()),this.channel_types.push(t.readUint16()),this.channel_associations.push(t.readUint16())}},Ti.fourcc="cdef",Ti),Ai,bc=(Ai=class extends u{constructor(...t){super(...t),this.box_name="CleanApertureBox"}parse(t){this.cleanApertureWidthN=t.readUint32(),this.cleanApertureWidthD=t.readUint32(),this.cleanApertureHeightN=t.readUint32(),this.cleanApertureHeightD=t.readUint32(),this.horizOffN=t.readUint32(),this.horizOffD=t.readUint32(),this.vertOffN=t.readUint32(),this.vertOffD=t.readUint32()}},Ai.fourcc="clap",Ai),Fi,vc=(Fi=class extends u{constructor(...t){super(...t),this.box_name="ContentLightLevelBox"}parse(t){this.max_content_light_level=t.readUint16(),this.max_pic_average_light_level=t.readUint16()}},Fi.fourcc="clli",Fi),Di,Sc=(Di=class extends u{constructor(...t){super(...t),this.box_name="CameraExtrinsicMatrixProperty"}parse(t){this.flags&1&&(this.pos_x=t.readInt32()),this.flags&2&&(this.pos_y=t.readInt32()),this.flags&4&&(this.pos_z=t.readInt32()),this.flags&8&&(this.version===0?this.flags&16?(this.quat_x=t.readInt32(),this.quat_y=t.readInt32(),this.quat_z=t.readInt32()):(this.quat_x=t.readInt16(),this.quat_y=t.readInt16(),this.quat_z=t.readInt16()):this.version),this.flags&32&&(this.id=t.readUint32())}},Di.fourcc="cmex",Di),Li,Bc=(Li=class extends u{constructor(...t){super(...t),this.box_name="CameraIntrinsicMatrixProperty"}parse(t){this.focal_length_x=t.readInt32(),this.principal_point_x=t.readInt32(),this.principal_point_y=t.readInt32(),this.flags&1&&(this.focal_length_y=t.readInt32(),this.skew_factor=t.readInt32())}},Li.fourcc="cmin",Li),Hi,Uc=(Hi=class extends f{constructor(...t){super(...t),this.box_name="CompressionConfigurationBox"}parse(t){this.parseFullHeader(t),this.compression_type=t.readString(4),this.compressed_unit_type=t.readUint8()}},Hi.fourcc="cmpC",Hi),Oi,wc=(Oi=class extends u{constructor(...t){super(...t),this.box_name="ComponentDefinitionBox"}parse(t){this.component_count=t.readUint32(),this.component_types=[],this.component_type_urls=[];for(let e=0;e<this.component_count;e++){let i=t.readUint16();this.component_types.push(i),i>=32768&&this.component_type_urls.push(t.readCString())}}},Oi.fourcc="cmpd",Oi),Mi,Ec=(Mi=class extends f{constructor(...t){super(...t),this.box_name="ChunkLargeOffsetBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.chunk_offsets=[],this.version===0)for(let i=0;i<e;i++)this.chunk_offsets.push(t.readUint64())}write(t){this.version=0,this.flags=0,this.size=4+8*this.chunk_offsets.length,this.writeHeader(t),t.writeUint32(this.chunk_offsets.length);for(let e=0;e<this.chunk_offsets.length;e++)t.writeUint64(this.chunk_offsets[e])}},Mi.fourcc="co64",Mi),Ri,zc=(Ri=class extends f{constructor(...t){super(...t),this.box_name="ContentLightLevelBox"}parse(t){this.parseFullHeader(t),this.maxCLL=t.readUint16(),this.maxFALL=t.readUint16()}},Ri.fourcc="CoLL",Ri),kc=class{toString(){let r="centre_azimuth: ";return r+=this.centre_azimuth,r+=" (",r+=this.centre_azimuth*2**-16,r+="\xB0), centre_elevation: ",r+=this.centre_elevation,r+=" (",r+=this.centre_elevation*2**-16,r+="\xB0), centre_tilt: ",r+=this.centre_tilt,r+=" (",r+=this.centre_tilt*2**-16,r+="\xB0)",this.range_included_flag&&(r+=", azimuth_range: ",r+=this.azimuth_range,r+=" (",r+=this.azimuth_range*2**-16,r+="\xB0), elevation_range: ",r+=this.elevation_range,r+=" (",r+=this.elevation_range*2**-16,r+="\xB0)"),this.interpolate_included_flag&&(r+=", interpolate: ",r+=this.interpolate),r}},Ic=class{toString(){let r="";return this.view_idc&&(r+="view_idc: ",r+=this.view_idc,r+=", "),r+="sphere_region: {",r+=this.sphere_region,r+="}",r}},Ni,Cc=(Ni=class extends f{constructor(...t){super(...t),this.box_name="CoverageInformationBox"}parse(t){this.parseFullHeader(t),this.coverage_shape_type=t.readUint8();let e=t.readUint8(),i=t.readInt8(),s=i&128;s&&(this.default_view_idc=(i&96)>>5),this.coverage_regions=new Array;for(let n=0;n<e;n++){let a=new Ic;s&&(a.view_idc=t.readUint8()>>6),a.sphere_region=this.parseSphereRegion(t,!0,!0),this.coverage_regions.push(a)}}parseSphereRegion(t,e,i){let s=new kc;return s.centre_azimuth=t.readInt32(),s.centre_elevation=t.readInt32(),s.centre_tilt=t.readInt32(),s.range_included_flag=e,e&&(s.azimuth_range=t.readUint32(),s.elevation_range=t.readUint32()),s.interpolate_included_flag=i,i&&(s.interpolate=(t.readUint8()&128)===128),s}},Ni.fourcc="covi",Ni),Vi,Pc=(Vi=class extends f{constructor(...t){super(...t),this.box_name="CopyrightBox"}parse(t){this.parseFullHeader(t),this.parseLanguage(t),this.notice=t.readCString()}},Vi.fourcc="cprt",Vi),Gi,Tc=(Gi=class extends f{constructor(...t){super(...t),this.box_name="CompatibleSchemeTypeBox"}parse(t){this.parseFullHeader(t),this.scheme_type=t.readString(4),this.scheme_version=t.readUint32(),this.flags&1&&(this.scheme_uri=t.readCString())}},Gi.fourcc="csch",Gi),yn=2147483647,ji,Ac=(ji=class extends f{constructor(...t){super(...t),this.box_name="CompositionToDecodeBox"}parse(t){this.parseFullHeader(t),this.version===0?(this.compositionToDTSShift=t.readInt32(),this.leastDecodeToDisplayDelta=t.readInt32(),this.greatestDecodeToDisplayDelta=t.readInt32(),this.compositionStartTime=t.readInt32(),this.compositionEndTime=t.readInt32()):this.version===1&&(this.compositionToDTSShift=t.readInt64(),this.leastDecodeToDisplayDelta=t.readInt64(),this.greatestDecodeToDisplayDelta=t.readInt64(),this.compositionStartTime=t.readInt64(),this.compositionEndTime=t.readInt64())}write(t){this.version=0,(this.compositionToDTSShift>yn||this.leastDecodeToDisplayDelta>yn||this.greatestDecodeToDisplayDelta>yn||this.compositionStartTime>yn||this.compositionEndTime>yn)&&(this.version=1),this.flags=0,this.version===0?(this.size=20,this.writeHeader(t),t.writeInt32(this.compositionToDTSShift),t.writeInt32(this.leastDecodeToDisplayDelta),t.writeInt32(this.greatestDecodeToDisplayDelta),t.writeInt32(this.compositionStartTime),t.writeInt32(this.compositionEndTime)):this.version===1&&(this.size=40,this.writeHeader(t),t.writeInt64(this.compositionToDTSShift),t.writeInt64(this.leastDecodeToDisplayDelta),t.writeInt64(this.greatestDecodeToDisplayDelta),t.writeInt64(this.compositionStartTime),t.writeInt64(this.compositionEndTime))}},ji.fourcc="cslg",ji),$i,Fc=($i=class extends f{constructor(...t){super(...t),this.box_name="CompositionOffsetBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.sample_counts=[],this.sample_offsets=[],this.version===0)for(let i=0;i<e;i++){this.sample_counts.push(t.readUint32());let s=t.readInt32();s<0&&l.warn("BoxParser","ctts box uses negative values without using version 1"),this.sample_offsets.push(s)}else if(this.version===1)for(let i=0;i<e;i++)this.sample_counts.push(t.readUint32()),this.sample_offsets.push(t.readInt32())}write(t){this.version=this.sample_offsets.some(e=>e<0)?1:0,this.flags=0,this.size=4+8*this.sample_counts.length,this.writeHeader(t),t.writeUint32(this.sample_counts.length);for(let e=0;e<this.sample_counts.length;e++)t.writeUint32(this.sample_counts[e]),this.version===1?t.writeInt32(this.sample_offsets[e]):t.writeUint32(this.sample_offsets[e])}unpack(t){let e=0;for(let i=0;i<this.sample_counts.length;i++)for(let s=0;s<this.sample_counts[i];s++)t[e].pts=t[e].dts+this.sample_offsets[i],e++}},$i.fourcc="ctts",$i),qi,Dc=(qi=class extends u{constructor(...t){super(...t),this.box_name="AC3SpecificBox"}parse(t){let e=t.readUint8(),i=t.readUint8(),s=t.readUint8();this.fscod=e>>6,this.bsid=e>>1&31,this.bsmod=(e&1)<<2|i>>6&3,this.acmod=i>>3&7,this.lfeon=i>>2&1,this.bit_rate_code=i&3|s>>5&7}},qi.fourcc="dac3",qi),Yi,Lc=(Yi=class extends u{constructor(...t){super(...t),this.box_name="EC3SpecificBox"}parse(t){let e=t.readUint16();this.data_rate=e>>3,this.num_ind_sub=e&7,this.ind_subs=[];for(let i=0;i<this.num_ind_sub+1;i++){let s=t.readUint8(),n=t.readUint8(),a=t.readUint8(),o={fscod:s>>6,bsid:s>>1&31,bsmod:(s&1)<<4|n>>4&15,acmod:n>>1&7,lfeon:n&1,num_dep_sub:a>>1&15};this.ind_subs.push(o),o.num_dep_sub>0&&(o.chan_loc=(a&1)<<8|t.readUint8())}}},Yi.fourcc="dec3",Yi),Wi,Hc=(Wi=class extends f{constructor(...t){super(...t),this.box_name="FLACSpecificBox"}parse(t){this.parseFullHeader(t);let e=127,i=128,s=[],n=["STREAMINFO","PADDING","APPLICATION","SEEKTABLE","VORBIS_COMMENT","CUESHEET","PICTURE","RESERVED"],a;do{a=t.readUint8();let o=Math.min(a&e,n.length-1);o?t.readUint8Array(t.readUint24()):(t.readUint8Array(13),this.samplerate=t.readUint32()>>12,t.readUint8Array(20)),s.push(n[o])}while(a&i);this.numMetadataBlocks=s.length+" ("+s.join(", ")+")"}},Wi.fourcc="dfLa",Wi),Ki,Oc=(Ki=class extends u{constructor(...t){super(...t),this.box_name="hintimmediateBytesSent"}parse(t){this.bytessent=t.readUint64()}},Ki.fourcc="dimm",Ki),Xi,Mc=(Xi=class extends u{constructor(...t){super(...t),this.box_name="hintlongestpacket"}parse(t){this.time=t.readUint32()}},Xi.fourcc="dmax",Xi),Ji,Rc=(Ji=class extends u{constructor(...t){super(...t),this.box_name="hintmediaBytesSent"}parse(t){this.bytessent=t.readUint64()}},Ji.fourcc="dmed",Ji),Qi,Nc=(Qi=class extends u{constructor(...t){super(...t),this.box_name="OpusSpecificBox"}parse(t){if(this.Version=t.readUint8(),this.OutputChannelCount=t.readUint8(),this.PreSkip=t.readUint16(),this.InputSampleRate=t.readUint32(),this.OutputGain=t.readInt16(),this.ChannelMappingFamily=t.readUint8(),this.ChannelMappingFamily!==0){this.StreamCount=t.readUint8(),this.CoupledCount=t.readUint8(),this.ChannelMapping=[];for(let e=0;e<this.OutputChannelCount;e++)this.ChannelMapping[e]=t.readUint8()}}write(t){if(this.size=11,this.ChannelMappingFamily!==0&&(this.size+=2+this.OutputChannelCount),this.writeHeader(t),t.writeUint8(this.Version),t.writeUint8(this.OutputChannelCount),t.writeUint16(this.PreSkip),t.writeUint32(this.InputSampleRate),t.writeInt16(this.OutputGain),t.writeUint8(this.ChannelMappingFamily),this.ChannelMappingFamily!==0){t.writeUint8(this.StreamCount),t.writeUint8(this.CoupledCount);for(let e=0;e<this.OutputChannelCount;e++)t.writeUint8(this.ChannelMapping[e])}}},Qi.fourcc="dOps",Qi),Zi,Vc=(Zi=class extends u{constructor(...t){super(...t),this.box_name="hintrepeatedBytesSent"}parse(t){this.bytessent=t.readUint64()}},Zi.fourcc="drep",Zi),ts,Gc=(ts=class extends f{constructor(...t){super(...t),this.box_name="EditListBox"}parse(t){this.parseFullHeader(t),this.entries=[];let e=t.readUint32();for(let i=0;i<e;i++){let s={segment_duration:this.version===1?t.readUint64():t.readUint32(),media_time:this.version===1?t.readInt64():t.readInt32(),media_rate_integer:t.readInt16(),media_rate_fraction:t.readInt16()};this.entries.push(s)}}write(t){let e=this.entries.some(i=>i.segment_duration>E||i.media_time>E)||this.version===1;this.version=e?1:0,this.size=4+12*this.entries.length,this.size+=e?8*this.entries.length:0,this.writeHeader(t),t.writeUint32(this.entries.length);for(let i=0;i<this.entries.length;i++){let s=this.entries[i];e?(t.writeUint64(s.segment_duration),t.writeInt64(s.media_time)):(t.writeUint32(s.segment_duration),t.writeInt32(s.media_time)),t.writeInt16(s.media_rate_integer),t.writeInt16(s.media_rate_fraction)}}},ts.fourcc="elst",ts),I=class extends f{parse(r){this.parseFullHeader(r),this.group_id=r.readUint32(),this.num_entities_in_group=r.readUint32(),this.entity_ids=[];for(let t=0;t<this.num_entities_in_group;t++){let e=r.readUint32();this.entity_ids.push(e)}}},es,jc=(es=class extends I{constructor(...t){super(...t),this.box_name="Auto exposure bracketing"}},es.fourcc="aebr",es),is,$c=(is=class extends I{constructor(...t){super(...t),this.box_name="Flash exposure information"}},is.fourcc="afbr",is),ss,qc=(ss=class extends I{constructor(...t){super(...t),this.box_name="Album collection"}},ss.fourcc="albc",ss),rs,Yc=(rs=class extends I{constructor(...t){super(...t),this.box_name="Alternative entity"}},rs.fourcc="altr",rs),ns,Wc=(ns=class extends I{constructor(...t){super(...t),this.box_name="Burst image"}},ns.fourcc="brst",ns),as,Kc=(as=class extends I{constructor(...t){super(...t),this.box_name="Depth of field bracketing"}},as.fourcc="dobr",as),os,Xc=(os=class extends I{constructor(...t){super(...t),this.box_name="Equivalent entity"}},os.fourcc="eqiv",os),hs,Jc=(hs=class extends I{constructor(...t){super(...t),this.box_name="Favorites collection"}},hs.fourcc="favc",hs),cs,Qc=(cs=class extends I{constructor(...t){super(...t),this.box_name="Focus bracketing"}},cs.fourcc="fobr",cs),ls,Zc=(ls=class extends I{constructor(...t){super(...t),this.box_name="Image item with an audio track"}},ls.fourcc="iaug",ls),ds,tl=(ds=class extends I{constructor(...t){super(...t),this.box_name="Panorama"}},ds.fourcc="pano",ds),fs,el=(fs=class extends I{constructor(...t){super(...t),this.box_name="Slideshow"}},fs.fourcc="slid",fs),ps,il=(ps=class extends I{constructor(...t){super(...t),this.box_name="Stereo"}},ps.fourcc="ster",ps),us,sl=(us=class extends I{constructor(...t){super(...t),this.box_name="Time-synchronized capture"}},us.fourcc="tsyn",us),_s,rl=(_s=class extends I{constructor(...t){super(...t),this.box_name="White balance bracketing"}},_s.fourcc="wbbr",_s),xs,nl=(xs=class extends I{constructor(...t){super(...t),this.box_name="Progressive rendering"}},xs.fourcc="prgr",xs),ms,al=(ms=class extends I{constructor(...t){super(...t),this.box_name="Image pyramid"}parse(t){this.parseFullHeader(t),this.group_id=t.readUint32(),this.num_entities_in_group=t.readUint32(),this.entity_ids=[];for(let e=0;e<this.num_entities_in_group;e++){let i=t.readUint32();this.entity_ids.push(i)}this.tile_size_x=t.readUint16(),this.tile_size_y=t.readUint16(),this.layer_binning=[],this.tiles_in_layer_column_minus1=[],this.tiles_in_layer_row_minus1=[];for(let e=0;e<this.num_entities_in_group;e++)this.layer_binning[e]=t.readUint16(),this.tiles_in_layer_row_minus1[e]=t.readUint16(),this.tiles_in_layer_column_minus1[e]=t.readUint16()}},ms.fourcc="pymd",ms),gs,ol=(gs=class extends u{constructor(...t){super(...t),this.box_name="FieldHandlingBox"}parse(t){this.fieldCount=t.readUint8(),this.fieldOrdering=t.readUint8()}},gs.fourcc="fiel",gs),ys,hl=(ys=class extends u{constructor(...t){super(...t),this.box_name="OriginalFormatBox"}parse(t){this.data_format=t.readString(4)}},ys.fourcc="frma",ys),bs,cl=(bs=class extends u{constructor(...t){super(...t),this.box_name="ImageMirror"}parse(t){let e=t.readUint8();this.reserved=e>>7,this.axis=e&1}},bs.fourcc="imir",bs),vs,ll=(vs=class extends f{constructor(...t){super(...t),this.box_name="ItemPropertyAssociationBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();this.associations=[];for(let i=0;i<e;i++){let s=this.version<1?t.readUint16():t.readUint32(),n=[],a=t.readUint8();for(let o=0;o<a;o++){let h=t.readUint8();n.push({essential:(h&128)>>7===1,property_index:this.flags&1?(h&127)<<8|t.readUint8():h&127})}this.associations.push({id:s,props:n})}}},vs.fourcc="ipma",vs),Ss,dl=(Ss=class extends u{constructor(...t){super(...t),this.box_name="ImageRotation"}parse(t){this.angle=t.readUint8()&3}},Ss.fourcc="irot",Ss),Bs,fl=(Bs=class extends f{constructor(...t){super(...t),this.box_name="ImageSpatialExtentsProperty"}parse(t){this.parseFullHeader(t),this.image_width=t.readUint32(),this.image_height=t.readUint32()}},Bs.fourcc="ispe",Bs),Us,pl=(Us=class extends f{constructor(...t){super(...t),this.box_name="TAITimestampBox"}parse(t){this.TAI_timestamp=t.readUint64();let e=t.readUint8();this.sychronization_state=e>>7&1,this.timestamp_generation_failure=e>>6&1,this.timestamp_is_modified=e>>5&1}},Us.fourcc="itai",Us),ws,ul=(ws=class extends f{constructor(...t){super(...t),this.box_name="KindBox"}parse(t){this.parseFullHeader(t),this.schemeURI=t.readCString(),this.isEndOfBox(t)||(this.value=t.readCString())}write(t){this.version=0,this.flags=0,this.size=this.schemeURI.length+1+(this.value?this.value.length+1:0),this.writeHeader(t),t.writeCString(this.schemeURI),this.value&&t.writeCString(this.value)}},ws.fourcc="kind",ws),Es,_l=(Es=class extends f{constructor(...t){super(...t),this.box_name="LevelAssignmentBox"}parse(t){this.parseFullHeader(t);let e=t.readUint8();this.levels=[];for(let i=0;i<e;i++){let s={};this.levels[i]=s,s.track_ID=t.readUint32();let n=t.readUint8();switch(s.padding_flag=n>>7,s.assignment_type=n&127,s.assignment_type){case 0:s.grouping_type=t.readString(4);break;case 1:s.grouping_type=t.readString(4),s.grouping_type_parameter=t.readUint32();break;case 2:break;case 3:break;case 4:s.sub_track_id=t.readUint32();break;default:l.warn("BoxParser",`Unknown level assignment type: ${s.assignment_type}`)}}}},Es.fourcc="leva",Es),zs,xl=(zs=class extends u{constructor(...t){super(...t),this.box_name="LHEVCConfigurationBox"}parse(t){this.configurationVersion=t.readUint8(),this.min_spatial_segmentation_idc=t.readUint16()&4095,this.parallelismType=t.readUint8()&3;let e=t.readUint8();this.numTemporalLayers=(e&13)>>3,this.temporalIdNested=(e&4)>>2,this.lengthSizeMinusOne=e&3,this.nalu_arrays=[];let i=t.readUint8();for(let s=0;s<i;s++){let n=[];this.nalu_arrays.push(n),e=t.readUint8(),n.completeness=(e&128)>>7,n.nalu_type=e&63;let a=t.readUint16();for(let o=0;o<a;o++){let h=t.readUint16();n.push({data:t.readUint8Array(h)})}}}},zs.fourcc="lhvC",zs),ks,ml=(ks=class extends u{constructor(...t){super(...t),this.box_name="LayerSelectorProperty"}parse(t){this.layer_id=t.readUint16()}},ks.fourcc="lsel",ks),Is,gl=(Is=class extends u{constructor(...t){super(...t),this.box_name="hintmaxrate"}parse(t){this.period=t.readUint32(),this.bytes=t.readUint32()}},Is.fourcc="maxr",Is),Pn=class{constructor(r,t){this.x=r,this.y=t}toString(){return"("+this.x+","+this.y+")"}},Cs,yl=(Cs=class extends u{constructor(...t){super(...t),this.box_name="MasteringDisplayColourVolumeBox"}parse(t){this.display_primaries=[],this.display_primaries[0]=new Pn(t.readUint16(),t.readUint16()),this.display_primaries[1]=new Pn(t.readUint16(),t.readUint16()),this.display_primaries[2]=new Pn(t.readUint16(),t.readUint16()),this.white_point=new Pn(t.readUint16(),t.readUint16()),this.max_display_mastering_luminance=t.readUint32(),this.min_display_mastering_luminance=t.readUint32()}},Cs.fourcc="mdcv",Cs),Ps,bl=(Ps=class extends f{constructor(...t){super(...t),this.box_name="MovieFragmentRandomAccessOffsetBox"}parse(t){this.parseFullHeader(t),this._size=t.readUint32()}},Ps.fourcc="mfro",Ps),Ts,vl=(Ts=class extends f{constructor(...t){super(...t),this.box_name="MaskConfigurationProperty"}parse(t){this.parseFullHeader(t),this.bits_per_pixel=t.readUint8()}},Ts.fourcc="mskC",Ts),As,Sl=(As=class extends u{constructor(...t){super(...t),this.box_name="hintPacketsSent"}parse(t){this.packetssent=t.readUint32()}},As.fourcc="npck",As),Fs,Bl=(Fs=class extends u{constructor(...t){super(...t),this.box_name="hintPacketsSent"}parse(t){this.packetssent=t.readUint64()}},Fs.fourcc="nump",Fs),Ul=class{constructor(r,t){this.pad1=r,this.pad2=t}},Ds,wl=(Ds=class extends f{constructor(...t){super(...t),this.box_name="PaddingBitsBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();this.padbits=[];for(let i=0;i<Math.floor((e+1)/2);i++){let s=t.readUint8(),n=(s&112)>>4,a=s&7;this.padbits.push(new Ul(n,a))}}},Ds.fourcc="padb",Ds),Ls,El=(Ls=class extends u{constructor(...t){super(...t),this.box_name="PixelAspectRatioBox"}parse(t){this.hSpacing=t.readUint32(),this.vSpacing=t.readUint32()}},Ls.fourcc="pasp",Ls),Hs,zl=(Hs=class extends u{constructor(...t){super(...t),this.box_name="CuePayloadBox"}parse(t){this.text=t.readString(this.size-this.hdr_size)}},Hs.fourcc="payl",Hs),Os,kl=(Os=class extends u{constructor(...t){super(...t),this.box_name="hintpayloadID"}parse(t){this.payloadID=t.readUint32();let e=t.readUint8();this.rtpmap_string=t.readString(e)}},Os.fourcc="payt",Os),Ms,Il=(Ms=class extends f{constructor(...t){super(...t),this.box_name="ProgressiveDownloadInfoBox",this.rate=[],this.initial_delay=[]}parse(t){this.parseFullHeader(t);let e=(this.size-this.hdr_size)/8;for(let i=0;i<e;i++)this.rate[i]=t.readUint32(),this.initial_delay[i]=t.readUint32()}},Ms.fourcc="pdin",Ms),Rs,Cl=(Rs=class extends f{constructor(...t){super(...t),this.box_name="PixelInformationProperty"}parse(t){this.parseFullHeader(t),this.num_channels=t.readUint8(),this.bits_per_channels=[];for(let e=0;e<this.num_channels;e++)this.bits_per_channels[e]=t.readUint8()}},Rs.fourcc="pixi",Rs),Ns,Pl=(Ns=class extends u{constructor(...t){super(...t),this.box_name="hintlargestpacket"}parse(t){this.bytes=t.readUint32()}},Ns.fourcc="pmax",Ns),Vs,Tl=(Vs=class extends f{constructor(...t){super(...t),this.box_name="ProgressiveDerivedImageItemInformationProperty"}parse(t){if(this.parseFullHeader(t),this.step_count=t.readUint16(),this.item_count=[],this.flags&2)for(let e=0;e<this.step_count;e++)this.item_count[e]=t.readUint16()}},Vs.fourcc="prdi",Vs),Gs,Al=(Gs=class extends f{constructor(...t){super(...t),this.box_name="ProjectionFormatBox"}parse(t){this.parseFullHeader(t),this.projection_type=t.readUint8()&31}},Gs.fourcc="prfr",Gs),js,Fl=(js=class extends f{constructor(...t){super(...t),this.box_name="ProducerReferenceTimeBox"}parse(t){this.parseFullHeader(t),this.ref_track_id=t.readUint32(),this.ntp_timestamp=t.readUint64(),this.version===0?this.media_time=t.readUint32():this.media_time=t.readUint64()}},js.fourcc="prft",js),$s,Dl=($s=class extends f{constructor(...t){super(...t),this.box_name="ProtectionSystemSpecificHeaderBox"}parse(t){if(this.parseFullHeader(t),this.system_id=$(t),this.kid=[],this.version>0){let i=t.readUint32();for(let s=0;s<i;s++)this.kid[s]=$(t)}let e=t.readUint32();e>0&&(this.protection_data=t.readUint8Array(e))}},$s.fourcc="pssh",$s),qs,Ll=(qs=class extends f{constructor(...t){super(...t),this.box_name="TrackCleanApertureDimensionsBox"}parse(t){this.parseFullHeader(t),this.width=t.readUint32(),this.height=t.readUint32()}},qs.fourcc="clef",qs);function Hl(r,t){if(r===bn.Types.UTF8)return new TextDecoder("utf-8").decode(t);let e=new DataView(t.buffer);if(r===bn.Types.BE_UNSIGNED_INT){if(t.length===1)return e.getUint8(0);if(t.length===2)return e.getUint16(0,!1);if(t.length===4)return e.getUint32(0,!1);if(t.length===8)return e.getBigUint64(0,!1);throw new Error("Unsupported ITIF_TYPE_BE_UNSIGNED_INT length "+t.length)}else if(r===bn.Types.BE_SIGNED_INT){if(t.length===1)return e.getInt8(0);if(t.length===2)return e.getInt16(0,!1);if(t.length===4)return e.getInt32(0,!1);if(t.length===8)return e.getBigInt64(0,!1);throw new Error("Unsupported ITIF_TYPE_BE_SIGNED_INT length "+t.length)}else if(r===bn.Types.BE_FLOAT32)return e.getFloat32(0,!1);l.warn("DataBox","Unsupported or unimplemented itif data type: "+r)}var K,bn=(K=class extends u{constructor(...t){super(...t),this.box_name="DataBox"}parse(t){this.valueType=t.readUint32(),this.country=t.readUint16(),this.country>255&&(t.seek(t.getPosition()-2),this.countryString=t.readString(2)),this.language=t.readUint16(),this.language>255&&(t.seek(t.getPosition()-2),this.parseLanguage(t)),this.raw=t.readUint8Array(this.size-this.hdr_size-8),this.value=Hl(this.valueType,this.raw)}},K.fourcc="data",K.Types={RESERVED:0,UTF8:1,UTF16:2,SJIS:3,UTF8_SORT:4,UTF16_SORT:5,JPEG:13,PNG:14,BE_SIGNED_INT:21,BE_UNSIGNED_INT:22,BE_FLOAT32:23,BE_FLOAT64:24,BMP:27,QT_ATOM:28,BE_SIGNED_INT8:65,BE_SIGNED_INT16:66,BE_SIGNED_INT32:67,BE_FLOAT32_POINT:70,BE_FLOAT32_DIMENSIONS:71,BE_FLOAT32_RECT:72,BE_SIGNED_INT64:74,BE_UNSIGNED_INT8:75,BE_UNSIGNED_INT16:76,BE_UNSIGNED_INT32:77,BE_UNSIGNED_INT64:78,BE_FLOAT64_AFFINE_TRANSFORM:79},K),Ys,Ol=(Ys=class extends f{constructor(...t){super(...t),this.box_name="TrackEncodedPixelsDimensionsBox"}parse(t){this.parseFullHeader(t),this.width=t.readUint32(),this.height=t.readUint32()}},Ys.fourcc="enof",Ys),Ws,Ml=(Ws=class extends u{constructor(...t){super(...t),this.box_name="IlstBox"}parse(t){this.list={};let e=this.size-this.hdr_size;for(;e>0;){let i=t.readUint32(),s=t.readUint32(),n=D(t,!1,i-8);n.code===1&&(this.list[s]=n.box),e-=i}}},Ws.fourcc="ilst",Ws),Ks,Rl=(Ks=class extends f{constructor(...t){super(...t),this.box_name="KeysBox"}parse(t){this.parseFullHeader(t),this.count=t.readUint32(),this.keys={};for(let e=0;e<this.count;e++){let i=t.readUint32();this.keys[e+1]=t.readString(i-4)}}},Ks.fourcc="keys",Ks),Xs,Nl=(Xs=class extends f{constructor(...t){super(...t),this.box_name="TrackProductionApertureDimensionsBox"}parse(t){this.parseFullHeader(t),this.width=t.readUint32(),this.height=t.readUint32()}},Xs.fourcc="prof",Xs),Js,Vl=(Js=class extends y{constructor(...t){super(...t),this.box_name="TrackApertureModeDimensionsBox",this.clefs=[],this.profs=[],this.enofs=[],this.subBoxNames=["clef","prof","enof"]}},Js.fourcc="tapt",Js),Qs,Gl=(Qs=class extends u{constructor(...t){super(...t),this.box_name="rtpmoviehintinformation"}parse(t){this.descriptionformat=t.readString(4),this.sdptext=t.readString(this.size-this.hdr_size-4)}},Qs.fourcc="rtp ",Qs),Zs,jl=(Zs=class extends f{constructor(...t){super(...t),this.box_name="SampleAuxiliaryInformationOffsetsBox"}parse(t){this.parseFullHeader(t),this.flags&1&&(this.aux_info_type=t.readString(4),this.aux_info_type_parameter=t.readUint32()),this.entry_count=t.readUint32(),this.offset=[];for(let e=0;e<this.entry_count;e++)this.version===0?this.offset[e]=t.readUint32():this.offset[e]=t.readUint64()}},Zs.fourcc="saio",Zs),tr,$l=(tr=class extends f{constructor(...t){super(...t),this.box_name="SampleAuxiliaryInformationSizesBox"}parse(t){if(this.parseFullHeader(t),this.flags&1&&(this.aux_info_type=t.readString(4),this.aux_info_type_parameter=t.readUint32()),this.default_sample_info_size=t.readUint8(),this.sample_count=t.readUint32(),this.sample_info_size=[],this.default_sample_info_size===0)for(let e=0;e<this.sample_count;e++)this.sample_info_size[e]=t.readUint8()}},tr.fourcc="saiz",tr),ql=class{constructor(r,t){this.bad_pixel_row=r,this.bad_pixel_column=t}toString(){return"[row: "+this.bad_pixel_row+", column: "+this.bad_pixel_column+"]"}},er,Yl=(er=class extends f{constructor(...t){super(...t),this.box_name="SensorBadPixelsMapBox"}parse(t){this.parseFullHeader(t),this.component_count=t.readUint16(),this.component_index=[];for(let i=0;i<this.component_count;i++)this.component_index.push(t.readUint16());let e=t.readUint8();this.correction_applied=(e&128)===128,this.num_bad_rows=t.readUint32(),this.num_bad_cols=t.readUint32(),this.num_bad_pixels=t.readUint32(),this.bad_rows=[],this.bad_columns=[],this.bad_pixels=[];for(let i=0;i<this.num_bad_rows;i++)this.bad_rows.push(t.readUint32());for(let i=0;i<this.num_bad_cols;i++)this.bad_columns.push(t.readUint32());for(let i=0;i<this.num_bad_pixels;i++){let s=t.readUint32(),n=t.readUint32();this.bad_pixels.push(new ql(s,n))}}},er.fourcc="sbpm",er),ir,Wl=(ir=class extends f{constructor(...t){super(...t),this.box_name="SchemeTypeBox"}parse(t){this.parseFullHeader(t),this.scheme_type=t.readString(4),this.scheme_version=t.readUint32(),this.flags&1&&(this.scheme_uri=t.readString(this.size-this.hdr_size-8))}},ir.fourcc="schm",ir),sr,Kl=(sr=class extends u{constructor(...t){super(...t),this.box_name="rtptracksdphintinformation"}parse(t){this.sdptext=t.readString(this.size-this.hdr_size)}},sr.fourcc="sdp ",sr),rr,Xl=(rr=class extends f{constructor(...t){super(...t),this.box_name="SampleEncryptionBox"}},rr.fourcc="senc",rr),nr,Jl=(nr=class extends f{constructor(...t){super(...t),this.box_name="SMPTE2086MasteringDisplayMetadataBox"}parse(t){this.parseFullHeader(t),this.primaryRChromaticity_x=t.readUint16(),this.primaryRChromaticity_y=t.readUint16(),this.primaryGChromaticity_x=t.readUint16(),this.primaryGChromaticity_y=t.readUint16(),this.primaryBChromaticity_x=t.readUint16(),this.primaryBChromaticity_y=t.readUint16(),this.whitePointChromaticity_x=t.readUint16(),this.whitePointChromaticity_y=t.readUint16(),this.luminanceMax=t.readUint32(),this.luminanceMin=t.readUint32()}},nr.fourcc="SmDm",nr),ar,Ql=(ar=class extends f{constructor(...t){super(...t),this.box_name="SamplingRateBox"}parse(t){this.parseFullHeader(t),this.sampling_rate=t.readUint32()}},ar.fourcc="srat",ar),or,Zl=(or=class extends f{constructor(...t){super(...t),this.box_name="DegradationPriorityBox"}parse(t){this.parseFullHeader(t);let e=(this.size-this.hdr_size)/2;this.priority=[];for(let i=0;i<e;i++)this.priority[i]=t.readUint16()}},or.fourcc="stdp",or),hr,td=(hr=class extends f{constructor(...t){super(...t),this.box_name="SubTrackInformationBox"}parse(t){this.parseFullHeader(t),this.switch_group=t.readUint16(),this.alternate_group=t.readUint16(),this.sub_track_id=t.readUint32();let e=(this.size-this.hdr_size-8)/4;this.attribute_list=[];for(let i=0;i<e;i++)this.attribute_list[i]=t.readUint32()}},hr.fourcc="stri",hr),cr,ed=(cr=class extends f{constructor(...t){super(...t),this.box_name="SubTrackSampleGroupBox"}parse(t){this.parseFullHeader(t),this.grouping_type=t.readUint32();let e=t.readUint16();this.group_description_index=[];for(let i=0;i<e;i++)this.group_description_index[i]=t.readUint32()}},cr.fourcc="stsg",cr),lr,id=(lr=class extends f{constructor(...t){super(...t),this.box_name="ShadowSyncSampleBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.shadowed_sample_numbers=[],this.sync_sample_numbers=[],this.version===0)for(let i=0;i<e;i++)this.shadowed_sample_numbers.push(t.readUint32()),this.sync_sample_numbers.push(t.readUint32())}write(t){this.version=0,this.flags=0,this.size=4+8*this.shadowed_sample_numbers.length,this.writeHeader(t),t.writeUint32(this.shadowed_sample_numbers.length);for(let e=0;e<this.shadowed_sample_numbers.length;e++)t.writeUint32(this.shadowed_sample_numbers[e]),t.writeUint32(this.sync_sample_numbers[e])}},lr.fourcc="stsh",lr),dr,sd=(dr=class extends f{constructor(...t){super(...t),this.box_name="SyncSampleBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();if(this.version===0){this.sample_numbers=[];for(let i=0;i<e;i++)this.sample_numbers.push(t.readUint32())}}write(t){this.version=0,this.flags=0,this.size=4+4*this.sample_numbers.length,this.writeHeader(t),t.writeUint32(this.sample_numbers.length),t.writeUint32Array(this.sample_numbers)}},dr.fourcc="stss",dr),fr,rd=(fr=class extends f{constructor(...t){super(...t),this.box_name="StereoVideoBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();this.single_view_allowed=e&3,this.stereo_scheme=t.readUint32();let i=t.readUint32();for(this.stereo_indication_type=t.readString(i),this.boxes=[];t.getPosition()<this.start+this.size;){let s=D(t,!1,this.size-(t.getPosition()-this.start));if(s.code===1){let n=s.box;this.boxes.push(n),this[n.type]=n}else return}}},fr.fourcc="stvi",fr),pr,nd=(pr=class extends f{constructor(...t){super(...t),this.box_name="CompactSampleSizeBox"}parse(t){if(this.parseFullHeader(t),this.sample_sizes=[],this.version===0){this.reserved=t.readUint24(),this.field_size=t.readUint8();let e=t.readUint32();if(this.field_size===4)for(let i=0;i<e;i+=2){let s=t.readUint8();this.sample_sizes[i]=s>>4&15,this.sample_sizes[i+1]=s&15}else if(this.field_size===8)for(let i=0;i<e;i++)this.sample_sizes[i]=t.readUint8();else if(this.field_size===16)for(let i=0;i<e;i++)this.sample_sizes[i]=t.readUint16();else l.error("BoxParser","Error in length field in stz2 box",t.isofile)}}},pr.fourcc="stz2",pr),ur,ad=(ur=class extends f{constructor(...t){super(...t),this.box_name="SubSampleInformationBox"}parse(t){this.parseFullHeader(t);let e=t.readUint32();this.entries=[];let i;for(let s=0;s<e;s++){let n={};if(this.entries[s]=n,n.sample_delta=t.readUint32(),n.subsamples=[],i=t.readUint16(),i>0)for(let a=0;a<i;a++){let o={};n.subsamples.push(o),this.version===1?o.size=t.readUint32():o.size=t.readUint16(),o.priority=t.readUint8(),o.discardable=t.readUint8(),o.codec_specific_parameters=t.readUint32()}}}},ur.fourcc="subs",ur),_r,od=(_r=class extends f{constructor(...t){super(...t),this.box_name="TAIClockInfoBox"}parse(t){this.time_uncertainty=t.readUint64(),this.clock_resolution=t.readUint32(),this.clock_drift_rate=t.readInt32();let e=t.readUint8();this.clock_type=(e&192)>>6}},_r.fourcc="taic",_r),xr,hd=(xr=class extends f{constructor(...t){super(...t),this.box_name="TrackEncryptionBox"}parse(t){if(this.parseFullHeader(t),t.readUint8(),this.version===0)t.readUint8();else{let e=t.readUint8();this.default_crypt_byte_block=e>>4&15,this.default_skip_byte_block=e&15}this.default_isProtected=t.readUint8(),this.default_Per_Sample_IV_Size=t.readUint8(),this.default_KID=$(t),this.default_isProtected===1&&this.default_Per_Sample_IV_Size===0&&(this.default_constant_IV_size=t.readUint8(),this.default_constant_IV=t.readUint8Array(this.default_constant_IV_size))}},xr.fourcc="tenc",xr),cd=class{},mr,ld=(mr=class extends f{constructor(...t){super(...t),this.box_name="TrackFragmentRandomAccessBox"}parse(t){this.parseFullHeader(t),this.track_ID=t.readUint32(),t.readUint24();let e=t.readUint8();this.length_size_of_traf_num=e>>4&3,this.length_size_of_trun_num=e>>2&3,this.length_size_of_sample_num=e&3,this.entries=[];let i=t.readUint32();for(let s=0;s<i;s++){let n=new cd;this.version===1?(n.time=t.readUint64(),n.moof_offset=t.readUint64()):(n.time=t.readUint32(),n.moof_offset=t.readUint32()),n.traf_number=t["readUint"+8*(this.length_size_of_traf_num+1)](),n.trun_number=t["readUint"+8*(this.length_size_of_trun_num+1)](),n.sample_delta=t["readUint"+8*(this.length_size_of_sample_num+1)](),this.entries.push(n)}}},mr.fourcc="tfra",mr),gr,dd=(gr=class extends u{constructor(...t){super(...t),this.box_name="hintmaxrelativetime"}parse(t){this.time=t.readUint32()}},gr.fourcc="tmax",gr),yr,fd=(yr=class extends u{constructor(...t){super(...t),this.box_name="hintminrelativetime"}parse(t){this.time=t.readUint32()}},yr.fourcc="tmin",yr),br,pd=(br=class extends u{constructor(...t){super(...t),this.box_name="hintBytesSent"}parse(t){this.bytessent=t.readUint32()}},br.fourcc="totl",br),vr,ud=(vr=class extends u{constructor(...t){super(...t),this.box_name="hintBytesSent"}parse(t){this.bytessent=t.readUint32()}},vr.fourcc="tpay",vr),Sr,_d=(Sr=class extends u{constructor(...t){super(...t),this.box_name="hintBytesSent"}parse(t){this.bytessent=t.readUint64()}},Sr.fourcc="tpyl",Sr),Br,xd=(Br=class extends Vn{},Br.fourcc="msrc",Br),q,md=(q=class extends u{constructor(...t){super(...t),this.box_name="TrackReferenceBox",this.references=[]}parse(t){for(;t.getPosition()<this.start+this.size;){let e=D(t,!0,this.size-(t.getPosition()-this.start));if(e.code===1){q.allowed_types.includes(e.type)||l.warn("BoxParser",`Unknown track reference type: '${e.type}'`);let i=new $n(e.type,e.size,e.hdr_size,e.start);i.write===u.prototype.write&&i.type!=="mdat"&&(l.info("BoxParser","TrackReference "+i.type+" box writing not yet implemented, keeping unparsed data in memory for later write"),i.parseDataAndRewind(t)),i.parse(t),this.references.push(i)}else return}}},q.fourcc="tref",q.allowed_types=["hint","cdsc","font","hind","vdep","vplx","subt","thmb","auxl","cdtg","shsc","aest"],q),Ur,gd=(Ur=class extends f{constructor(...t){super(...t),this.box_name="TrackExtensionPropertiesBox"}parse(t){for(this.parseFullHeader(t),this.track_ID=t.readUint32(),this.boxes=[];t.getPosition()<this.start+this.size;){let e=D(t,!1,this.size-(t.getPosition()-this.start));if(e.code===1){let i=e.box;this.boxes.push(i)}else return}}},Ur.fourcc="trep",Ur),wr,yd=(wr=class extends u{constructor(...t){super(...t),this.box_name="hintBytesSent"}parse(t){this.bytessent=t.readUint64()}},wr.fourcc="trpy",wr),Er,bd=(Er=class extends f{constructor(...t){super(...t),this.box_name="TrackSelectionBox"}parse(t){this.parseFullHeader(t),this.switch_group=t.readUint32();let e=(this.size-this.hdr_size-4)/4;this.attribute_list=[];for(let i=0;i<e;i++)this.attribute_list[i]=t.readUint32()}},Er.fourcc="tsel",Er),zr,vd=(zr=class extends f{constructor(...t){super(...t),this.box_name="TextConfigBox"}parse(t){this.parseFullHeader(t),this.config=t.readCString()}},zr.fourcc="txtc",zr),kr,Sd=(kr=class extends u{constructor(...t){super(...t),this.box_name="TypeCombinationBox"}parse(t){let e=(this.size-this.hdr_size)/4;this.compatible_brands=[];for(let i=0;i<e;i++)this.compatible_brands[i]=t.readString(4)}},kr.fourcc="tyco",kr),Ir,Bd=(Ir=class extends f{constructor(...t){super(...t),this.box_name="UserDescriptionProperty"}parse(t){this.parseFullHeader(t),this.lang=t.readCString(),this.name=t.readCString(),this.description=t.readCString(),this.tags=t.readCString()}},Ir.fourcc="udes",Ir),Cr,Ud=(Cr=class extends f{constructor(...t){super(...t),this.box_name="UncompressedFrameConfigBox"}parse(t){if(this.parseFullHeader(t),this.profile=t.readString(4),this.version!==1){if(this.version===0){this.component_count=t.readUint32(),this.component_index=[],this.component_bit_depth_minus_one=[],this.component_format=[],this.component_align_size=[];for(let i=0;i<this.component_count;i++)this.component_index.push(t.readUint16()),this.component_bit_depth_minus_one.push(t.readUint8()),this.component_format.push(t.readUint8()),this.component_align_size.push(t.readUint8());this.sampling_type=t.readUint8(),this.interleave_type=t.readUint8(),this.block_size=t.readUint8();let e=t.readUint8();this.component_little_endian=e>>7&1,this.block_pad_lsb=e>>6&1,this.block_little_endian=e>>5&1,this.block_reversed=e>>4&1,this.pad_unknown=e>>3&1,this.pixel_size=t.readUint32(),this.row_align_size=t.readUint32(),this.tile_align_size=t.readUint32(),this.num_tile_cols_minus_one=t.readUint32(),this.num_tile_rows_minus_one=t.readUint32()}}}},Cr.fourcc="uncC",Cr),Pr,wd=(Pr=class extends f{constructor(...t){super(...t),this.box_name="DataEntryUrnBox"}parse(t){this.parseFullHeader(t),this.name=t.readCString(),this.size-this.hdr_size-this.name.length-1>0&&(this.location=t.readCString())}write(t){this.version=0,this.flags=0,this.size=this.name.length+1+(this.location?this.location.length+1:0),this.writeHeader(t),t.writeCString(this.name),this.location&&t.writeCString(this.location)}},Pr.fourcc="urn ",Pr),Tr,Ed=(Tr=class extends u{constructor(...t){super(...t),this.box_name="WebVTTConfigurationBox"}parse(t){this.text=t.readString(this.size-this.hdr_size)}},Tr.fourcc="vttC",Tr),Ar,zd=(Ar=class extends f{constructor(...t){super(...t),this.box_name="VvcNALUConfigBox"}parse(t){this.parseFullHeader(t);let e=t.readUint8();this.lengthSizeMinusOne=e&3}},Ar.fourcc="vvnC",Ar),Fr,kd=(Fr=class extends U{parse(t){let e=t.readUint16();this.first_output_sample=t.readUint16(),this.sample_offset=[];for(let s=0;s<e;s++)this.sample_offset[s]=t.readUint32();let i=this.description_length-4-4*e;this.num_output_samples=[],this.num_total_samples=[];for(let s=0;s<i/4;s++)this.num_output_samples[s]=t.readUint16(),this.num_total_samples[s]=t.readUint16()}},Fr.grouping_type="alst",Fr),Dr,Id=(Dr=class extends U{parse(t){this.layerNumber=t.readUint8(),this.accurateStatisticsFlag=t.readUint8(),this.avgBitRate=t.readUint16(),this.avgFrameRate=t.readUint16()}},Dr.grouping_type="avll",Dr),Lr,Cd=(Lr=class extends U{parse(t){this.subSequenceIdentifier=t.readUint16(),this.layerNumber=t.readUint8();let e=t.readUint8();this.durationFlag=e>>7,this.avgRateFlag=e>>6&1,this.durationFlag&&(this.duration=t.readUint32()),this.avgRateFlag&&(this.accurateStatisticsFlag=t.readUint8(),this.avgBitRate=t.readUint16(),this.avgFrameRate=t.readUint16()),this.dependency=[];let i=t.readUint8();for(let s=0;s<i;s++)this.dependency.push({subSeqDirectionFlag:t.readUint8(),layerNumber:t.readUint8(),subSequenceIdentifier:t.readUint16()})}},Lr.grouping_type="avss",Lr),Hr,Pd=(Hr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Hr.grouping_type="dtrt",Hr),Or,Td=(Or=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Or.grouping_type="mvif",Or),Mr,Ad=(Mr=class extends U{parse(t){this.roll_distance=t.readInt16()}},Mr.grouping_type="prol",Mr),Rr,Fd=(Rr=class extends U{parse(t){let e=t.readUint8();this.num_leading_samples_known=e>>7,this.num_leading_samples=e&127}},Rr.grouping_type="rap ",Rr),Nr,Dd=(Nr=class extends U{parse(t){if(this.operation_point_count=t.readUint16(),this.description_length!==2+(this.operation_point_count===1?2:this.operation_point_count*6)+9)l.warn("BoxParser","Mismatch in "+this.grouping_type+" sample group length"),this.data=t.readUint8Array(this.description_length-2);else{if(this.operation_point_count===1)this.target_rate_share=t.readUint16();else{this.target_rate_share=[],this.available_bitrate=[];for(let e=0;e<this.operation_point_count;e++)this.available_bitrate[e]=t.readUint32(),this.target_rate_share[e]=t.readUint16()}this.maximum_bitrate=t.readUint32(),this.minimum_bitrate=t.readUint32(),this.discard_priority=t.readUint8()}}},Nr.grouping_type="rash",Nr),Vr,Ld=(Vr=class extends U{parse(t){this.roll_distance=t.readInt16()}},Vr.grouping_type="roll",Vr),Gr,Hd=(Gr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Gr.grouping_type="scif",Gr),jr,Od=(jr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},jr.grouping_type="scnm",jr),$r,Md=($r=class extends U{parse(t){this.reserved=t.readUint8();let e=t.readUint8();this.crypt_byte_block=e>>4,this.skip_byte_block=e&15,this.isProtected=t.readUint8(),this.Per_Sample_IV_Size=t.readUint8(),this.KID=$(t),this.constant_IV_size=0,this.constant_IV=0,this.isProtected===1&&this.Per_Sample_IV_Size===0&&(this.constant_IV_size=t.readUint8(),this.constant_IV=t.readUint8Array(this.constant_IV_size))}},$r.grouping_type="seig",$r),qr,Rd=(qr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},qr.grouping_type="stsa",qr),Yr,Nd=(Yr=class extends U{parse(t){let e=t.readUint8();this.NAL_unit_type=e&63}},Yr.grouping_type="sync",Yr),Wr,Vd=(Wr=class extends U{parse(t){let e=t.readUint8();this.level_independently_decodable=e>>7}},Wr.grouping_type="tele",Wr),Kr,Gd=(Kr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Kr.grouping_type="tsas",Kr),Xr,jd=(Xr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Xr.grouping_type="tscl",Xr),Jr,$d=(Jr=class extends U{parse(t){l.warn("BoxParser","Sample Group type: "+this.grouping_type+" not fully parsed")}},Jr.grouping_type="vipr",Jr),Qr,Gh=(Qr=class extends u{},Qr.fourcc="uuid",Qr),Zr,cn=(Zr=class extends f{},Zr.fourcc="uuid",Zr),tn,qd=(tn=class extends cn{constructor(...t){super(...t),this.box_name="LiveServerManifestBox"}parse(t){this.parseFullHeader(t),this.LiveServerManifest=t.readString(this.size-this.hdr_size).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}},tn.uuid="a5d40b30e81411ddba2f0800200c9a66",tn),en,Yd=(en=class extends cn{constructor(...t){super(...t),this.box_name="PiffProtectionSystemSpecificHeaderBox"}parse(t){this.parseFullHeader(t),this.system_id=$(t);let e=t.readUint32();e>0&&(this.data=t.readUint8Array(e))}},en.uuid="d08a4f1810f34a82b6c832d8aba183d3",en),sn,Wd=(sn=class extends cn{constructor(...t){super(...t),this.box_name="PiffSampleEncryptionBox"}},sn.uuid="a2394f525a9b4f14a2446c427c648df4",sn),rn,Kd=(rn=class extends cn{constructor(...t){super(...t),this.box_name="PiffTrackEncryptionBox"}parse(t){this.parseFullHeader(t),this.default_AlgorithmID=t.readUint24(),this.default_IV_size=t.readUint8(),this.default_KID=$(t)}},rn.uuid="8974dbce7be74c5184f97148f9882554",rn),nn,Xd=(nn=class extends cn{constructor(...t){super(...t),this.box_name="TfrfBox"}parse(t){this.parseFullHeader(t),this.fragment_count=t.readUint8(),this.entries=[];for(let e=0;e<this.fragment_count;e++){let i=0,s=0;this.version===1?(i=t.readUint64(),s=t.readUint64()):(i=t.readUint32(),s=t.readUint32()),this.entries.push({absolute_time:i,absolute_duration:s})}}},nn.uuid="d4807ef2ca3946958e5426cb9e46a79f",nn),an,Jd=(an=class extends cn{constructor(...t){super(...t),this.box_name="TfxdBox"}parse(t){this.parseFullHeader(t),this.version===1?(this.absolute_time=t.readUint64(),this.duration=t.readUint64()):(this.absolute_time=t.readUint32(),this.duration=t.readUint32())}},an.uuid="6d1d9b0542d544e680e2141daff757b2",an),on,Qd=(on=class extends Gh{constructor(...t){super(...t),this.box_name="ItemContentIDProperty"}parse(t){this.content_id=t.readCString()}},on.uuid="261ef3741d975bbaacbd9d2c8ea73522",on),hn,Zd=(hn=class extends Gh{constructor(...t){super(...t),this.box_name="ItemComponentContentIDProperty"}parse(t){this.number_of_components=t.readUint32(),this.content_ids=[];for(let e=0;e<this.number_of_components;e++){let i=t.readCString();this.content_ids.push(i)}}},hn.uuid="9db9dd6e373c5a4e811021fc83a911fd",hn),tf=Mn({CoLLBox:()=>zc,ItemComponentContentIDPropertyBox:()=>Zd,ItemContentIDPropertyBox:()=>Qd,OpusSampleEntry:()=>ph,SmDmBox:()=>Jl,a1lxBox:()=>uc,a1opBox:()=>_c,ac_3SampleEntry:()=>lh,ac_4SampleEntry:()=>dh,aebrBox:()=>jc,afbrBox:()=>$c,albcBox:()=>qc,alstSampleGroupEntry:()=>kd,altrBox:()=>Yc,auxCBox:()=>xc,av01SampleEntry:()=>Ho,av1CBox:()=>Eo,avc1SampleEntry:()=>Ao,avc2SampleEntry:()=>Fo,avc3SampleEntry:()=>Do,avc4SampleEntry:()=>Lo,avcCBox:()=>Xn,avllSampleGroupEntry:()=>Id,avs3SampleEntry:()=>sh,avssSampleGroupEntry:()=>Cd,brstBox:()=>Wc,btrtBox:()=>mc,bxmlBox:()=>Xa,ccstBox:()=>gc,cdefBox:()=>yc,clapBox:()=>bc,clefBox:()=>Ll,clliBox:()=>vc,cmexBox:()=>Sc,cminBox:()=>Bc,cmpCBox:()=>Uc,cmpdBox:()=>wc,co64Box:()=>Ec,colrBox:()=>To,coviBox:()=>Cc,cprtBox:()=>Pc,cschBox:()=>Tc,cslgBox:()=>Ac,cttsBox:()=>Fc,dOpsBox:()=>Nc,dac3Box:()=>Dc,dataBox:()=>bn,dav1SampleEntry:()=>Oo,dec3Box:()=>Lc,dfLaBox:()=>Hc,dimmBox:()=>Oc,dinfBox:()=>ea,dmax:()=>Mc,dmedBox:()=>Rc,dobrBox:()=>Kc,drefBox:()=>na,drepBox:()=>Vc,dtrtSampleGroupEntry:()=>Pd,dvh1SampleEntry:()=>Yo,dvheSampleEntry:()=>Wo,ec_3SampleEntry:()=>fh,edtsBox:()=>Qa,elngBox:()=>aa,elstBox:()=>Gc,emsgBox:()=>Lh,encaSampleEntry:()=>bh,encmSampleEntry:()=>wh,encsSampleEntry:()=>Sh,enctSampleEntry:()=>Uh,encuSampleEntry:()=>vh,encvSampleEntry:()=>yh,enofBox:()=>Ol,eqivBox:()=>Xc,esdsBox:()=>zo,etypBox:()=>xo,fLaCSampleEntry:()=>gh,favcBox:()=>Jc,fielBox:()=>ol,fobrBox:()=>Qc,freeBox:()=>qa,frmaBox:()=>hl,ftypBox:()=>oa,grplBox:()=>uo,hdlrBox:()=>ha,hev1SampleEntry:()=>No,hev2SampleEntry:()=>Vo,hinfBox:()=>so,hmhdBox:()=>Jn,hntiBox:()=>io,hvc1SampleEntry:()=>Mo,hvc2SampleEntry:()=>Ro,hvcCBox:()=>ca,hvt1SampleEntry:()=>Go,iaugBox:()=>Zc,idatBox:()=>$a,iinfBox:()=>yo,ilocBox:()=>bo,ilstBox:()=>Ml,imirBox:()=>cl,infeBox:()=>go,iodsBox:()=>Wa,ipcoBox:()=>po,ipmaBox:()=>ll,iproBox:()=>Ja,iprpBox:()=>fo,irefBox:()=>vo,irotBox:()=>dl,ispeBox:()=>fl,itaiBox:()=>pl,j2kHBox:()=>_o,j2kiSampleEntry:()=>rh,keysBox:()=>Rl,kindBox:()=>ul,levaBox:()=>_l,lhe1SampleEntry:()=>jo,lhv1SampleEntry:()=>$o,lhvCBox:()=>xl,lselBox:()=>ml,lvc1SampleEntry:()=>qo,lvcCBox:()=>Io,m4aeSampleEntry:()=>ch,maxrBox:()=>gl,mdatBox:()=>dn,mdcvBox:()=>yl,mdhdBox:()=>la,mdiaBox:()=>Zn,mecoBox:()=>eo,mehdBox:()=>da,metaBox:()=>Bo,mettSampleEntry:()=>Uo,metxSampleEntry:()=>wo,mfhdBox:()=>fa,mfraBox:()=>to,mfroBox:()=>bl,mha1SampleEntry:()=>uh,mha2SampleEntry:()=>_h,mhm1SampleEntry:()=>xh,mhm2SampleEntry:()=>mh,minfBox:()=>ta,mjp2SampleEntry:()=>nh,mjpgSampleEntry:()=>ah,moofBox:()=>sa,moovBox:()=>pn,mp4aSampleEntry:()=>ua,mp4sSampleEntry:()=>Bh,mp4vSampleEntry:()=>hh,mskCBox:()=>vl,msrcTrackGroupTypeBox:()=>xd,mvexBox:()=>En,mvhdBox:()=>pa,mvifSampleGroupEntry:()=>Td,nmhdBox:()=>fn,npckBox:()=>Sl,numpBox:()=>Bl,padbBox:()=>wl,panoBox:()=>tl,paspBox:()=>El,paylBox:()=>zl,paytBox:()=>kl,pdinBox:()=>Il,piffLsmBox:()=>qd,piffPsshBox:()=>Yd,piffSencBox:()=>Wd,piffTencBox:()=>Kd,piffTfrfBox:()=>Xd,piffTfxdBox:()=>Jd,pitmBox:()=>So,pixiBox:()=>Cl,pmaxBox:()=>Pl,povdBox:()=>mo,prdiBox:()=>Tl,prfrBox:()=>Al,prftBox:()=>Fl,prgrBox:()=>nl,profBox:()=>Nl,prolSampleGroupEntry:()=>Ad,psshBox:()=>Dl,pymdBox:()=>al,rapSampleGroupEntry:()=>Fd,rashSampleGroupEntry:()=>Dd,resvSampleEntry:()=>Eh,rinfBox:()=>oo,rollSampleGroupEntry:()=>Ld,rtp_Box:()=>Gl,saioBox:()=>jl,saizBox:()=>$l,sbgpBox:()=>Ph,sbpmBox:()=>Yl,sbttSampleEntry:()=>zh,schiBox:()=>ho,schmBox:()=>Wl,scifSampleGroupEntry:()=>Hd,scnmSampleGroupEntry:()=>Od,sdp_Box:()=>Kl,sdtpBox:()=>Th,seigSampleGroupEntry:()=>Md,sencBox:()=>Xl,sgpdBox:()=>Ah,sidxBox:()=>Fh,sinfBox:()=>ao,skipBox:()=>Ya,slidBox:()=>el,smhdBox:()=>xa,sratBox:()=>Ql,ssixBox:()=>Hh,stblBox:()=>ia,stcoBox:()=>ma,stdpBox:()=>Zl,sterBox:()=>il,sthdBox:()=>ga,stppSampleEntry:()=>_a,strdBox:()=>no,striBox:()=>td,strkBox:()=>ro,stsaSampleGroupEntry:()=>Rd,stscBox:()=>ya,stsdBox:()=>ba,stsgBox:()=>ed,stshBox:()=>id,stssBox:()=>sd,stszBox:()=>va,sttsBox:()=>Sa,stviBox:()=>rd,stxtSampleEntry:()=>kh,stypBox:()=>Oh,stz2Box:()=>nd,subsBox:()=>ad,syncSampleGroupEntry:()=>Nd,taicBox:()=>od,taptBox:()=>Vl,teleSampleGroupEntry:()=>Vd,tencBox:()=>hd,tfdtBox:()=>Ba,tfhdBox:()=>Ua,tfraBox:()=>ld,tkhdBox:()=>wa,tmaxBox:()=>dd,tminBox:()=>fd,totlBox:()=>pd,tpayBox:()=>ud,tpylBox:()=>_d,trafBox:()=>ra,trakBox:()=>Qn,trefBox:()=>md,trepBox:()=>gd,trexBox:()=>zn,trgrBox:()=>co,trpyBox:()=>yd,trunBox:()=>Ea,tsasSampleGroupEntry:()=>Gd,tsclSampleGroupEntry:()=>jd,tselBox:()=>bd,tsynBox:()=>sl,tx3gSampleEntry:()=>Ih,txtcBox:()=>vd,tycoBox:()=>Sd,udesBox:()=>Bd,udtaBox:()=>lo,uncCBox:()=>Ud,uncvSampleEntry:()=>oh,urlBox:()=>za,urnBox:()=>wd,viprSampleGroupEntry:()=>$d,vmhdBox:()=>ka,vp08SampleEntry:()=>eh,vp09SampleEntry:()=>ih,vpcCBox:()=>Co,vttCBox:()=>Ed,vttcBox:()=>Za,vvc1SampleEntry:()=>Xo,vvcCBox:()=>Po,vvcNSampleEntry:()=>Zo,vvi1SampleEntry:()=>Jo,vvnCBox:()=>zd,vvs1SampleEntry:()=>Qo,waveBox:()=>ko,wbbrBox:()=>rl,wvttSampleEntry:()=>Ch,xmlBox:()=>Ka}),ef=Ga(tf);ja(nc);return Kh(sf);})();
    if (typeof module !== 'undefined' && module.exports) module.exports = MP4BoxLib;
    // ============================================================================
    // DASH 音视频合并：把 B 站的 video.m4s + audio.m4s 合成一个能直接播放的 mp4
    // 便携版没有 ffmpeg，靠这个模块在浏览器里合并 —— 只重排 mp4 box、不重新编码，
    // 所以没有画质损失，也不需要 WebCodecs 那一套。
    // 该文件被 build.js 内联进便携版 userscript，同时可直接被 Node require 做单测，
    // 保证「测试的代码」与「发布的代码」是同一份。
    // 依赖 src/lib/mp4box.min.js（MP4Box.js / gpac/mp4box.js，BSD-3-Clause）
    // ============================================================================
    (function (root, factory) {
        const api = factory(root);
        if (typeof module !== 'undefined' && module.exports) module.exports = api;
        root.__biliDashMerge = api;                         // 供浏览器内自检 / 冒烟测试
    })(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
        'use strict';

        // 合计超过这个大小就不合并：合并要把音视频两份原始数据 + 输出同时放进内存。
        // 实测（Node，已热身 / --expose-gc）：内存 ≈ 2.32 倍输入 + 9MB 固定开销，耗时约 4.2ms/MB，
        // 所以 512MB 输入的峰值约 1.2GB；再往上（比如 1GB）要 2.4GB，标签页容易崩，不值当。
        // 超限的走「音画分开存」，并提示用户用环境版（服务端 ffmpeg 流式落盘，不吃内存）。
        const MAX_MERGE_BYTES = 512 * 1024 * 1024;

        let cachedMP4Box = null;

        // 取 MP4Box：内联进 userscript 时它在同一作用域；Node 单测时走 require
        function getMP4Box() {
            if (cachedMP4Box) return cachedMP4Box;
            if (typeof MP4BoxLib !== 'undefined' && MP4BoxLib) cachedMP4Box = MP4BoxLib;
            else if (root && root.MP4BoxLib) cachedMP4Box = root.MP4BoxLib;
            else if (typeof require === 'function') {
                try { cachedMP4Box = require('./mp4box.min.js'); } catch (e) { }
            }
            return cachedMP4Box;
        }

        // 各种「字节」形态统一算长度（数字 / ArrayBuffer / TypedArray / Blob）
        function byteLength(bytes) {
            if (typeof bytes === 'number') return bytes > 0 ? bytes : 0;
            if (!bytes) return 0;
            if (typeof bytes.byteLength === 'number') return bytes.byteLength;
            if (typeof bytes.size === 'number') return bytes.size;          // Blob
            if (typeof bytes.length === 'number') return bytes.length;
            return 0;
        }

        // 转成 ArrayBuffer（mp4box 只认 ArrayBuffer）
        function toArrayBuffer(bytes) {
            if (bytes instanceof ArrayBuffer) return bytes;
            if (ArrayBuffer.isView(bytes)) {
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            }
            return new Uint8Array(bytes).buffer;
        }

        function toArrayBufferAsync(bytes) {
            if (typeof Blob !== 'undefined' && bytes instanceof Blob) return bytes.arrayBuffer();
            return Promise.resolve(toArrayBuffer(bytes));
        }

        // 解析一个 DASH 分片（本质是 fMP4）：拿到轨道信息、全部样本，
        // 以及原始 sample entry（avcC / esds 这些解码器参数就在里面，合并时要原样带过去）
        function parseFragment(MP4Box, bytes) {
            return new Promise(function (resolve, reject) {
                const file = MP4Box.createFile();
                const samples = [];
                let info = null;
                let failed = null;
                file.onError = function (e) { failed = failed || ('分片解析失败：' + e); };
                file.onReady = function (i) {
                    if (!i || !i.tracks || !i.tracks.length) { failed = failed || '分片里没有找到轨道'; return; }
                    info = i;
                    const t = i.tracks[0];
                    file.setExtractionOptions(t.id, null, { nbSamples: t.nb_samples });
                    file.start();
                };
                file.onSamples = function (id, user, list) {
                    for (let i = 0; i < list.length; i++) samples.push(list[i]);
                };
                toArrayBufferAsync(bytes).then(function (ab) {
                    ab.fileStart = 0;
                    file.appendBuffer(ab);
                    file.flush();                                    // 样本回调是同步跑完的，下面再让出一次事件循环兜底
                    setTimeout(function () {
                        if (failed) { reject(new Error(failed)); return; }
                        if (!info || !samples.length) { reject(new Error('没读到样本数据（可能不是标准 fMP4 分片）')); return; }
                        const trak = file.moov && file.moov.traks && file.moov.traks[0];
                        const entry = trak && trak.mdia.minf.stbl.stsd.entries[0];
                        if (!entry) { reject(new Error('分片缺少 sample entry（解码器参数）')); return; }
                        resolve({ track: info.tracks[0], entry: entry, samples: samples });
                    }, 0);
                }, reject);
            });
        }

        // 把两条轨道写进一个新文件：音视频同一个容器，直接就能播
        // 注意 hdlr 必须给对（vide / soun），否则播放器会把音轨当成视频轨
        function buildMerged(MP4Box, v, a) {
            const out = MP4Box.createFile();
            const videoId = out.addTrack({
                hdlr: 'vide', type: v.entry.type,
                timescale: v.track.timescale, duration: v.track.duration,
                width: v.track.video.width, height: v.track.video.height,
                description_boxes: v.entry.boxes
            });
            const audioId = out.addTrack({
                hdlr: 'soun', type: a.entry.type,
                timescale: a.track.timescale, duration: a.track.duration,
                samplerate: a.track.audio.sample_rate,
                channel_count: a.track.audio.channel_count,
                samplesize: a.track.audio.sample_size,
                description_boxes: a.entry.boxes
            });
            if (!videoId || !audioId) {
                throw new Error('不支持的编码组合（' + v.entry.type + ' + ' + a.entry.type + '）');
            }
            const copy = function (trackId, samples) {
                for (let i = 0; i < samples.length; i++) {
                    const s = samples[i];
                    out.addSample(trackId, s.data, {
                        duration: s.duration, dts: s.dts, cts: s.cts, is_sync: s.is_sync
                    });
                }
            };
            copy(videoId, v.samples);
            copy(audioId, a.samples);
            const stream = out.getBuffer();
            const buf = stream && stream.buffer;
            if (!buf || !buf.byteLength) throw new Error('合并输出为空');
            return buf;
        }

        // 该不该尝试合并：体积超限的直接不试，省得下完了才发现白下
        function shouldMerge(totalBytes, maxBytes) {
            const total = byteLength(totalBytes);
            return total > 0 && total <= (maxBytes || MAX_MERGE_BYTES);
        }

        // 合并入口：失败就抛错，由调用方回退成音画分开保存（不能把用户的数据弄丢）
        function mergeDashStreams(videoBytes, audioBytes, maxBytes) {
            const MP4Box = getMP4Box();
            if (!MP4Box) return Promise.reject(new Error('合并组件未加载（请更新到最新版便携版）'));
            const total = byteLength(videoBytes) + byteLength(audioBytes);
            if (!shouldMerge(total, maxBytes)) {
                return Promise.reject(new Error('音视频合计 ' + Math.round(total / 1048576) + 'MB，超出合并上限 ' +
                    Math.round((maxBytes || MAX_MERGE_BYTES) / 1048576) + 'MB'));
            }
            return parseFragment(MP4Box, videoBytes).then(function (v) {
                return parseFragment(MP4Box, audioBytes).then(function (a) {
                    return buildMerged(MP4Box, v, a);
                });
            });
        }

        return {
            MAX_MERGE_BYTES: MAX_MERGE_BYTES,
            byteLength: byteLength,
            getMP4Box: getMP4Box,
            shouldMerge: shouldMerge,
            mergeDashStreams: mergeDashStreams
        };
    });
    const DM = (typeof globalThis !== 'undefined' && globalThis.__biliDashMerge) ? globalThis.__biliDashMerge : null;
    // wbi 签名（给 playurl 算 w_rid，降风控）：纯函数，两个版本共用
    // ============================================================================
    // B 站 wbi 签名（w_rid / wts）
    //
    // 背景：playurl 这类接口从 2023 年起支持 wbi 签名。实测不签名也能正常取流
    // （Bilibili-Evolved 同样没签），所以签名在这里只当「锦上添花」：调用方失败就
    // 退回未签名请求，绝不影响正常取流。
    //
    // 顺带把「跟着请求走的 dm_* 指纹参数」排除在外：那是客户端 canvas / WebGL 指纹，
    // 伪造值反而更容易被风控盯上，而它在 uscript 里没法真实生成，收益也无法验证。
    //
    // 该文件被 build.js 内联进 userscript，同时可直接被 Node require 做单测。
    // ============================================================================
    (function (root, factory) {
        const api = factory();
        if (typeof module !== 'undefined' && module.exports) module.exports = api;
        root.__biliWbi = api;                               // 供浏览器内自检 / 冒烟测试
    })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
        'use strict';

        // 官方前端那把 64 位重排表
        const MIXIN_KEY_ENC_TAB = [
            46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
            27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
            37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
            22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
        ];

        function utf8Bytes(str) {
            if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
            const out = [];                                  // 兜底（极老环境）
            for (let i = 0; i < str.length; i++) {
                const c = str.charCodeAt(i);
                if (c < 0x80) out.push(c);
                else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
                else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
            return Uint8Array.from(out);
        }

        // MD5（RFC 1321）→ 32 位小写 hex。浏览器 crypto.subtle 是异步的，签名要同步算就用这个
        function md5Hex(str) {
            const bytes = utf8Bytes(String(str));
            const len = bytes.length;
            const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
            padded.set(bytes);
            padded[len] = 0x80;                              // 补位：0x80 + 若干 0
            const dv = new DataView(padded.buffer);
            const bits = len * 8;
            dv.setUint32(padded.length - 8, bits >>> 0, true);
            dv.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);

            const S = [
                7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
            ];
            const K = new Uint32Array(64);
            for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

            let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
            for (let off = 0; off < padded.length; off += 64) {
                const M = new Uint32Array(16);
                for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
                let A = a0, B = b0, C = c0, D = d0;
                for (let i = 0; i < 64; i++) {
                    let F, g;
                    if (i < 16) { F = (B & C) | (~B & D); g = i; }
                    else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
                    else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
                    else { F = C ^ (B | ~D); g = (7 * i) % 16; }
                    F = (F + A + K[i] + M[g]) >>> 0;
                    A = D; D = C; C = B;
                    B = (B + (((F << S[i]) | (F >>> (32 - S[i]))) >>> 0)) >>> 0;
                }
                a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
            }
            const hex = n => {
                let s = '';
                for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
                return s;
            };
            return hex(a0) + hex(b0) + hex(c0) + hex(d0);
        }

        // img_key + sub_key 拼成 64 位后按表重排，取前 32 位
        function getMixinKey(orig) {
            let out = '';
            for (let i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) out += orig[MIXIN_KEY_ENC_TAB[i]] || '';
            return out.slice(0, 32);
        }

        // 参数 → 签名 query：按 key 排序、值去掉 !'()* 、拼串、末尾接 mixinKey 再 md5 = w_rid
        function signQuery(params, imgKey, subKey, wts) {
            const mixin = getMixinKey(String(imgKey || '') + String(subKey || ''));
            const stamp = String(wts || Math.round(Date.now() / 1000));
            const all = Object.assign({}, params, { wts: stamp });
            const query = Object.keys(all).sort().map(k => {
                const v = String(all[k] == null ? '' : all[k]).replace(/[!'()*]/g, '');
                return encodeURIComponent(k) + '=' + encodeURIComponent(v);
            }).join('&');
            return query + '&w_rid=' + md5Hex(query + mixin);
        }

        // 从 nav 接口响应里取两个 key（它们藏在图片地址的文件名里）
        function parseWbiKeys(nav) {
            const d = nav && nav.data;
            if (!d) return null;
            const pick = url => {
                const m = String(url || '').match(/\/([^/]+)\.(?:png|jpg|jpeg|webp|gif)$/i);
                return m ? m[1] : null;
            };
            const imgKey = pick(d.wbi_img && d.wbi_img.img_url);
            const subKey = pick(d.wbi_img && d.wbi_img.sub_url);
            return (imgKey && subKey) ? { imgKey: imgKey, subKey: subKey } : null;
        }

        return {
            MIXIN_KEY_ENC_TAB: MIXIN_KEY_ENC_TAB,
            md5Hex: md5Hex,
            getMixinKey: getMixinKey,
            signQuery: signQuery,
            parseWbiKeys: parseWbiKeys
        };
    });
    const WB = (typeof globalThis !== 'undefined' && globalThis.__biliWbi) ? globalThis.__biliWbi : null;
    // 浏览器是否支持「选择文件夹直写」（Chromium 系）
    const FSA_SUPPORTED = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    // 收款码：以 base64 直接内嵌（data URI），不依赖本地服务 /qr，
    // 这样即使没启动服务、或页面是 HTTPS（混合内容限制）也能正常显示。
    const DONATE_QR = 'data:image/jpeg;base64,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ACu6+OX/ACWv4h/9jFqP/pVJXC13Xxy/5LX8Q/8AsYtR/wDSqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/wAlv+Hn/Yxaf/6Ux1w9dx8Cf+S3/Dz/ALGLT/8A0pjrh6ACiiigAooooAK7r45f8lr+If8A2MWo/wDpVJXC13Xxy/5LX8Q/+xi1H/0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8lv+Hn/Yxaf/AOlMdcPXcfAn/kt/w8/7GLT/AP0pjrh6ACiiigAooooAK7r45f8AJa/iH/2MWo/+lUlcLXdfHL/ktfxD/wCxi1H/ANKpKAOFooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP/ACW/4ef9jFp//pTHXD13HwJ/5Lf8PP8AsYtP/wDSmOuHoAKKKKACiiigAruvjl/yWv4h/wDYxaj/AOlUlcLXdfHL/ktfxD/7GLUf/SqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW/4ef9jFp/8A6Ux1w9dx8Cf+S3/Dz/sYtP8A/SmOuHoAKKKKACiiigAruvjl/wAlr+If/Yxaj/6VSVwtd18cv+S1/EP/ALGLUf8A0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8AJb/h5/2MWn/+lMdcPXcfAn/kt/w8/wCxi0//ANKY64egAooooAKKKKACu6+OX/Ja/iH/ANjFqP8A6VSVwtd18cv+S1/EP/sYtR/9KpKAOFooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP/Jb/h5/2MWn/wDpTHXD13HwJ/5Lf8PP+xi0/wD9KY64egAooooAKKKKACu6+OX/ACWv4h/9jFqP/pVJXC13Xxy/5LX8Q/8AsYtR/wDSqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigArX8J+Edc8c69Bovh3SL3W9WnDGGwsIGnlkCqWYhFBJwAxOBwFJrIr6k/4Jm/8nl+B/8ArlqH/pDNQB5n/wAMofGn/ok3jD/wQ3P/AMRR/wAMofGn/ok3jH/wQ3P/AMRX9B1FAH8+P/DKHxp/6JN4x/8ABDc//EUf8MofGn/ok3jH/wAENz/8RX9B1FAH8+P/AAyf8av+iT+Mf/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGn/ok3jL/wAEVz/8RX9B1FAH81/irwlrngbXLjRPEejXuhaxAqmawv4HhljDAMpZWAK5BUjI5DA1k19Rf8FM/wDk8vxz/wBcdO/9Ioa+XaACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8lv8Ah5/2MWn/APpTHXD13HwJ/wCS3/Dz/sYtP/8ASmOuHoAKKKKACiiigAruvjl/yWv4h/8AYxaj/wClUlcLXdfHL/ktfxD/AOxi1H/0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK+pP+CZn/J5fgf8A646h/wCkU1fLdfUn/BMz/k8vwP8A9cdQ/wDSKagD9wqKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAormfiV45tPhv4E13xPfc2ulWj3Lr/ewOF/E4H41+Ynw+/4LE+INZ+Llnp2s+FbOHwre3QtAYp2aaIFsK/QA84yP1oA/WGiqumahDqunW17bOJIJ41kRh0IIyKtUAFFFRsxVGIoAkor8svjt/wAFcPEfgH40ap4e0Dwpaz6DpVx9mme4nIlmI+8RgED261+jfwc+Idv8V/hl4d8YWsLW0OsWi3Igc5MZPDL+BBoA7KiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/Dz/AIKZ/wDJ5fjj/rjp/wD6RQ18uV9R/wDBTP8A5PL8cf8AXHT/AP0ihr5coAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW74ef9jFp/wD6Ux1w9dx8Cf8Akt3w8/7GLT//AEpjrh6ACiiigAooooAK7r45f8lr+If/AGMWo/8ApVJXC13Xxy/5LX8Q/wDsYtR/9KpKAOFooooAKKKKACiiigAooooAKKKKACii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UAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAdx8Cf+S3fDz/sYtP8A/SmOuHruPgT/AMlu+Hn/AGMWn/8ApTHXD0AFFFFABRRRQAV3Xxz/AOS2fEP/ALGLUf8A0pkrha7r45/8ls+If/Yxaj/6UyUAcLRRRQAUUUUAFFLikoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW74ef9jFp/8A6Ux1w9dx8Cf+S3fDz/sYtP8A/SmOuHoAKKKKACiiigAruvjn/wAls+If/Yxaj/6UyVwtd18c/wDktnxD/wCxi1H/ANKZKAOFooooAKKK9t/ZY+Cdr8V/E+oahrztB4V0CEXmqSIT93DMEJGCAQjAsCCO1AHiXlP5XmfP5f3d3bP1oiRm4Clj7CvZ/wBof4raD8RdWstE8K+H7fQ9D0pvItnRP3tx8zZZzkk5LNjk8ba9n13SfB/7Hvw6srbUtFh1/wCJGt2pdzdhmitYnDJgKSBxtkIO3OfagD4yA4pdvvUl3cG7nlnbG6Vy5x05Oa9m/ZO8E/D/AMd/EZdM8eXkkNrLC32aHeypNJuA2s6kMDgk8f3aAPFdvvRtr3n9p79lfWfgRqzXdsTf+FrlgIL1QxZMsw2PlQA33ehP3l5rznwB8GvGvxOgubjwr4dvNat7dgsslsowuc7c5Pfa35UAcZto21+inx++AGr6f+zl4U8NeE/Bjat4g8yNr2W0gQyohSV3BckHIYqK+HfH3wh8afDCG2n8V+Hb3Q4rlykLXSgByBkgcntQBxu33o212XwZsLbV/i34JsruFZra41uyilRujIZ0DKfYgkV7f+394N0TwV8SNKtdD06LTbeS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AFFemav+zR8UdEBFx4J1SQDq1nGLkD8Yi1cJqvhnV9AkMep6Xe6a/TbeW7xH/wAeArlp4rD1v4dRP0dzaVGcPii16ozq7r45/wDJbPiH/wBjFqP/AKUyVwtdz8c+PjZ8Q/8AsYtR/wDSmSuoxOGooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP8AyW74ef8AYxaf/wClMdcPXcfAn/kt/wAPP+xi07/0pjrh6ACitHSfDmra9L5Wl6XealJ/ds7d5j/46DXdaP8As1fFDW2AtvBOqR573kYth+cpWuarisPR/iVEvV2/M2hSlP4U/kfqrR5SSgpJsdH+VlZdwx7in0V/Ld2tmfo5ymqfCXwVrYYaj4P0S8z/AMtptNiZv++tmV/A1yXiz9lP4X+M9WvdV1Hw4f7TvZXuLi6gvJkMkjszO5AfbksxJ4616xRXZSzHGUdKdWS+bMpUaU/iin8j5n1b/gn38PbxXax1XXLCQ9FM8Ukf5GPP61wur/8ABOV8M+meOBntFead/wCzrIf/AEGvtKivXo8TZtS2q/gv+CcrwGGlvH7tD89tV/4J/fEKyDNZaloeoqOircSRufwaMD9a4zV/2Pfi5pAZj4Ua8jH8dpdwSZ/4CH3fpX6eUV7FLjXMofEov5M5JZRh27ps/I3V/gz480LcdQ8G69bRr1lbT5fL/wC+guP1rlbiynspjDcwyW8o6pKhVvyNfs5Ve70+1v4zHdW8V3F/zzmQMv5HIr1aXHM1/FoXfk/+Ac0slj9if3r/AIKPxlpK/W3Vfgl8PtaVhe+CdCmZusg0+JX/AO+gAf1rjdW/Y5+Eeq7m/wCEXNnIf4rS8njA/wCA7yv6V69PjbBfapy/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f4u8S+LdYjsF1H7OjAlpPL37cKSOMjrjH41+judHDVIYBScmkklyxe+tk36ngKM6kXXskndvV9PQ0N1r/wBCL/L/ABrE+IVzqWvw213LpUthBaRlSr44XP1NM1v4g6/pGq3Vkuo+eIJDEX2bckEjpk+ldNY65d678LtemvH8yRVZQfbNZOpQxsa2EhJx5U21yxSbjrq16DUalHkrNJptJat7+p49Xo/wa8Ox3upy6rcqBb2mCm4cMTu5/DFecV0XhnxJeWj22mROVtpbiJiAT2f+RzzXx+U1qNHHQqVldLVeb6X8j18VBujKEXa/5dT0/wAefEe68Na0lnBa286cNulUnqB7/wC1XO/FeH/ittK/g3Rx7u3/AC0bNUfi/wD8jJbt/wBMk/kK1virol14k8Y2NrYorSNZA/O2Bwzn+lfcYzEV8UsVTa5uSUUl6t6L1seFQpwp+yktLp3Zs+NvBtt4pntimtWsCwKUCl19APX2qHwN4ItfCusteya1az/uygUOvXIPr7Vx/wDwpbxI4G2G3x7yioLz4Sa/p9nJPJDb+XGu4lZR0rnlWrqv9bll75ou97vp5WtojVRh7P2SxCt2sjV8d+AGtbO91/8AtCO5iaQErEO5YDr0715vXpcv7r4Mt/t3C7f++krzSvl88hS9vCpSjy88VJq7erb6s9TAuUqclJ3s2vkgooor5w9AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK7j4O/8AI4xf9cj/AOhLXD1q+GfEdx4Zv1vbZYmcKy/vVOMHHuD2r08vrww2Kp1p7Jps58RCU6UoR3aN2bX/APhG/iFd3zxeckcrfJ65Ugfqal1Dx/4h8W3YsrWT7MkjbBBCo7nHXGf1rkNR1CTVNQuLuTaJJm3NtzwfbOat+HvEN14c1Fby0K+YAVIcHBB/Ku+OZ1I1Z0o1HGjKTem9m/8ALoY/Vko35U5JWVz0yWWD4XeGfnkSfxBd/ebcWI6/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GE/dhv8Aa9SfWse0meC4jkVirIwYEdiDmvnX7KhWvRd4Rejta69Du5ZVKXvRtJo9v8baV4avdStn1e7MN0IVOwHtiuc+M+oT2niu0eCRo3W0Xa6N/tvXA6prN5q0wmu52mkAxuNV7rUrnUJfMuZWmYDapPYelfS43PY4qFWMKajzNNNaPS+++uuljzqGBdNxlKd7X09exoReJdbmO1b+fce26po7vxDqGYVmuJ8/LjfWbpOoyaTqEF3Af3kLBl3fd47H2rtR8a9fMeBHZr9Ij/8AFV52FrUJwf1rEzi+yTd163VjoqKcWvZU0/XT9DS8b2jeH/hxpGmSjZO77nX0IOTXltaOt69e6/efab2YyyH5R6KPQD8azq58yxlPGVlOimoxSSvvZK2vrubYajKlTak9W238wooorxjqCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAxiiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACjNFFABmjNFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//2Q==';                        
    const TOAST_MS = 4000;
    const DIR_ASKED_KEY = 'bili_save_dir_asked_v1';
    const SETTINGS_KEY = 'bili_save_settings_v1';
    const THEME_KEY = 'bili_save_theme_v1';

    const DEFAULT_SETTINGS = {
        saveDir: '',
        intervalMs: 0,
        timeoutMs: 30000,
        dedupe: true,
        downloadMode: 'auto',
        autoRun: false,
        // 便携版：落盘方式 'zip'（打包下载，最省心）| 'dir'（写入授权目录）
        portableSave: 'zip',
        portableVideoSave: 'single',                    // 便携版视频保存方式：single=逐个下载 zip=打包成 ZIP（自动分卷）
        videoQuality: 0,                                // 视频清晰度（B 站画质码）：0 = 自动（最高可用）
        hiResAudio: false,                              // 高音质音轨：优先无损 FLAC / 杜比全景声（需大会员；FLAC 部分播放器不支持，默认关）
        // 「需要本地环境」的功能：只提示一次（避免反复打扰）
        envNotice: true,
        envNoticeShown: false,
        // 「去除无关功能」：直接隐藏所有需要本地环境的功能
        hideEnvOnly: false,
        keys: { next: 'ArrowRight', prev: 'ArrowLeft', download: 'ArrowDown', exit: 'Escape' }
    };

    // ========================================================================
    // 一、配置与持久化
    // ========================================================================
    // 读取设置并与默认值合并（localStorage 持久化）
    function loadSettings(){
        let s = Object.assign({}, DEFAULT_SETTINGS);
        try{
            const raw = localStorage.getItem(SETTINGS_KEY);
            if(raw) s = Object.assign(s, JSON.parse(raw));
        }catch(e){}
        return s;
    }
    // 保存设置到 localStorage
    function saveSettings(s){
        try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch(e){}
    }
    // 读取主题（auto / cloud / midnight / sakura；旧版本存的是 light / dark，读的时候兼容）
    function loadTheme(){
        try{ return localStorage.getItem(THEME_KEY) || 'auto'; }catch(e){ return 'auto'; }
    }
    // 保存主题
    function saveTheme(t){
        try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
    }
    const THEME = loadTheme();

    // ========================================================================
    // 二、通用工具
    // ========================================================================
    // 延时工具（Promise 版 setTimeout）
    function sleep(ms){
        return new Promise(r => setTimeout(r, ms));
    }

    // 应用主题：注入一次样式表 + 在 <html> 上打标记，之后纯 CSS 生效（不需要刷新页面）
    function applyTheme(theme){
        injectUiCss();
        const t = TH ? TH.normalizeTheme(theme) : 'auto';
        document.documentElement.setAttribute('data-bp-theme', t);
        return t;
    }

    // ========================================================================
    // 三、图片地址处理（规范化 / 原图还原 / 过滤）
    // ========================================================================
    // B 站页面本身是 https：http 的媒体地址会被浏览器按混合内容直接拦掉，
    // 所以把 B 站自家 CDN 的 http 地址统一升级成 https（第三方域名保持原样，不擅自改）
    function upgradeMediaProtocol(url){
        if(url && url.protocol === 'http:' && /(^|\.)(hdslb\.com|bilibili\.com|bilivideo\.com|bilivideo\.cn)$/i.test(url.hostname)){
            url.protocol = 'https:';
        }
        return url;
    }

    // 把相对 / 协议相对地址补全为绝对地址
    function normalizeUrl(raw, base){
        if(!raw) return null;
        raw = raw.trim();
        if(raw.startsWith('//')) raw = 'https:' + raw;
        try{
            const url = new URL(raw, base || window.location.href);
            if(url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return upgradeMediaProtocol(url).href;
        }catch(e){
            return null;
        }
    }






    // 缩略图地址还原为原图（反转义 \u002F、去 @ 参数、webp/avif→jpg）
    function toOriginalImageUrl(raw, base){
        if(!raw) return null;
        let u = String(raw).trim()
            .replace(/\\u002F/g, '/')
            .replace(/\\\//g, '/');
        if(u.startsWith('//')) u = 'https:' + u;
        try{
            const url = new URL(u, base || window.location.href);
            if(url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            upgradeMediaProtocol(url);
            let pathname = url.pathname.split('@')[0];
            if(/\.(webp|avif)$/i.test(pathname) && /(hdslb\.com|bilibili\.com)/i.test(url.hostname)){
                pathname = pathname.replace(/\.(webp|avif)$/i, '.jpg');
            }
            url.pathname = pathname;
            url.search = '';
            url.hash = '';
            return url.href;
        }catch(e){
            return null;
        }
    }



    // 判断是否为正文图片（排除头像 / 活动图等噪声）
    function isContentImageUrl(url){
        if(!url) return false;
        if(!/\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i.test(url)) return false;
        try{
            if(!/(^|\.)hdslb\.com$/i.test(new URL(url).hostname)) return false;
        }catch(e){ return false; }
        return /\/bfs\/(album|new_dyn|article|sns|opus)\//i.test(url);
    }

    // ========================================================================
    // 四、图片地址提取（DOM / 文本 / JSON / 子页面）
    // ========================================================================
    // 从 DOM 提取图片地址（img / source srcset / video poster）
    function extractUrlsFromDoc(doc, baseUrl = window.location.href){
        const urls = new Set();

        const add = (candidate) => {
            const original = toOriginalImageUrl(candidate);
            if(original && isContentImageUrl(original)) urls.add(original);
        };

        const imgAttrs = ['data-origin','data-original','data-src','data-actualsrc','src'];
        doc.querySelectorAll('img').forEach(img => {
            imgAttrs.forEach(attr => {
                const v = img.getAttribute(attr);
                if(v) add(v);
            });
            const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
            if(srcset){
                srcset.split(',').forEach(part => {
                    const url = part.trim().split(' ')[0];
                    add(url);
                });
            }
        });


        doc.querySelectorAll('source').forEach(src => {
            const srcset = src.getAttribute('srcset') || src.getAttribute('data-srcset');
            if(srcset){
                srcset.split(',').forEach(part => {
                    const url = part.trim().split(' ')[0];
                    add(url);
                });
            }
            const srcAttr = src.getAttribute('src') || src.getAttribute('data-src');
            if(srcAttr) add(srcAttr);
        });


        doc.querySelectorAll('video').forEach(v => {
            const p = v.getAttribute('poster') || v.getAttribute('data-poster');
            if(p) add(p);
        });

        doc.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || a.getAttribute('data-href');
            if(href){
                const original = toOriginalImageUrl(href);
                if(original && (isContentImageUrl(original) || /原图|查看原图|下载原图/i.test(a.textContent || ''))){
                    urls.add(original);
                }
            }
        });

        doc.querySelectorAll('[style]').forEach(el => {
            const style = el.getAttribute('style');
            const match = /background-image\s*:\s*url\(([^)]+)\)/i.exec(style);
            if(match){
                add(match[1].replace(/^['"]|['"]$/g, ''));
            }
        });

        doc.querySelectorAll('script:not([src])').forEach(script => {
            const text = script.textContent || '';
            extractUrlsFromText(text, baseUrl).forEach(u => urls.add(u));
        });

        return Array.from(urls);
    }

    // 从纯文本中提取图片地址
    function extractUrlsFromText(text, baseUrl = window.location.href){
        const urls = new Set();
        // \\?\/ 同时吃普通与 JSON 转义两种写法：直接扫 innerHTML 时地址常常是 https:\/\/… 形式，
        // 只认 https:// 会整段漏掉（漏的不只是样式，而是真的少下几张图）
        const regex = /https?:\\?\/\\?\/[^\s"'<>]+?\.(?:jpe?g|png|gif|webp|bmp|avif)(?:[@?#][^\s"'<>]*)?/gi;
        let match;
        while((match = regex.exec(text))){
            const original = toOriginalImageUrl(match[0], baseUrl);
            if(original && isContentImageUrl(original)) urls.add(original);
        }
        return Array.from(urls);
    }

    // 从 JS 数据（已转义的 JSON）中提取图片地址
    function extractUrlsFromJsonText(text, baseUrl = window.location.href){
        const urls = new Set();
        const regex = /["'](?:img|image|pic|src|url)[^"']*["']\s*:\s*["']([^"']+\.(?:jpe?g|png|gif|webp|bmp|avif)(?:[@?][^"']*)?)["']/gi;
        let match;
        while((match = regex.exec(text))){
            const original = toOriginalImageUrl(match[1]);
            if(original && isContentImageUrl(original)) urls.add(original);
        }
        return Array.from(urls);
    }

    // 从 DOM 收集 opus 详情页链接
    function getOpusLinks(doc){
        const links = new Set();
        doc.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || a.getAttribute('data-href');
            if(!href) return;
            const normalized = normalizeUrl(href, window.location.href);
            if(!normalized) return;

            if(/\/opus\/(\d+)/.test(normalized) || /t\.bilibili\.com\/(\d+)/.test(normalized)){
                links.add(normalized.split('#')[0]);
            }
        });
        return Array.from(links);
    }

    // 从文本中收集 opus 链接
    function getOpusLinksFromText(text){
        const links = new Set();
        const addNormalized = (raw) => {
            let u = raw;
            if(u.startsWith('//')) u = 'https:' + u;
            links.add(u.split('#')[0]);
        };


        const regexOpus = /https?:\/\/(?:www\.)?bilibili\.com\/opus\/(\d+)(?:\S*)/gi;
        let match;
        while((match = regexOpus.exec(text))) addNormalized(match[0]);
        const regexOpusRel = /(?:https?:)?\/\/(?:www\.)?bilibili\.com\/opus\/(\d+)(?:\S*)/gi;
        while((match = regexOpusRel.exec(text))) addNormalized(match[0]);
        const regexOpusPath = /\/[oO]pus\/(\d+)(?:\S*)/gi;
        while((match = regexOpusPath.exec(text))){
            links.add(normalizeUrl(match[0], window.location.origin).split('#')[0]);
        }


        const regexT = /https?:\/\/t\.bilibili\.com\/(\d+)(?:\S*)/gi;
        while((match = regexT.exec(text))) addNormalized(match[0]);
        const regexTRel = /(?:https?:)?\/\/t\.bilibili\.com\/(\d+)(?:\S*)/gi;
        while((match = regexTRel.exec(text))) addNormalized(match[0]);

        return Array.from(links);
    }

    // ========================================================================
    // 五、网络抓取
    // ========================================================================
    // 抓取文本内容（优先 GM_xmlhttpRequest，带 cookie 与超时；GM 失败退回普通 fetch）
    // opts.accept：请求 JSON 接口时务必传 application/json —— 用 text/html 去要 JSON，
    // B 站的接口风控会直接回 412（实测：同一接口只换 Accept 就 412）。
    const ACCEPT_HTML = 'text/html,application/xhtml+xml,*/*;q=0.8';
    const ACCEPT_JSON = 'application/json, text/plain, */*';
    async function fetchText(url, opts){
        const accept = (opts && opts.accept) || ACCEPT_HTML;
        let gmError = null;
        if(typeof GM_xmlhttpRequest === 'function'){
            try{
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        responseType: 'text',
                        withCredentials: true,
                        timeout: 20000,
                        headers: {
                            'User-Agent': navigator.userAgent,
                            'Referer': 'https://www.bilibili.com/',
                            'Accept': accept
                        },
                        onload: function(response){
                            if(response.status >= 200 && response.status < 300){
                                resolve(response.responseText);
                            } else {
                                reject(new Error('GM fetch failed ' + response.status + ' for ' + url));
                            }
                        },
                        onerror: function(){ reject(new Error('GM fetch error for ' + url)); },
                        ontimeout: function(){ reject(new Error('GM fetch timeout for ' + url)); }
                    });
                });
            }catch(err){
                gmError = err;   // 比如管理器不接受某个请求头：别让整个功能就此瘫痪，退回 fetch
            }
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try{
            const resp = await fetch(url, { credentials: 'include', signal: controller.signal, headers: { 'Accept': accept } });
            if(!resp.ok) throw new Error('Fetch failed ' + resp.status + ' for ' + url);
            return await resp.text();
        }catch(err){
            if(gmError) throw new Error('GM 通道：' + gmError.message + '；直接请求：' + err.message);
            throw err;
        }finally{
            clearTimeout(timer);
        }
    }

    // 解析一段 HTML 并提取其中的原图地址
    function parseUrlsFromHtml(html, baseUrl){

        html = html.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const urls = new Set(extractUrlsFromDoc(doc, baseUrl));
        extractUrlsFromText(html, baseUrl).forEach(u => urls.add(u));
        extractUrlsFromJsonText(html, baseUrl).forEach(u => urls.add(u));

        const metaRegex = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/gi;
        let match;
        while((match = metaRegex.exec(html))){
            const original = toOriginalImageUrl(match[1]);
            if(original) urls.add(original);
        }

        const secureMetaRegex = /<meta[^>]+(?:property|name)=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/gi;
        while((match = secureMetaRegex.exec(html))){
            const original = toOriginalImageUrl(match[1]);
            if(original) urls.add(original);
        }

        return Array.from(urls).filter(isContentImageUrl);
    }

    // 抓取 opus 子页面并提取原图地址
    async function fetchOpusPageImageUrls(url){
        try{
            const html = await fetchText(url);
            const urls = parseUrlsFromHtml(html, url);
            return urls;
        }catch(e){
            console.error('抓取子页面失败', url, e);
            return [];
        }
    }


    let statusEl = null;
    // ========================================================================
    // 六、状态提示 UI（浮窗 / 提示 / 进度）
    // ========================================================================
    // 创建（或获取）右下角状态浮窗
    function ensureStatusEl(){
        if(statusEl && statusEl.isConnected) return statusEl;
        statusEl = document.createElement('div');
        statusEl.id = 'bili-save-status';
        statusEl.className = 'bp-toast';
        statusEl.style.display = 'none';
        document.body.appendChild(statusEl);
        return statusEl;
    }
    // 更新状态浮窗文本
    function setStatus(text, autoHide){
        const el = ensureStatusEl();
        el.textContent = text;
        el.style.display = 'block';
        if(autoHide){
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.display = 'none'; }, TOAST_MS);
        }
    }
    // 轻量提示（自动消失，不打断操作）
    function showToast(text){
        setStatus(text, true);
    }
    // 进度浮窗（可选停止按钮）
    function showProgress(text, stopHandler){
        const el = ensureStatusEl();
        el.textContent = '';
        el.style.display = 'block';
        const span = document.createElement('span');
        span.textContent = text;
        el.appendChild(span);
        if(stopHandler){
            const btn = document.createElement('button');
            btn.textContent = '停止';
            btn.className = 'bp-toast__stop';
            btn.addEventListener('click', stopHandler);
            el.appendChild(btn);
        }
        return el;
    }


    // ========================================================================
    // 七、本地服务通信
    // ========================================================================
    // 向本地服务 POST JSON（图片保存通道）
    function postJsonToServer(payload){
        if(typeof GM_xmlhttpRequest === 'function'){
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: LOCAL_SERVER,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(payload),
                    timeout: 300000,                
                    onload: function(response){
                        if(response.status >= 200 && response.status < 300){
                            try{ resolve(JSON.parse(response.responseText)); }
                            catch(e){ reject(new Error('本地服务返回格式错误')); }
                        } else {
                            reject(new Error('本地服务返回 HTTP ' + response.status));
                        }
                    },
                    onerror: function(){ reject(new Error('无法连接本地保存服务')); },
                    ontimeout: function(){ reject(new Error('连接本地保存服务超时')); }
                });
            });
        }
        // 普通 fetch 没有内建超时：服务假死时会一直挂着，这里补一个和 GM 通道一致的超时
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 300000);
        return fetch(LOCAL_SERVER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        }).then(r => r.json()).catch(err => {
            throw (err && err.name === 'AbortError') ? new Error('连接本地保存服务超时') : err;
        }).finally(() => clearTimeout(timer));
    }

    // 批量提交图片地址并统计结果（环境版走本地服务，便携版走浏览器直存）
    async function sendUrlsToServer(urls, opts){
        if(!urls.length) return { ok:false, error:'no urls' };
        if(IS_PORTABLE) return saveUrlsInBrowser(urls, opts);
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const interval = (opts && opts.interval != null) ? opts.interval : settings.intervalMs;
        const timeout = (opts && opts.timeout != null) ? opts.timeout : settings.timeoutMs;
        const dedupe = (opts && opts.dedupe != null) ? opts.dedupe : settings.dedupe;
        try{
            const json = await postJsonToServer({ urls, timeout, dedupe, interval });
            console.log('本地保存服务返回', json);
            return json;
        }catch(err){
            console.error(err);
            showToast('❌ 未连接本地保存服务：\n请先双击「一键启动.bat」启动，然后刷新本页重试');
            return { ok:false, error: err.message };
        }
    }

    // ========================================================================
    // 七·五、便携版保存通道（纯浏览器：零 Node、零 ffmpeg）
    // ========================================================================
    // 媒体字节请求：B 站视频 CDN（upos-*.bilivideo.com）会校验 Referer，不带就直接 403；
    // 图片 CDN（hdslb.com）不校验，所以这个坑只有视频才会踩到。
    // fetch 不允许手写 Referer（禁止头），因此优先用 GM_xmlhttpRequest 显式带上；
    // 退回 fetch 时也绝不能把 Referer 抹掉（referrerPolicy 设成 no-referrer 就等于自断生路）。
    const MEDIA_REFERER = 'https://www.bilibili.com/';

    function pickContentType(headerText){
        const m = /^content-type:\s*([^\r\n;]+)/im.exec(String(headerText || ''));
        return m ? m[1].trim().toLowerCase() : '';
    }

    function assertMediaType(type){
        if(type.includes('text/html') || type.includes('application/json')){
            throw new Error('返回了 ' + type + '（可能是风控页）');
        }
    }

    // 网络层错误翻成人话：失败时必须让用户知道是「被插件拦了」「CDN 不可达」还是「地址过期」，
    // 否则界面上只有一个「失败 1 个」，跟点了没反应没区别
    function friendlyNetError(err){
        const msg = (err && err.message) || String(err == null ? '' : err);
        if(/^timeout$/i.test(msg) || /abort/i.test(msg)) return '下载超时（网络太慢或 CDN 不可达），可以直接重试';
        if(/Failed to fetch|NetworkError|load failed|ERR_BLOCKED|ERR_FAILED|net::/i.test(msg)){
            return '请求被中断或被拦截：广告/隐私插件可能挡了视频 CDN，也可能是网络策略限制或该 CDN 不可达（换个网络或关掉拦截插件再试）';
        }
        return msg || '未知错误';
    }

    function httpStatusError(status){
        // 403 基本都是 CDN 嫌弃 Referer 或者下载地址过期：给一句人能看懂的提示
        return status === 403
            ? new Error('HTTP 403（CDN 拒绝：Referer 缺失或下载地址已过期，重新打开面板获取新地址再试）')
            : new Error('HTTP ' + status);
    }

    function toBytes(buf){
        if(!buf) return null;
        if(buf instanceof ArrayBuffer) return new Uint8Array(buf);
        if(ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return null;
    }

    // GM 通道：能显式带 Referer，且不受 CORS 限制
    function gmFetchBytes(url, timeoutMs, onProgress){
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'arraybuffer',
                timeout: timeoutMs || 30000,
                headers: { 'Referer': MEDIA_REFERER },
                onprogress: function(res){
                    // 有的管理器在 arraybuffer 模式下不给进度：给了就报，没给就算了
                    if(!onProgress || !res) return;
                    const loaded = Number(res.loaded) || (res.response && res.response.byteLength) || 0;
                    if(loaded) onProgress(loaded, Number(res.total) || 0);
                },
                onload: function(res){
                    if(res.status < 200 || res.status >= 300){ reject(httpStatusError(res.status)); return; }
                    try{ assertMediaType(pickContentType(res.responseHeaders)); }
                    catch(e){ reject(e); return; }
                    const bytes = toBytes(res.response);
                    if(!bytes){ reject(new Error('响应不是二进制（responseType 未生效？）')); return; }
                    resolve(bytes);
                },
                onerror: () => reject(new Error('请求失败（网络或风控）')),
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }

    // 取字节：优先用流式 fetch —— 它能边下边报进度（下载进度条靠这个）；
    // 直接请求走不通（CORS / 风控 / 被扩展拦）时才退回 GM 通道。
    async function fetchBytes(url, timeoutMs, onProgress){
        let fetchError = null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), (timeoutMs || 30000));
        try{
            const res = await fetch(url, { signal: controller.signal });
            if(!res.ok) throw httpStatusError(res.status);
            assertMediaType((res.headers.get('content-type') || '').toLowerCase());
            const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
            if(res.body && typeof res.body.getReader === 'function'){
                const reader = res.body.getReader();
                const chunks = [];
                let received = 0;
                for(;;){
                    const { done, value } = await reader.read();
                    if(done) break;
                    if(value && value.length){
                        chunks.push(value);
                        received += value.length;
                        if(onProgress) onProgress(received, total);
                    }
                }
                const out = new Uint8Array(received);
                let off = 0;
                for(const c of chunks){ out.set(c, off); off += c.length; }
                if(onProgress && !received) onProgress(0, total);   // 空响应也报一次，界面不至于一直停在 0
                return out;
            }
            const buf = new Uint8Array(await res.arrayBuffer());
            if(onProgress) onProgress(buf.length, total || buf.length);
            return buf;
        }catch(err){
            if(err.name === 'AbortError') throw new Error('timeout');
            fetchError = err;
        }finally{
            clearTimeout(timer);
        }
        if(typeof GM_xmlhttpRequest === 'function'){
            try{
                return await gmFetchBytes(url, timeoutMs, onProgress);
            }catch(err){
                throw new Error('直接请求：' + fetchError.message + '；GM 通道：' + err.message);
            }
        }
        throw fetchError;
    }

    // 授权目录句柄（持久化在 IndexedDB，可跨会话复用）；prompt=true 时才弹选择框
    async function getBrowserDirHandle(prompt){
        if(!FSA_SUPPORTED) return null;
        let handle = null;
        try{ handle = await BS.idbGetKV('dirHandle'); }catch(e){}
        if(handle){
            try{
                let perm = await handle.queryPermission({ mode:'readwrite' });
                if(perm !== 'granted' && prompt) perm = await handle.requestPermission({ mode:'readwrite' });
                if(perm === 'granted') return handle;
            }catch(e){}
            if(!prompt) return null;
        }
        if(!prompt) return null;
        try{
            handle = await window.showDirectoryPicker({ mode:'readwrite' });
            await BS.idbSetKV('dirHandle', handle);
            return handle;
        }catch(e){
            return null;                       // 用户取消选择
        }
    }

    // 触发单个文件下载（ZIP 方式：一次点击一个文件，不会弹「多个文件」授权）
    // 触发浏览器下载。
    //
    // 为什么不能只用 <a download>：
    //  ① B 站是 SPA，document 上挂着捕获阶段的 click 监听，<a> 容易被当成路由导航；
    //  ② <a> 一旦带上 rel="noopener" / target，Chrome 就按「导航」而不是「下载」处理，
    //     blob URL 被打开又立刻关掉，用户看到的就是「链接已关闭」；
    //  ③ Chrome 对「同一页面连续自动下载多个文件」有限制，批量下会有一部分被拦掉。
    // 所以分两层：优先 GM_download（扩展层下载，三条全绕过），没有/失败时再用修好的 <a>。
    let blobDownloadChannel = 'anchor';                 // 自检用：最近一次走的通道
    // <a> 通道的 blob URL 统一在这里登记，页面卸载时再回收。
    // 关键：绝不能按固定时间 revoke —— 大文件 + 慢网速下，5 分钟可能还没下载完，
    // 一 revoke 就等于把正在下载的源删掉，表现为「下载到最后一步突然失败 / 链接已关闭」。
    const pendingBlobUrls = new Set();
    let blobUrlCleanupBound = false;
    function bindBlobUrlCleanup(){
        if(blobUrlCleanupBound) return;
        blobUrlCleanupBound = true;
        const flush = () => {
            pendingBlobUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch(e){} });
            pendingBlobUrls.clear();
        };
        window.addEventListener('pagehide', flush, { once: true });
        window.addEventListener('beforeunload', flush, { once: true });
    }
    function gmDownloadAvailable(){
        return typeof GM_download === 'function';
    }

    // 兜底通道：修好的 <a download>
    function anchorDownloadBlob(url, name){
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        // ⚠️ 绝对不要加 rel="noopener" / target="_self"：它们会让 download 属性失效，
        //    浏览器改成导航到 blob URL，用户看到「链接已关闭」，文件也存不下来。
        a.style.display = 'none';
        // 挂到 <html> 上：SPA 框架重渲染的是 <body>，挂在 body 里可能被连带清掉
        (document.documentElement || document.body).appendChild(a);
        a.click();
        // 不能立刻移除：下载是异步接管的，节点提前消失会让下载中断
        setTimeout(() => { try{ a.remove(); }catch(e){} }, 60000);
        // 不按时间 revoke：等页面卸载时统一回收（见 bindBlobUrlCleanup）
        pendingBlobUrls.add(url);
        bindBlobUrlCleanup();
    }

    function triggerBlobDownload(blob, filename){
        const name = String(filename || '').trim() || 'bilibili-download';
        const url = URL.createObjectURL(blob);

        if(gmDownloadAvailable()){
            let fellBack = false;
            const fallback = (why) => {
                if(fellBack) return;
                fellBack = true;
                blobDownloadChannel = 'anchor(兜底)';
                console.warn('[BiliSave] GM_download 不可用（' + why + '），改用 <a> 下载');
                anchorDownloadBlob(url, name);
                // 让用户看得见：静默失败最难受
                try{ showToast('⚠️ 系统下载通道不可用（' + why + '），已改用浏览器下载\n若仍失败，请在 Tampermonkey「设置 → 下载」里把下载模式改为「浏览器 API」'); }catch(e){}
            };
            try{
                GM_download({
                    url: url,
                    name: name,
                    saveAs: false,
                    onload: function(){
                        blobDownloadChannel = 'GM_download';
                        // GM_download 的 onload = 下载已完成，这时回收才安全
                        setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 60000);
                    },
                    onerror: function(err){
                        fallback((err && (err.error || err.details)) || 'onerror');
                    }
                });
                return;
            }catch(e){
                fallback((e && e.message) || 'throw');
                return;
            }
        }
        blobDownloadChannel = 'anchor';
        anchorDownloadBlob(url, name);
    }

    // 授权目录里是否已有这个文件（用于「已存在就跳过」，而不是覆盖甚至误删用户原有的文件）
    async function fileExistsInDir(dir, filename){
        try{ await dir.getFileHandle(filename); return true; }
        catch(e){ return false; }
    }

    // 写入授权目录（blob 已就绪时直接流式落盘）；skipExisting=true 且文件已存在时返回 false（不覆盖）
    async function writeBlobToDir(dir, filename, blob, skipExisting){
        if(skipExisting && await fileExistsInDir(dir, filename)) return false;
        const fh = await dir.getFileHandle(filename, { create:true });
        const w = await fh.createWritable();
        try{
            await blob.stream().pipeTo(w);
        }catch(e){
            // 写了一半失败：必须 abort + 删掉残片，否则留下一个坏文件，
            // 下次查重会把它当成「已下载」直接跳过，用户永远拿到的是一个打不开的文件
            try{ await w.abort(); }catch(_e){}
            try{ await dir.removeEntry(filename); }catch(_e){}
            throw e;
        }
        return true;
    }

    // 边下边写：响应体不整块进内存，直接流进授权目录；失败时只清掉本次自己写的半成品
    async function fetchToDir(dir, filename, url, timeoutMs, skipExisting, onProgress){
        if(skipExisting && await fileExistsInDir(dir, filename)) return false;
        const limit = timeoutMs || 30000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), limit);
        let started = false;
        let w = null;
        try{
            // 同样不能把 Referer 抹掉（视频 CDN 校验 Referer，去掉就 403）
            const res = await fetch(url, { signal: controller.signal });
            if(!res.ok) throw httpStatusError(res.status);
            assertMediaType((res.headers.get('content-type') || '').toLowerCase());
            const fh = await dir.getFileHandle(filename, { create:true });
            w = await fh.createWritable();
            started = true;                          // create:true 会截断同名文件，从这里开始这个文件才算「本次写的」
            if(onProgress && res.body && typeof res.body.getReader === 'function'){
                // 要报进度就自己泵：边收边写边回调
                const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
                const reader = res.body.getReader();
                let received = 0;
                for(;;){
                    const { done, value } = await reader.read();
                    if(done) break;
                    if(value && value.length){
                        received += value.length;
                        await w.write(value);
                        onProgress(received, total);
                    }
                }
                await w.close();
            }else if(res.body && typeof res.body.pipeTo === 'function'){
                await res.body.pipeTo(w);
            }else{
                await w.write(await res.arrayBuffer());
                await w.close();
            }
            w = null;
            return true;
        }catch(err){
            if(w){ try{ await w.abort(); }catch(e){} }
            if(started){ try{ await dir.removeEntry(filename); }catch(e){} }
            if(err.name === 'AbortError') err = new Error('timeout');
            // 流式 fetch 走不通（CORS / 风控 / Referer 被抹掉）就退回 GM 取字节再落盘
            if(!started && typeof GM_xmlhttpRequest === 'function'){
                const bytes = await fetchBytes(url, limit);
                return (await writeBlobToDir(dir, filename, new Blob([bytes]), skipExisting)) !== false;
            }
            throw err;
        }finally{
            clearTimeout(timer);
        }
    }

    // 便携版：批量保存图片（fetch → 查重 → 打包 ZIP 或写授权目录）
    async function saveUrlsInBrowser(urls, opts){
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const dedupe = (opts && opts.dedupe != null) ? opts.dedupe : settings.dedupe;
        const timeout = (opts && opts.timeout != null) ? opts.timeout : settings.timeoutMs;
        const wantDir = settings.portableSave === 'dir' && FSA_SUPPORTED;
        let dir = null;
        if(wantDir){
            dir = await getBrowserDirHandle(true);
            if(!dir) showToast('未选择文件夹，本次改为打包为 ZIP 下载');
        }

        const targets = [];
        const seenNames = new Set();
        for(let ui = 0; ui < urls.length; ui++){
            const u = urls[ui];
            const name = BS.hashFileNameFromUrl(u);
            if(seenNames.has(name)) continue;      // 同一张图的多个地址（如 webp/jpg 变体）只留一个，避免 ZIP 里出现同名条目
            seenNames.add(name);
            targets.push({ url:u, name, idx: ui });   // idx = 在调用方数组里的位置，结果据此对齐
        }
        let known = new Set();
        if(dedupe){
            try{ known = await BS.idbHasNames(targets.map(t => t.name)); }catch(e){}
        }

        const total = targets.length;
        const results = [];
        let idx = 0, finished = 0;
        let totalBytes = 0;                            // 已下载的字节总量（用来在内存吃紧前提醒用户）
        let memWarned = false;
        const progress = showProgress('便携版保存中 0/' + total);
        const tick = () => {
            if(progress && progress.firstChild) progress.firstChild.textContent = '便携版保存中 ' + finished + '/' + total;
        };
        async function worker(){
            while(idx < total){
                const t = targets[idx++];
                if(dedupe && known.has(t.name)){
                    results.push({ idx:t.idx, url:t.url, name:t.name, exists:true, saved:t.name });
                    finished++; tick();
                    continue;
                }
                try{
                    const bytes = await fetchBytes(t.url, timeout);
                    results.push({ idx:t.idx, url:t.url, name:t.name, bytes });
                    totalBytes += bytes.length;
                    // 非目录模式要等全部下完才打包，字节全在内存里：攒到一定量就提醒一次，
                    // 别等标签页崩了才知道该换「写入授权目录」
                    if(!dir && !memWarned && totalBytes > 800 * 1024 * 1024){
                        memWarned = true;
                        showToast('⚠️ 本次图片总量已超过 800 MB，都在内存里等着打包\n建议在「设置 → 保存位置」选「写入授权目录」（边下边写，不占内存）');
                    }
                }catch(err){
                    results.push({ idx:t.idx, url:t.url, name:t.name, error: err.message || String(err) });
                }
                finished++; tick();
            }
        }
        await Promise.all(Array.from({ length: Math.min(BROWSER_CONCURRENCY, total) }, () => worker()));

        const okItems = results.filter(r => r.bytes && !r.error);
        let zipName = '';
        if(okItems.length){
            if(dir){
                for(const r of okItems){
                    try{
                        const written = await writeBlobToDir(dir, r.name, new Blob([r.bytes]), dedupe);
                        r.saved = dir.name + '/' + r.name;
                        if(written === false) r.exists = true;      // 目录里已有同名文件：按查重跳过，不覆盖
                    }catch(e){
                        r.error = '写入失败：' + (e.message || e);
                    }
                }
            }else{
                // 单个 ZIP 有 4GB / 65535 条的硬上限：超了自动分批成多个 ZIP（_part1、_part2…）
                const baseName = BS.buildZipName();
                // 单个 ZIP 有 4GB / 65535 条的硬上限：超了自动分批成多个 ZIP（_part1、_part2…）。
                // 但这里必须给一个**远小于 4GB 的软上限**：整包字节要先在内存里拼出来再交给浏览器下载，
                // 而且 Chrome 下载这种大 Blob 很容易在下到一半时报「链接已关闭」。
                // 512MB 与音画合并的上限保持一致，内存峰值约 1GB，稳定得多。
                const batches = BS.planZipBatches(okItems.map(r => ({ name:r.name, data:r.bytes, item:r })), ZIP_SOFT_LIMIT_BYTES);
                zipName = batches.length > 1
                    ? baseName.replace(/\.zip$/, '') + '_part1~' + batches.length + '.zip'
                    : baseName;
                for(let bi = 0; bi < batches.length; bi++){
                    const batch = batches[bi];
                    const partName = batches.length > 1
                        ? baseName.replace(/\.zip$/, '') + '_part' + (bi + 1) + '.zip'
                        : baseName;
                    try{
                        const blob = BS.zipStore(batch.map(x => ({ name:x.name, data:x.data })));
                        triggerBlobDownload(blob, partName);
                        batch.forEach(x => { x.item.saved = partName + ' → ' + x.name; });
                    }catch(e){
                        const msg = (e && e.message) || String(e);
                        batch.forEach(x => { x.item.error = msg; });
                        showToast('❌ 打包失败：' + msg);
                    }
                    if(bi < batches.length - 1) await sleep(700);   // 连续下载留点间隔，避免浏览器节流
                }
            }
            // 记账与查重解耦：dedupe 只决定「是否跳过已存在」，成功落盘一律记账
            // （与本地服务端一致：关掉查重也会真的写文件，下次开启查重就能命中）
            const names = okItems.filter(r => r.saved && !r.error).map(r => r.name);
            if(names.length){
                try{ await BS.idbAddNames(names); }catch(e){}
            }
            if(names.length){
                showToast('✅ 已保存 ' + names.length + ' 张图片' +
                    (dir ? ('\n保存位置：' + dir.name) : ('\n已打包为：' + zipName)));
            }
        }

        results.forEach(r => { delete r.bytes; });        // 释放字节数据
        const saved = results.filter(r => r.saved && !r.error && !r.exists).length;
        const exists = results.filter(r => r.exists).length;
        const failed = results.filter(r => r.error).length;
        return { ok:true, total, saved, exists, failed, results };
    }

    // 便携版：批量下载视频（官方 mp4 单文件直存；仅 DASH 时音画分开存并提示一次）
    // 依次尝试候选地址：B 站给同一个流会返回多条 CDN 地址（baseUrl + backupUrl），
    // 实测经常第一条节点连不上、后面的才通。所以前一个失败就换下一个，别一次失败就判死刑。
    async function tryUrls(urls, fn){
        const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
        if(!list.length) throw new Error('没有可用的下载地址');
        let lastErr = null;
        for(let i = 0; i < list.length; i++){
            try{ return await fn(list[i], i); }
            catch(e){ lastErr = e; }
        }
        throw lastErr;
    }

    // opts.force = true 表示「重新下载」：覆盖同名文件，也不看「已下载」记账
    async function saveVideosInBrowser(items, ui, opts){
        const force = !!(opts && opts.force);
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const wantDir = settings.portableSave === 'dir' && FSA_SUPPORTED;
        const dir = await getBrowserDirHandle(wantDir);
        const zipMode = settings.portableVideoSave === 'zip';
        const ZIP_BATCH_BYTES = ZIP_SOFT_LIMIT_BYTES;      // 打包模式每包软上限（控制内存；ZIP 硬上限仍为 4GB）
        const results = [];
        let mergeNotice = false;
        let bigWarned = false;
        let pending = [];                                 // 待打包条目：攒够一批就打包，不把整批视频堆在内存里
        let pendingBytes = 22;
        let zipPart = 0;
        const zipBase = zipMode ? BS.buildZipName(new Date(), 'B站视频') : '';
        const flushZip = async () => {                    // 打包当前批次（失败则整批标记失败，可重试）
            if(!pending.length) return;
            const batch = pending;
            pending = []; pendingBytes = 22;
            zipPart++;
            const partName = zipBase.replace(/\.zip$/, '') + '_part' + zipPart + '.zip';
            if(ui.progText) ui.progText.textContent = '正在打包第 ' + zipPart + ' 个 ZIP（' + batch.length + ' 个文件）…';
            try{
                const blob = BS.zipStore(batch.map(x => ({ name:x.name, data:x.data })));
                if(dir){
                    await writeBlobToDir(dir, partName, blob);
                    batch.forEach(x => { x.item.saved = dir.name + '/' + partName + ' → ' + x.name; });
                }else{
                    triggerBlobDownload(blob, partName);
                    batch.forEach(x => { x.item.saved = partName + ' → ' + x.name; });
                }
            }catch(e){
                const msg = (e && e.message) || String(e);
                batch.forEach(x => { x.item.error = '打包失败：' + msg; delete x.item.saved; });
                showToast('❌ 视频打包失败：' + msg);
            }
        };
        // 单个文件下载期间也要让进度条动起来：按「已下字节 / 总字节」折算整体百分比
        // （200ms 节流，避免每个数据块都刷 DOM；服务器没给 content-length 时用预估大小兜底）
        let lastPaintAt = 0;
        let curEstimate = 0;
        const fileProgress = (i, label) => (received, total) => {
            const tot = total || curEstimate || 0;
            const frac = tot ? Math.min(1, received / tot) : 0;
            const now = Date.now();
            if(frac < 1 && now - lastPaintAt < 200) return;
            lastPaintAt = now;
            const overall = Math.min(99, Math.round((i + frac) / items.length * 100));
            if(ui.progBar) ui.progBar.style.width = overall + '%';
            if(ui.progPct) ui.progPct.textContent = overall + '%';
            if(ui.progSub){
                ui.progSub.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · ' + label + '  ' +
                    formatSize(received) + (tot ? (' / ' + formatSize(tot)) : '');
            }
        };
        // 便携版的音视频合并：内置 MP4Box 重排 mp4 box（不重新编码，画质无损），
        // 把 DASH 的两条流合成一个能直接播放的 mp4。体积超限就根本不去试；
        // 真合并失败也只退回「音画分开存」—— 宁可分开，也不能把用户下到的数据弄丢。
        let mergeError = '';
        const wantMerge = it => IS_PORTABLE && !!DM && !!it.audioUrl && (!it.size || DM.shouldMerge(it.size));
        const tryMerge = async (i, it, vBytes, aBytes) => {
            try{
                if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · 🔗 合并音视频';
                return await DM.mergeDashStreams(vBytes, aBytes);
            }catch(e){
                if(!mergeError) mergeError = (e && e.message) || String(e);
                return null;
            }
        };
        for(let i = 0; i < items.length; i++){
            const it = items[i];
            curEstimate = it.size || 0;                    // 服务器不给 content-length 时的进度分母
            const safeTitle = BS.sanitizeFilename(String(it.title || '').trim()) || ('video_' + (i + 1));
            const base = (safeTitle.length > 60 ? safeTitle.slice(0, 60) : safeTitle) + (it.bvid ? '_' + it.bvid : '')
                + (it.multiPart && it.cid != null ? '_c' + it.cid : '');   // 多 P 分 P 必须带 cid，否则认不出是哪一 P
            const pct = Math.round(i / items.length * 100);
            if(ui.progBar) ui.progBar.style.width = pct + '%';
            if(ui.progPct) ui.progPct.textContent = pct + '%';
            if(ui.progSub) ui.progSub.textContent = it.title || it.bvid || '';
            try{
                if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · ⬇️ 下载视频流';
                if(!zipMode && !dir && !bigWarned && it.size && it.size > 500 * 1024 * 1024){
                    bigWarned = true;                      // 未授权目录时只能整块读进内存再交给浏览器下载
                    showToast('⚠️ 该视频约 ' + formatSize(it.size) + '，要先整块读进内存\n建议在「设置 → 保存位置」选择「写入授权目录」（直接流式写入文件，不占内存）');
                }
                if(zipMode){
                    const vBytes = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchBytes(u, 600000, fileProgress(i, '⬇️ 视频流')));
                    const vName = base + (it.audioUrl ? '.video.' : '.') + (it.ext || 'mp4');
                    const r = { idx:i, bvid: it.bvid, title: it.title, saved: vName };
                    if(it.audioUrl){
                        if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · 🎵 下载音频流';
                        const aBytes = await tryUrls(it.audioUrls || [it.audioUrl], u => fetchBytes(u, 600000, fileProgress(i, '🎵 音频流')));
                        const aName = base + '.audio.m4a';
                        // 便携版能就地合并成一个 mp4（合并失败才退回分开存）
                        const merged = wantMerge(it) ? await tryMerge(i, it, vBytes, aBytes) : null;
                        if(merged){
                            const mName = base + '.mp4';
                            pending.push({ name: mName, data: merged, item: r });
                            pendingBytes += 76 + mName.length * 2 + merged.byteLength;
                        }else{
                            pending.push({ name: vName, data: vBytes, item: r });
                            pending.push({ name: aName, data: aBytes, item: r });
                            pendingBytes += 76 + (vName.length + aName.length) * 2 + vBytes.length + aBytes.length;
                            r.separate = true;
                            mergeNotice = true;
                        }
                    }else{
                        pending.push({ name: vName, data: vBytes, item: r });
                        pendingBytes += 76 + vName.length * 2 + vBytes.length;
                    }
                    results.push(r);
                    if(pending.length >= 0xFFFF || pendingBytes >= ZIP_BATCH_BYTES) await flushZip();
                }else if(wantMerge(it)){
                    // 便携版合并：两条流都得先完整进内存才能交给 MP4Box，
                    // 体积超限的项在 wantMerge 里已被挡掉（会走下面那条流式分开存的老路）
                    const vBytes = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchBytes(u, 600000, fileProgress(i, '⬇️ 视频流')));
                    if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · 🎵 下载音频流';
                    const aBytes = await tryUrls(it.audioUrls || [it.audioUrl], u => fetchBytes(u, 600000, fileProgress(i, '🎵 音频流')));
                    const merged = await tryMerge(i, it, vBytes, aBytes);
                    const mName = base + '.mp4';
                    const vName = base + '.video.' + (it.ext || 'mp4');
                    const aName = base + '.audio.m4a';
                    if(merged){
                        if(dir){
                            await writeBlobToDir(dir, mName, new Blob([merged]), !force);
                        }else{
                            triggerBlobDownload(new Blob([merged]), mName);
                        }
                        results.push({ idx:i, bvid: it.bvid, title: it.title, saved: mName });
                    }else{
                        // 合并失败：数据已经下到内存了，照样写成文件，用户不会白下
                        if(dir){
                            await writeBlobToDir(dir, vName, new Blob([vBytes]), !force);
                            await writeBlobToDir(dir, aName, new Blob([aBytes]), !force);
                        }else{
                            triggerBlobDownload(new Blob([vBytes]), vName);
                            await sleep(500);
                            triggerBlobDownload(new Blob([aBytes]), aName);
                        }
                        results.push({ idx:i, bvid: it.bvid, title: it.title, saved: vName, separate:true });
                        mergeNotice = true;
                    }
                }else if(it.audioUrl){
                    const vName = base + '.video.' + (it.ext || 'mp4');
                    const aName = base + '.audio.m4a';
                    if(dir){
                        // 目录模式：边下边写，不整块进内存；已有同名文件就跳过（不覆盖用户文件）
                        const wroteVideo = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchToDir(dir, vName, u, 600000, !force, fileProgress(i, '⬇️ 视频流')));
                        if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · 🎵 下载音频流';
                        let wroteAudio = true;
                        try{
                            wroteAudio = await tryUrls(it.audioUrls || [it.audioUrl], u => fetchToDir(dir, aName, u, 600000, !force, fileProgress(i, '🎵 音频流')));
                        }catch(e){
                            // 只清掉本次自己写的那个文件，别动用户原有的
                            if(wroteVideo !== false){ try{ await dir.removeEntry(vName); }catch(_e){} }
                            throw e;
                        }
                        if(wroteVideo === false && wroteAudio === false){
                            results.push({ idx:i, bvid: it.bvid, title: it.title, saved: vName, exists:true, separate:true });
                            mergeNotice = true;
                            continue;                      // 音画两个文件都在，不用重下
                        }
                    }else{
                        const vBytes = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchBytes(u, 600000, fileProgress(i, '⬇️ 视频流')));
                        if(ui.progText) ui.progText.textContent = '第 ' + (i + 1) + '/' + items.length + ' 个 · 🎵 下载音频流';
                        const aBytes = await tryUrls(it.audioUrls || [it.audioUrl], u => fetchBytes(u, 600000, fileProgress(i, '🎵 音频流')));
                        triggerBlobDownload(new Blob([vBytes]), vName);
                        await sleep(500);                      // 稍作间隔，避免浏览器连续下载节流
                        triggerBlobDownload(new Blob([aBytes]), aName);
                    }
                    results.push({ idx:i, bvid: it.bvid, title: it.title, saved: vName, separate:true });
                    mergeNotice = true;
                }else{
                    const name = base + '.' + (it.ext || 'mp4');
                    if(dir){
                        const wrote = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchToDir(dir, name, u, 600000, !force, fileProgress(i, '⬇️ 下载中')));
                        results.push({ idx:i, bvid: it.bvid, title: it.title, saved: name, exists: wrote === false });
                    }else{
                        const bytes = await tryUrls(it.videoUrls || [it.videoUrl], u => fetchBytes(u, 600000, fileProgress(i, '⬇️ 下载中')));
                        triggerBlobDownload(new Blob([bytes]), name);
                        results.push({ idx:i, bvid: it.bvid, title: it.title, saved: name });
                    }
                }
            }catch(err){
                const why = friendlyNetError(err);
                it.errorMsg = why;                          // 列表项上也留一份，方便看是哪一项、为什么
                results.push({ idx:i, bvid: it.bvid, title: it.title, error: why });
            }
        }
        if(zipMode) await flushZip();
        if(ui.progBar) ui.progBar.style.width = '100%';
        if(ui.progPct) ui.progPct.textContent = '100%';
        const saved = results.filter(r => r.saved && !r.error).length;
        const failed = results.filter(r => r.error).length;
        const separate = results.filter(r => r.separate).length;
        const firstFail = results.find(r => r.error);      // 把「为什么失败」直接摆出来，别让用户对着一个数字猜
        if(ui.progText) ui.progText.textContent = failed ? '⚠️ 部分完成' : '✅ 下载完成';
        if(ui.progSub) ui.progSub.textContent = '成功 ' + saved + ' 个'
            + (failed ? '，失败 ' + failed + ' 个' : '')
            + (separate ? '，音画分开保存 ' + separate + ' 个' : '')
            + (firstFail ? '　原因：' + String(firstFail.error).slice(0, 80) : '');
        const where = zipMode
            ? (zipPart ? ('已打包 ' + zipPart + ' 个 ZIP' + (dir ? ('，保存到：' + dir.name) : '（浏览器「下载」文件夹）')) : '')
            : (dir ? ('保存位置：' + dir.name) : '保存位置：浏览器「下载」文件夹');
        showToast('视频下载完成：成功 ' + saved + ' 个' + (failed ? '，失败 ' + failed + ' 个' : '') +
            (firstFail ? '\n失败原因：' + String(firstFail.error).slice(0, 140) : '') +
            (where ? '\n' + where : ''));
        if(mergeNotice){
            if(mergeError) showToast('⚠️ 音画合并没成功，已分开保存\n原因：' + mergeError + '\n（环境版装了 ffmpeg 可自动合并）');
            else notifyEnvRequired('音画合并（DASH → mp4）');
        }
        return { ok:true, results, saved, failed };
    }

    // 转义 HTML（提示文案里可能带接口返回的内容）
    function escapeHtml(s){
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 「需要本地环境」的一次性提示：只提醒一次，可在设置里关闭或直接隐藏这些功能
    function notifyEnvRequired(reason){
        const s = loadSettings();
        if(s.hideEnvOnly) return false;
        if(!s.envNotice || s.envNoticeShown) return false;
        s.envNoticeShown = true;
        saveSettings(s);

        const old = document.getElementById('bili-env-notice');
        if(old) old.remove();
        const panel = document.createElement('div');
        panel.id = 'bili-env-notice';
        panel.className = 'bp-panel';
        panel.style.cssText = 'right:20px;bottom:88px;width:390px;max-height:calc(100vh - 120px);';
        panel.innerHTML =
            '<div class="bp-head">' +
            '<span class="bp-head__icon">🔌</span>' +
            '<span class="bp-head__title">这个功能需要本地环境</span>' +
            '<button class="bp-close" id="bili-env-x" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div class="bp-scroll"><div class="bp-section">' +
            '<div class="bp-feat" style="color:var(--bp-text);">便携版无需任何环境即可保存图片和视频；但「' + escapeHtml(reason) + '」需要本地环境支持：</div>' +
            '<div class="bp-hint" style="margin:8px 0 10px;">① Node.js（≥18）　② ffmpeg（音画合并）</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:12px;">' +
            '<a class="bp-link" href="' + ENV_LINKS.node + '" target="_blank" rel="noopener">下载 Node.js</a>' +
            '<a class="bp-link" href="' + ENV_LINKS.ffmpeg + '" target="_blank" rel="noopener">下载 ffmpeg</a>' +
            '<a class="bp-link" href="' + ENV_LINKS.pkg + '" target="_blank" rel="noopener">环境版（已内置运行环境）</a>' +
            '</div>' +
            '<div class="bp-tipbox">此提示只出现一次，可在「设置 → 功能与提示」里重新打开。</div>' +
            '</div></div>' +
            '<div class="bp-foot">' +
            '<button id="bili-env-intro" class="bp-btn bp-btn--sm">功能介绍</button>' +
            '<button id="bili-env-hide" class="bp-btn bp-btn--sm">隐藏这些功能</button>' +
            '<span class="bp-foot__spacer"></span>' +
            '<button id="bili-env-ok" class="bp-btn bp-btn--primary">知道了</button>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#bili-env-ok').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-env-x').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-env-intro').addEventListener('click', () => openFeatureIntroPanel());
        panel.querySelector('#bili-env-hide').addEventListener('click', () => {
            const cur = loadSettings();
            cur.hideEnvOnly = true;
            saveSettings(cur);
            panel.remove();
            showToast('已隐藏「需要本地环境」的功能（可在设置里恢复）');
        });
        return true;
    }

    // 功能介绍面板：哪些功能开箱即用、哪些需要本地环境
    function openFeatureIntroPanel(){
        const existing = document.getElementById('bili-intro-panel');
        if(existing){ existing.remove(); }
        const s = loadSettings();
        injectUiCss();
        const feat = (icon, html) => '<div class="bp-feat" style="margin-bottom:6px;"><span>' + icon + '</span><span>' + html + '</span></div>';
        const panel = document.createElement('div');
        panel.id = 'bili-intro-panel';
        panel.className = 'bp-panel';
        panel.style.cssText = 'right:20px;bottom:88px;width:430px;max-height:calc(100vh - 120px);';
        panel.innerHTML =
            '<div class="bp-head">' +
            '<span class="bp-head__icon">🧩</span>' +
            '<span class="bp-head__title">功能介绍</span>' +
            '<span class="bp-head__meta">' + (IS_PORTABLE ? '便携版 · 无需环境' : '环境版') + '</span>' +
            '<button class="bp-close" id="bili-intro-x" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div class="bp-scroll">' +
            '<div class="bp-section">' +
            '<div class="bp-section__title">✅ 开箱即用（无需任何环境）</div>' +
            feat('🖼️', '<b>原图批量保存</b>：收藏夹 / 动态 / 作品页自动提取原图并保存') +
            feat('🔍', '<b>审查模式</b>：逐张确认后再存，键位可自定义') +
            feat('🎬', '<b>视频下载</b>：B 站官方 mp4 单文件（含音轨，最高 1080P），无需 ffmpeg') +
            feat('🗂️', '<b>已下载标记</b>：本地记账，重复下载自动跳过') +
            feat('🔥', '<b>页面增强</b>：只看大图、点赞/关注/收藏状态、多套主题') +
            '</div>' +
            '<div class="bp-section">' +
            '<div class="bp-section__title">🔌 需要本地环境（Node.js + ffmpeg）</div>' +
            feat('🎞️', '<b>4K/HDR 与音画合并</b>：DASH 流合并成带声音的 mp4') +
            feat('🖼️', '<b>图片相册页</b>：本机 127.0.0.1 页面里浏览已存图片') +
            feat('⚡', '<b>静默自动落盘</b>：后台直接写入自定义绝对路径，无需点击') +
            '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;">' +
            '<a class="bp-link" href="' + ENV_LINKS.node + '" target="_blank" rel="noopener">Node.js</a>' +
            '<a class="bp-link" href="' + ENV_LINKS.ffmpeg + '" target="_blank" rel="noopener">ffmpeg</a>' +
            '<a class="bp-link" href="' + ENV_LINKS.pkg + '" target="_blank" rel="noopener">项目主页 / 环境版</a>' +
            '</div>' +
            '</div>' +
            '<div class="bp-section">' +
            '<label class="bp-check" style="margin-bottom:10px;"><input type="checkbox" id="bili-intro-notice"' + (s.envNotice ? ' checked' : '') + '> 需要环境的功能「仅提示一次」</label>' +
            '<label class="bp-check"><input type="checkbox" id="bili-intro-hide"' + (s.hideEnvOnly ? ' checked' : '') + '> 去除无关功能：隐藏所有需要本地环境的功能</label>' +
            '</div>' +
            '</div>' +
            '<div class="bp-foot">' +
            '<span class="bp-foot__spacer"></span>' +
            '<button id="bili-intro-ok" class="bp-btn bp-btn--primary">知道了</button>' +
            '</div>';
        document.body.appendChild(panel);
        const close = () => panel.remove();
        panel.querySelector('#bili-intro-x').addEventListener('click', close);
        panel.querySelector('#bili-intro-ok').addEventListener('click', close);
        panel.querySelector('#bili-intro-notice').addEventListener('change', (e) => {
            const cur = loadSettings();
            cur.envNotice = e.target.checked;
            if(e.target.checked) cur.envNoticeShown = false;      // 重新打开后允许再提示一次
            saveSettings(cur);
        });
        panel.querySelector('#bili-intro-hide').addEventListener('change', (e) => {
            const cur = loadSettings();
            cur.hideEnvOnly = e.target.checked;
            saveSettings(cur);
            showToast(e.target.checked ? '已隐藏需要本地环境的功能' : '已恢复显示需要本地环境的功能');
        });
    }

    // 首次使用时自动展示一次功能介绍（之后可在设置面板随时打开）
    function maybeShowIntroOnce(){
        const key = 'bili_intro_shown_v1';
        try{
            if(localStorage.getItem(key) === '1') return;
            localStorage.setItem(key, '1');
        }catch(e){ return; }
        setTimeout(openFeatureIntroPanel, 2000);
    }

    // ========================================================================
    // 八、页面类型识别
    // ========================================================================
    // 识别页面类型：收藏夹 / 动态列表 / 动态详情 / 作品 / 空间其它 / 普通页
    function detectPageType(){
        const host = location.hostname;
        const path = location.pathname;
        const isSpace = host === 'space.bilibili.com';
        const uid = (isSpace && /^\/(\d+)/.test(path)) ? path.match(/^\/(\d+)/)[1] : null;


        if(isSpace && /\/favlist/.test(path)){
            return { type:'favlist', uid, imagePage:true, label:'收藏夹' };
        }

        // 旧版收藏夹入口（www.bilibili.com/medialist/detail/ml<fid> 与 /medialist/play/<fid>）：
        // 以前漏了这里，于是在这类页面上视频面板只会显示「未检测到视频」
        if(host === 'www.bilibili.com' && /^\/medialist\/(detail|play)\//.test(path)){
            const fid = getFavFolderId();
            return { type:'favlist', uid, fid, imagePage:true, label:'收藏夹' };
        }


        if(isSpace && /\/dynamic/.test(path)){
            return { type:'dynamic-list', uid, imagePage:true, label:'动态列表' };
        }

        if(host === 't.bilibili.com' && /^\d+$/.test(path.replace(/^\//,'').replace(/\/$/,''))){
            return { type:'dynamic-detail', uid, imagePage:true, label:'动态' };
        }

        if(/\/opus\//.test(path)){
            return { type:'opus', uid, imagePage:true, label:'作品' };
        }

        if(isSpace){
            const seg = path.split('/')[2] || '';
            const tabName = seg || '首页';
            return { type:'space-other', uid, imagePage:false, label:'空间·' + tabName };
        }

        return { type:'other', uid, imagePage:false, label:'页面' };
    }



    // 判断空间页属于自己还是他人
    function detectOwnership(){
        const ownSelectors = [
            'a[href*="/account/accountinfo"]',
            'a[href*="upload/video"]',
            'a[href*="bilibili.com/creative"]',
            '[class*="edit-avatar"]',
            '[class*="header-upinfo__edit"]',
            'a[href*="/manage"]',
            '[class*="space-edit"]'
        ].join(',');
        if(document.querySelector(ownSelectors)) return 'own';
        const otherSelectors = [
            '.header-op__btn',
            '.follow-btn',
            '[class*="follow-btn"]',
            '.be-followed',
            '[class*="header-follow"]'
        ].join(',');
        if(document.querySelector(otherSelectors)) return 'other';

        return null;
    }

    // 生成空间页的描述文本
    function describeSpace(info, ownership){
        if(!info) return '';
        if(info.type === 'favlist' || info.type === 'dynamic-list'){
            const owner = ownership === 'own' ? '（你的空间）' : (ownership === 'other' ? '（他人空间）' : '');
            return info.label + owner;
        }
        return info.label;
    }

    const stopFlag = { stop: false };

    // 统计本地服务返回的下载结果（新增 / 已存在 / 失败）
    function countResults(json){
        const list = (json && json.results) || [];
        return {
            saved: list.filter(r => r.saved && !r.error && !r.exists).length,
            exists: list.filter(r => r.exists).length,
            failed: list.filter(r => r.error).length,
            total: list.length
        };
    }
    // ========================================================================
    // 九、打赏面板
    // ========================================================================
    // 成功打赏面板（统计 + 收款码 + 作者信息）
    function showDonatePanel(stats, title){
        const existing = document.getElementById('bili-donate-panel');
        if(existing) existing.remove();
        injectUiCss();
        const panel = document.createElement('div');
        panel.id = 'bili-donate-panel';
        panel.className = 'bp-panel';
        panel.style.cssText = 'right:20px;bottom:88px;width:370px;max-height:calc(100vh - 120px);';
        const statText = stats
            ? '<span class="bp-head__meta">新增 ' + stats.saved + ' · 已存在 ' + stats.exists + ' · 失败 ' + stats.failed + '</span>'
            : '';
        panel.innerHTML =
            '<div class="bp-head">' +
            '<span class="bp-head__icon">' + (stats ? '✅' : '☕') + '</span>' +
            '<span class="bp-head__title">' + escapeHtml(title || (stats ? '下载成功！' : '感谢使用 Bilibili-Plus！')) + '</span>' +
            statText +
            '<button class="bp-close" id="bili-donate-x" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div class="bp-scroll">' +
            '<div class="bp-section">' +
            '<div style="display:flex;gap:14px;align-items:flex-start;">' +
            '<img id="bili-donate-qr" class="bp-qr" src="' + DONATE_QR + '" alt="收款码（点击放大）" title="点击放大收款码">' +
            '<div style="line-height:1.9;min-width:0;">' +
            '<div class="bp-strong">似玖得六（FNAS）</div>' +
            '<div class="bp-hint" style="word-break:break-all;">GitHub: github.com/FNAS-496/bilibili-image-saver</div>' +
            '<div class="bp-hint">邮箱: sijiudeliu@outlook.com</div>' +
            '</div>' +
            '</div>' +
            '<div class="bp-tipbox">觉得好用的话就打赏一杯咖啡钱吧 ☕<br><span class="bp-hint">（点击收款码可放大）</span></div>' +
            '</div>' +
            '</div>' +
            '<div class="bp-foot">' +
            '<a id="bili-donate-view" class="bp-btn bp-btn--accent-ghost" href="http://127.0.0.1:8765/" target="_blank" rel="noopener">查看图片</a>' +
            '<span class="bp-foot__spacer"></span>' +
            '<button id="bili-donate-close" class="bp-btn bp-btn--primary">知道了</button>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#bili-donate-close').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-donate-x').addEventListener('click', () => panel.remove());
        // 便携版没有本地服务：「查看图片」（相册页）属于需要环境的功能
        const donateViewLink = panel.querySelector('#bili-donate-view');
        if(donateViewLink && IS_PORTABLE){
            if(loadSettings().hideEnvOnly){
                donateViewLink.style.display = 'none';
            }else{
                donateViewLink.addEventListener('click', (e) => {
                    // 提示确实弹出来了才拦下跳转；否则（已提示过/关掉了提示）就让它照常跳，别做成死链
                    if(notifyEnvRequired('图片相册页（由本地服务提供）')) e.preventDefault();
                });
            }
        }
        panel.querySelector('#bili-donate-qr').addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.id = 'bili-donate-lightbox';
            overlay.className = 'bp-overlay bp-lightbox';
            const big = document.createElement('img');
            big.src = DONATE_QR;
            big.alt = '收款码';
            big.className = 'bp-lightbox__img';
            overlay.appendChild(big);
            const close = () => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
            };
            function onKey(e){
                if(e.key === 'Escape') close();
            }
            overlay.addEventListener('click', close);
            document.addEventListener('keydown', onKey);
            document.body.appendChild(overlay);
        });
    }

    // 提取 UP 主名称、头像与动态文案
    function extractUpInfo(){
        let upName = '';
        let upText = '';
        let upAvatar = '';
        const st = window.__INITIAL_STATE__;
        if(st){
            const owner = (st.videoData && st.videoData.owner) || (st.opusData && st.opusData.owner) || null;
            if(owner && owner.name) upName = owner.name;
            if(owner && owner.face) upAvatar = owner.face;
            if(!upName && st.user && st.user.name) upName = st.user.name;
            if(st.videoData && st.videoData.title) upText = st.videoData.title;
            if(!upName && st.opusData && st.opusData.title) upText = st.opusData.title;
            if(st.userInfo && st.userInfo.data && st.userInfo.data.name) upName = st.userInfo.data.name;
            if(st.opusDetail && st.opusDetail.opus) {
                const o = st.opusDetail.opus;
                if(o.author && o.author.name) upName = o.author.name;
                if(o.author && o.author.face) upAvatar = o.author.face;
                if(o.title) upText = o.title;
            }
            if(!upName && st.detail && st.detail.opus) {
                const o = st.detail.opus;
                if(o.author && o.author.name) upName = o.author.name;
                if(o.author && o.author.face) upAvatar = o.author.face;
            }
        }
        if(!upName){
            const selectors = [
                '.opus-module-author__name', '[class*="opus-module-author__name"]',
                '[class*="opus-author"]', '[class*="opus-owner"]',
                '.bili-dyn-item__author', '[class*="dyn-item__author"]',
                '.bili-dyn-member__name', '[class*="dyn-member__name"]',
                '.up-name', '.name.medium', '[class*="author__name"]',
                '[class*="author-name"]', '[class*="owner-name"]',
                '.bili-video-card__info--owner', '[class*="video-card__info--owner"]',
                '.header-info__username', '[class*="header-info__username"]'
            ];
            for(const sel of selectors){
                const el = document.querySelector(sel);
                if(el){
                    const t = (el.textContent || '').trim();
                    if(t){ upName = t; break; }
                }
            }
        }
        if(!upName){
            const link = document.querySelector('.opus-module-author a[href*="space.bilibili.com"], .bili-dyn-item__author a[href*="space.bilibili.com"], a[href*="space.bilibili.com"] [class*="author"], a[href*="space.bilibili.com"] [class*="name"]');
            if(link) upName = (link.textContent || '').trim();
        }
        if(!upName){
            const titleEl = document.querySelector('meta[property="og:title"], meta[name="og:title"]');
            if(titleEl && titleEl.content){
                const m = titleEl.content.match(/^(.+?)(?:[_-].{0,12}的?|$)/);
                if(m && m[1]) upName = m[1].trim().slice(0, 30);
            }
        }
        if(!upAvatar){
            const avatarImg = document.querySelector('.opus-module-author img, [class*="opus-author"] img, [class*="dyn-member__avatar"] img, [class*="author"] img[src*="hdslb.com"]');
            if(avatarImg) upAvatar = avatarImg.src;
        }
        if(!upText){
            const txtSelectors = [
                '.opus-module-title__content', '[class*="module-title__content"]',
                '.bili-dyn-content', '[class*="dyn-content"]',
                '.opus-detail__content', '[class*="post-content"]',
                '.desc-info', '.video-desc', '.opus-content',
                'meta[property="og:description"]'
            ];
            for(const sel of txtSelectors){
                const el = document.querySelector(sel);
                if(el){
                    const t = sel.indexOf('meta') === 0 ? (el.content || '') : (el.textContent || '');
                    if(t){ upText = t.trim().slice(0, 500); break; }
                }
            }
        }
        return { upName: upName || '未知UP主', upText, upAvatar };
    }

    // 判断页面元素是否处于已激活状态（如已点赞）
    function elementIsActive(el){
        if(!el) return false;
        let cls = '';
        try{ cls = (typeof el.className === 'string') ? el.className : (el.className && el.className.baseVal) || ''; }catch(e){}
        if(/\b(active|on|liked|followed|collect|checked|selected|sel|is-active|enabled)\b/i.test(cls)) return true;
        if(el.getAttribute('aria-pressed') === 'true') return true;
        if(el.getAttribute('aria-checked') === 'true') return true;
        const state = el.getAttribute('data-state') || el.getAttribute('data-status');
        if(state === 'active' || state === 'on' || state === 'liked' || state === 'followed' || state === 'true') return true;
        return false;
    }
    // 按选择器组查找页面上的操作按钮
    function findActionButton(groups){
        for(const group of groups){
            for(const sel of group.selectors){
                const el = document.querySelector(sel);
                if(el) return { el, active: elementIsActive(el) };
            }
        }
        return null;
    }

    // ========================================================================
    // 十、审查模式
    // ========================================================================
    // 键位显示名（ArrowRight → →）：设置面板和审查模式共用
    const KEY_DISPLAY = { ArrowDown:'↓', ArrowUp:'↑', ArrowLeft:'←', ArrowRight:'→', Escape:'Esc', Space:'空格', Enter:'回车' };
    const keyName = k => KEY_DISPLAY[k] || k;

    // 审查模式面板：左键位 / 中预览 / 右 UP 信息，三栏布局
    function openReviewPanel(urls, onDone){
        const existing = document.getElementById('bili-review-panel');
        if(existing) existing.remove();
        injectUiCss();
        const s = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const keys = Object.assign({}, DEFAULT_SETTINGS.keys, s.keys || {});
        const panel = document.createElement('div');
        // ── 面板容器 ──
        panel.id = 'bili-review-panel';
        panel.className = 'bp-review';
        // ── UP 信息 ──
        const upInfo = extractUpInfo();
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const keyRow = (label, k, which) => {
            if(!which){
                return '<div class="bp-krow">' +
                '<span class="bp-krow__label">' + label + '</span>' +
                '<kbd class="bp-kbd">' + k + '</kbd>' +
                '</div>';
            }
            return '<div class="bp-krow bili-review-key" data-key="' + which + '" title="点击后按任意键自定义">' +
            '<span class="bp-krow__label">' + label + '</span>' +
            '<kbd class="bp-kbd bp-kbd--accent bili-review-keycap">' + k + '</kbd>' +
            '</div>';
        };
        panel.innerHTML =
            // ── 左栏：键位设置 + 审查说明 + 下载进度（置底）──
            '<div id="bili-review-left" class="bp-review__side bp-review__side--left">' +
            '<div class="bp-section__title" style="margin-bottom:10px;">' +
            '<span>键位设置</span><span style="flex:1;"></span>' +
            '<button id="bili-review-key-reset" class="bp-btn bp-btn--sm">恢复默认</button>' +
            '</div>' +
            '<div class="bp-hint" style="margin-bottom:10px;padding:6px 8px;background:var(--bp-subtle);border-radius:var(--bp-radius-md);">点击卡片后按任意键即可自定义</div>' +
            keyRow('下载当前图', keyName(keys.download), 'download') +
            keyRow('下一张', keyName(keys.next), 'next') +
            keyRow('上一张', keyName(keys.prev), 'prev') +
            keyRow('退出审查', keyName(keys.exit), 'exit') +
            '<div class="bp-hint" style="margin-top:14px;line-height:1.9;">' +
            '<div class="bp-strong" style="margin-bottom:4px;">📋 审查模式说明</div>' +
            '<div>· 单张预览，满意后再下载</div>' +
            '<div>· 按 <kbd class="bp-kbd" id="bili-review-mode-dl-key">' + keyName(keys.download) + '</kbd> 保存当前这张</div>' +
            '<div>· 已下载的图标记 ✅</div>' +
            '<div>· 「全部下载」一键保存全部</div>' +
            '</div>' +
            '<div class="bp-review__progress">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">' +
            '<span>下载进度</span><span><b id="bili-review-dl-count" style="color:var(--bp-accent);">0</b> / ' + urls.length + '</span>' +
            '</div>' +
            '<div class="bp-progress"><div class="bp-progress__bar" id="bili-review-bar"></div></div>' +
            '</div>' +
            '</div>' +
            // ── 中栏：页码胶囊 + 只看大图 + 图片预览 ──
            '<div id="bili-review-center" class="bp-review__center">' +
            '<div id="bili-review-progress" class="bp-review__badge"></div>' +
            '<button id="bili-review-full" class="bp-btn bp-btn--sm bp-review__full">🔍 只看大图</button>' +
            '<div id="bili-review-frame" class="bp-review__frame">' +
            '<img id="bili-review-img" src="" alt="预览">' +
            '</div>' +
            '</div>' +
            // ── 右栏：UP 信息 + 点赞/收藏/关注/全部下载/退出 ──
            '<div id="bili-review-right" class="bp-review__side bp-review__side--right">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
            (upInfo.upAvatar
                ? '<img src="' + esc(upInfo.upAvatar) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid var(--bp-border);flex-shrink:0;" referrerpolicy="no-referrer">'
                : '<div style="width:36px;height:36px;border-radius:50%;background:var(--bp-hover);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">👤</div>') +
            '<div style="min-width:0;">' +
            '<div class="bp-review__upname">' + esc(upInfo.upName) + '</div>' +
            '<div class="bp-hint">UP主' + (upInfo.upText ? ' · 动态文案见下方' : '') + '</div>' +
            '</div>' +
            '</div>' +
            (upInfo.upText
                ? '<div class="bp-review__uptext">' + esc(upInfo.upText) + '</div>'
                : '<div class="bp-hint" style="margin-bottom:12px;">（未获取到动态文案）</div>') +
            '<div style="margin-top:4px;padding-top:10px;border-top:1px solid var(--bp-border);">' +
            '<button id="bili-review-like" class="bp-btn bp-btn--block" style="border-color:#fb7299;color:#fb7299;margin-bottom:8px;">👍 点赞</button>' +
            '<button id="bili-review-fav" class="bp-btn bp-btn--block" style="border-color:#ffa940;color:#ffa940;margin-bottom:8px;">☆ 收藏</button>' +
            '<button id="bili-review-follow" class="bp-btn bp-btn--block" style="border-color:var(--bp-accent);color:var(--bp-accent);margin-bottom:8px;">＋ 关注</button>' +
            '<button id="bili-review-dl-all" class="bp-btn bp-btn--primary bp-btn--block" style="margin-bottom:8px;">全部下载</button>' +
            '<button id="bili-review-close" class="bp-btn bp-btn--ghost bp-btn--block">退出审查</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(panel);

        // ── 运行时状态与元素引用 ──
        let index = 0;
        let downloaded = new Set();
        let busy = false;
        const imgEl = panel.querySelector('#bili-review-img');
        const progressEl = panel.querySelector('#bili-review-progress');
        const countEl = panel.querySelector('#bili-review-dl-count');
        const barEl = panel.querySelector('#bili-review-bar');
        const leftEl = panel.querySelector('#bili-review-left');
        const rightEl = panel.querySelector('#bili-review-right');
        const centerEl = panel.querySelector('#bili-review-center');
        const fullBtn = panel.querySelector('#bili-review-full');
        const likeBtn = panel.querySelector('#bili-review-like');
        const favBtn = panel.querySelector('#bili-review-fav');
        const followBtn = panel.querySelector('#bili-review-follow');
        let fullMode = false;
        let capturing = false;
        let pendingKeyListener = null;                 // 正在等待按键的那次录制，面板关掉时要注销，否则会吞掉下一次按键

        // ── 渲染当前图片与下载进度 ──
        const render = () => {
            imgEl.src = urls[index];
            progressEl.textContent = (index + 1) + ' / ' + urls.length + (downloaded.has(index) ? '  ✅ 已下载' : '');
            countEl.textContent = downloaded.size;
            if(barEl) barEl.style.width = urls.length ? Math.round(downloaded.size / urls.length * 100) + '%' : '0%';
        };

        // ── 关闭面板（回调已下载数量，必要时弹出打赏面板）──
        const close = () => {
            panel.remove();
            document.removeEventListener('keydown', onKey);
            if(pendingKeyListener){
                document.removeEventListener('keydown', pendingKeyListener);
                pendingKeyListener = null;
                capturing = false;
            }
            if(onDone) onDone(downloaded.size);
            if(downloaded.size) showDonatePanel({ saved: downloaded.size, exists: 0, failed: 0 }, '审查结束');
        };

        // ── 只看大图：隐藏左右栏 ──
        const toggleFull = () => {
            fullMode = !fullMode;
            leftEl.style.display = fullMode ? 'none' : '';
            rightEl.style.display = fullMode ? 'none' : '';
            fullBtn.textContent = fullMode ? '🗂️ 恢复侧栏' : '🔍 只看大图';
            panel.classList.toggle('is-full', fullMode);
        };

        // ── 下载当前这一张 ──
        const dlCurrent = async () => {
            if(busy) return;
            if(downloaded.has(index)){ showToast('这张已经下载过了'); return; }
            busy = true;
            showToast('⬇️ 正在下载第 ' + (index + 1) + ' 张...');
            try{
                const json = await sendUrlsToServer([urls[index]]);
                if(json && json.results){
                    const c = countResults(json);
                    if(c.saved || c.exists){
                        downloaded.add(index);
                        countEl.textContent = downloaded.size;
                        progressEl.textContent = (index + 1) + ' / ' + urls.length + '  ✅ 已下载';
                        showToast('✅ 下载完成（新增 ' + c.saved + '，已存在 ' + c.exists + '）');
                    } else {
                        showToast(IS_PORTABLE ? '❌ 下载失败，请稍后重试' : '❌ 下载失败，请检查本地服务');
                    }
                }
            } finally {
                busy = false;
            }
        };

        // ── 全部下载（跳过已下载）──
        const dlAll = async () => {
            if(busy) return;
            const remaining = urls.filter((u, i) => !downloaded.has(i));
            if(!remaining.length){ showToast('全部已下载'); return; }
            busy = true;
            showToast('⬇️ 正在全部下载 ' + remaining.length + ' 张...');
            try{
                const json = await sendUrlsToServer(remaining);
                if(json && json.results){
                    // 结果顺序 = 完成顺序，且 url 可能是 webp→jpg 变体：先认 idx（原始请求下标），
                    // 再退回 url 匹配，最后才按下标硬对，避免把「已下载」标到别的图上
                    json.results.forEach((r, i) => {
                        if(!r || !(r.saved || r.exists)) return;
                        let origIdx = -1;
                        if(r.idx != null && remaining[r.idx] != null) origIdx = urls.indexOf(remaining[r.idx]);
                        if(origIdx < 0 && r.url) origIdx = urls.indexOf(r.url);
                        if(origIdx < 0) origIdx = urls.indexOf(remaining[i]);
                        if(origIdx >= 0) downloaded.add(origIdx);
                    });
                    countEl.textContent = downloaded.size;
                    const c = countResults(json);
                    showToast(`✅ 全部下载完成：新增 ${c.saved} 张，已存在 ${c.exists} 张，失败 ${c.failed} 张`);
                    close();
                }
            } finally {
                busy = false;
            }
        };

        // ── 键盘快捷键（可在左栏自定义）──
        function onKey(e){
            if(busy || capturing){ return; }
            const k = e.key;
            if(k === keys.download){ e.preventDefault(); dlCurrent(); }
            else if(k === keys.next){ e.preventDefault(); index = Math.min(urls.length - 1, index + 1); render(); }
            else if(k === keys.prev){ e.preventDefault(); index = Math.max(0, index - 1); render(); }
            else if(k === keys.exit){ e.preventDefault(); close(); }
        }
        document.addEventListener('keydown', onKey);

        // ── 滚轮翻页（仅图片区生效，侧栏滚动不触发）──
        centerEl.addEventListener('wheel', (e) => {
            if(busy) return;
            if(e.deltaY > 0) index = Math.min(urls.length - 1, index + 1);
            else index = Math.max(0, index - 1);
            render();
        }, { passive: true });

        panel.querySelector('#bili-review-dl-all').addEventListener('click', dlAll);
        panel.querySelector('#bili-review-close').addEventListener('click', close);
        panel.querySelector('#bili-review-full').addEventListener('click', toggleFull);

        const refreshKeycaps = () => {
            panel.querySelectorAll('.bili-review-key').forEach(row => {
                const which = row.getAttribute('data-key');
                const cap = row.querySelector('.bili-review-keycap');
                if(cap) cap.textContent = keyName(keys[which]);
            });
            const modeDlKey = panel.querySelector('#bili-review-mode-dl-key');
            if(modeDlKey) modeDlKey.textContent = keyName(keys.download);
        };

        panel.querySelectorAll('.bili-review-key').forEach(row => {
            row.addEventListener('click', () => {
                if(capturing) return;
                const which = row.getAttribute('data-key');
                const cap = row.querySelector('.bili-review-keycap');
                if(!cap) return;
                capturing = true;
                cap.textContent = '…';
                const listener = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.removeEventListener('keydown', listener);
                    pendingKeyListener = null;
                    capturing = false;
                    let k = e.key;
                    if(k === ' ') k = 'Space';
                    if(k.length === 1) k = k.toUpperCase();
                    const KEY_LABELS = { download:'下载当前图', next:'下一张', prev:'上一张', exit:'退出审查' };
                    const conflict = Object.keys(DEFAULT_SETTINGS.keys).find(other => other !== which && keys[other] === k);
                    if(conflict){
                        showToast('⚠️ 该键已绑定「' + (KEY_LABELS[conflict] || conflict) + '」，请换一个键');
                        refreshKeycaps();
                        return;
                    }
                    keys[which] = k;
                    const settings = loadSettings();
                    settings.keys = Object.assign({}, settings.keys || {}, { [which]: k });
                    saveSettings(settings);
                    refreshKeycaps();
                };
                pendingKeyListener = listener;
                document.addEventListener('keydown', listener);
            });
        });

        panel.querySelector('#bili-review-key-reset').addEventListener('click', () => {
            const settings = loadSettings();
            settings.keys = Object.assign({}, DEFAULT_SETTINGS.keys);
            saveSettings(settings);
            Object.keys(DEFAULT_SETTINGS.keys).forEach(k => { keys[k] = DEFAULT_SETTINGS.keys[k]; });
            refreshKeycaps();
            showToast('✅ 键位已恢复默认');
        });

        const LIKE_GROUPS = [
            { name:'点赞', selectors:['.opus-like', '[class*="opus-like"]', '[class*="opus-detail__like"]', '[class*="like-btn"]'] },
            { name:'点赞', selectors:['.bili-dyn-action__like', '[class*="dyn-action__like"]'] },
            { name:'点赞', selectors:['[data-action="like"]', '[class*="action-like"]', '[class*="like-action"]'] }
        ];
        const FAV_GROUPS = [
            { name:'收藏', selectors:['[class*="favorite"]', '[class*="fav-btn"]', '[class*="collect-btn"]', '[class*="star-btn"]'] },
            { name:'收藏', selectors:['[data-action="favorite"]', '[data-action="collect"]', '[class*="action-fav"]'] }
        ];
        const FOLLOW_GROUPS = [
            { name:'关注', selectors:['[class*="follow-btn"]', '[class*="follow-btn"]', '[class*="header-follow"]', '[class*="be-followed"]', '[class*="relation-btn"]'] }
        ];
        const actionStates = { like: null, fav: null, follow: null };

        function refreshActionButtons(){
            const likeHit = findActionButton(LIKE_GROUPS);
            const favHit = findActionButton(FAV_GROUPS);
            const followHit = findActionButton(FOLLOW_GROUPS);
            actionStates.like = likeHit;
            actionStates.fav = favHit;
            actionStates.follow = followHit;
            if(likeBtn){
                const on = !!(likeHit && likeHit.active);
                likeBtn.textContent = on ? '❤️ 已点赞' : '👍 点赞';
                likeBtn.style.background = on ? 'rgba(251,114,153,.16)' : 'transparent';
            }
            if(favBtn){
                const on = !!(favHit && favHit.active);
                favBtn.textContent = on ? '★ 已收藏' : '☆ 收藏';
                favBtn.style.background = on ? 'rgba(255,169,64,.16)' : 'transparent';
            }
            if(followBtn){
                const on = !!(followHit && followHit.active);
                followBtn.textContent = on ? '✔ 已关注' : '＋ 关注';
                followBtn.style.background = on ? 'rgba(0,161,214,.16)' : 'transparent';
            }
        }

        const bindAction = (btn, key, label) => {
            if(!btn) return;
            btn.addEventListener('click', () => {
                const hit = actionStates[key];
                if(!hit || !hit.el){
                    showToast('未找到' + label + '按钮，请在页面右侧直接操作');
                    return;
                }
                try{
                    hit.el.click();
                }catch(e){}
                showToast((hit.active ? '已取消' : '已') + label);
                setTimeout(refreshActionButtons, 600);
            });
        };
        bindAction(likeBtn, 'like', '点赞');
        bindAction(favBtn, 'fav', '收藏');
        bindAction(followBtn, 'follow', '关注');

        panel.addEventListener('click', (e) => {
            if(e.target === panel) close();
        });

        render();
        refreshActionButtons();

        serverApi('/check', { urls }).then(json => {
            if(json && Array.isArray(json.results)){
                json.results.forEach((r, i) => { if(r && r.exists) downloaded.add(i); });
                countEl.textContent = downloaded.size;
                render();
            }
        }).catch(() => {});
    }

    // ========================================================================
    // 十一、主流程
    // ========================================================================
    // 主流程：提取图片 → 按设置自动下载或进入审查模式
    async function collectAndSave(){
        stopFlag.stop = false;
        const pageUrls = new Set(extractUrlsFromDoc(document));
        const textUrls = extractUrlsFromText(document.documentElement.innerHTML);
        textUrls.forEach(u => pageUrls.add(u));
        const jsonUrls = extractUrlsFromJsonText(document.documentElement.innerHTML);
        jsonUrls.forEach(u => pageUrls.add(u));


        const info = detectPageType();
        let failCount = 0;

        if(info && info.type === 'favlist'){
            const opusLinks = getOpusLinks(document);
            const textOpusLinks = getOpusLinksFromText(document.documentElement.innerHTML);
            textOpusLinks.forEach(u => opusLinks.push(u));
            const uniqueOpusLinks = Array.from(new Set(opusLinks));
            const limited = uniqueOpusLinks.slice(0, MAX_CHILD_PAGES);
            if(limited.length){
                const progress = showProgress(`正在抓取 ${limited.length} 个作品的大图链接...`, () => { stopFlag.stop = true; });
                let done = 0;
                async function worker(){
                    while(!stopFlag.stop && done < limited.length){
                        const link = limited[done++];
                        const childUrls = await fetchOpusPageImageUrls(link);
                        if(childUrls.length){
                            childUrls.forEach(u => pageUrls.add(u));
                        } else {
                            failCount++;
                        }
                        const span = progress && progress.querySelector('span');
                        if(span) span.textContent = `正在抓取作品大图链接 ${Math.min(done, limited.length)}/${limited.length} ...`;
                    }
                }
                await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, limited.length) }, () => worker()));
            }
        }

        if(stopFlag.stop){
            showToast('已停止。');
            return;
        }

        const urlsAll = Array.from(pageUrls).filter(isContentImageUrl);
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const urls = urlsAll;                          // 不再限制单次下载数量：ZIP 会自动分批
        if(urls.length === 0){

            const retry = (window.__biliRetryCount || 0) + 1;
            if(retry <= 3){
                window.__biliRetryCount = retry;
                showToast(`页面内容可能还在加载，${retry}/3 次自动重试...`);
                setTimeout(() => { collectAndSave(); }, 4000);
            } else {
                window.__biliRetryCount = 0;
                showToast('未检索到可用图片地址。\n可能是该空间动态未公开，或请刷新页面后重试。');
            }
            return;
        }

        window.__biliRetryCount = 0;
        if(settings.downloadMode === 'review'){
            const statusEl = document.getElementById('bili-save-status');
            if(statusEl) statusEl.style.display = 'none';
            openReviewPanel(urls, (downloadedCount) => {
                if(downloadedCount > 0){
                    showToast('审查结束，共下载 ' + downloadedCount + ' 张');
                } else {
                    showToast('已退出审查（未下载）');
                }
            });
            return;
        }
        // 抓取阶段可以停；进入保存阶段后没法中断，就不放一个点了没反应的「停止」按钮了
        showProgress(`正在下载 ${urls.length} 张原图到本地...`);
        const json = await sendUrlsToServer(urls, settings);
        if(json && json.results){
            const c = countResults(json);
            // 便携版不写本地服务的目录；环境版直接从返回的实际路径里取保存位置，
            // 不要再写死「bilibili_images」——默认目录早就不是它了
            const where = IS_PORTABLE
                ? (loadSettings().portableSave === 'dir' && FSA_SUPPORTED
                    ? '\n图片已写入你选择的文件夹'
                    : '\n图片已打包为 ZIP，存在浏览器「下载」文件夹')
                : (() => {
                    const first = json.results.find(r => r.saved && !r.error);
                    const dir = first ? String(first.saved).replace(/[\\/][^\\/]+$/, '') : '';
                    return dir ? '\n保存位置：' + dir : '';
                })();
            showToast(`保存完成：新增 ${c.saved} 张，已存在 ${c.exists} 张，失败 ${c.failed} 张` + where);
            showDonatePanel(c);                   
            if(failCount) console.warn('解析失败的作品数:', failCount);
        }
    }


    // 动态列表页监听滚动，增量保存新加载的图片
    function setupDynamicListWatcher(){
        const info = detectPageType();
        if(!info || info.type !== 'dynamic-list') return;
        const seen = new Set();
        const queue = new Set();
        let timer = null;
        let stopped = false;
        // 全文档扫描很贵（img/source/video/a/[style] + 所有内联 script），
        // 所以放在防抖回调里做一次，而不是每个滚动/变更事件都做一次
        const scan = () => {
            timer = null;
            if(stopped) return;
            extractUrlsFromDoc(document).forEach(u => {
                if(!seen.has(u)){ seen.add(u); queue.add(u); }
            });
            if(!queue.size) return;
            const urls = Array.from(queue).filter(isContentImageUrl);
            if(!urls.length) return;
            const st = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
            if(!st.autoRun || st.downloadMode === 'review') return;   // 设置不允许自动存：先留在队列里，等设置改了再说
            queue.clear();
            showToast(`发现 ${urls.length} 张新图片，自动保存中...`);
            sendUrlsToServer(urls).then(res => {
                if(!res || res.ok === false) urls.forEach(u => queue.add(u));   // 没存成功就放回去，下次重试
            }).catch(err => {
                urls.forEach(u => queue.add(u));
                console.error('自动保存失败', err);
            });
        };
        const collect = () => {
            if(stopped) return;
            clearTimeout(timer);
            timer = setTimeout(scan, 1500);
        };
        const observer = new MutationObserver(collect);
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('scroll', collect, { passive: true });
        window.addEventListener('pagehide', () => {
            stopped = true;
            clearTimeout(timer);
            observer.disconnect();
            window.removeEventListener('scroll', collect);
        }, { once: true });
    }


    // 便携版的 /check：用 IndexedDB 记账判断「已下载」（浏览器无法扫目录）
    async function browserCheckUrls(body){
        const urls = (body && Array.isArray(body.urls)) ? body.urls : [];
        let known = new Set();
        try{ known = await BS.idbHasNames(urls.map(u => BS.hashFileNameFromUrl(u))); }catch(e){}
        return { ok:true, results: urls.map(u => ({ url:u, exists: known.has(BS.hashFileNameFromUrl(u)) })) };
    }
    // 便携版的保存位置信息
    async function browserGetDirInfo(){
        if(!FSA_SUPPORTED) return { ok:true, dir:'浏览器「下载」文件夹（打包 ZIP）' };
        const h = await getBrowserDirHandle(false);
        return { ok:true, dir: h ? (h.name + '（浏览器授权目录）') : '未选择（当前打包为 ZIP 下载）' };
    }
    // 便携版的视频已下载清单（本地记账；文件名里带 _BV号，面板据此标记「已下载」）
    async function browserListVideos(){
        let names = [];
        try{ names = await BS.idbListNames('video:'); }catch(e){}
        return { ok:true, dir:'（便携版本地记账）', videos: names.map(n => ({ name: n.slice(6) })) };
    }

    // 便携版不支持手填绝对路径，只能通过按钮授权目录
    async function browserSetDirInfo(){
        if(!FSA_SUPPORTED) return { ok:false, error:'当前浏览器不支持选择文件夹，请使用 ZIP 打包方式' };
        const h = await getBrowserDirHandle(true);
        return h ? { ok:true, dir: h.name + '（浏览器授权目录）' } : { ok:false, error:'未选择文件夹' };
    }

    // 调用本地服务接口（GET 或 POST JSON）；便携版没有服务，改由浏览器本地实现应答
    function serverApi(path, body){
        if(IS_PORTABLE){
            if(path === '/check') return browserCheckUrls(body);
            if(path === '/getdir') return browserGetDirInfo();
            if(path === '/setdir') return browserSetDirInfo();
            if(path === '/video/list') return browserListVideos();
        }
        const req = body ? { method:'POST', headers:{'Content-Type':'application/json'}, data: JSON.stringify(body) } : { method:'GET' };
        return new Promise(resolve => {
            if(typeof GM_xmlhttpRequest === 'function'){
                GM_xmlhttpRequest({ ...req, url: 'http://127.0.0.1:8765' + path, timeout: 5000,
                    onload: r => { try{ resolve(JSON.parse(r.responseText)); }catch(e){ resolve(null); } },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null)
                });
            } else {
                fetch('http://127.0.0.1:8765' + path, body ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) } : {})
                    .then(r => r.json()).then(resolve).catch(() => resolve(null));
            }
        });
    }
    const getSaveDir = () => serverApi('/getdir');
    const setSaveDir = (dir) => serverApi('/setdir', { dir });

    // ========================================================================
    // 十二、设置面板
    // ========================================================================
    // 设置面板：保存目录 / 下载参数 / 下载模式 / 键位 / 主题 / 打赏
    function openSettingsPanel(){
        const existing = document.getElementById('bili-save-settings');
        if(existing){ existing.style.display = 'block'; return; }
        injectUiCss();
        const panel = document.createElement('div');
        panel.id = 'bili-save-settings';
        panel.className = 'bp-panel';
        panel.style.cssText = 'right:20px;bottom:88px;width:400px;max-height:calc(100vh - 120px);';

        const s = loadSettings();
        const curTheme = themeState.current;
        const themeSeg = TH ? TH.THEMES.map(t =>
            '<button class="bp-seg__item bp-theme-opt" data-theme="' + t + '" aria-pressed="' + (t === curTheme ? 'true' : 'false') + '">' +
            (THEME_ICON[t] || '') + ' ' + (THEME_SHORT[t] || t) + '</button>').join('') : '';

        // 外观：四套主题，点了立刻生效并落盘（不用点「保存设置」）
        const themeCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">🎨 外观</div>' +
            '<div class="bp-seg" role="group" aria-label="主题">' + themeSeg + '</div>' +
            '<div class="bp-hint" style="margin-top:8px;">跟随系统 = 按系统明暗自动切换；换主题即时生效，无需刷新页面</div>' +
            '</div>';

        // 便携版：保存位置改由「打包 ZIP / 写入浏览器授权目录」决定，不需要绝对路径输入框
        const portableDirCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">📁 保存位置（便携版）</div>' +
            '<div class="bp-hint" style="margin-bottom:8px;">' + (FSA_SUPPORTED
                ? '推荐「打包 ZIP」：一次点击一个文件，不会弹「多个文件」下载授权'
                : '当前浏览器（Firefox/Safari）不支持选择文件夹，将打包成 ZIP 下载') + '</div>' +
            '<div style="display:flex;gap:16px;margin-bottom:10px;">' +
            '<label class="bp-check"><input type="radio" name="bili-psave" value="zip"' + (s.portableSave !== 'dir' ? ' checked' : '') + '> 打包 ZIP</label>' +
            '<label class="bp-check"><input type="radio" name="bili-psave" value="dir"' + (s.portableSave === 'dir' ? ' checked' : '') + (FSA_SUPPORTED ? '' : ' disabled') + '> 写入授权目录</label>' +
            '</div>' +
            '<div class="bp-label" style="margin-top:4px;">视频下载方式</div>' +
            '<div style="display:flex;gap:16px;margin-bottom:10px;">' +
            '<label class="bp-check"><input type="radio" name="bili-vsave" value="single"' + (s.portableVideoSave !== 'zip' ? ' checked' : '') + '> 逐个下载</label>' +
            '<label class="bp-check"><input type="radio" name="bili-vsave" value="zip"' + (s.portableVideoSave === 'zip' ? ' checked' : '') + '> 打包成 ZIP（自动分卷）</label>' +
            '</div>' +
            (FSA_SUPPORTED ? '<button id="bili-dir-pick" class="bp-btn bp-btn--block">📂 选择文件夹</button>' : '') +
            '<div id="bili-dir-current" class="bp-hint" style="margin-top:8px;word-break:break-all;"></div>' +
            '</div>';

        // 环境版：绝对路径输入
        const envDirCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">📁 保存目录</div>' +
            '<div class="bp-hint" style="margin-bottom:8px;">留空 = 自动保存到桌面「B站下载」文件夹</div>' +
            '<input id="bili-dir-input" class="bp-input" type="text" placeholder="例如 D:\\bilibili_pics" value="' + (s.saveDir || '').replace(/"/g, '&quot;') + '">' +
            '<div id="bili-dir-current" class="bp-hint" style="margin-top:8px;word-break:break-all;"></div>' +
            '</div>';

        const optionsCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">⚡ 下载选项</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
            '<div><div class="bp-label">间隔 (ms)</div><input id="bili-int-input" class="bp-input" type="number" min="0" step="100" value="' + s.intervalMs + '"></div>' +
            '<div><div class="bp-label">超时 (ms)</div><input id="bili-timeout-input" class="bp-input" type="number" min="5000" step="1000" value="' + s.timeoutMs + '"></div>' +
            '</div>' +
            '<div style="display:flex;gap:18px;margin-top:12px;">' +
            '<label class="bp-check"><input type="checkbox" id="bili-dedupe-input"' + (s.dedupe ? ' checked' : '') + '> 查重</label>' +
            '<label class="bp-check"><input type="checkbox" id="bili-autorun-input"' + (s.autoRun ? ' checked' : '') + '> 打开页面自动提取</label>' +
            '</div>' +
            '</div>';

        const modeCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">🖼️ 下载模式</div>' +
            '<div class="bp-seg" role="group" aria-label="下载模式">' +
            '<button class="bp-seg__item bp-mode-opt" data-mode="auto" aria-pressed="' + (s.downloadMode !== 'review' ? 'true' : 'false') + '">⬇️ 自动下载</button>' +
            '<button class="bp-seg__item bp-mode-opt" data-mode="review" aria-pressed="' + (s.downloadMode === 'review' ? 'true' : 'false') + '">🔍 审查模式</button>' +
            '</div>' +
            '<div class="bp-label" style="margin-top:12px;">审查键位（点击后按任意键）</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
            '<button class="bili-key-btn bp-btn bp-btn--sm" data-key="next">下一页 <b class="bp-kbd" id="bili-key-next">' + keyName(s.keys && s.keys.next || '→') + '</b></button>' +
            '<button class="bili-key-btn bp-btn bp-btn--sm" data-key="prev">上一页 <b class="bp-kbd" id="bili-key-prev">' + keyName(s.keys && s.keys.prev || '←') + '</b></button>' +
            '<button class="bili-key-btn bp-btn bp-btn--sm" data-key="download">下载 <b class="bp-kbd" id="bili-key-download">' + keyName(s.keys && s.keys.download || '↓') + '</b></button>' +
            '<button class="bili-key-btn bp-btn bp-btn--sm" data-key="exit">退出 <b class="bp-kbd" id="bili-key-exit">' + keyName(s.keys && s.keys.exit || 'Esc') + '</b></button>' +
            '</div>' +
            '</div>';

        // 「功能与提示」卡片：功能介绍入口 + 仅提示一次 + 去除无关功能 + 音轨
        const featureCard =
            '<div class="bp-section">' +
            '<div class="bp-section__title">🧩 功能与提示</div>' +
            '<button id="bili-intro-btn" class="bp-btn bp-btn--block" style="margin-bottom:10px;">📖 功能介绍（哪些功能需要环境）</button>' +
            '<label class="bp-check" style="margin-bottom:8px;"><input type="checkbox" id="bili-envnotice-input"' + (s.envNotice ? ' checked' : '') + '> 需要环境的功能「仅提示一次」</label>' +
            '<label class="bp-check" style="margin-bottom:12px;"><input type="checkbox" id="bili-hideenv-input"' + (s.hideEnvOnly ? ' checked' : '') + '> 去除无关功能：隐藏需要本地环境的功能</label>' +
            '<div class="bp-label" style="margin-bottom:4px;">🎵 音轨</div>' +
            '<label class="bp-check"><input type="checkbox" id="bili-hires-input"' + (s.hiResAudio ? ' checked' : '') + '> 高音质音轨：优先无损 FLAC / 杜比全景声</label>' +
            '<div class="bp-hint" style="margin-top:4px;">需大会员；无损 FLAC 部分播放器不支持，默认用普通音轨</div>' +
            (IS_PORTABLE ? '<button id="bili-clear-marks" class="bp-btn bp-btn--block bp-btn--sm" style="margin-top:12px;">🧹 清空「已下载」记录</button>' : '') +
            '</div>';

        panel.innerHTML =
            '<div class="bp-head">' +
            '<span class="bp-head__icon">⚙️</span>' +
            '<span class="bp-head__title">Bilibili-Plus 设置</span>' +
            '<button class="bp-close" id="bili-settings-x" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div class="bp-scroll">' +
            themeCard +
            (IS_PORTABLE ? portableDirCard : envDirCard) +
            optionsCard + modeCard + featureCard +
            '</div>' +
            '<div class="bp-foot">' +
            '<button id="bili-donate-btn" class="bp-btn bp-btn--sm">☕ 赞助</button>' +
            '<span class="bp-foot__spacer"></span>' +
            '<button id="bili-dir-cancel" class="bp-btn bp-btn--ghost">取消</button>' +
            '<button id="bili-dir-ok" class="bp-btn bp-btn--primary">💾 保存设置</button>' +
            '</div>';
        document.body.appendChild(panel);
        // 主题：点一下即时生效并落盘（输入框的聚焦样式由 .bp-input:focus 处理，不用再手写）
        panel.querySelectorAll('.bp-theme-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = setTheme(btn.getAttribute('data-theme'));
                panel.querySelectorAll('.bp-theme-opt').forEach(b =>
                    b.setAttribute('aria-pressed', String(b.getAttribute('data-theme') === t)));
            });
        });
        // 下载模式：分段控件本身维护选中态，保存时按 aria-pressed 取值
        panel.querySelectorAll('.bp-mode-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.bp-mode-opt').forEach(b =>
                    b.setAttribute('aria-pressed', String(b === btn)));
            });
        });
        const pickedMode = () => {
            const on = panel.querySelector('.bp-mode-opt[aria-pressed="true"]');
            return on ? on.getAttribute('data-mode') : 'auto';
        };
        const curEl = panel.querySelector('#bili-dir-current');
        panel.querySelector('#bili-donate-btn').addEventListener('click', () => { showDonatePanel(null); });
        // 功能介绍入口 + 「仅提示一次」/「去除无关功能」开关
        panel.querySelector('#bili-intro-btn').addEventListener('click', () => openFeatureIntroPanel());
        const envNoticeInput = panel.querySelector('#bili-envnotice-input');
        envNoticeInput.addEventListener('change', () => {
            const cur = loadSettings();
            cur.envNotice = envNoticeInput.checked;
            if(envNoticeInput.checked) cur.envNoticeShown = false;      // 重新打开后允许再提示一次
            saveSettings(cur);
            showToast(envNoticeInput.checked ? '已开启：需要环境的功能「仅提示一次」' : '已关闭「需要环境」提示');
        });
        const hideEnvInput = panel.querySelector('#bili-hideenv-input');
        hideEnvInput.addEventListener('change', () => {
            const cur = loadSettings();
            cur.hideEnvOnly = hideEnvInput.checked;
            saveSettings(cur);
            showToast(hideEnvInput.checked ? '已隐藏需要本地环境的功能' : '已恢复显示需要本地环境的功能');
        });
        // 音轨质量：即时生效，不用点保存（和上面「去除无关功能」一个套路）
        const hiresInput = panel.querySelector('#bili-hires-input');
        if(hiresInput){
            hiresInput.addEventListener('change', () => {
                const cur2 = loadSettings();
                cur2.hiResAudio = hiresInput.checked;
                saveSettings(cur2);
                showToast(hiresInput.checked ? '已开启高音质音轨（优先无损 FLAC / 杜比全景声）' : '已切回普通音轨（兼容性最好）');
            });
        }
        const refreshDirInfo = async () => {
            const info = await getSaveDir();
            if(curEl) curEl.textContent = '当前 / Current: ' + ((info && info.dir) || '未连接本地服务 / server not running');
        };
        const clearMarksBtn = panel.querySelector('#bili-clear-marks');
        if(clearMarksBtn){
            clearMarksBtn.addEventListener('click', async () => {
                try{
                    await BS.idbClearNames();
                    showToast('已清空「已下载」记录，下次会重新保存');
                }catch(e){
                    showToast('清空失败：' + (e.message || e));
                }
            });
        }
        const dirPickBtn = panel.querySelector('#bili-dir-pick');
        if(dirPickBtn){
            dirPickBtn.addEventListener('click', async () => {
                const h = await getBrowserDirHandle(true);
                if(h){
                    showToast('已选择文件夹：' + h.name);
                    refreshDirInfo();
                }
            });
        }
        refreshDirInfo();
        const close = () => {
            panel.remove();
            if(pendingKeyListener){
                document.removeEventListener('keydown', pendingKeyListener);
                pendingKeyListener = null;
            }
            // 关掉面板 = 放弃没保存的键位改动；不清掉的话，下次打开面板点保存
            // 会把上一次「取消」掉的改动一起写进设置
            window.__biliPendingKeys = null;
        };
        panel.querySelector('#bili-settings-x').addEventListener('click', close);
        panel.querySelector('#bili-dir-cancel').addEventListener('click', () => {
            close();
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });
        panel.querySelector('#bili-dir-ok').addEventListener('click', async () => {
            // 便携版：只保存下载选项与落盘方式（没有绝对路径输入框）
            if(IS_PORTABLE){
                const prev = loadSettings();
                const psaveRadio = panel.querySelector('input[name="bili-psave"]:checked');
                const intervalMsP = Math.max(0, parseInt(panel.querySelector('#bili-int-input').value, 10) || 0);
                const timeoutMsP = Math.max(5000, parseInt(panel.querySelector('#bili-timeout-input').value, 10) || 30000);
                const modeRadioP = pickedMode();
                const vsaveRadio = panel.querySelector('input[name="bili-vsave"]:checked');
                saveSettings({
                    saveDir: '', intervalMs: intervalMsP, timeoutMs: timeoutMsP,
                    dedupe: panel.querySelector('#bili-dedupe-input').checked,
                    downloadMode: modeRadioP,
                    autoRun: panel.querySelector('#bili-autorun-input').checked,
                    portableSave: psaveRadio ? psaveRadio.value : 'zip',
                    portableVideoSave: vsaveRadio ? vsaveRadio.value : 'single',
                    envNotice: prev.envNotice, envNoticeShown: prev.envNoticeShown, hideEnvOnly: prev.hideEnvOnly,
                    videoQuality: prev.videoQuality, hiResAudio: prev.hiResAudio,
                    keys: Object.assign({}, DEFAULT_SETTINGS.keys, window.__biliPendingKeys || {})
                });
                window.__biliPendingKeys = null;
                const vModeText = (vsaveRadio ? vsaveRadio.value : 'single') === 'zip' ? '打包成 ZIP' : '逐个下载';
                if((psaveRadio && psaveRadio.value === 'dir')){
                    const h = await getBrowserDirHandle(true);
                    showToast(h ? ('✅ 设置已保存，图片写入 ' + h.name + '；视频：' + vModeText) : ('✅ 设置已保存（未授权目录时仍会打包 ZIP）；视频：' + vModeText));
                }else{
                    showToast('✅ 设置已保存，图片：打包 ZIP；视频：' + vModeText);
                }
                close();
                try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
                return;
            }
            const dirInput = panel.querySelector('#bili-dir-input');
            const dir = (dirInput ? dirInput.value : '').trim();
            const intervalMs = Math.max(0, parseInt(panel.querySelector('#bili-int-input').value, 10) || 0);
            const timeoutMs = Math.max(5000, parseInt(panel.querySelector('#bili-timeout-input').value, 10) || 30000);
            const dedupe = panel.querySelector('#bili-dedupe-input').checked;
            const autoRun = panel.querySelector('#bili-autorun-input').checked;
            const downloadMode = pickedMode();
            const keys = Object.assign({}, DEFAULT_SETTINGS.keys, window.__biliPendingKeys || {});
            const prevSettings = loadSettings();
            const ns = { saveDir: dir, intervalMs, timeoutMs, dedupe, downloadMode, autoRun, keys,
                portableSave: prevSettings.portableSave, portableVideoSave: prevSettings.portableVideoSave,
                envNotice: prevSettings.envNotice,
                videoQuality: prevSettings.videoQuality, hiResAudio: prevSettings.hiResAudio,
                envNoticeShown: prevSettings.envNoticeShown, hideEnvOnly: prevSettings.hideEnvOnly };
            saveSettings(ns);
            window.__biliPendingKeys = null;
            if(dir){
                const info = await setSaveDir(dir);
                if(info && info.ok){
                    showToast('✅ 设置已保存，保存目录：' + info.dir);
                } else {
                    showToast('❌ 设置失败：请先双击「一键启动.bat」启动本地服务');
                }
            } else {
                // 留空 = 恢复默认（桌面「B站下载」）；必须通知服务端，否则服务仍沿用旧目录
                const info = await setSaveDir('');
                if(info && info.ok){
                    showToast('✅ 已恢复默认保存位置：桌面「B站下载」' + (info.dir ? '\n' + info.dir : ''));
                } else {
                    showToast('✅ 设置已保存（保存目录：桌面「B站下载」）\n本地服务未运行时，重启「一键启动.bat」后生效');
                }
            }
            close();
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });

        window.__biliPendingKeys = window.__biliPendingKeys || {};
        const KEY_BTN_LABELS = { next:'下一页', prev:'上一页', download:'下载', exit:'退出' };
        let pendingKeyListener = null;                 // 面板关掉时要注销，否则会吞掉下一次按键
        panel.querySelectorAll('.bili-key-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const which = btn.getAttribute('data-key');
                btn.textContent = '按任意键...';
                const listener = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.removeEventListener('keydown', listener);
                    pendingKeyListener = null;
                    let k = e.key;
                    if(k === ' ') k = 'Space';
                    if(k.length === 1) k = k.toUpperCase();
                    const cur = Object.assign({}, DEFAULT_SETTINGS.keys, loadSettings().keys || {}, window.__biliPendingKeys || {});
                    const conflict = Object.keys(DEFAULT_SETTINGS.keys).find(other => other !== which && cur[other] === k);
                    if(conflict){
                        showToast('⚠️ 该键已绑定「' + (KEY_BTN_LABELS[conflict] || conflict) + '」，请换一个键');
                        btn.innerHTML = KEY_BTN_LABELS[which] + ' <b class="bp-kbd">' + keyName(cur[which] || (which === 'exit' ? 'Esc' : '')) + '</b>';
                        return;
                    }
                    window.__biliPendingKeys[which] = k;
                    btn.innerHTML = KEY_BTN_LABELS[which] + ' <b class="bp-kbd">' + keyName(k) + '</b>';
                };
                pendingKeyListener = listener;
                document.addEventListener('keydown', listener);
            });
        });
    }


    // 首次进入图片页时询问一次保存目录
    function maybeAskDirOnce(){
        const pageInfo = detectPageType();
        if(!pageInfo || !pageInfo.imagePage) return;
        try{
            if(localStorage.getItem(DIR_ASKED_KEY) === '1') return;
        }catch(e){}
        setTimeout(openSettingsPanel, 1200);
    }

    // ========================================================================
    // 十三、视频下载
    // ========================================================================
    // 字节数 → 可读大小
    function formatSize(bytes){
        if(!bytes || bytes <= 0) return '未知';
        if(bytes < 1024) return bytes + ' B';
        if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if(bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }
    // 秒 → mm:ss（超过 1 小时显示 h:mm:ss）
    function formatDuration(sec){
        sec = Math.round(sec || 0);
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        const mm = m < 10 ? '0' + m : m, ss = s < 10 ? '0' + s : s;
        return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
    }
    // 字节/秒 → 可读速率
    function formatSpeed(bps){
        if(!bps || bps <= 0) return '';
        if(bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(2) + ' MB/s';
        if(bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
        return Math.round(bps) + ' B/s';
    }
    // 秒 → 剩余时间文本
    function formatRemaining(sec){
        sec = Math.max(0, Math.round(sec || 0));
        if(!sec) return '';
        if(sec >= 3600) return Math.floor(sec / 3600) + ' 小时 ' + Math.floor(sec % 3600 / 60) + ' 分';
        if(sec >= 60) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
        return sec + ' 秒';
    }
    // B 站画质编码 → 友好名称（80=1080P 等）
    function qualityLabel(q){
        const map = { 127:'8K', 126:'杜比', 125:'HDR', 120:'4K', 116:'1080P60', 112:'1080P+', 80:'1080P', 74:'720P60', 64:'720P', 32:'480P', 16:'360P', 6:'240P' };
        return map[q] || (q ? (q + 'P') : '');
    }
    // 清晰度下拉里可选的档位（id 越大越清晰；0 = 自动）
    const QUALITY_CHOICES = [
        { id: 0,   label: '自动（推荐）' },
        { id: 127, label: '8K 超高清' },
        { id: 126, label: '杜比视界' },
        { id: 125, label: 'HDR 真彩' },
        { id: 120, label: '4K 超清' },
        { id: 116, label: '1080P 60帧' },
        { id: 112, label: '1080P 高码率' },
        { id: 80,  label: '1080P 高清' },
        { id: 74,  label: '720P 60帧' },
        { id: 64,  label: '720P 高清' },
        { id: 32,  label: '480P 清晰' },
        { id: 16,  label: '360P 流畅' }
    ];
    // 同一画质档会同时给多种编码（avc1 / hvc1 / av01）：优先 avc1 —— 兼容性最好，用户下完直接用播放器就能放。
    // B 站目前返回顺序通常是 avc1 在前，但不能依赖顺序（Bilibili-Evolved 也是显式优先 AVC）
    const codecRank = c => {
        const s = String(c || '').toLowerCase();
        if(s.indexOf('avc1') === 0) return 0;
        if(s.indexOf('hvc1') === 0 || s.indexOf('hev1') === 0) return 1;
        if(s.indexOf('av01') === 0) return 2;
        return 3;
    };
    // 在候选流里按目标画质挑一个：自动=最高；点名了就先要精确匹配，
    // 没有就退到「不超过它但最接近」的档位（B 站本身也会这样降级），最后兜底取最低可用
    function pickStream(list, targetQn){
        if(!Array.isArray(list) || !list.length) return null;
        const sorted = list.slice().sort((a, b) =>
            ((b.id || 0) - (a.id || 0)) || (codecRank(a.codecs) - codecRank(b.codecs)));
        if(!targetQn) return sorted[0];
        return sorted.find(x => x.id === targetQn)
            || sorted.find(x => (x.id || 0) < targetQn)
            || sorted[sorted.length - 1];
    }
    // 视频号 → 接口参数（BV… 用 bvid=，av… 必须用 aid=，拿 bvid 传 av 号接口只会报错）
    function videoIdParam(id){
        const s = String(id || '').trim();
        return /^av\d+$/i.test(s) ? ('aid=' + s.slice(2)) : ('bvid=' + s);
    }
    // 视频唯一标识：多 P 视频各分 P 的 bvid 相同，必须带上 cid 才分得清谁下过
    function videoKey(v){
        if(!v) return '';
        return String(v.bvid || '') + ((v.multiPart && v.cid != null) ? '#' + v.cid : '');
    }
    // 本次真正要下载哪些项：已下载的默认跳过（省流量）；点「🔄 重下」时 force=true 全部重下。
    // 抽成纯函数是为了能单测 —— 这段逻辑曾把 skippedDone 写丢，导致下载成功后抛 ReferenceError。
    function planVideoTargets(picked, force, isDownloaded){
        const list = (Array.isArray(picked) ? picked : []).filter(Boolean);
        const skip = (typeof isDownloaded === 'function') ? isDownloaded : () => false;
        const targets = force ? list.slice() : list.filter(it => !skip(it));
        return { targets, skipped: list.length - targets.length };
    }
    // 从当前 URL 提取视频号（BV… / av… 都原样返回，接口参数名由 videoIdParam 决定）
    function getVideoBvidFromUrl(){
        const m = location.href.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
        return m ? m[1] : null;
    }
    // DOM 兜底时一次最多列多少个（避免长列表把面板撑爆）。
    // 正常路径不会用到它：收藏夹走接口分页，能拿全。
    const MAX_FAV_PANEL_ITEMS = 50;

    // 从 URL 取收藏夹 fid：新版 space…/favlist?fid=123，旧版 www…/medialist/detail/ml123
    function getFavFolderId(){
        try{
            const fid = new URLSearchParams(location.search).get('fid');
            if(fid && /^\d+$/.test(fid)) return fid;
        }catch(e){}
        // medialist 的两种写法都要认：/medialist/detail/ml123 与 /medialist/play/ml123，
        // 「ml」前缀也可能没有（部分入口是纯数字）
        const m = location.pathname.match(/\/medialist\/(?:detail|play)\/(?:ml)?(\d+)/i);
        return m ? m[1] : null;
    }

    // 收藏夹内容接口的分页参数与限速。
    // ps 最大只接受 40（传 100 返回 -400）；但拉全 1000+ 个要几十页，
    // 实测「几十次请求挤在几秒内」会被 B 站按 IP 风控（之后连单次请求都回 412），
    // 所以这里刻意压低并发、页间留间隔，并在 412 时退避重试、仍失败就停止并保留已拿到的部分。
    const FAV_PAGE_SIZE = 20;
    const MAX_FAV_PAGES = 60;                       // 20 × 60 = 1200 个，够覆盖常见收藏夹
    const FAV_CONCURRENCY = 2;
    const FAV_PAGE_DELAY = 350;                     // 每个 worker 每页之后的间隔（ms）

    const isRateLimited = msg => /\b412\b|-412|风控|请求过于频繁|频繁|too many/i.test(String(msg == null ? '' : msg));

    // 拉一页收藏夹；失败时返回带错误标记的对象，由调用方决定重试还是停
    async function fetchFavPage(fid, pn){
        try{
            const text = await fetchText('https://api.bilibili.com/x/v3/fav/resource/list?media_id=' + encodeURIComponent(fid) +
                '&pn=' + pn + '&ps=' + FAV_PAGE_SIZE + '&keyword=&order=mtime&type=0&tid=0&platform=web',
                { accept: ACCEPT_JSON });
            const j = JSON.parse(text);
            if(j && j.code === 0 && j.data) return { data: j.data };
            // 接口明确回了错误码：-400 参数问题，-412 / 其它多为风控
            return { error: 'code=' + (j && j.code) + (j && j.message ? ' ' + j.message : ''), rateLimited: !!j && j.code === -412 };
        }catch(e){
            return { error: (e && e.message) || String(e), rateLimited: isRateLimited(e && e.message) };
        }
    }

    // 收藏夹全部视频：走官方接口分页。
    // 为什么必须走接口：收藏夹页是「客户端渲染 + 虚拟滚动」，document 里永远只有当前可见的十几条，
    // 靠 querySelectorAll 抓 DOM 只能拿到一小撮（实测一个 1062 个视频的收藏夹，DOM 里能抓到的远少于这个数）。
    // onPage(items, info)：每拉到一页就回调一次，界面可以先显示出来，不用等全部拉完。
    async function collectFavFolderItems(fid, onPage){
        if(!fid) return null;
        const first = await fetchFavPage(fid, 1);
        if(first.rateLimited) return { titled: '', total: 0, items: [], rateLimited: true, skipped: 0, truncated: false };
        if(!first.data) return null;

        const total = (first.data.info && first.data.info.media_count) || 0;
        const firstMedias = first.data.medias || [];
        const pageCount = Math.max(1, Math.min(MAX_FAV_PAGES,
            Math.ceil(Math.max(total, firstMedias.length) / FAV_PAGE_SIZE)));

        const pageMap = new Map();
        pageMap.set(1, firstMedias);

        // 把接口条目转成列表项：失效稿件（attr>0）与非普通视频（type!==2）跳过
        const toItems = (medias) => {
            const out = [];
            let skipped = 0;
            for(const m of medias || []){
                if(!m || !m.bvid || m.attr > 0 || (m.type != null && m.type !== 2)){ skipped++; continue; }
                out.push({
                    bvid: m.bvid,
                    cid: null,
                    title: String(m.title || ('视频 ' + m.bvid)).trim(),
                    duration: m.duration || null,
                    fromFav: true
                });
            }
            return { items: out, skipped };
        };

        if(onPage){
            const p1 = toItems(firstMedias);
            onPage(p1.items, { page: 1, pageCount, total, skipped: p1.skipped });
        }

        let next = 2, donePages = 1, rateLimited = false, skippedAll = 0;
        async function worker(){
            while(next <= pageCount && !rateLimited){
                const p = next++;
                let r = await fetchFavPage(fid, p);
                // 被风控：退避一次再试，还不行就整体停下来（已拿到的页面照样能用）
                if(r.rateLimited){
                    await sleep(1500);
                    r = await fetchFavPage(fid, p);
                }
                if(r.rateLimited || (!r.data && r.error && isRateLimited(r.error))){
                    rateLimited = true;
                    break;
                }
                if(r.data){
                    pageMap.set(p, r.data.medias || []);
                    if(r.data.has_more === false) next = pageCount + 1;   // 已到最后一页，别再往下拉
                }
                donePages++;
                if(onPage){
                    const pi = toItems(r.data ? r.data.medias : []);
                    skippedAll += pi.skipped;
                    onPage(pi.items, { page: donePages, pageCount, total, skipped: pi.skipped });
                }
                await sleep(FAV_PAGE_DELAY);        // 限速：别把几十个请求挤在一瞬间
            }
        }
        await Promise.all(Array.from({ length: Math.min(FAV_CONCURRENCY, Math.max(0, pageCount - 1)) }, () => worker()));

        const items = [];
        const seen = new Set();
        let skipped = 0;
        for(let p = 1; p <= pageCount; p++){
            const arr = pageMap.get(p);
            if(!arr) continue;
            const pi = toItems(arr);
            skipped += pi.skipped;
            for(const it of pi.items){
                if(seen.has(it.bvid)) continue;
                seen.add(it.bvid);
                items.push(it);
            }
        }
        if(!items.length && !rateLimited) return null;
        return {
            title: (first.data.info && first.data.info.title) || '收藏夹',
            total,
            skipped,
            rateLimited,
            truncated: !rateLimited && (pageCount >= MAX_FAV_PAGES || total > items.length + skipped),
            items
        };
    }

    // 收集当前页可下载的视频（当前视频 / 收藏夹列表）
    function collectVideoItems(){
        const items = [];
        if(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i.test(location.pathname)){
            const bvid = getVideoBvidFromUrl();
            if(bvid){
                items.push({ bvid, cid: null, title: '视频 ' + bvid, duration: null });
            }
            return items;
        }
        const info = detectPageType();
        if(info && info.type === 'favlist'){
            const seen = new Set();
            document.querySelectorAll('a[href*="/video/"]').forEach(a => {
                const href = a.getAttribute('href') || '';
                const m = href.match(/\/video\/(BV[0-9A-Za-z]+)/i);
                if(!m) return;
                const bvid = m[1];
                if(seen.has(bvid)) return;
                seen.add(bvid);
                const card = a.closest('li, .fav-video, [class*="video-card"]') || a;
                const titleEl = card.querySelector('.title, [class*="title"]');
                const domTitle = ((titleEl ? titleEl.textContent : (a.getAttribute('title') || a.textContent)) || '').trim();
                items.push({ bvid, cid: null, title: domTitle || ('视频 ' + bvid), duration: null });
            });
            return items.slice(0, MAX_FAV_PANEL_ITEMS);
        }
        return items;
    }

    // 读取合集元信息 sid / mid / 标题（__INITIAL_STATE__ 优先，DOM 兜底）
    function getCollectionMeta(){
        const st = window.__INITIAL_STATE__;
        const vd = st && st.videoData;
        if(vd && vd.ugc_season && vd.ugc_season.id){
            return { sid: vd.ugc_season.id, title: vd.ugc_season.title || '合集', mid: (vd.owner && vd.owner.mid) || null };
        }
        const a = document.querySelector('a[href*="collectiondetail"], a[href*="channel/collectiondetail"]');
        if(a){
            const href = a.getAttribute('href') || '';
            const sm = href.match(/sid=(\d+)/);
            const mm = href.match(/space\.bilibili\.com\/(\d+)/);
            if(sm) return { sid: sm[1], title: (a.getAttribute('title') || a.textContent || '').trim() || '合集', mid: mm ? mm[1] : null };
        }
        return null;
    }

    // 并发分页拉取整个合集的视频列表（最新在前）
    async function collectCollectionItems(){
        try{
            const meta = getCollectionMeta();
            if(!meta || !meta.sid || !meta.mid) return null;
            const pageSize = 30;
            const apiUrl = 'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=' + meta.mid + '&season_id=' + meta.sid + '&sort_reverse=false&page_size=' + pageSize + '&page_num=';
            const fetchPage = async (p) => {
                try{
                    const text = await fetchText(apiUrl + p);
                    const j = JSON.parse(text);
                    if(j && j.code === 0 && j.data){
                        return { archives: j.data.archives || [], total: (j.data.page && j.data.page.total) || 0 };
                    }
                }catch(e){}
                return null;
            };
            const first = await fetchPage(1);
            if(!first || !first.archives.length) return null;
            const total = first.total || first.archives.length;
            const pageCount = Math.max(1, Math.min(MAX_COLLECTION_PAGES, Math.ceil(total / pageSize)));
            const pageMap = new Map();
            pageMap.set(1, first.archives);
            let next = 2;
            async function worker(){
                while(next <= pageCount){
                    const p = next++;
                    const r = await fetchPage(p);
                    if(r) pageMap.set(p, r.archives);
                }
            }
            await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, Math.max(0, pageCount - 1)) }, () => worker()));
            const items = [];
            for(let p = 1; p <= pageCount; p++){
                const arr = pageMap.get(p);
                if(!arr) continue;
                for(const a of arr){
                    items.push({ bvid: a.bvid, cid: null, title: (a.title || ('视频 ' + a.bvid)).trim(), duration: a.duration || null, fromCollection: true });
                }
            }
            if(!items.length) return null;
            return { title: meta.title, total, truncated: total > items.length, items };
        }catch(e){
            return null;
        }
    }

    // 调用 view 接口获取 cid、分 P、标题与时长
    async function fetchViewCid(id){
        try{
            const text = await fetchText('https://api.bilibili.com/x/web-interface/view?' + videoIdParam(id));
            const j = JSON.parse(text);
            if(j && j.code === 0 && j.data){
                const d = j.data;
                const pages = Array.isArray(d.pages) && d.pages.length
                    ? d.pages.map(p => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration }))
                    : [{ cid: d.cid, page: 1, part: d.title, duration: d.duration }];
                return { cid: d.cid, duration: d.duration, title: d.title, pages };
            }
        }catch(e){}
        return null;
    }

    // nav 接口一次能拿到两样东西：登录态 + wbi 签名用的两个 key，所以一次探测两用。
    // 登录态：浏览器里读不到 HttpOnly 的 SESSDATA，问接口最靠谱（同源请求自带 Cookie）；
    // 探测失败按「已登录」处理，保守不动 —— 未登录才带 try_look，带错可能被当成试看。
    let navCache = null;
    async function fetchNavInfo(){
        if(navCache) return navCache;
        try{
            const j = JSON.parse(await fetchText('https://api.bilibili.com/x/web-interface/nav'));
            navCache = {
                loggedIn: !!(j && j.data && j.data.isLogin),
                keys: WB ? WB.parseWbiKeys(j) : null
            };
        }catch(e){
            navCache = { loggedIn: true, keys: null };
        }
        return navCache;
    }
    const detectLoggedIn = async () => (await fetchNavInfo()).loggedIn;
    const getWbiKeys = async () => (await fetchNavInfo()).keys;

    // 音轨挑选：默认拿普通音轨里码率最高的（AAC，兼容性最好，下完直接能播）；
    // 开了「高音质音轨」再优先无损 FLAC（30251）→ 杜比全景声（30250）→ 普通音轨
    function pickAudioStream(dash, hiRes){
        const normal = Array.isArray(dash.audio) ? dash.audio : [];
        const flac = (dash.flac && Array.isArray(dash.flac.audio)) ? dash.flac.audio : [];
        const dolby = (dash.dolby && Array.isArray(dash.dolby.audio)) ? dash.dolby.audio : [];
        // 同类音轨里挑档位最高的：先比 id（30280=192K > 30232=132K > 30216=64K），
        // 再拿带宽兜底 —— 实测 30232 与 30280 的 bandwidth 字段会一模一样（都是 91668），只看带宽会挑错
        const best = list => list.slice().sort((x, y) =>
            ((Number(y.id) || 0) - (Number(x.id) || 0)) || ((y.bandwidth || 0) - (x.bandwidth || 0)))[0] || null;
        return hiRes
            ? (best(flac) || best(dolby) || best(normal))
            : (best(normal) || best(dolby) || best(flac));
    }
    // playurl 的 support_formats 是「这个视频声明支持哪些档位」，dash.video 才是这个账号真能拿到的。
    // 声明了却没返回 = 拿不到（多半要大会员 / 没登录）—— 标出来，免得用户疑惑「选了 4K 怎么只给 1080P」
    function parseBlockedQualities(data, availableIds, loggedIn){
        const list = Array.isArray(data && data.support_formats) ? data.support_formats : [];
        const have = Array.isArray(availableIds) ? availableIds : [];
        return list.filter(f => f && f.quality && have.indexOf(f.quality) < 0).map(f => ({
            id: f.quality,
            label: f.new_description || qualityLabel(f.quality),
            reason: (Number(f.limit_watch_reason) > 0) ? '需大会员' : (loggedIn ? '当前不可用' : '需登录')
        }));
    }
    // 解析 DASH 结果（抽出来复用：便携版要在「单文件 durl」与 DASH 之间比一下谁更清晰）
    function parseDashStream(data, target, hiRes, loggedIn){
        const dash = data && data.dash;
        if(!dash || !Array.isArray(dash.video) || !dash.video.length) return null;
        const v = pickStream(dash.video, target) || dash.video[0];
        const a = pickAudioStream(dash, hiRes);
        const durSec = (data.timelength || dash.duration || 0) / 1000;
        const vbw = v.bandwidth || 0;
        const abw = a ? (a.bandwidth || 0) : 0;
        const mt = v.mimeType || v.mime_type || '';
        // B 站会给多条地址（baseUrl + backupUrl，常分布在 mcdn / mountaintoys / bilivideo 等不同节点）。
        // 实测中经常第一条节点连不上、后面的才通 —— 所以全都留着，下载时按顺序重试
        const urlList = (item, primary) => {
            if(!item) return [];
            const list = [];
            const push = u => { const s = String(u || '').trim(); if(s && list.indexOf(s) < 0) list.push(s); };
            push(primary);
            (item.backupUrl || item.backup_url || []).forEach(push);
            return list;
        };
        const vUrls = urlList(v, v.baseUrl || v.base_url);
        const aUrls = urlList(a, a ? (a.baseUrl || a.base_url) : null);
        return {
            videoUrl: vUrls[0] || null,
            videoUrls: vUrls,
            audioUrl: aUrls[0] || null,
            audioUrls: aUrls,
            size: (durSec > 0 && vbw) ? Math.round((vbw + abw) * durSec / 8) : null,
            quality: v.id || null,
            audioQuality: a ? (a.id || null) : null,
            ext: /mp4/i.test(mt) ? 'mp4' : 'm4s',
            available: dash.video.map(x => x.id).filter(Boolean),
            blocked: parseBlockedQualities(data, dash.video.map(x => x.id).filter(Boolean), loggedIn),
            merged: false
        };
    }
    // 解析「音视频合一的官方 mp4」结果（单文件、自带音轨，但 B 站最高只给到 720P）
    function parseDurlStream(data){
        const durl = (data && Array.isArray(data.durl) && data.durl.length) ? data.durl[0] : null;
        if(!durl) return null;
        let sum = 0;
        data.durl.forEach(x => { sum += (x.size || 0); });
        // 单文件同样有多条备用地址
        const urls = [];
        const push = u => { const s = String(u || '').trim(); if(s && urls.indexOf(s) < 0) urls.push(s); };
        push(durl.url);
        (durl.backup_url || durl.backupUrl || []).forEach(push);
        return {
            videoUrl: urls[0] || null,
            videoUrls: urls,
            audioUrl: null,
            audioUrls: [],
            size: sum || durl.size || null,
            quality: data.quality || null,
            ext: /\.flv/i.test(durl.url) ? 'flv' : 'mp4',
            merged: true
        };
    }

    // 视频号 → playurl 请求参数对象（wbi 签名要按 key 排序再拼串，所以用结构化参数，别拼字符串）
    function videoParams(id, cid){
        const idParam = videoIdParam(id);
        const eq = idParam.indexOf('=');
        const p = {};
        p[idParam.slice(0, eq)] = idParam.slice(eq + 1);
        if(cid != null) p.cid = String(cid);
        return p;
    }
    // 参数对象 → query 串（与签名用同一套编码规则）
    const toQuery = params => Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');

    // playurl 请求：先试带 wbi 签名的（降风控）；签名拿不到、或者带签名没取到数据，
    // 就原样退回未签名请求 —— 实测不签名也能正常取流（Bilibili-Evolved 同样不签），
    // 所以签名只能当锦上添花，绝不能成为单点故障。
    async function fetchPlayUrl(params){
        const api = 'https://api.bilibili.com/x/player/playurl?';
        const get = async q => {
            try{
                const j = JSON.parse(await fetchText(api + q));
                return (j && j.code === 0 && j.data) ? j.data : null;
            }catch(e){
                return null;
            }
        };
        const keys = await getWbiKeys();
        if(keys && WB){
            const signed = await get(WB.signQuery(params, keys.imgKey, keys.subKey));
            if(signed) return signed;
        }
        return await get(toQuery(params));
    }

    // 调用 playurl 接口获取视频/音频流地址与大小
    // targetQn：0 = 自动（取最高可用）；>0 时尽量取该清晰度，取不到按 B 站规则降级到最接近的
    async function fetchVideoStreams(id, cid, targetQn){
        const target = Number(targetQn) || 0;
        const logged = await detectLoggedIn();
        const hiRes = !!loadSettings().hiResAudio;
        // fnval=4048 = 4K|HDR|杜比视界|杜比音频|8K|DASH 一起要；fnval=1 = 官方音视频合一 mp4
        const ask = (fnval, qn) => {
            const p = videoParams(id, cid);
            p.fourk = '1';
            p.fnval = String(fnval);
            p.qn = String(qn);
            // 未登录时补 try_look=1（实测画质上限 480P → 1080P，两个视频都验证过）
            if(!logged) p.try_look = '1';
            return fetchPlayUrl(p);
        };
        try{
            // 便携版没有 ffmpeg：能拿「音视频合一的官方 mp4」就优先拿它（单文件、自带音轨）。
            // 这种格式 B 站最高只到 720P，所以用户点名更高清晰度时要去试 DASH——但必须比一比
            // 谁真的更清晰：未登录时 DASH 可能只给 480P，反而比 durl 的 720P 差，那就别换。
            if(IS_PORTABLE){
                const durlStream = parseDurlStream(await ask(1, target || 80));
                if(durlStream && (!target || (durlStream.quality || 0) >= target)) return durlStream;
                const dashData = await ask(4048, target || 127);
                const dashStream = parseDashStream(dashData, target, hiRes, logged);
                if(dashStream && (!durlStream || (dashStream.quality || 0) > (durlStream.quality || 0))) return dashStream;
                return durlStream || dashStream;
            }
            // 环境版直接走 DASH（装了 ffmpeg 会自动合并音画），没有 DASH 的老视频再退回 durl
            const data = await ask(4048, target || 127);
            return parseDashStream(data, target, hiRes, logged) || parseDurlStream(data);
        }catch(e){
            console.error('获取视频流失败', id, cid, e);
        }
        return null;
    }

    // 向本地服务指定路径 POST JSON（视频保存通道）
    function postJsonToPath(pathName, payload, timeoutMs){
        if(typeof GM_xmlhttpRequest === 'function'){
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'http://127.0.0.1:8765' + pathName,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(payload),
                    timeout: timeoutMs || 600000,
                    onload: function(response){
                        if(response.status >= 200 && response.status < 300){
                            try{ resolve(JSON.parse(response.responseText)); }
                            catch(e){ reject(new Error('本地服务返回格式错误')); }
                        } else {
                            reject(new Error('本地服务返回 HTTP ' + response.status));
                        }
                    },
                    onerror: function(){ reject(new Error('无法连接本地保存服务')); },
                    ontimeout: function(){ reject(new Error('连接本地保存服务超时')); }
                });
            });
        }
        return fetch('http://127.0.0.1:8765' + pathName, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => r.json());
    }

    // 视频下载面板：列表 / 大小画质 / 下载进度
    function openVideoPanel(){
        navCache = null;                               // 每次开面板重新探测登录态（用户可能中途登录/登出）
        const existing = document.getElementById('bili-video-panel');
        if(existing){ existing.remove(); }
        const panel = document.createElement('div');
        // ── 面板容器 ──
        panel.id = 'bili-video-panel';
        panel.className = 'bp-panel';
        panel.style.cssText = 'right:20px;bottom:88px;width:460px;max-height:calc(100vh - 120px);';
        injectUiCss();
        panel.innerHTML =
            // ── 面板 HTML：标题 + 列表 + 进度 + 底部操作 ──
            '<div class="bp-head">' +
            '<span class="bp-head__icon">📹</span>' +
            '<span class="bp-head__title">视频批量下载</span>' +
            '<span class="bp-head__meta" id="bili-video-hint"></span>' +
            '<button class="bp-close" id="bili-video-x" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div id="bili-video-list" class="bp-scroll" style="flex:1;min-height:0;padding:6px;border-bottom:1px solid var(--bp-border);"></div>' +
            '<div id="bili-video-progress" style="display:none;padding:10px 16px 0;">' +
            '<div class="bp-prog">' +
            '<div class="bp-prog__top">' +
            '<span class="bp-prog__text" id="bili-video-prog-text">准备中…</span>' +
            '<span class="bp-prog__pct" id="bili-video-prog-pct">0%</span>' +
            '</div>' +
            '<div class="bp-progress"><div class="bp-progress__bar" id="bili-video-prog-bar"></div></div>' +
            '<div class="bp-prog__sub" id="bili-video-prog-sub"></div>' +
            '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px 0;">' +
            '<label for="bili-video-quality" class="bp-hint" style="flex-shrink:0;margin:0;">清晰度</label>' +
            '<select id="bili-video-quality" class="bp-select" style="flex:1;min-width:0;">' +
            QUALITY_CHOICES.map(q => '<option value="' + q.id + '"' +
                ((Number(loadSettings().videoQuality) || 0) === q.id ? ' selected' : '') + '>' + q.label + '</option>').join('') +
            '</select>' +
            '</div>' +
            '<div id="bili-video-quality-hint" class="bp-hint" style="padding:6px 16px 0;"></div>' +
            (IS_PORTABLE ? ('<div class="bp-tipbox" style="margin:10px 16px 0;text-align:left;">便携版：默认下 B 站官方 mp4 单文件（自带音轨、无需 ffmpeg），但这种格式最高只有 720P；要 1080P 以上就在上面选具体清晰度（下载后会自动合并成一个带声音的 mp4，合并不了才分开存）</div>') : '') +
            '<div id="bili-video-dir" class="bp-hint" style="padding:8px 16px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title=""></div>' +
            '<div class="bp-foot" style="margin-top:10px;">' +
            '<label class="bp-check" title="只勾选尚未下载的视频，避免重复下载"><input type="checkbox" id="bili-video-all"> 全选未下载</label>' +
            '<button id="bili-video-clear" class="bp-btn bp-btn--sm">清空</button>' +
            '<span class="bp-foot__spacer"></span>' +
            '<button id="bili-video-dl" class="bp-btn bp-btn--primary">下载选中</button>' +
            '<button id="bili-video-close" class="bp-btn bp-btn--ghost">关闭</button>' +
            '</div>';
        document.body.appendChild(panel);

        const listEl = panel.querySelector('#bili-video-list');
        const hintEl = panel.querySelector('#bili-video-hint');
        const allEl = panel.querySelector('#bili-video-all');

        // ── 清晰度选择 ──
        const qualityEl = panel.querySelector('#bili-video-quality');
        const qualityHintEl = panel.querySelector('#bili-video-quality-hint');
        const currentQuality = () => (qualityEl ? (Number(qualityEl.value) || 0) : 0);
        // 「本视频支持、但当前账号拿不到」的档位提示（只让第一个拿到信息的视频说话）
        let blockedHint = '';
        const blockedHintText = list => {
            const names = [];
            list.forEach(b => {
                const s = (b.label || qualityLabel(b.id)) + (b.reason ? '（' + b.reason + '）' : '');
                if(names.indexOf(s) < 0) names.push(s);
            });
            return '｜本视频还支持 ' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '') + '，当前账号拿不到';
        };
        const refreshQualityHint = () => {
            if(!qualityHintEl) return;
            const q = currentQuality();
            let text;
            if(!q){
                text = IS_PORTABLE
                    ? '自动：优先下带声音的官方单文件（这种格式 B 站最高 720P）；想要更高画质请在上面选具体清晰度'
                    : '自动：取该视频可用的最高画质（装了 ffmpeg 会自动合并音画）';
            }else{
                text = IS_PORTABLE
                    ? (qualityLabel(q) + '：下载后自动合并成一个带声音的 mp4')
                    : (qualityLabel(q) + '：取不到这一档时自动降到最接近的档位');
            }
            qualityHintEl.textContent = text + blockedHint;
        };
        refreshQualityHint();
        if(qualityEl){
            qualityEl.addEventListener('change', () => {
                const s = loadSettings();
                s.videoQuality = currentQuality();
                saveSettings(s);
                refreshQualityHint();
                // 清晰度变了，之前按旧档位取好的流地址作废，重新取
                state.items.forEach(it => {
                    it.videoUrl = null; it.audioUrl = null;
                    it.videoUrls = []; it.audioUrls = [];
                    it.size = null; it.quality = null; it.error = false; it.errorMsg = null;
                });
                render();
                const label = currentQuality() ? qualityLabel(currentQuality()) : '自动';
                showToast('清晰度已切换为「' + label + '」\n正在按新清晰度重新获取地址…');
                fetchSizes();
            });
        }

        // ── 状态 ──
        //   items      : 列表项
        //   downloaded : 已下载集合，键 = videoKey(项)（BV 号；多 P 再加 #cid）
        //   checked    : 已勾选的项，存对象引用而非下标 —— 列表重绘（fillCids 会 splice 展开分P）后仍能保持勾选
        const state = { items: [], ready: false, downloaded: new Set(), checked: new Set(), force: false, loadingFav: false, favHint: '' };
        const dlBtnEl = panel.querySelector('#bili-video-dl');

        // 同步「下载选中」按钮上的数量提示
        const refreshDlBtn = () => {
            if(!dlBtnEl) return;
            const n = state.checked.size;
            dlBtnEl.textContent = n ? ('下载选中 (' + n + ')') : '下载选中';
        };

        // ── 渲染视频列表（合集项带 [合集] 标记）──
        const render = () => {
            if(!state.items.length){
                listEl.innerHTML = '<div class="bp-empty">' +
                    (state.loadingFav ? '正在读取收藏夹…' : '当前页面未检测到视频。') + '</div>';
                return;
            }
            listEl.innerHTML = state.items.map((it, i) => {
                const tag = it.fromCollection ? '<span class="bp-badge bp-badge--accent">合集</span>' : '';
                const dur = it.duration ? ('<span>' + formatDuration(it.duration) + '</span>') : '';
                const size = it.size ? ('<span>' + formatSize(it.size) + '</span>') : '';
                const q = it.quality ? ('<span>' + qualityLabel(it.quality) + '</span>') : '';
                const err = it.error ? '<span class="bp-badge bp-badge--danger">获取失败</span>'
                    : (it.errorMsg ? '<span class="bp-badge bp-badge--danger" title="' + escapeHtml(it.errorMsg) + '">下载失败</span>' : '');
                // 已下载的项给一个「重新下载」入口：不看记账、覆盖同名文件重拿一遍
                const done = state.downloaded.has(videoKey(it))
                    ? '<span class="bp-badge bp-badge--ok">✅ 已下载</span>' +
                        '<button class="bili-video-redl bp-btn bp-btn--sm" data-i="' + i + '" title="重新下载这个视频（覆盖同名文件）">🔄 重下</button>'
                    : '';
                const ck = state.checked.has(it) ? ' checked' : '';
                return '<label class="bp-item">' +
                    '<input type="checkbox" class="bili-video-check" data-i="' + i + '"' + ck + '>' +
                    '<span class="bp-item__title" title="' + escapeHtml(it.title) + '">' + escapeHtml(it.title) + '</span>' +
                    '<span class="bp-item__meta">' + tag + dur + size + q + err + done + '</span>' +
                    '</label>';
            }).join('');
        };

        // 点「🔄 重下」：只下这一项，强制模式（覆盖同名文件），复用「下载选中」的全套流程
        listEl.addEventListener('click', e => {
            const btn = e.target && e.target.closest ? e.target.closest('.bili-video-redl') : null;
            if(!btn) return;
            e.preventDefault();                        // 列表项是 <label>，不拦一下会顺手把勾选也切了
            e.stopPropagation();
            const it = state.items[Number(btn.getAttribute('data-i'))];
            if(!it) return;
            state.checked.clear();
            state.checked.add(it);
            state.force = true;                        // 告诉「下载选中」：别跳过已下载
            render();
            refreshDlBtn();
            const dlBtn2 = panel.querySelector('#bili-video-dl');
            if(dlBtn2) dlBtn2.click();
        });

        // ── 补齐 cid（仅当前视频/收藏夹项；合集项 cid 已知，跳过）──
        const fillCids = async () => {
            // 收藏夹可能上千个视频：绝不在这里逐个请求 view 接口（会慢到没法用，还容易触发风控）。
            // 它们的 cid 在勾选下载时由 prepWorker 按需获取。
            const need = state.items.filter(it => it.cid == null && !it.fromCollection && !it.fromFav);
            if(!need.length) return;
            hintEl.textContent = '获取视频信息中...';
            let done = 0;
            async function worker(){
                while(done < need.length){
                    const i = done++;
                    const it = need[i];
                    const v = await fetchViewCid(it.bvid);
                    if(v){
                        if(v.pages && v.pages.length > 1){
                            const expanded = v.pages.map(p => ({
                                bvid: it.bvid,
                                cid: p.cid,
                                multiPart: true,
                                title: 'P' + p.page + ' ' + (p.part || ''),
                                duration: p.duration || null
                            }));
                            state.items.splice(state.items.indexOf(it), 1, ...expanded);
                        } else {
                            it.cid = v.cid;
                            if(!it.duration) it.duration = v.duration;
                            if(!it.title || it.title.indexOf('视频 ') === 0) it.title = v.title || it.title;
                            it.title = v.title || it.title;
                        }
                    } else {
                        it.error = true;
                    }
                    const span = hintEl; if(span) span.textContent = '获取视频信息 ' + Math.min(done, need.length) + '/' + need.length + ' ...';
                    render();
                }
            }
            await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, need.length) }, () => worker()));
            hintEl.textContent = '共 ' + state.items.length + ' 个';
        };

        // 取到的流信息落到列表项上；顺带记下「本视频支持、但当前账号拿不到」的档位用于提示
        const applyStream = (it, s) => {
            it.videoUrl = s.videoUrl; it.audioUrl = s.audioUrl;
            it.videoUrls = s.videoUrls || (s.videoUrl ? [s.videoUrl] : []);
            it.audioUrls = s.audioUrls || (s.audioUrl ? [s.audioUrl] : []);
            it.size = s.size;
            it.quality = s.quality; it.ext = s.ext;
            if(s.blocked && s.blocked.length && !blockedHint){
                blockedHint = blockedHintText(s.blocked);
                refreshQualityHint();
            }
        };

        // ── 获取大小与画质（跳过合集项，改为下载时按需获取）──
        const fetchSizes = async () => {
            hintEl.textContent = '正在获取大小与画质...';
            let done = 0;
            const total = state.items.length;
            async function worker(){
                while(done < total){
                    const i = done++;
                    const it = state.items[i];
                    if(it.cid == null || it.error || it.fromCollection || it.fromFav){ continue; }
                    const s = await fetchVideoStreams(it.bvid, it.cid, currentQuality());
                    if(s && s.videoUrl) applyStream(it, s);
                    else { it.error = true; }
                    const span = hintEl; if(span) span.textContent = '正在获取大小与画质 ' + Math.min(done, total) + '/' + total + ' ...';
                    render();
                }
            }
            await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, total) }, () => worker()));
            // 收藏夹项不预取大小（上千个逐个请求既慢又容易被风控），这里不能说「已自动获取」
            const favCount = state.items.filter(it => it.fromFav).length;
            hintEl.textContent = state.favHint || ('共 ' + state.items.length + ' 个' +
                (favCount ? '（收藏夹项在下载时获取大小）' : '（已自动获取大小与画质）'));
        };

        // ── 下载选中：先补齐缺失的流地址，再交给本地服务下载 ──
        panel.querySelector('#bili-video-dl').addEventListener('click', async () => {
            // 以 state.checked 为准：勾选状态由事件委托维护，不受列表重绘影响
            const picked = Array.from(state.checked).filter(it => state.items.indexOf(it) >= 0);
            // 先取走 force 再判断 picked：否则「🔄 重下」后列表恰好没勾上任何项时，
            // force=true 会残留到下一次普通下载，把已下载的视频统统覆盖重下一遍
            const force = !!state.force;
            state.force = false;
            if(!picked.length){ showToast('请先勾选视频'); return; }
            // 已下载的默认跳过（省掉多余请求）；点列表里的「🔄 重下」则强制重下、覆盖同名文件
            const { targets, skipped: skippedDone } = planVideoTargets(picked, force, it => state.downloaded.has(videoKey(it)));
            if(!targets.length){ showToast('所选视频都已经下载过了\n想重下就点列表里那个「🔄 重下」喵'); return; }
            const dlBtn = dlBtnEl || panel.querySelector('#bili-video-dl');
            const progEl = panel.querySelector('#bili-video-progress');
            const progText = panel.querySelector('#bili-video-prog-text');
            const progSub = panel.querySelector('#bili-video-prog-sub');
            dlBtn.disabled = true;
            dlBtn.textContent = '准备中…';
            const need = targets.filter(it => !it.videoUrl);
            if(need.length){
                if(progEl) progEl.style.display = 'block';
                if(progText) progText.textContent = '正在获取下载地址 ' + need.length + ' 个…';
                let done = 0;
                async function prepWorker(){
                    while(done < need.length){
                        const i = done++;
                        const it = need[i];
                        try{
                            if(it.cid == null){
                                const v = await fetchViewCid(it.bvid);
                                if(v){
                                    it.cid = v.cid;
                                    if(!it.duration) it.duration = v.duration;
                                    if(!it.title || it.title.indexOf('视频 ') === 0) it.title = v.title || it.title;
                                } else { it.error = true; }
                            }
                            if(it.cid != null && !it.error){
                                const s = await fetchVideoStreams(it.bvid, it.cid, currentQuality());
                                if(s && s.videoUrl) applyStream(it, s);
                                else { it.error = true; }
                            }
                        }catch(e){ it.error = true; }
                        if(progSub) progSub.textContent = '第 ' + Math.min(done, need.length) + '/' + need.length + ' 个 · ' + (it.title || it.bvid);
                    }
                }
                await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, need.length) }, () => prepWorker()));
            }
            const chosen = targets.filter(it => it.videoUrl && !it.error);
            if(!chosen.length){
                showToast('未能获取所选视频的下载地址，请重试（可能是网络或接口限流）');
                dlBtn.disabled = false;
                refreshDlBtn();
                return;
            }
            if(progEl) progEl.style.display = 'block';
            dlBtn.textContent = '下载中…';
            const videos = chosen.map(it => ({
                title: it.title, videoUrl: it.videoUrl, audioUrl: it.audioUrl,
                videoUrls: it.videoUrls || [], audioUrls: it.audioUrls || [], ext: it.ext,
                bvid: it.bvid, cid: it.cid, multiPart: !!it.multiPart
            }));
            const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            const progBar = panel.querySelector('#bili-video-prog-bar');
            const progPct = panel.querySelector('#bili-video-prog-pct');
            try{
                // 便携版：不经过本地服务，直接由浏览器下载
                if(IS_PORTABLE){
                    const res = await saveVideosInBrowser(chosen, { progText: progText, progSub: progSub, progBar: progBar, progPct: progPct }, { force: force });
                    // 只有真正下载成功的才记账：失败的留着，下次还能重试
                    const okIdx = new Set(((res && res.results) || []).filter(r => r && r.saved && !r.error).map(r => r.idx));
                    const okItems = chosen.filter((it, i) => okIdx.has(i));
                    try{
                        const marks = okItems.map(it => {
                            const t = BS.sanitizeFilename(String(it.title || '').trim()) || ('video_' + it.bvid);
                            const base = (t.length > 60 ? t.slice(0, 60) : t) + '_' + it.bvid
                                + (it.multiPart && it.cid != null ? '_c' + it.cid : '');
                            return 'video:' + base + '.mp4';      // 记录标记（文件名里带 BV 号、多 P 还带 cid，面板据此标「已下载」）
                        });
                        if(marks.length) await BS.idbAddNames(marks);
                    }catch(e){}
                    okItems.forEach(it => { state.downloaded.add(videoKey(it)); });
                    state.checked.clear();
                    if(allEl) allEl.checked = false;
                    render();
                    if(res && res.saved > 0) showDonatePanel({ saved: res.saved, exists: 0, failed: res.failed || 0 });
                    return;                                       // finally 里会恢复按钮状态
                }
                const startJson = await postJsonToPath('/video/save', { videos, jobId, force });
                if(!(startJson && startJson.ok)) throw new Error((startJson && startJson.error) || '启动下载失败');
                const activeJobId = startJson.jobId || jobId;
                let summary = null;
                let lastBytes = 0, lastTime = 0, speedBps = 0;
                let pollFails = 0;
                for(;;){
                    const p = await serverApi('/video/progress?job=' + encodeURIComponent(activeJobId));
                    // 服务端重启 / job 被淘汰 / 请求超时都会返回空：连续失败就退出，
                    // 否则面板会永远卡在「下载中」并一直空转轮询
                    if(!p || !p.ok){
                        if(++pollFails >= 15) throw new Error('进度查询连续失败，本地服务可能已关闭');
                        await sleep(800);
                        continue;
                    }
                    pollFails = 0;
                    if(p.ok){
                        const total = p.total || 1;
                        const doneN = p.done || 0;
                        // 把「当前这个文件已经下了多少」也算进总进度，否则进度条只会在下完一个文件时跳一格，
                        // 大文件下载期间看着像卡住不动
                        const curFrac = (p.phase === 'merging') ? 0.99
                            : (p.bytesTotal > 0 ? Math.min(0.99, (p.bytes || 0) / p.bytesTotal) : 0);
                        const overall = Math.min(99, Math.round((doneN + curFrac) / total * 100));
                        if(progBar) progBar.style.width = overall + '%';
                        if(progPct) progPct.textContent = overall + '%';
                        if(p.finished){ summary = p.summary; break; }
                        const cur = (p.currentIndex != null ? p.currentIndex + 1 : doneN + 1) + '/' + total;
                        const title = p.currentTitle || '';
                        if(p.phase === 'downloading-video' || p.phase === 'downloading-audio'){
                            const label = p.phase === 'downloading-video' ? '⬇️ 下载视频流' : '🎵 下载音频流';
                            const filePct = p.bytesTotal ? Math.round(p.bytes / p.bytesTotal * 100) + '%' : '';
                            const size = p.bytesTotal
                                ? (formatSize(p.bytes) + ' / ' + formatSize(p.bytesTotal) + (filePct ? ' (' + filePct + ')' : ''))
                                : formatSize(p.bytes);
                            if(p.bytes < lastBytes){ lastBytes = 0; lastTime = 0; speedBps = 0; }
                            const nowT = Date.now();
                            if(lastTime && nowT - lastTime >= 400){
                                const inst = (p.bytes - lastBytes) / ((nowT - lastTime) / 1000);
                                if(inst > 0) speedBps = speedBps ? (speedBps * 0.6 + inst * 0.4) : inst;
                            }
                            lastBytes = p.bytes;
                            lastTime = nowT;
                            let extra = '';
                            if(speedBps > 0){
                                extra = ' · ' + formatSpeed(speedBps);
                                if(p.bytesTotal > p.bytes) extra += ' · 约 ' + formatRemaining((p.bytesTotal - p.bytes) / speedBps);
                            }
                            if(progText) progText.textContent = '第 ' + cur + ' 个 · ' + label;
                            if(progSub) progSub.textContent = title + '  ' + size + extra;
                        } else if(p.phase === 'merging'){
                            if(progText) progText.textContent = '第 ' + cur + ' 个 · ⚙️ ffmpeg 合并音画';
                            if(progSub) progSub.textContent = title + '  正在合并，请稍候…';
                        } else {
                            if(progText) progText.textContent = '第 ' + cur + ' 个 · 处理中…';
                            if(progSub) progSub.textContent = title + '  ' + (p.message || '');
                        }
                    }
                    await sleep(800);
                }
                if(progBar) progBar.style.width = '100%';
                if(progPct) progPct.textContent = '100%';
                const json = summary;
                if(json && json.ok && json.results){
                    const saved = json.results.filter(r => r.saved && !r.error && !r.exists).length;
                    const exists = json.results.filter(r => r.exists).length;
                    const failResults = json.results.filter(r => r.error);
                    const failed = failResults.length;
                    const separate = json.results.filter(r => r.separate).length;
                    const merged = json.results.filter(r => r.merged).length;
                    if(progText) progText.textContent = '✅ 下载完成';
                    if(progSub) progSub.textContent = '新增 ' + saved + ' 个'
                        + (exists ? '，已有 ' + exists + ' 个' : '')
                        + (failed ? '，失败 ' + failed + ' 个' : '');
                    // 从服务端返回的实际文件路径中取出保存目录，避免用户不知道文件存到了哪里
                    const firstSaved = json.results.find(r => r.saved && !r.error);
                    const savedDir = firstSaved ? String(firstSaved.saved).replace(/[\\/][^\\/]+$/, '') : '';
                    // 失败时点名具体是哪些，方便用户判断要不要重试
                    const failNames = failResults.slice(0, 3).map(r => String(r.title || '').slice(0, 16)).join('；');
                    showToast('视频下载完成：新增 ' + saved + ' 个'
                        + (merged ? '（含合并 mp4 ' + merged + ' 个）' : '')
                        + (separate ? '，音画分开保存 ' + separate + ' 个' : '')
                        + (exists ? '，已有 ' + exists + ' 个' : '')
                        + (failed ? '，失败 ' + failed + ' 个：' + failNames + (failResults.length > 3 ? ' 等' : '') : '')
                        + (skippedDone ? '\n（已跳过 ' + skippedDone + ' 个已下载）' : '')
                        + (savedDir ? '\n保存位置：' + savedDir : ''));
                    // 把本次落盘成功的项记为「已下载」并刷新列表，避免下次重复下载
                    // 服务端是并发下载、按完成顺序返回的，位置对不上：优先按 bvid(+cid) 认领，
                    // 只有当结果没带标识（旧版服务端）时才退回按位置匹配
                    const byKey = new Map();
                    chosen.forEach(it => byKey.set(videoKey(it), it));
                    json.results.forEach((r, i) => {
                        const it = (r && r.bvid) ? byKey.get(videoKey(r)) : chosen[i];
                        if(!r.error && (r.saved || r.exists) && it) state.downloaded.add(videoKey(it));
                    });
                    state.checked.clear();
                    if(allEl) allEl.checked = false;
                    render();
                    if(saved > 0) showDonatePanel({ saved: saved, exists: exists, failed: failed });
                } else {
                    if(progText) progText.textContent = '❌ 下载失败';
                    if(progSub) progSub.textContent = (json && json.error) || '下载未成功完成';
                }
            }catch(err){
                if(progText) progText.textContent = '❌ 下载失败';
                if(progSub) progSub.textContent = (err && err.message) || '未知错误';
                showToast('❌ 视频下载失败：\n' + (err && err.message)
                    + (IS_PORTABLE ? '' : '\n请先双击「一键启动.bat」启动本地服务'));
            } finally {
                dlBtn.disabled = false;
                refreshDlBtn();
            }
        });

        // ── 其它交互：关闭 / 全选 ──
        panel.querySelector('#bili-video-close').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-video-x').addEventListener('click', () => panel.remove());

        // ── 勾选状态：事件委托维护（列表重建后依然有效，不会因重绘丢失勾选）──
        listEl.addEventListener('change', (e) => {
            const cb = e.target && e.target.closest ? e.target.closest('.bili-video-check') : null;
            if(!cb) return;
            const it = state.items[Number(cb.getAttribute('data-i'))];
            if(!it) return;
            if(cb.checked) state.checked.add(it); else state.checked.delete(it);
            refreshDlBtn();
        });

        // ── 全选：只勾选「尚未下载」的项，避免重复下载浪费流量 ──
        allEl.addEventListener('change', () => {
            state.checked.clear();
            if(allEl.checked){
                state.items.forEach(it => {
                    if(!state.downloaded.has(videoKey(it))) state.checked.add(it);
                });
            }
            render();
            refreshDlBtn();
        });

        // ── 清空选择 ──
        const clearEl = panel.querySelector('#bili-video-clear');
        if(clearEl){
            clearEl.addEventListener('click', () => {
                state.checked.clear();
                if(allEl) allEl.checked = false;
                render();
                refreshDlBtn();
            });
        }

        // ── 初始化：先渲染当前视频，再异步拉取合集视频 ──
        // 显示实际保存位置：避免用户下载完不知道文件存到哪（便携版会把目录放在自己的文件夹内）
        getSaveDir().then(info => {
            const dirEl = panel.querySelector('#bili-video-dir');
            if(!dirEl) return;
            if(!(info && info.dir)){
                dirEl.textContent = '保存位置：未连接本地服务（请双击「一键启动.bat」）';
                return;
            }
            if(IS_PORTABLE){
                // 便携版不建 videos 子目录：要么写进授权目录，要么由浏览器下载
                const where = (loadSettings().portableSave === 'dir' && FSA_SUPPORTED)
                    ? ('保存位置：' + info.dir)
                    : '保存位置：浏览器「下载」文件夹';
                dirEl.textContent = where;
                dirEl.title = where;
                return;
            }
            const sep = info.dir.indexOf('\\') >= 0 ? '\\' : '/';
            const full = info.dir + sep + 'videos';
            dirEl.textContent = '保存位置：' + full;
            dirEl.title = full;
        });

        const items = collectVideoItems();
        state.items = items;
        render();
        // 收藏夹页即使 DOM 里一条都抓不到也必须继续往下走 —— 内容要走接口分页拉。
        // （收藏夹是虚拟滚动，DOM 里经常是 0 条；这里一旦提前 return，接口就永远不会被调用，
        //   面板只会显示「当前页面未检测到视频」，正是收藏夹下载「一直有问题」的直接原因。）
        const earlyPageInfo = detectPageType();
        const isFavPage = !!(earlyPageInfo && earlyPageInfo.type === 'favlist');
        if(!items.length && !isFavPage){ hintEl.textContent = ''; return; }
        if(!items.length && isFavPage) hintEl.textContent = '正在读取收藏夹…';

        // 读取本地已下载列表并在列表上标记「✅ 已下载」：全选与下载都会自动跳过，避免重复下载
        // 注意：这里不做 state.items 过滤 —— 合集项是稍后才异步合并进来的，
        // 先把 bvid 全部记入 state.downloaded，render 时再动态判断，避免漏标。
        (async () => {
            const list = await serverApi('/video/list');
            if(!list || !Array.isArray(list.videos) || !list.videos.length) return;
            let hit = 0;
            for(const v of list.videos){
                // 文件名可能是 xxx_BV号.mp4 / xxx_BV号_c<cid>.mp4 / xxx_BV号.video.mp4
                const m = /_(BV[0-9A-Za-z]{10})(?:_c(\d+))?(?:\.[0-9A-Za-z]+)+$/.exec(String(v.name || ''));
                if(m){
                    const key = m[2] ? (m[1] + '#' + m[2]) : m[1];       // 多 P 分 P 靠 cid 区分，不能只认 BV 号
                    if(!state.downloaded.has(key)){
                        state.downloaded.add(key);
                        hit++;
                    }
                }
            }
            if(hit){ render(); refreshDlBtn(); }
        })();

        (async () => {
            // ── 收藏夹：必须用官方接口分页拉全 ──
            // 收藏夹页是客户端渲染 + 虚拟滚动，DOM 里永远只有当前可见的十几条，
            // 所以「面板只列出几个」「想勾的视频根本不在列表里」的根因就在这里。
            const pageInfo = detectPageType();
            if(pageInfo && pageInfo.type === 'favlist'){
                const fid = getFavFolderId();
                if(fid){
                    hintEl.textContent = '正在读取收藏夹…';
                    state.loadingFav = true;
                    render();
                    let fav = null;
                    // 渐进式：每拉完一页就把已拿到的追加到列表，用户不用干等几十页
                    const favSeen = new Set();
                    const appendPage = (pageItems) => {
                        let added = 0;
                        for(const it of pageItems){
                            if(favSeen.has(it.bvid)) continue;
                            favSeen.add(it.bvid);
                            state.items.push(it);
                            added++;
                        }
                        if(added){ render(); refreshDlBtn(); }
                    };
                    try{
                        fav = await collectFavFolderItems(fid, (pageItems, info) => {
                            appendPage(pageItems);
                            hintEl.textContent = '正在读取收藏夹 ' + info.page + '/' + info.pageCount +
                                ' 页（已 ' + state.items.length + ' 个）…';
                        });
                    }catch(e){ console.warn('[BiliSave] 读取收藏夹失败', e); }
                    state.loadingFav = false;
                    render();

                    if(fav && fav.rateLimited){
                        state.favHint = '⚠️ B 站限流了，已加载 ' + state.items.length + ' 个' +
                            (fav.total ? '（共 ' + fav.total + ' 个）' : '') + '；稍等几分钟重开面板可继续';
                        hintEl.textContent = state.favHint;
                        showToast('⚠️ 收藏夹读取被 B 站限流\n已加载 ' + state.items.length + ' 个' +
                            (fav.total ? '（共 ' + fav.total + ' 个）' : '') +
                            '\n稍等几分钟重开「视频下载」面板会接着读');
                    }else if(fav && state.items.length){
                        const extra = [];
                        if(fav.skipped) extra.push('跳过失效/非视频 ' + fav.skipped + ' 个');
                        if(fav.truncated) extra.push('收藏夹共 ' + fav.total + ' 个，已达单次上限');
                        state.favHint = '共 ' + state.items.length + ' 个' +
                            (extra.length ? '（' + extra.join('；') + '）' : '');
                        hintEl.textContent = state.favHint;
                    }else if(!fav){
                        const domCount = state.items.length;
                        state.favHint = domCount
                            ? '共 ' + domCount + ' 个（接口读取失败，只列出页面可见部分）'
                            : '读取收藏夹失败，请刷新页面重试';
                        hintEl.textContent = state.favHint;
                        if(!domCount) console.warn('[BiliSave] 收藏夹接口没返回数据');
                    }
                }else{
                    state.favHint = '未能从地址栏识别收藏夹 ID（fid），只列出页面可见部分';
                    hintEl.textContent = state.favHint;
                }
            }

            let col = null;
            try{ col = await collectCollectionItems(); }catch(e){}
            if(col && col.items.length){
                const seenBvids = new Set(state.items.map(i => i.bvid));
                const added = col.items.filter(i => !seenBvids.has(i.bvid));
                if(added.length){
                    state.items = state.items.concat(added);
                    render();
                }
            }
            await fillCids();
            await fetchSizes();
            const videoCount = state.items.filter(i => !i.fromCollection).length;
            const colCount = state.items.length - videoCount;
            if(colCount > 0){
                const colName = '合集《' + (col ? col.title : '') + '》' + colCount + ' 个';
                const tip = (col && col.truncated)
                    ? '（合集共 ' + col.total + ' 个，已达上限只取前 ' + colCount + ' 个）'
                    : '（合集项下载时获取大小）';
                hintEl.textContent = '视频 ' + videoCount + ' 个 · ' + colName + tip;
            } else if(!(pageInfo && pageInfo.type === 'favlist')){
                hintEl.textContent = '共 ' + state.items.length + ' 个';
            }
        })();
    }

    // ========================================================================
    // 十四、悬浮按钮与启动
    // ========================================================================
    // 主题循环切换：跟随系统 → 云白 → 夜空 → 樱花 → …（纯 CSS 变量，即时生效，不用刷新页面）
    const THEME_CYCLE = ['auto', 'cloud', 'midnight', 'sakura'];
    const THEME_ICON = { auto: '🌗', cloud: '☀️', midnight: '🌙', sakura: '🌸' };
    const THEME_SHORT = { auto: '跟随系统', cloud: '云白', midnight: '夜空', sakura: '樱花' };
    const themeButtonText = t => (THEME_ICON[t] || '🎨') + ' ' + (THEME_SHORT[t] || t);
    // 当前主题的唯一真相源：悬浮菜单和设置面板都从这里读，改一处即可
    const themeState = { current: 'auto' };
    function setTheme(t){
        const n = applyTheme(t);
        themeState.current = n;
        saveTheme(n);
        return n;
    }

    // 创建右下角悬浮按钮组
    function makeButton(){
        injectUiCss();
        const wrap = document.createElement('div');
        wrap.className = 'bp-fab-wrap';

        const menu = document.createElement('div');
        menu.className = 'bp-fab__menu';
        menu.hidden = true;
        wrap.appendChild(menu);

        // 说明：mkSub() 的副作用就是创建按钮并挂进菜单；
        // 只有需要动态改文案/禁用状态的按钮（如 saveBtn、themeBtn）才需要接收返回值。
        const mkSub = (text, tone, onClick) => {
            const b = document.createElement('button');
            b.className = 'bp-fab__item';
            if(tone) b.setAttribute('data-tone', tone);
            b.textContent = text;
            b.addEventListener('click', onClick);
            menu.appendChild(b);
            return b;
        };

        let curTheme = themeState.current;
        const themeBtn = mkSub(themeButtonText(curTheme), 'amber', () => {
            const i = THEME_CYCLE.indexOf(curTheme);
            curTheme = setTheme(THEME_CYCLE[(i + 1) % THEME_CYCLE.length]);
            themeBtn.textContent = themeButtonText(curTheme);
            themeBtn.title = '点击切换到下一个主题（当前：' + (THEME_SHORT[curTheme] || curTheme) + '）';
            showToast('🎨 主题已切换为「' + (THEME_SHORT[curTheme] || curTheme) + '」');
        });
        themeBtn.title = '点击切换到下一个主题（当前：' + (THEME_SHORT[curTheme] || curTheme) + '）';
        mkSub('⚙️ 设置', 'accent', openSettingsPanel);
        mkSub('📹 视频下载', 'pink', openVideoPanel);
        const saveBtn = mkSub('⬇️ 提取并保存', 'accent', () => {
            saveBtn.disabled = true;
            saveBtn.textContent = '正在提取...';
            collectAndSave().finally(() => {
                saveBtn.disabled = false;
                saveBtn.textContent = '⬇️ 提取并保存';
            });
        });

        const rootBtn = document.createElement('button');
        rootBtn.className = 'bp-fab';
        rootBtn.innerHTML = '<span class="bp-fab__dot"></span>Bilibili-Plus';
        const setOpen = (open) => {
            menu.hidden = !open;
            // 让状态浮窗跟着上移，否则弹出的菜单会把提示压住（两者都在右下角）
            document.documentElement.classList.toggle('bp-fab-open', open);
            rootBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        setOpen(false);
        rootBtn.addEventListener('click', () => {
            const open = menu.hidden;
            // 菜单要展开了才刷新主题按钮文案（设置面板里可能刚换过主题）
            if(open){
                curTheme = themeState.current;
                themeBtn.textContent = themeButtonText(curTheme);
                themeBtn.title = '点击切换到下一个主题（当前：' + (THEME_SHORT[curTheme] || curTheme) + '）';
            }
            setOpen(open);
        });
        // 点完任一项就收起菜单：否则弹出的面板会正好盖住菜单，看着像卡住了
        menu.addEventListener('click', () => setOpen(false));
        wrap.appendChild(rootBtn);
        document.body.appendChild(wrap);
    }


    let autoStarted = false;
    // 按设置与页面类型决定是否自动提取
    function maybeAutoRun(){
        if(autoStarted) return;
        autoStarted = true;
        try{
            if(new URL(location.href).searchParams.get(AUTO_SAVE_PARAM) === '0') return;
        }catch(e){}
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        if(!settings.autoRun){
            console.log('[BiliSave] 自动提取已关闭（可在设置中开启），请点击右下角「⬇️ 提取并保存」手动下载');
            return;
        }
        if(!AUTO_RUN) return;

        const info = detectPageType();
        if(!info || !info.imagePage){
            if(info && info.type === 'space-other'){
                console.log('[BiliSave] 当前为' + info.label + '，非图片页面，跳过自动保存（可按右下角按钮手动提取）');
            }
            return;
        }
        const ownership = info.uid ? detectOwnership() : null;
        const label = describeSpace(info, ownership);
        const ownerNote = (info.type === 'dynamic-list' || info.type === 'favlist')
            ? (ownership === 'other' ? '（他人空间，仅公开内容）' : (ownership === 'own' ? '（你的空间）' : ''))
            : '';
        setTimeout(() => {
            showToast(`🔄 正在自动提取${label}原图...${ownerNote}`);
            collectAndSave();
        }, 1500);
    }

    // 启动自检：内嵌收款码完整性与本地服务连通性
    function verifySetup(){
        const REPO = 'https://github.com/FNAS-496/bilibili-image-saver';
        const qrOk = typeof DONATE_QR === 'string' && DONATE_QR.indexOf('data:image/') === 0 && DONATE_QR.length > 100;
        console.log('[check] 收款码(内嵌): ' + (qrOk ? 'ready' : 'missing'));
        if(!qrOk){
            console.warn('[BiliSave] 收款码数据缺失，打赏面板将显示不出收款码。完整版请从 ' + REPO + ' 下载。');
        }
        // 下载通道自检：<a download> 在 SPA 页面上很容易被搞成「导航」（表现为「链接已关闭」），
        // 所以优先 GM_download，这里把实际可用的通道打出来，方便排查
        console.log('[check] 保存文件通道: ' + (gmDownloadAvailable()
            ? 'GM_download（优先）+ <a> 兜底'
            : '仅 <a>（当前管理器没有 GM_download，建议用 Tampermonkey / Violentmonkey）'));
        // 便携版不需要本地服务，自检到此为止
        if(IS_PORTABLE){
            console.info('[BiliSave] 便携版（无需 Node / ffmpeg）：图片与视频由浏览器直接保存。'
                + '需要 4K/HDR 或音画合并时请改用环境版：' + REPO_URL);
            return;
        }
        getSaveDir().then(dirInfo => {
            if(dirInfo && dirInfo.dir){
                return;
            }
            console.warn('[BiliSave] 本地保存服务未运行。请双击「一键启动.bat」启动，或从 ' + REPO + ' 下载完整版。');
        });
    }

    // ========================================================================
    // 十五、初始化入口
    // ========================================================================
    // 初始化入口
    function init(){
        themeState.current = setTheme(THEME);      // 顺手把旧版的 light / dark 迁移成新主题名
        applyTheme(themeState.current);
        makeButton();
        setupDynamicListWatcher();
        maybeAutoRun();
        maybeAskDirOnce();
        verifySetup();
        maybeShowIntroOnce();
    }

    // 自检钩子：仅当页面显式设置 window.__BILI_PLUS_TEST__ 时暴露内部函数（供冒烟测试用，正常使用不生效）
    if(typeof window !== 'undefined' && window.__BILI_PLUS_TEST__){
        window.__biliPlusTest = {
            isPortable: IS_PORTABLE,
            saveUrlsInBrowser: saveUrlsInBrowser,
            saveVideosInBrowser: saveVideosInBrowser,
            notifyEnvRequired: notifyEnvRequired,
            openFeatureIntroPanel: openFeatureIntroPanel,
            fetchVideoStreams: fetchVideoStreams,
            loadSettings: loadSettings,
            saveSettings: saveSettings,
            // 面板入口：只用于本地渲染调试（需要页面显式设置 window.__BILI_PLUS_TEST__）
            openSettingsPanel: openSettingsPanel,
            openVideoPanel: openVideoPanel,
            openReviewPanel: openReviewPanel,
            showDonatePanel: showDonatePanel,
            // 纯函数（无 DOM 依赖），给单测用
            planVideoTargets: planVideoTargets,
            videoKey: videoKey,
            toOriginalImageUrl: toOriginalImageUrl,
            normalizeUrl: normalizeUrl,
            isContentImageUrl: isContentImageUrl,
            extractUrlsFromText: extractUrlsFromText,
            parseDashStream: parseDashStream,
            parseDurlStream: parseDurlStream,
            pickStream: pickStream,
            // 收藏夹：接口分页拉全（DOM 在虚拟列表下抓不到）
            getFavFolderId: getFavFolderId,
            collectFavFolderItems: collectFavFolderItems,
            collectVideoItems: collectVideoItems,
            detectPageType: detectPageType,
            // 下载通道：诊断「链接已关闭」时用
            triggerBlobDownload: triggerBlobDownload,
            getDownloadChannel: () => blobDownloadChannel,
            gmDownloadAvailable: gmDownloadAvailable,
            planZipBatches: BS.planZipBatches,
            idbListNames: BS.idbListNames,
            idbClearNames: BS.idbClearNames
        };
    }

    if(document.readyState === 'complete' || document.readyState === 'interactive'){
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
