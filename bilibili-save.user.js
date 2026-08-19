// ==UserScript==
// @name         Bilibili-Plus 哔哩哔哩增强（原图/视频批量下载）
// @name:en      Bilibili-Plus - Enhanced Bilibili Downloader
// @namespace    https://github.com/FNAS-496/bilibili-image-saver
// @version      0.9.19
// @updateURL    https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @downloadURL  https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @author       FNAS-496 <sijiudeliu@outlook.com>
// @description  Bilibili-Plus：B 站原图/视频批量下载增强。审查模式显示全部图片并标记已下载、点赞/关注/收藏状态检测、只看大图、自定义键位、日夜主题（默认不自动下载，需点击按钮；需配合“一键启动.bat”启动本地服务）
// @description:en Bilibili-Plus: auto-download original images from Bilibili favorites, dynamics, opus and space pages; video batch download, review mode, custom keys (needs the local server started via "一键启动.bat")
// @homepageURL  https://github.com/FNAS-496/bilibili-image-saver
// @supportURL   https://github.com/FNAS-496/bilibili-image-saver/issues
// @match        *://*.bilibili.com/*
// @match        *://bilibili.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      hdslb.com
// @connect      bilibili.com
// @connect      127.0.0.1
// @noframes
// @license      CC BY-NC-SA 4.0
// ==/UserScript==


(function(){
    'use strict';

    const LOCAL_SERVER = 'http://127.0.0.1:8765/save';
    const AUTO_SAVE_PARAM = 'bili_auto_save';

                      
    const AUTO_RUN = true;                                                             
    const MAX_CHILD_PAGES = 200;                                   
    const CHILD_CONCURRENCY = 6;                        
    const TOAST_MS = 4000;
    const DIR_ASKED_KEY = 'bili_save_dir_asked_v1';
    const SETTINGS_KEY = 'bili_save_settings_v1';
    const THEME_KEY = 'bili_save_theme_v1';

    const DEFAULT_SETTINGS = {
        saveDir: '',
        intervalMs: 0,
        timeoutMs: 30000,
        maxDownload: 0,
        dedupe: true,
        downloadMode: 'auto',
        autoRun: false,
        keys: { next: 'ArrowRight', prev: 'ArrowLeft', download: 'ArrowDown', exit: 'Escape' }
    };

    function loadSettings(){
        let s = Object.assign({}, DEFAULT_SETTINGS);
        try{
            const raw = localStorage.getItem(SETTINGS_KEY);
            if(raw) s = Object.assign(s, JSON.parse(raw));
        }catch(e){}
        return s;
    }
    function saveSettings(s){
        try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch(e){}
    }
    function loadTheme(){
        try{ return localStorage.getItem(THEME_KEY) || 'light'; }catch(e){ return 'light'; }
    }
    function saveTheme(t){
        try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
    }
    const THEME = loadTheme();

    function sleep(ms){
        return new Promise(r => setTimeout(r, ms));
    }

    function applyTheme(theme){
        const dark = theme === 'dark';
        const root = document.documentElement;
        root.style.setProperty('--bili-save-bg', dark ? '#1f1f1f' : '#ffffff');
        root.style.setProperty('--bili-save-fg', dark ? '#e6e6e6' : '#222222');
        root.style.setProperty('--bili-save-muted', dark ? '#999999' : '#888888');
        root.style.setProperty('--bili-save-border', dark ? '#3a3a3a' : '#e0e0e0');
        root.style.setProperty('--bili-save-input-bg', dark ? '#2a2a2a' : '#ffffff');
    }

    function normalizeUrl(raw, base){
        if(!raw) return null;
        raw = raw.trim();
        if(raw.startsWith('//')) raw = 'https:' + raw;
        try{
            const url = new URL(raw, base || window.location.href);
            if(url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url.href;
        }catch(e){
            return null;
        }
    }

                                
                                                            
                        
                                                             
                                                
    function toOriginalImageUrl(raw){
        if(!raw) return null;
        let u = String(raw).trim()
            .replace(/\\u002F/g, '/')
            .replace(/\\\//g, '/');
        if(u.startsWith('//')) u = 'https:' + u;
        try{
            const url = new URL(u, window.location.href);
            if(url.protocol !== 'http:' && url.protocol !== 'https:') return null;
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

                                    
                                                             
    function isContentImageUrl(url){
        if(!url) return false;
        if(!/\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i.test(url)) return false;
        try{
            if(!/(^|\.)hdslb\.com$/i.test(new URL(url).hostname)) return false;
        }catch(e){ return false; }
        return /\/bfs\/(album|new_dyn|article|sns|opus)\//i.test(url);
    }

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

    function extractUrlsFromText(text, baseUrl = window.location.href){
        const urls = new Set();
        const regex = /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|gif|webp|bmp|avif)(?:[@?#][^\s"'<>]*)?/gi;
        let match;
        while((match = regex.exec(text))){
            const original = toOriginalImageUrl(match[0]);
            if(original && isContentImageUrl(original)) urls.add(original);
        }
        return Array.from(urls);
    }

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

    async function fetchText(url){
        if(typeof GM_xmlhttpRequest === 'function'){
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    responseType: 'text',
                    withCredentials: true,
                    timeout: 20000,
                    headers: {
                        'User-Agent': navigator.userAgent,
                        'Referer': 'https://www.bilibili.com/',
                        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
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
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try{
            const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
            if(!resp.ok) throw new Error('Fetch failed ' + resp.status + ' for ' + url);
            return await resp.text();
        } finally {
            clearTimeout(timer);
        }
    }

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
    function ensureStatusEl(){
        if(statusEl && statusEl.isConnected) return statusEl;
        statusEl = document.createElement('div');
        statusEl.id = 'bili-save-status';
        Object.assign(statusEl.style, {
            position: 'fixed', right: '20px', bottom: '70px', zIndex: 999999,
            background: 'rgba(0,0,0,0.78)', color: '#fff', padding: '10px 14px',
            borderRadius: '8px', fontSize: '13px', lineHeight: '1.6',
            maxWidth: '360px', minWidth: '190px', display: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', whiteSpace: 'pre-line'
        });
        document.body.appendChild(statusEl);
        return statusEl;
    }
    function setStatus(text, autoHide){
        const el = ensureStatusEl();
        el.textContent = text;
        el.style.display = 'block';
        if(autoHide){
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.display = 'none'; }, TOAST_MS);
        }
    }
    function showToast(text){
        setStatus(text, true);
    }
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
            Object.assign(btn.style, {
                marginLeft: '10px', background: '#ff4d4f', color: '#fff',
                border: 'none', borderRadius: '4px', padding: '2px 10px',
                cursor: 'pointer', fontSize: '12px'
            });
            btn.addEventListener('click', stopHandler);
            el.appendChild(btn);
        }
        return el;
    }

                                                              
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
        return fetch(LOCAL_SERVER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => r.json());
    }

    async function sendUrlsToServer(urls, opts){
        if(!urls.length) return { ok:false, error:'no urls' };
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

    function collectPageImageUrls(){
        const pageUrls = new Set(extractUrlsFromDoc(document));
        const textUrls = extractUrlsFromText(document.documentElement.innerHTML);
        textUrls.forEach(u => pageUrls.add(u));
        const jsonUrls = extractUrlsFromJsonText(document.documentElement.innerHTML);
        jsonUrls.forEach(u => pageUrls.add(u));
        return Array.from(pageUrls).filter(isContentImageUrl);
    }

                                       
                                          
                                                                                  
    function detectPageType(){
        const host = location.hostname;
        const path = location.pathname;
        const isSpace = host === 'space.bilibili.com';
        const uid = (isSpace && /^\/(\d+)/.test(path)) ? path.match(/^\/(\d+)/)[1] : null;

               
        if(isSpace && /\/favlist/.test(path)){
            return { type:'favlist', uid, imagePage:true, label:'收藏夹' };
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

    function describeSpace(info, ownership){
        if(!info) return '';
        if(info.type === 'favlist' || info.type === 'dynamic-list'){
            const owner = ownership === 'own' ? '（你的空间）' : (ownership === 'other' ? '（他人空间）' : '');
            return info.label + owner;
        }
        return info.label;
    }
 
    const stopFlag = { stop: false };

    function countResults(json){
        const list = (json && json.results) || [];
        return {
            saved: list.filter(r => r.saved && !r.error && !r.exists).length,
            exists: list.filter(r => r.exists).length,
            failed: list.filter(r => r.error).length,
            total: list.length
        };
    }
    function showDonatePanel(stats, title){
        const existing = document.getElementById('bili-donate-panel');
        if(existing) existing.remove();
        const panel = document.createElement('div');
        panel.id = 'bili-donate-panel';
        Object.assign(panel.style, {
            position:'fixed', right:'20px', bottom:'180px', zIndex:999999,
            background:'#fff', color:'#222', padding:'16px', borderRadius:'12px',
            width:'370px', boxShadow:'0 8px 28px rgba(0,0,0,0.3)', fontSize:'13px'
        });
        const statText = stats
            ? `<span style="margin-left:auto;color:#888;font-size:12px;">新增 ${stats.saved} · 已存在 ${stats.exists} · 失败 ${stats.failed}</span>`
            : '';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
            '<span style="font-size:18px;">' + (stats ? '✅' : '☕') + '</span>' +
            '<b style="font-size:15px;color:#00a1d6;">' + (title || (stats ? '下载成功！' : '感谢使用 Bilibili-Plus！')) + '</b>' + statText +
            '</div>' +
            '<div style="display:flex;gap:14px;align-items:flex-start;">' +
            '<img id="bili-donate-qr" src="http://127.0.0.1:8765/qr" alt="收款码（点击放大）" title="点击放大收款码" style="width:150px;height:150px;border:1px solid #eee;border-radius:8px;flex-shrink:0;background:#f7f7f7;cursor:zoom-in;">' +
            '<div style="line-height:1.8;">' +
            '<div><b>似玖得六（FNAS）</b></div>' +
            '<div style="color:#555;word-break:break-all;">GitHub: github.com/FNAS-496/bilibili-image-saver</div>' +
            '<div style="color:#555;">邮箱: sijiudeliu@outlook.com</div>' +
            '</div>' +
            '</div>' +
            '<div style="margin-top:10px;background:#fff8e1;border:1px solid #ffd700;color:#8a6d00;border-radius:8px;padding:8px 10px;text-align:center;">' +
            '觉得好用的话就打赏一杯奶茶钱吧 ☕<span style="color:#b00;">（点击收款码可放大）</span>' +
            '</div>' +
            '<div style="margin-top:12px;text-align:right;">' +
            '<a id="bili-donate-view" href="http://127.0.0.1:8765/" target="_blank" rel="noopener" style="margin-right:8px;padding:6px 16px;border:1px solid #00a1d6;color:#00a1d6;border-radius:6px;text-decoration:none;font-size:13px;display:inline-block;">查看图片</a>' +
            '<button id="bili-donate-close" style="padding:6px 16px;border:none;background:#00a1d6;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">知道了</button>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#bili-donate-close').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-donate-qr').addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.id = 'bili-donate-lightbox';
            Object.assign(overlay.style, {
                position:'fixed', inset:'0', zIndex:9999999, background:'rgba(0,0,0,0.78)',
                display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out'
            });
            const big = document.createElement('img');
            big.src = 'http://127.0.0.1:8765/qr';
            big.alt = '收款码';
            Object.assign(big.style, {
                maxWidth:'min(520px, 92vw)', maxHeight:'92vh', background:'#fff',
                padding:'14px', borderRadius:'14px', boxShadow:'0 8px 40px rgba(0,0,0,0.5)'
            });
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
    function findActionButton(groups){
        for(const group of groups){
            for(const sel of group.selectors){
                const el = document.querySelector(sel);
                if(el) return { el, active: elementIsActive(el) };
            }
        }
        return null;
    }

    function openReviewPanel(urls, onDone){
        const existing = document.getElementById('bili-review-panel');
        if(existing) existing.remove();
        const dark = (loadTheme() === 'dark');
        const s = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
        const keys = Object.assign({}, DEFAULT_SETTINGS.keys, s.keys || {});
        const panel = document.createElement('div');
        panel.id = 'bili-review-panel';
        Object.assign(panel.style, {
            position:'fixed', inset:'0', zIndex:9999998,
            background: dark ? 'rgba(24,26,32,0.97)' : 'rgba(248,249,252,0.97)',
            display:'flex', alignItems:'stretch',
            color: dark ? '#e6e6e6' : '#1f2330', fontSize:'14px'
        });
        const upInfo = extractUpInfo();
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const keyName = k => ({ ArrowDown:'↓', ArrowUp:'↑', ArrowLeft:'←', ArrowRight:'→', Escape:'Esc', Space:'空格', Enter:'回车' }[k] || k);
        const borderC = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const mutedC = dark ? '#9aa0ae' : '#6b7280';
        const subBg = dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.65)';
        const btnGhost = 'width:100%;padding:9px 0;border:1px solid ' + (dark ? '#4a4e5c' : '#d0d4dd') + ';background:transparent;color:' + (dark ? '#e6e6e6' : '#2a2f3a') + ';border-radius:9px;cursor:pointer;font-size:13px;margin-bottom:8px;transition:all .15s;';
        const keyItemC = 'display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 12px;background:' + (dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.75)') + ';border:1px solid ' + borderC + ';border-radius:10px;font-size:13px;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,0.04);margin-bottom:8px;';
        const keycapC = 'display:inline-flex;align-items:center;justify-content:center;min-width:52px;box-sizing:border-box;padding:6px 10px;border-radius:6px;font-size:13px;font-weight:bold;line-height:normal;';
        const keyRow = (label, k, which) => {
            if(!which){
                return '<div style="' + keyItemC + '">' +
                '<span style="display:block;flex:1;text-align:left;line-height:normal;white-space:nowrap;color:' + (dark ? '#e6e6e6' : '#333') + ';">' + label + '</span>' +
                '<kbd style="' + keycapC + 'background:' + (dark ? 'rgba(255,255,255,0.06)' : '#fff') + ';border:1px solid ' + borderC + ';color:' + mutedC + ';">' + k + '</kbd>' +
                '</div>';
            }
            return '<div class="bili-review-key" data-key="' + which + '" style="' + keyItemC + 'cursor:pointer;transition:background .15s;" title="点击后按任意键自定义">' +
            '<span style="display:block;flex:1;text-align:left;line-height:normal;white-space:nowrap;color:' + (dark ? '#e6e6e6' : '#333') + ';">' + label + '</span>' +
            '<kbd class="bili-review-keycap" style="' + keycapC + 'background:' + (dark ? 'rgba(255,255,255,0.06)' : '#fff') + ';border:1px solid #00a1d6;color:#00a1d6;">' + k + '</kbd>' +
            '</div>';
        };
        panel.innerHTML =
            '<div id="bili-review-left" style="width:220px;padding:18px 16px;border-right:1px solid ' + borderC + ';overflow:auto;display:flex;flexDirection:column;background:' + subBg + ';">' +
            '<div style="display:flex;align-items:center;gap:6px;font-weight:bold;font-size:14px;margin-bottom:12px;color:#00a1d6;letter-spacing:.3px;">' +
            '<b>键位设置</b>' +
            '<span style="flex:1;"></span>' +
            '<button id="bili-review-key-reset" style="font-size:11px;font-weight:normal;color:' + mutedC + ';background:transparent;border:1px solid ' + borderC + ';border-radius:6px;padding:2px 9px;cursor:pointer;transition:all .15s;">恢复默认</button>' +
            '</div>' +
            '<div style="font-size:11px;line-height:1.5;color:' + mutedC + ';margin:-2px 0 10px;padding:6px 8px;background:' + (dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.6)') + ';border:1px solid ' + borderC + ';border-radius:8px;">点击卡片后按任意键即可自定义</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px;">' +
            keyRow('下载当前图', keyName(keys.download), 'download') +
            keyRow('下一张', keyName(keys.next), 'next') +
            keyRow('上一张', keyName(keys.prev), 'prev') +
            keyRow('退出审查', keyName(keys.exit), 'exit') +
            '</div>' +
            '<div style="margin-top:12px;padding:12px 12px 10px;border-top:1px solid ' + borderC + ';font-size:12px;color:' + mutedC + ';line-height:1.9;">' +
            '<div style="font-weight:bold;color:' + (dark ? '#e6e6e6' : '#333') + ';margin-bottom:4px;">📋 审查模式说明</div>' +
            '<div>· 单张预览，满意后再下载</div>' +
            '<div>· 按 <kbd id="bili-review-mode-dl-key" style="display:inline-block;min-width:26px;text-align:center;padding:1px 7px;border-radius:5px;background:' + (dark ? 'rgba(255,255,255,0.06)' : '#fff') + ';border:1px solid ' + borderC + ';color:#00a1d6;font-weight:bold;font-size:11px;">' + keyName(keys.download) + '</kbd> 保存当前这张</div>' +
            '<div>· 已下载的图标记 ✅</div>' +
            '<div>· 「全部下载」一键保存全部</div>' +
            '</div>' +
            '<div style="margin-top:auto;padding:10px 12px;background:' + (dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.8)') + ';border:1px solid ' + borderC + ';border-radius:9px;font-size:12px;color:' + mutedC + ';">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>下载进度</span><span><b id="bili-review-dl-count" style="color:#00a1d6;">0</b> / ' + urls.length + '</span></div>' +
            '<div style="height:6px;background:' + (dark ? '#2c3038' : '#e3e6ec') + ';border-radius:3px;overflow:hidden;"><div id="bili-review-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#00a1d6,#00b3e6);border-radius:3px;transition:width .3s;"></div></div>' +
            '</div>' +
            '</div>' +
            '<div id="bili-review-center" style="flex:1;display:flex;flexDirection:column;min-width:0;position:relative;overflow:hidden;">' +
            '<div id="bili-review-progress" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);color:' + mutedC + ';font-size:13px;background:' + (dark ? 'rgba(24,26,32,0.75)' : 'rgba(255,255,255,0.8)') + ';padding:5px 16px;border-radius:20px;z-index:3;box-shadow:0 1px 6px rgba(0,0,0,0.12);white-space:nowrap;"></div>' +
            '<div style="flex:1;display:flex;alignItems:center;justifyContent:center;min-height:0;margin:48px 14px 14px;background:' + (dark ? '#0d0e12' : '#eef0f5') + ';border-radius:12px;box-shadow:0 4px 30px rgba(0,0,0,0.18);overflow:hidden;position:relative;" id="bili-review-frame">' +
            '<img id="bili-review-img" src="" alt="预览" style="max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;box-shadow:0 2px 12px rgba(0,0,0,0.2);border-radius:4px;">' +
            '</div>' +
            '</div>' +
            '<div id="bili-review-right" style="width:220px;padding:16px 14px;border-left:1px solid ' + borderC + ';overflow:auto;background:' + subBg + ';">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
            (upInfo.upAvatar ? '<img src="' + esc(upInfo.upAvatar) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid ' + borderC + ';flex-shrink:0;" referrerpolicy="no-referrer">' : '<div style="width:36px;height:36px;border-radius:50%;background:' + (dark ? '#3a3f4d' : '#e2e6ee') + ';display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">👤</div>') +
            '<div style="min-width:0;">' +
            '<div style="font-weight:bold;font-size:14px;color:' + (dark ? '#e6e6e6' : '#1f2330') + ';word-break:break-all;">' + esc(upInfo.upName) + '</div>' +
            '<div style="font-size:10px;color:' + mutedC + ';margin-top:2px;">UP主 · ' + (upInfo.upText ? '动态文案见下方' : '') + '</div>' +
            '</div>' +
            '</div>' +
            (upInfo.upText ? '<div style="line-height:1.7;font-size:12px;color:' + (dark ? '#c6cad4' : '#4b5563') + ';white-space:pre-wrap;word-break:break-word;margin-bottom:12px;padding:8px 10px;background:' + (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') + ';border-radius:8px;">' + esc(upInfo.upText) + '</div>' : '<div style="font-size:11px;color:' + mutedC + ';margin-bottom:12px;">（未获取到动态文案）</div>') +
            '<div style="margin-top:4px;padding-top:10px;border-top:1px solid ' + borderC + ';">' +
            '<button id="bili-review-like" style="' + btnGhost + 'border-color:#fb7299;color:#fb7299;">👍 点赞</button>' +
            '<button id="bili-review-fav" style="' + btnGhost + 'border-color:#ffa940;color:#ffa940;">☆ 收藏</button>' +
            '<button id="bili-review-follow" style="' + btnGhost + 'border-color:#00a1d6;color:#00a1d6;">＋ 关注</button>' +
            '<button id="bili-review-dl-all" style="width:100%;padding:9px 0;border:none;background:linear-gradient(135deg,#00a1d6,#00b3e6);color:#fff;border-radius:9px;cursor:pointer;font-size:13px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,161,214,0.3);">全部下载</button>' +
            '<button id="bili-review-close" style="' + btnGhost + 'margin-bottom:0;">退出审查</button>' +
            '</div>' +
            '</div>' +
            '<button id="bili-review-full" style="position:absolute;top:12px;right:12px;z-index:3;padding:7px 14px;border:1px solid ' + (dark ? '#4a4e5c' : '#d0d4dd') + ';background:' + (dark ? 'rgba(40,42,50,0.92)' : 'rgba(255,255,255,0.92)') + ';color:' + (dark ? '#e6e6e6' : '#2a2f3a') + ';border-radius:20px;cursor:pointer;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.18);">🔍 只看大图</button>';
        document.body.appendChild(panel);

        let index = 0;
        let downloaded = new Set();
        let busy = false;
        const imgEl = panel.querySelector('#bili-review-img');
        const progressEl = panel.querySelector('#bili-review-progress');
        const countEl = panel.querySelector('#bili-review-dl-count');
        const barEl = panel.querySelector('#bili-review-bar');
        const leftEl = panel.querySelector('#bili-review-left');
        const rightEl = panel.querySelector('#bili-review-right');
        const fullBtn = panel.querySelector('#bili-review-full');
        const likeBtn = panel.querySelector('#bili-review-like');
        const favBtn = panel.querySelector('#bili-review-fav');
        const followBtn = panel.querySelector('#bili-review-follow');
        let fullMode = false;
        let capturing = false;

        const render = () => {
            imgEl.src = urls[index];
            progressEl.textContent = (index + 1) + ' / ' + urls.length + (downloaded.has(index) ? '  ✅ 已下载' : '');
            countEl.textContent = downloaded.size;
            if(barEl) barEl.style.width = urls.length ? Math.round(downloaded.size / urls.length * 100) + '%' : '0%';
        };

        const close = () => {
            panel.remove();
            document.removeEventListener('keydown', onKey);
            if(onDone) onDone(downloaded.size);
            if(downloaded.size) showDonatePanel({ saved: downloaded.size, exists: 0, failed: 0 }, '审查结束');
        };

        const toggleFull = () => {
            fullMode = !fullMode;
            leftEl.style.display = fullMode ? 'none' : '';
            rightEl.style.display = fullMode ? 'none' : '';
            fullBtn.textContent = fullMode ? '🗂️ 恢复侧栏' : '🔍 只看大图';
            const frame = document.getElementById('bili-review-frame');
            if(frame){ frame.style.margin = fullMode ? '14px' : '48px 14px 14px'; }
        };

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
                        showToast('❌ 下载失败，请检查本地服务');
                    }
                }
            } finally {
                busy = false;
            }
        };

        const dlAll = async () => {
            if(busy) return;
            const remaining = urls.filter((u, i) => !downloaded.has(i));
            if(!remaining.length){ showToast('全部已下载'); return; }
            busy = true;
            showToast('⬇️ 正在全部下载 ' + remaining.length + ' 张...');
            try{
                const json = await sendUrlsToServer(remaining);
                if(json && json.results){
                    json.results.forEach((r, i) => {
                        if(r && (r.saved || r.exists)){
                            const origIdx = urls.indexOf(remaining[i]);
                            if(origIdx >= 0) downloaded.add(origIdx);
                        }
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

        function onKey(e){
            if(busy || capturing){ return; }
            const k = e.key;
            if(k === keys.download){ e.preventDefault(); dlCurrent(); }
            else if(k === keys.next){ e.preventDefault(); index = Math.min(urls.length - 1, index + 1); render(); }
            else if(k === keys.prev){ e.preventDefault(); index = Math.max(0, index - 1); render(); }
            else if(k === keys.exit){ e.preventDefault(); close(); }
        }
        document.addEventListener('keydown', onKey);

        panel.addEventListener('wheel', (e) => {
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
                likeBtn.style.borderColor = on ? '#fb7299' : '#fb7299';
                likeBtn.style.background = on ? (dark ? 'rgba(251,114,153,0.18)' : 'rgba(251,114,153,0.12)') : 'transparent';
                likeBtn.style.color = on ? '#fb7299' : '#fb7299';
            }
            if(favBtn){
                const on = !!(favHit && favHit.active);
                favBtn.textContent = on ? '★ 已收藏' : '☆ 收藏';
                favBtn.style.background = on ? (dark ? 'rgba(255,169,64,0.18)' : 'rgba(255,169,64,0.12)') : 'transparent';
                favBtn.style.color = on ? '#ffa940' : '#ffa940';
            }
            if(followBtn){
                const on = !!(followHit && followHit.active);
                followBtn.textContent = on ? '✔ 已关注' : '＋ 关注';
                followBtn.style.background = on ? (dark ? 'rgba(0,161,214,0.18)' : 'rgba(0,161,214,0.1)') : 'transparent';
                followBtn.style.color = on ? '#00a1d6' : '#00a1d6';
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
        let urls = urlsAll;
        if(settings.maxDownload > 0 && urls.length > settings.maxDownload){
            urls = urls.slice(0, settings.maxDownload);
        }
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
        showProgress(`正在下载 ${urls.length} 张原图到本地...`, () => { stopFlag.stop = true; });
        const json = await sendUrlsToServer(urls, settings);
        if(json && json.results){
            const c = countResults(json);
            showToast(`保存完成：新增 ${c.saved} 张，已存在 ${c.exists} 张，失败 ${c.failed} 张\n图片已保存到 bilibili_images 目录`);
            showDonatePanel(c);                   
            if(failCount) console.warn('解析失败的作品数:', failCount);
        }
    }

                                           
    function setupDynamicListWatcher(){
        const info = detectPageType();
        if(!info || info.type !== 'dynamic-list') return;
        const seen = new Set();
        const queue = new Set();
        let timer = null;
        const flush = () => {
            timer = null;
            if(!queue.size) return;
            const urls = Array.from(queue).filter(isContentImageUrl);
            queue.clear();
            if(urls.length){
                const st = Object.assign({}, DEFAULT_SETTINGS, loadSettings());
                if(!st.autoRun || st.downloadMode === 'review') return;
                showToast(`发现 ${urls.length} 张新图片，自动保存中...`);
                sendUrlsToServer(urls);
            }
        };
        const collect = () => {
            extractUrlsFromDoc(document).forEach(u => {
                if(!seen.has(u)){ seen.add(u); queue.add(u); }
            });
            clearTimeout(timer);
            timer = setTimeout(flush, 1500);
        };
        const observer = new MutationObserver(collect);
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('scroll', collect, { passive: true });
    }

                                                        
    function serverApi(path, body){
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

    function openSettingsPanel(){
        const existing = document.getElementById('bili-save-settings');
        if(existing){ existing.style.display = 'block'; return; }
        const panel = document.createElement('div');
        panel.id = 'bili-save-settings';
        Object.assign(panel.style, {
            position:'fixed', right:'20px', bottom:'150px', zIndex:999999,
            background:'var(--bili-save-bg)', color:'var(--bili-save-fg)', padding:'0', borderRadius:'14px',
            width:'380px', boxShadow:'0 10px 36px rgba(0,0,0,0.32)', fontSize:'13px', border:'1px solid var(--bili-save-border)', overflow:'hidden'
        });
        const s = loadSettings();
        const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bili-save-border);border-radius:8px;font-size:13px;margin-bottom:4px;background:var(--bili-save-input-bg);color:var(--bili-save-fg);outline:none;';
        const inputStyleFocused = inputStyle + ';border-color:#00a1d6;';
        const labelStyle = 'font-size:12px;color:var(--bili-save-muted);margin-bottom:4px;';
        const cardStyle = 'padding:12px 16px;border-bottom:1px solid var(--bili-save-border);';
        const groupTitle = 'display:flex;align-items:center;gap:6px;font-weight:bold;font-size:13px;color:#00a1d6;margin-bottom:8px;';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:14px 16px;background:linear-gradient(135deg,#00a1d6,#00b3e6);color:#fff;">' +
            '<span style="font-size:18px;">⚙️</span>' +
            '<b style="font-size:15px;flex:1;">Bilibili-Plus 设置</b>' +
            '<button id="bili-settings-x" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;line-height:1;">✕</button>' +
            '</div>' +
            '<div style="' + cardStyle + '">' +
            '<div style="' + groupTitle + '">📁 保存目录</div>' +
            '<div style="' + labelStyle + '">留空 = 默认 bilibili_images 文件夹</div>' +
            '<input id="bili-dir-input" type="text" placeholder="例如 D:\\bilibili_pics" value="' + (s.saveDir||'').replace(/"/g,'&quot;') + '" style="' + inputStyle + '">' +
            '<div id="bili-dir-current" style="font-size:11px;color:var(--bili-save-muted);margin-bottom:2px;word-break:break-all;"></div>' +
            '</div>' +
            '<div style="' + cardStyle + '">' +
            '<div style="' + groupTitle + '">⚡ 下载选项</div>' +
            '<div style="display:flex;gap:10px;">' +
            '<div style="flex:1;"><div style="' + labelStyle + '">间隔 (ms)</div>' +
            '<input id="bili-int-input" type="number" min="0" step="100" value="' + s.intervalMs + '" style="' + inputStyle + '"></div>' +
            '<div style="flex:1;"><div style="' + labelStyle + '">超时 (ms)</div>' +
            '<input id="bili-timeout-input" type="number" min="5000" step="1000" value="' + s.timeoutMs + '" style="' + inputStyle + '"></div>' +
            '<div style="flex:1;"><div style="' + labelStyle + '">单次上限</div>' +
            '<input id="bili-max-input" type="number" min="0" step="10" value="' + s.maxDownload + '" style="' + inputStyle + '"></div>' +
            '</div>' +
            '<div style="display:flex;gap:16px;margin-top:8px;">' +
            '<label style="font-size:12px;color:var(--bili-save-fg);cursor:pointer;display:flex;align-items:center;gap:5px;"><input type="checkbox" id="bili-dedupe-input"' + (s.dedupe ? ' checked' : '') + '> 查重</label>' +
            '<label style="font-size:12px;color:var(--bili-save-fg);cursor:pointer;display:flex;align-items:center;gap:5px;"><input type="checkbox" id="bili-autorun-input"' + (s.autoRun ? ' checked' : '') + '> 打开页面自动提取</label>' +
            '</div>' +
            '</div>' +
            '<div style="' + cardStyle + '">' +
            '<div style="' + groupTitle + '">🖼️ 下载模式</div>' +
            '<div style="display:flex;gap:10px;">' +
            '<label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--bili-save-border);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--bili-save-input-bg);"><input type="radio" name="bili-mode" value="auto"' + (s.downloadMode !== 'review' ? ' checked' : '') + '> ⬇️ 自动下载</label>' +
            '<label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--bili-save-border);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--bili-save-input-bg);"><input type="radio" name="bili-mode" value="review"' + (s.downloadMode === 'review' ? ' checked' : '') + '> 🔍 审查模式</label>' +
            '</div>' +
            '<div style="' + labelStyle + ';margin-top:10px;">审查键位（点击后按任意键）</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;">' +
            '<button class="bili-key-btn" data-key="next" style="padding:7px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:8px;cursor:pointer;font-size:12px;">下一页 <b id="bili-key-next">' + (s.keys && s.keys.next || '→') + '</b></button>' +
            '<button class="bili-key-btn" data-key="prev" style="padding:7px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:8px;cursor:pointer;font-size:12px;">上一页 <b id="bili-key-prev">' + (s.keys && s.keys.prev || '←') + '</b></button>' +
            '<button class="bili-key-btn" data-key="download" style="padding:7px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:8px;cursor:pointer;font-size:12px;">下载 <b id="bili-key-download">' + (s.keys && s.keys.download || '↓') + '</b></button>' +
            '<button class="bili-key-btn" data-key="exit" style="padding:7px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:8px;cursor:pointer;font-size:12px;">退出 <b id="bili-key-exit">' + (s.keys && s.keys.exit || 'Esc') + '</b></button>' +
            '</div>' +
            '</div>' +
            '<div style="padding:14px 16px;">' +
            '<div style="display:flex;gap:8px;">' +
            '<button id="bili-donate-btn" style="flex:1;padding:8px 0;border:1px solid #ffd700;background:#fff8e1;color:#8a6d00;border-radius:8px;cursor:pointer;font-size:13px;">☕ 赞助</button>' +
            '<button id="bili-dir-cancel" style="flex:1;padding:8px 0;border:1px solid var(--bili-save-border);background:var(--bili-save-bg);color:var(--bili-save-fg);border-radius:8px;cursor:pointer;font-size:13px;">取消</button>' +
            '<button id="bili-dir-ok" style="flex:1.4;padding:8px 0;border:none;background:linear-gradient(135deg,#00a1d6,#00b3e6);color:#fff;border-radius:8px;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,161,214,0.3);">💾 保存设置</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#bili-settings-x').addEventListener('click', () => panel.remove());
        panel.querySelector('#bili-dir-input').addEventListener('focus', (e) => { e.target.style.borderColor = '#00a1d6'; });
        panel.querySelector('#bili-dir-input').addEventListener('blur', (e) => { e.target.style.borderColor = 'var(--bili-save-border)'; });
        const input = panel.querySelector('#bili-dir-input');
        const curEl = panel.querySelector('#bili-dir-current');
        panel.querySelector('#bili-donate-btn').addEventListener('click', () => { showDonatePanel(null); });
        getSaveDir().then(info => {
            curEl.textContent = '当前 / Current: ' + ((info && info.dir) || '未连接本地服务 / server not running');
        });
        const close = () => { panel.remove(); };
        panel.querySelector('#bili-dir-cancel').addEventListener('click', () => {
            close();
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });
        panel.querySelector('#bili-dir-ok').addEventListener('click', async () => {
            const dir = input.value.trim();
            const intervalMs = Math.max(0, parseInt(panel.querySelector('#bili-int-input').value, 10) || 0);
            const timeoutMs = Math.max(5000, parseInt(panel.querySelector('#bili-timeout-input').value, 10) || 30000);
            const maxDownload = Math.max(0, parseInt(panel.querySelector('#bili-max-input').value, 10) || 0);
            const dedupe = panel.querySelector('#bili-dedupe-input').checked;
            const autoRun = panel.querySelector('#bili-autorun-input').checked;
            const modeRadio = panel.querySelector('input[name="bili-mode"]:checked');
            const downloadMode = modeRadio ? modeRadio.value : 'auto';
            const keys = Object.assign({}, DEFAULT_SETTINGS.keys, window.__biliPendingKeys || {});
            const ns = { saveDir: dir, intervalMs, timeoutMs, maxDownload, dedupe, downloadMode, autoRun, keys };
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
                showToast('✅ 设置已保存（保存目录：默认 bilibili_images）');
            }
            close();
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });

        window.__biliPendingKeys = window.__biliPendingKeys || {};
        const keyLabel = { next:'#bili-key-next', prev:'#bili-key-prev', download:'#bili-key-download', exit:'#bili-key-exit' };
        const KEY_BTN_LABELS = { next:'下一页', prev:'上一页', download:'下载', exit:'退出' };
        panel.querySelectorAll('.bili-key-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const which = btn.getAttribute('data-key');
                btn.textContent = '按任意键...';
                const listener = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.removeEventListener('keydown', listener);
                    let k = e.key;
                    if(k === ' ') k = 'Space';
                    if(k.length === 1) k = k.toUpperCase();
                    const cur = Object.assign({}, DEFAULT_SETTINGS.keys, loadSettings().keys || {}, window.__biliPendingKeys || {});
                    const conflict = Object.keys(DEFAULT_SETTINGS.keys).find(other => other !== which && cur[other] === k);
                    if(conflict){
                        showToast('⚠️ 该键已绑定「' + (KEY_BTN_LABELS[conflict] || conflict) + '」，请换一个键');
                        btn.innerHTML = KEY_BTN_LABELS[which] + ' <b>' + (cur[which] || (which === 'exit' ? 'Esc' : '')) + '</b>';
                        return;
                    }
                    window.__biliPendingKeys[which] = k;
                    btn.innerHTML = KEY_BTN_LABELS[which] + ' <b>' + k + '</b>';
                };
                document.addEventListener('keydown', listener);
            });
        });
    }

                                        
    function maybeAskDirOnce(){
        const pageInfo = detectPageType();
        if(!pageInfo || !pageInfo.imagePage) return;
        try{
            if(localStorage.getItem(DIR_ASKED_KEY) === '1') return;
        }catch(e){}
        setTimeout(openSettingsPanel, 1200);
    }

    function formatSize(bytes){
        if(!bytes || bytes <= 0) return '未知';
        if(bytes < 1024) return bytes + ' B';
        if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if(bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }
    function formatDuration(sec){
        sec = Math.round(sec || 0);
        const m = Math.floor(sec / 60), s = sec % 60;
        return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }
    function qualityLabel(q){
        const map = { 127:'8K', 126:'杜比', 125:'HDR', 120:'4K', 116:'1080P60', 112:'1080P+', 80:'1080P', 74:'720P60', 64:'720P', 32:'480P', 16:'360P', 6:'240P' };
        return map[q] || (q ? (q + 'P') : '');
    }
    function getVideoBvidFromUrl(){
        const m = location.href.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
        return m ? m[1] : null;
    }

    function collectVideoItems(){
        const items = [];
        if(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i.test(location.pathname)){
            const bvid = getVideoBvidFromUrl();
            if(bvid){
                items.push({ bvid, cid: null, title: '视频 ' + bvid, duration: null, useApiTitle: true });
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
                items.push({ bvid, cid: null, title: domTitle || ('视频 ' + bvid), duration: null, useApiTitle: true });
            });
            return items.slice(0, 50);
        }
        return items;
    }

    async function fetchViewCid(bvid){
        try{
            const text = await fetchText('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
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

    async function fetchVideoStreams(bvid, cid){
        try{
            const text = await fetchText('https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + cid + '&qn=80&fnval=16&fourk=1');
            const j = JSON.parse(text);
            if(j && j.code === 0 && j.data){
                const data = j.data;
                const dash = data.dash;
                let videoUrl = null, audioUrl = null, size = null, quality = null, ext = 'mp4';
                if(dash && dash.video && dash.video.length){
                    const v = dash.video[0];
                    videoUrl = v.baseUrl || v.base_url;
                    const a = dash.audio && dash.audio[0];
                    if(a) audioUrl = a.baseUrl || a.base_url;
                    const durSec = (data.timelength || dash.duration || 0) / 1000;
                    const vbw = v.bandwidth || 0;
                    const abw = a ? (a.bandwidth || 0) : 0;
                    if(durSec > 0 && vbw) size = Math.round((vbw + abw) * durSec / 8);
                    quality = v.id;
                    const mt = v.mimeType || v.mime_type || '';
                    ext = /mp4/i.test(mt) ? 'mp4' : 'm4s';
                } else if(data.durl && data.durl.length){
                    videoUrl = data.durl[0].url;
                    let sum = 0;
                    data.durl.forEach(x => { sum += (x.size || 0); });
                    size = sum || null;
                    quality = data.quality;
                    ext = /\.flv/i.test(videoUrl) ? 'flv' : 'mp4';
                }
                return { videoUrl, audioUrl, size, quality, ext };
            }
        }catch(e){
            console.error('获取视频流失败', bvid, cid, e);
        }
        return null;
    }

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

    function openVideoPanel(){
        const existing = document.getElementById('bili-video-panel');
        if(existing){ existing.remove(); }
        const panel = document.createElement('div');
        panel.id = 'bili-video-panel';
        Object.assign(panel.style, {
            position:'fixed', right:'20px', bottom:'180px', zIndex:999999,
            background:'#fff', color:'#222', padding:'16px', borderRadius:'12px',
            width:'440px', maxHeight:'70vh', display:'flex', flexDirection:'column',
            boxShadow:'0 8px 28px rgba(0,0,0,0.3)', fontSize:'13px'
        });
        panel.innerHTML =
            '<div style="display:flex;align-items:center;margin-bottom:10px;">' +
            '<b style="font-size:15px;color:#00a1d6;">📹 视频批量下载</b>' +
            '<span style="margin-left:auto;font-size:12px;color:#888;" id="bili-video-hint"></span>' +
            '</div>' +
            '<div id="bili-video-list" style="overflow:auto;flex:1;border:1px solid #eee;border-radius:8px;padding:6px;"></div>' +
            '<div style="display:flex;align-items:center;gap:10px;margin-top:10px;">' +
            '<label style="font-size:12px;color:#555;cursor:pointer;"><input type="checkbox" id="bili-video-all" style="vertical-align:middle;"> 全选</label>' +
            '<span style="flex:1;"></span>' +
            '<button id="bili-video-dl" style="padding:6px 16px;border:none;background:#00a1d6;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">下载选中</button>' +
            '<button id="bili-video-close" style="padding:6px 12px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">关闭</button>' +
            '</div>';
        document.body.appendChild(panel);

        const listEl = panel.querySelector('#bili-video-list');
        const hintEl = panel.querySelector('#bili-video-hint');
        const allEl = panel.querySelector('#bili-video-all');

        const state = { items: [], ready: false };

        const render = () => {
            if(!state.items.length){
                listEl.innerHTML = '<div style="color:#999;padding:24px;text-align:center;">当前页面未检测到视频。</div>';
                return;
            }
            listEl.innerHTML = state.items.map((it, i) => {
                const dur = it.duration ? (' · ' + formatDuration(it.duration)) : '';
                const size = it.size ? (' · ' + formatSize(it.size)) : '';
                const q = it.quality ? (' · ' + qualityLabel(it.quality)) : '';
                const err = it.error ? ' · <span style="color:#f00;">获取失败</span>' : '';
                return '<label style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid #f2f2f2;cursor:pointer;">' +
                    '<input type="checkbox" class="bili-video-check" data-i="' + i + '" style="flex-shrink:0;">' +
                    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + it.title.replace(/"/g,'&quot;') + '">' + it.title + '</span>' +
                    '<span style="color:#999;font-size:12px;flex-shrink:0;">' + dur + size + q + err + '</span>' +
                    '</label>';
            }).join('');
        };

        const fillCids = async () => {
            const need = state.items.filter(it => it.cid == null);
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
                                title: 'P' + p.page + ' ' + (p.part || ''),
                                duration: p.duration || null,
                                useApiTitle: true
                            }));
                            state.items.splice(state.items.indexOf(it), 1, ...expanded);
                        } else {
                            it.cid = v.cid;
                            if(!it.duration) it.duration = v.duration;
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

        const fetchSizes = async () => {
            hintEl.textContent = '正在获取大小与画质...';
            let done = 0;
            const total = state.items.length;
            async function worker(){
                while(done < total){
                    const i = done++;
                    const it = state.items[i];
                    if(it.cid == null || it.error){ continue; }
                    const s = await fetchVideoStreams(it.bvid, it.cid);
                    if(s && s.videoUrl){ it.videoUrl = s.videoUrl; it.audioUrl = s.audioUrl; it.size = s.size; it.quality = s.quality; it.ext = s.ext; }
                    else { it.error = true; }
                    const span = hintEl; if(span) span.textContent = '正在获取大小与画质 ' + Math.min(done, total) + '/' + total + ' ...';
                    render();
                }
            }
            await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, total) }, () => worker()));
            hintEl.textContent = '共 ' + state.items.length + ' 个（已自动获取大小与画质）';
        };

        panel.querySelector('#bili-video-dl').addEventListener('click', async () => {
            const checks = listEl.querySelectorAll('.bili-video-check:checked');
            const chosen = Array.from(checks).map(c => state.items[Number(c.getAttribute('data-i'))]).filter(it => it.videoUrl);
            if(!chosen.length){ showToast('请先勾选视频（列表已自动获取下载地址，无需额外操作）'); return; }
            panel.querySelector('#bili-video-dl').disabled = true;
            const videos = chosen.map(it => ({ title: it.title, videoUrl: it.videoUrl, audioUrl: it.audioUrl, ext: it.ext }));
            try{
                const json = await postJsonToPath('/video/save', { videos });
                if(json && json.results){
                    const saved = json.results.filter(r => r.saved && !r.error).length;
                    const failed = json.results.filter(r => r.error).length;
                    const separate = json.results.filter(r => r.separate).length;
                    const merged = json.results.filter(r => r.merged).length;
                    showToast('视频下载完成：成功 ' + saved + ' 个'
                        + (merged ? '（含合并 mp4 ' + merged + ' 个）' : '')
                        + (separate ? '，音画分开保存 ' + separate + ' 个' : '')
                        + '，失败 ' + failed + ' 个\n保存目录：videos/');
                    if(saved > 0) showDonatePanel({ saved: saved, exists: 0, failed: failed });
                }
            }catch(err){
                showToast('❌ 视频下载失败：\n' + err.message + '\n请先双击「一键启动.bat」启动本地服务');
            } finally {
                panel.querySelector('#bili-video-dl').disabled = false;
            }
        });

        panel.querySelector('#bili-video-close').addEventListener('click', () => panel.remove());

        allEl.addEventListener('change', () => {
            listEl.querySelectorAll('.bili-video-check').forEach(c => { c.checked = allEl.checked; });
        });

        const items = collectVideoItems();
        state.items = items;
        render();
        if(!items.length){ hintEl.textContent = ''; return; }
        (async () => {
            await fillCids();
            await fetchSizes();
        })();
    }

    function makeButton(){
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { position:'fixed', right:'20px', bottom:'20px', zIndex:999999, display:'flex', flexDirection:'column', gap:'8px', alignItems:'flex-end' });

        const subBtns = [];
        const mkSub = (text, color, onClick) => {
            const b = document.createElement('button');
            b.textContent = text;
            Object.assign(b.style, {
                padding:'8px 14px', background:'var(--bili-save-bg)', color:color || 'var(--bili-save-fg)', border:'1px solid ' + (color || 'var(--bili-save-border)'),
                borderRadius:'6px', cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.15)', fontSize:'13px', display:'none'
            });
            b.addEventListener('click', onClick);
            wrap.appendChild(b);
            subBtns.push(b);
            return b;
        };

        const themeBtn = mkSub((THEME === 'dark' ? '☀️ 日间' : '🌙 夜间'), '#ffb300', () => {
            const next = THEME === 'dark' ? 'light' : 'dark';
            saveTheme(next);
            location.reload();
        });
        const settingsBtn = mkSub('⚙️ 设置', '#00a1d6', openSettingsPanel);
        const videoBtn = mkSub('📹 视频下载', '#fb7299', openVideoPanel);
        const saveBtn = mkSub('⬇️ 提取并保存', '#00a1d6', () => {
            saveBtn.disabled = true;
            saveBtn.textContent = '正在提取...';
            collectAndSave().finally(() => {
                saveBtn.disabled = false;
                saveBtn.textContent = '⬇️ 提取并保存';
            });
        });

        const rootBtn = document.createElement('button');
        rootBtn.textContent = 'Bilibili-Plus';
        Object.assign(rootBtn.style, {
            padding:'10px 18px', background:'#00a1d6', color:'#fff', border:'none', borderRadius:'8px',
            cursor:'pointer', boxShadow:'0 3px 10px rgba(0,161,214,0.4)', fontSize:'14px', fontWeight:'bold',
            letterSpacing:'0.5px'
        });
        rootBtn.addEventListener('click', () => {
            const show = rootBtn.textContent !== '✖ 收起';
            subBtns.forEach(b => { b.style.display = show ? 'block' : 'none'; });
            rootBtn.textContent = show ? '✖ 收起' : 'Bilibili-Plus';
        });
        wrap.appendChild(rootBtn);
        document.body.appendChild(wrap);
    }

                                         
    let autoStarted = false;
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

    function verifySetup(){
        const REPO = 'https://github.com/FNAS-496/bilibili-image-saver';
        getSaveDir().then(dirInfo => {
            if(dirInfo && dirInfo.dir){
                return;
            }
            console.warn('[BiliSave] 本地保存服务未运行。请双击「一键启动.bat」启动，或从 ' + REPO + ' 下载完整版。');
        });
    }

    function init(){
        applyTheme(THEME);
        makeButton();
        setupDynamicListWatcher();
        maybeAutoRun();
        maybeAskDirOnce();
        verifySetup();
    }

    if(document.readyState === 'complete' || document.readyState === 'interactive'){
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
