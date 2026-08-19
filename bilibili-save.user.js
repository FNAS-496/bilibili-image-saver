// ==UserScript==
// @name         Bilibili-Plus 哔哩哔哩增强（原图/视频批量下载）
// @name:en      Bilibili-Plus - Enhanced Bilibili Downloader
// @namespace    https://github.com/FNAS-496/bilibili-image-saver
// @version      0.9.8
// @updateURL    https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @downloadURL  https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @author       FNAS-496 <sijiudeliu@outlook.com>
// @description  Bilibili-Plus：自动下载 B 站收藏夹、动态、作品(opus)、空间中的原图，支持视频批量下载、审查模式、自定义键位（自动运行，需配合“一键启动.bat”启动本地服务）
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
                    headers: {
                    timeout: 20000,
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

                                               
    const DONATE_QR = 'data:image/jpeg;base64,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ACu6+OX/ACWv4h/9jFqP/pVJXC13Xxy/5LX8Q/8AsYtR/wDSqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/wAlv+Hn/Yxaf/6Ux1w9dx8Cf+S3/Dz/ALGLT/8A0pjrh6ACiiigAooooAK7r45f8lr+If8A2MWo/wDpVJXC13Xxy/5LX8Q/+xi1H/0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8lv+Hn/Yxaf/AOlMdcPXcfAn/kt/w8/7GLT/AP0pjrh6ACiiigAooooAK7r45f8AJa/iH/2MWo/+lUlcLXdfHL/ktfxD/wCxi1H/ANKpKAOFooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP/ACW/4ef9jFp//pTHXD13HwJ/5Lf8PP8AsYtP/wDSmOuHoAKKKKACiiigAruvjl/yWv4h/wDYxaj/AOlUlcLXdfHL/ktfxD/7GLUf/SqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW/4ef9jFp/8A6Ux1w9dx8Cf+S3/Dz/sYtP8A/SmOuHoAKKKKACiiigAruvjl/wAlr+If/Yxaj/6VSVwtd18cv+S1/EP/ALGLUf8A0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8AJb/h5/2MWn/+lMdcPXcfAn/kt/w8/wCxi0//ANKY64egAooooAKKKKACu6+OX/Ja/iH/ANjFqP8A6VSVwtd18cv+S1/EP/sYtR/9KpKAOFooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP/Jb/h5/2MWn/wDpTHXD13HwJ/5Lf8PP+xi0/wD9KY64egAooooAKKKKACu6+OX/ACWv4h/9jFqP/pVJXC13Xxy/5LX8Q/8AsYtR/wDSqSgDhaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigArX8J+Edc8c69Bovh3SL3W9WnDGGwsIGnlkCqWYhFBJwAxOBwFJrIr6k/4Jm/8nl+B/8ArlqH/pDNQB5n/wAMofGn/ok3jD/wQ3P/AMRR/wAMofGn/ok3jH/wQ3P/AMRX9B1FAH8+P/DKHxp/6JN4x/8ABDc//EUf8MofGn/ok3jH/wAENz/8RX9B1FAH8+P/AAyf8av+iT+Mf/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGr/ok3jL/wAEVz/8RX9B1FAH8+P/AAyf8av+iTeMv/BFc/8AxFH/AAyf8av+iTeMv/BFc/8AxFf0HUUAfz4/8Mn/ABq/6JN4y/8ABFc//EUf8Mn/ABq/6JN4y/8ABFc//EV/QdRQB/Pj/wAMn/Gr/ok3jL/wRXP/AMRR/wAMn/Gr/ok3jL/wRXP/AMRX9B1FAH8+P/DJ/wAav+iTeMv/AARXP/xFH/DJ/wAav+iTeMv/AARXP/xFf0HUUAfz4/8ADJ/xq/6JN4y/8EVz/wDEUf8ADJ/xq/6JN4y/8EVz/wDEV/QdRQB/Pj/wyf8AGr/ok3jL/wAEVz/8RR/wyf8AGn/ok3jL/wAEVz/8RX9B1FAH81/irwlrngbXLjRPEejXuhaxAqmawv4HhljDAMpZWAK5BUjI5DA1k19Rf8FM/wDk8vxz/wBcdO/9Ioa+XaACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA7j4E/8lv8Ah5/2MWn/APpTHXD13HwJ/wCS3/Dz/sYtP/8ASmOuHoAKKKKACiiigAruvjl/yWv4h/8AYxaj/wClUlcLXdfHL/ktfxD/AOxi1H/0qkoA4WiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK+pP+CZn/J5fgf8A646h/wCkU1fLdfUn/BMz/k8vwP8A9cdQ/wDSKagD9wqKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAormfiV45tPhv4E13xPfc2ulWj3Lr/ewOF/E4H41+Ynw+/4LE+INZ+Llnp2s+FbOHwre3QtAYp2aaIFsK/QA84yP1oA/WGiqumahDqunW17bOJIJ41kRh0IIyKtUAFFFRsxVGIoAkor8svjt/wAFcPEfgH40ap4e0Dwpaz6DpVx9mme4nIlmI+8RgED261+jfwc+Idv8V/hl4d8YWsLW0OsWi3Igc5MZPDL+BBoA7KiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/Dz/AIKZ/wDJ5fjj/rjp/wD6RQ18uV9R/wDBTP8A5PL8cf8AXHT/AP0ihr5coAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW74ef9jFp/wD6Ux1w9dx8Cf8Akt3w8/7GLT//AEpjrh6ACiiigAooooAK7r45f8lr+If/AGMWo/8ApVJXC13Xxy/5LX8Q/wDsYtR/9KpKAOFooooAKKKKACiiigAooooAKKKKACii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UAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAdx8Cf+S3fDz/sYtP8A/SmOuHruPgT/AMlu+Hn/AGMWn/8ApTHXD0AFFFFABRRRQAV3Xxz/AOS2fEP/ALGLUf8A0pkrha7r45/8ls+If/Yxaj/6UyUAcLRRRQAUUUUAFFLikoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDuPgT/yW74ef9jFp/8A6Ux1w9dx8Cf+S3fDz/sYtP8A/SmOuHoAKKKKACiiigAruvjn/wAls+If/Yxaj/6UyVwtd18c/wDktnxD/wCxi1H/ANKZKAOFooooAKKK9t/ZY+Cdr8V/E+oahrztB4V0CEXmqSIT93DMEJGCAQjAsCCO1AHiXlP5XmfP5f3d3bP1oiRm4Clj7CvZ/wBof4raD8RdWstE8K+H7fQ9D0pvItnRP3tx8zZZzkk5LNjk8ba9n13SfB/7Hvw6srbUtFh1/wCJGt2pdzdhmitYnDJgKSBxtkIO3OfagD4yA4pdvvUl3cG7nlnbG6Vy5x05Oa9m/ZO8E/D/AMd/EZdM8eXkkNrLC32aHeypNJuA2s6kMDgk8f3aAPFdvvRtr3n9p79lfWfgRqzXdsTf+FrlgIL1QxZMsw2PlQA33ehP3l5rznwB8GvGvxOgubjwr4dvNat7dgsslsowuc7c5Pfa35UAcZto21+inx++AGr6f+zl4U8NeE/Bjat4g8yNr2W0gQyohSV3BckHIYqK+HfH3wh8afDCG2n8V+Hb3Q4rlykLXSgByBkgcntQBxu33o212XwZsLbV/i34JsruFZra41uyilRujIZ0DKfYgkV7f+394N0TwV8SNKtdD06LTbeS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AFFemav+zR8UdEBFx4J1SQDq1nGLkD8Yi1cJqvhnV9AkMep6Xe6a/TbeW7xH/wAeArlp4rD1v4dRP0dzaVGcPii16ozq7r45/wDJbPiH/wBjFqP/AKUyVwtdz8c+PjZ8Q/8AsYtR/wDSmSuoxOGooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAO4+BP8AyW74ef8AYxaf/wClMdcPXcfAn/kt/wAPP+xi07/0pjrh6ACitHSfDmra9L5Wl6XealJ/ds7d5j/46DXdaP8As1fFDW2AtvBOqR573kYth+cpWuarisPR/iVEvV2/M2hSlP4U/kfqrR5SSgpJsdH+VlZdwx7in0V/Ld2tmfo5ymqfCXwVrYYaj4P0S8z/AMtptNiZv++tmV/A1yXiz9lP4X+M9WvdV1Hw4f7TvZXuLi6gvJkMkjszO5AfbksxJ4616xRXZSzHGUdKdWS+bMpUaU/iin8j5n1b/gn38PbxXax1XXLCQ9FM8Ukf5GPP61wur/8ABOV8M+meOBntFead/wCzrIf/AEGvtKivXo8TZtS2q/gv+CcrwGGlvH7tD89tV/4J/fEKyDNZaloeoqOircSRufwaMD9a4zV/2Pfi5pAZj4Ua8jH8dpdwSZ/4CH3fpX6eUV7FLjXMofEov5M5JZRh27ps/I3V/gz480LcdQ8G69bRr1lbT5fL/wC+guP1rlbiynspjDcwyW8o6pKhVvyNfs5Ve70+1v4zHdW8V3F/zzmQMv5HIr1aXHM1/FoXfk/+Ac0slj9if3r/AIKPxlpK/W3Vfgl8PtaVhe+CdCmZusg0+JX/AO+gAf1rjdW/Y5+Eeq7m/wCEXNnIf4rS8njA/wCA7yv6V69PjbBfapy/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f4u8S+LdYjsF1H7OjAlpPL37cKSOMjrjH41+judHDVIYBScmkklyxe+tk36ngKM6kXXskndvV9PQ0N1r/wBCL/L/ABrE+IVzqWvw213LpUthBaRlSr44XP1NM1v4g6/pGq3Vkuo+eIJDEX2bckEjpk+ldNY65d678LtemvH8yRVZQfbNZOpQxsa2EhJx5U21yxSbjrq16DUalHkrNJptJat7+p49Xo/wa8Ox3upy6rcqBb2mCm4cMTu5/DFecV0XhnxJeWj22mROVtpbiJiAT2f+RzzXx+U1qNHHQqVldLVeb6X8j18VBujKEXa/5dT0/wAefEe68Na0lnBa286cNulUnqB7/wC1XO/FeH/ittK/g3Rx7u3/AC0bNUfi/wD8jJbt/wBMk/kK1virol14k8Y2NrYorSNZA/O2Bwzn+lfcYzEV8UsVTa5uSUUl6t6L1seFQpwp+yktLp3Zs+NvBtt4pntimtWsCwKUCl19APX2qHwN4ItfCusteya1az/uygUOvXIPr7Vx/wDwpbxI4G2G3x7yioLz4Sa/p9nJPJDb+XGu4lZR0rnlWrqv9bll75ou97vp5WtojVRh7P2SxCt2sjV8d+AGtbO91/8AtCO5iaQErEO5YDr0715vXpcv7r4Mt/t3C7f++krzSvl88hS9vCpSjy88VJq7erb6s9TAuUqclJ3s2vkgooor5w9AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK7j4O/8AI4xf9cj/AOhLXD1q+GfEdx4Zv1vbZYmcKy/vVOMHHuD2r08vrww2Kp1p7Jps58RCU6UoR3aN2bX/APhG/iFd3zxeckcrfJ65Ugfqal1Dx/4h8W3YsrWT7MkjbBBCo7nHXGf1rkNR1CTVNQuLuTaJJm3NtzwfbOat+HvEN14c1Fby0K+YAVIcHBB/Ku+OZ1I1Z0o1HGjKTem9m/8ALoY/Vko35U5JWVz0yWWD4XeGfnkSfxBd/ebcWI6/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GE/dhv8Aa9SfWse0meC4jkVirIwYEdiDmvnX7KhWvRd4Rejta69Du5ZVKXvRtJo9v8baV4avdStn1e7MN0IVOwHtiuc+M+oT2niu0eCRo3W0Xa6N/tvXA6prN5q0wmu52mkAxuNV7rUrnUJfMuZWmYDapPYelfS43PY4qFWMKajzNNNaPS+++uuljzqGBdNxlKd7X09exoReJdbmO1b+fce26po7vxDqGYVmuJ8/LjfWbpOoyaTqEF3Af3kLBl3fd47H2rtR8a9fMeBHZr9Ij/8AFV52FrUJwf1rEzi+yTd163VjoqKcWvZU0/XT9DS8b2jeH/hxpGmSjZO77nX0IOTXltaOt69e6/efab2YyyH5R6KPQD8azq58yxlPGVlOimoxSSvvZK2vrubYajKlTak9W238wooorxjqCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAxiiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACjNFFABmjNFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//2Q==';

    function showDonatePanel(stats){
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
            '<span style="font-size:18px;">✅</span>' +
            '<b style="font-size:15px;color:#00a1d6;">下载成功！</b>' + statText +
            '</div>' +
            '<div style="display:flex;gap:14px;align-items:flex-start;">' +
            '<img id="bili-donate-qr" src="' + DONATE_QR + '" alt="收款码（点击放大）" title="点击放大收款码" style="width:150px;height:150px;border:1px solid #eee;border-radius:8px;flex-shrink:0;background:#f7f7f7;cursor:zoom-in;">' +
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
            big.src = DONATE_QR;
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
        const path = location.pathname;
        const st = window.__INITIAL_STATE__;
        if(st){
            if(st.videoData && st.videoData.owner && st.videoData.owner.name) upName = st.videoData.owner.name;
            if(st.opusData && st.opusData.owner && st.opusData.owner.name) upName = st.opusData.owner.name;
            if(!upName && st.user && st.user.name) upName = st.user.name;
            if(!upText && st.videoData && st.videoData.title) upText = st.videoData.title;
        }
        if(!upName){
            const el = document.querySelector('.opus-module-author__name, [class*="opus-module-author__name"], .bili-dyn-item__author, [class*="dyn-item__author"], .up-name, .name.medium, [class*="author__name"], .bili-video-card__info--owner, [class*="video-card__info--owner"], [class*="owner-name"], .header-info__username, a[href*="space.bilibili.com"] .bili-dyn-item__author');
            if(el) upName = (el.textContent || '').trim();
        }
        if(!upName){
            const link = document.querySelector('.opus-module-author a[href*="space.bilibili.com"], .bili-dyn-item__author a[href*="space.bilibili.com"], a[href*="space.bilibili.com"] [class*="author"]');
            if(link) upName = (link.textContent || '').trim();
        }
        if(!upText){
            const txtEl = document.querySelector('.opus-module-title__content, [class*="module-title__content"], .bili-dyn-content, [class*="dyn-content"], .opus-detail__content, [class*="post-content"], .desc-info, .video-desc');
            if(txtEl) upText = (txtEl.textContent || '').trim().slice(0, 500);
        }
        return { upName: upName || '未知UP主', upText };
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
        panel.innerHTML =
            '<div id="bili-review-left" style="width:250px;padding:20px;border-right:1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') + ';overflow:auto;display:flex;flexDirection:column;background:' + (dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.6)') + ';">' +
            '<div style="font-weight:bold;font-size:15px;margin-bottom:10px;color:' + (dark ? '#00a1d6' : '#00a1d6') + ';">⌨️ 键位设置 / Keys</div>' +
            '<div style="line-height:2.1;font-size:13px;">' +
            '<div>⏬ <b>' + keyName(keys.download) + '</b>：下载当前图</div>' +
            '<div>➡️ <b>' + keyName(keys.next) + '</b>：下一张</div>' +
            '<div>⬅️ <b>' + keyName(keys.prev) + '</b>：上一张</div>' +
            '<div>🚪 <b>' + keyName(keys.exit) + '</b>：退出审查</div>' +
            '<div>🖱️ 滚轮：翻页</div>' +
            '</div>' +
            '<div style="margin-top:16px;padding-top:12px;border-top:1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') + ';font-size:12px;color:' + (dark ? '#9aa0ae' : '#6b7280') + ';line-height:1.9;">' +
            '<div style="font-weight:bold;margin-bottom:4px;">📋 审查模式说明</div>' +
            '<div>· 单张预览，满意后再下载</div>' +
            '<div>· 按 ' + keyName(keys.download) + ' 保存当前这张</div>' +
            '<div>· 下载过的图会标记 ✅</div>' +
            '<div>· 「全部下载」一键保存所有</div>' +
            '<div>· 「只看大图」隐藏侧栏全屏看图</div>' +
            '</div>' +
            '<div style="margin-top:auto;padding-top:12px;border-top:1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') + ';font-size:13px;color:' + (dark ? '#9aa0ae' : '#6b7280') + ';">当前已下载 <b id="bili-review-dl-count" style="color:#00a1d6;">0</b> 张</div>' +
            '</div>' +
            '<div id="bili-review-center" style="flex:1;display:flex;flexDirection:column;alignItems:center;justifyContent:center;padding:10px;min-width:0;position:relative;">' +
            '<div id="bili-review-progress" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);color:' + (dark ? '#9aa0ae' : '#6b7280') + ';font-size:13px;background:' + (dark ? 'rgba(24,26,32,0.7)' : 'rgba(255,255,255,0.7)') + ';padding:4px 14px;border-radius:20px;z-index:2;"></div>' +
            '<div style="flex:1;width:100%;display:flex;alignItems:center;justifyContent:center;overflow:hidden;background:' + (dark ? '#0d0e12' : '#eef0f5') + ';border-radius:10px;box-shadow:0 4px 30px rgba(0,0,0,0.18);margin-top:34px;" id="bili-review-frame">' +
            '<img id="bili-review-img" src="" alt="预览" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;">' +
            '</div>' +
            '</div>' +
            '<div id="bili-review-right" style="width:280px;padding:20px;border-left:1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') + ';overflow:auto;background:' + (dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.6)') + ';">' +
            '<div style="font-weight:bold;font-size:15px;margin-bottom:10px;">👤 ' + esc(upInfo.upName) + '</div>' +
            '<div style="line-height:1.8;font-size:13px;color:' + (dark ? '#c6cad4' : '#4b5563') + ';white-space:pre-wrap;word-break:break-word;">' + (upInfo.upText ? esc(upInfo.upText) : '（未获取到动态文案）') + '</div>' +
            '<div style="margin-top:16px;padding-top:12px;border-top:1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') + ';font-size:12px;line-height:1.9;">' +
            '<button id="bili-review-like" style="width:100%;padding:9px 0;border:1px solid #fb7299;background:transparent;color:#fb7299;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;transition:background .15s;">👍 点赞</button>' +
            '<button id="bili-review-full" style="width:100%;padding:9px 0;border:1px solid ' + (dark ? '#555' : '#ccc') + ';background:transparent;color:' + (dark ? '#e6e6e6' : '#222') + ';border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">🔍 只看大图</button>' +
            '<button id="bili-review-dl-all" style="width:100%;padding:9px 0;border:none;background:#00a1d6;color:#fff;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">⬇️ 全部下载</button>' +
            '<button id="bili-review-close" style="width:100%;padding:9px 0;border:1px solid ' + (dark ? '#555' : '#ccc') + ';background:transparent;color:' + (dark ? '#e6e6e6' : '#222') + ';border-radius:8px;cursor:pointer;font-size:13px;">退出审查</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(panel);

        let index = 0;
        let downloaded = new Set();
        let busy = false;
        const imgEl = panel.querySelector('#bili-review-img');
        const progressEl = panel.querySelector('#bili-review-progress');
        const countEl = panel.querySelector('#bili-review-dl-count');
        const leftEl = panel.querySelector('#bili-review-left');
        const rightEl = panel.querySelector('#bili-review-right');
        const centerEl = panel.querySelector('#bili-review-center');
        const fullBtn = panel.querySelector('#bili-review-full');
        let fullMode = false;

        const render = () => {
            imgEl.src = urls[index];
            progressEl.textContent = (index + 1) + ' / ' + urls.length + (downloaded.has(index) ? '  ✅已下载' : '');
            countEl.textContent = downloaded.size;
        };

        const close = () => {
            panel.remove();
            document.removeEventListener('keydown', onKey);
            if(onDone) onDone(downloaded.size);
        };

        const toggleFull = () => {
            fullMode = !fullMode;
            leftEl.style.display = fullMode ? 'none' : '';
            rightEl.style.display = fullMode ? 'none' : '';
            fullBtn.textContent = fullMode ? '🗂️ 恢复侧栏' : '🔍 只看大图';
            const frame = document.getElementById('bili-review-frame');
            if(frame){ frame.style.marginTop = fullMode ? '0' : '34px'; }
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
                        progressEl.textContent = (index + 1) + ' / ' + urls.length + '  ✅已下载';
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
                    urls.forEach((u, i) => { if(!downloaded.has(i)) downloaded.add(i); });
                    countEl.textContent = downloaded.size;
                    const c = countResults(json);
                    showToast(`✅ 全部下载完成：新增 ${c.saved} 张，已存在 ${c.exists} 张，失败 ${c.failed} 张`);
                    showDonatePanel(c);
                    close();
                }
            } finally {
                busy = false;
            }
        };

        function onKey(e){
            if(busy){ return; }
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
        panel.querySelector('#bili-review-like').addEventListener('click', () => {
            let clicked = false;
            const likeSelectors = [
                '.opus-like, [class*="opus-like"], [class*="opus-detail__like"], [class*="like-btn"]',
                '.bili-dyn-action__like, [class*="dyn-action__like"]',
                '.like, [class*="action-like"], [data-action="like"]'
            ];
            for(const sel of likeSelectors){
                const el = document.querySelector(sel);
                if(el){
                    el.click();
                    clicked = true;
                    break;
                }
            }
            if(clicked){
                showToast('👍 已点赞');
            } else {
                showToast('未找到点赞按钮，请在页面右侧直接点赞');
            }
        });
        panel.addEventListener('click', (e) => {
            if(e.target === panel) close();
        });

        render();
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
            background:'var(--bili-save-bg)', color:'var(--bili-save-fg)', padding:'14px 16px', borderRadius:'10px',
            width:'360px', boxShadow:'0 6px 20px rgba(0,0,0,0.3)', fontSize:'13px', border:'1px solid var(--bili-save-border)'
        });
        const s = loadSettings();
        const inputStyle = 'width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--bili-save-border);border-radius:6px;font-size:13px;margin-bottom:6px;background:var(--bili-save-input-bg);color:var(--bili-save-fg);';
        const labelStyle = 'font-size:12px;color:var(--bili-save-muted);margin-bottom:4px;';
        panel.innerHTML =
            '<div style="font-weight:bold;font-size:14px;margin-bottom:10px;">⚙️ 设置 / Settings</div>' +
            '<div style="' + labelStyle + '">保存目录 / Save directory（留空 = 默认 bilibili_images）</div>' +
            '<input id="bili-dir-input" type="text" placeholder="例如 D:\\bilibili_pics" value="' + (s.saveDir||'').replace(/"/g,'&quot;') + '" style="' + inputStyle + '">' +
            '<div id="bili-dir-current" style="font-size:12px;color:var(--bili-save-muted);margin-bottom:8px;word-break:break-all;"></div>' +
            '<div style="' + labelStyle + '">下载间隔（毫秒，0 = 不等待） / Download interval (ms)</div>' +
            '<input id="bili-int-input" type="number" min="0" step="100" value="' + s.intervalMs + '" style="' + inputStyle + '">' +
            '<div style="' + labelStyle + '">下载超时（毫秒，默认 30000）/ Download timeout (ms)</div>' +
            '<input id="bili-timeout-input" type="number" min="5000" step="1000" value="' + s.timeoutMs + '" style="' + inputStyle + '">' +
            '<div style="' + labelStyle + '">单次下载上限（0 = 不限） / Max per batch (0 = unlimited)</div>' +
            '<input id="bili-max-input" type="number" min="0" step="10" value="' + s.maxDownload + '" style="' + inputStyle + '">' +
            '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;">' +
            '<label style="font-size:12px;color:var(--bili-save-fg);cursor:pointer;"><input type="checkbox" id="bili-dedupe-input"' + (s.dedupe ? ' checked' : '') + '> 查重 / Deduplicate</label>' +
            '</div>' +
            '<div style="' + labelStyle + '">图片下载模式 / Download mode</div>' +
            '<div style="display:flex;gap:14px;margin-bottom:8px;">' +
            '<label style="font-size:12px;color:var(--bili-save-fg);cursor:pointer;"><input type="radio" name="bili-mode" value="auto"' + (s.downloadMode !== 'review' ? ' checked' : '') + '> 自动下载 / Auto</label>' +
            '<label style="font-size:12px;color:var(--bili-save-fg);cursor:pointer;"><input type="radio" name="bili-mode" value="review"' + (s.downloadMode === 'review' ? ' checked' : '') + '> 审查模式 / Review</label>' +
            '</div>' +
            '<div style="' + labelStyle + '">审查键位（点击后按任意键）/ Review keys</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">' +
            '<button class="bili-key-btn" data-key="next" style="padding:6px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:6px;cursor:pointer;font-size:12px;">下一页 <b id="bili-key-next">' + (s.keys && s.keys.next || '→') + '</b></button>' +
            '<button class="bili-key-btn" data-key="prev" style="padding:6px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:6px;cursor:pointer;font-size:12px;">上一页 <b id="bili-key-prev">' + (s.keys && s.keys.prev || '←') + '</b></button>' +
            '<button class="bili-key-btn" data-key="download" style="padding:6px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:6px;cursor:pointer;font-size:12px;">下载 <b id="bili-key-download">' + (s.keys && s.keys.download || '↓') + '</b></button>' +
            '<button class="bili-key-btn" data-key="exit" style="padding:6px 4px;border:1px solid var(--bili-save-border);background:var(--bili-save-input-bg);color:var(--bili-save-fg);border-radius:6px;cursor:pointer;font-size:12px;">退出 <b id="bili-key-exit">' + (s.keys && s.keys.exit || 'Esc') + '</b></button>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
            '<button id="bili-donate-btn" style="padding:6px 14px;border:1px solid #ffd700;background:#fff8e1;color:#8a6d00;border-radius:6px;cursor:pointer;font-size:13px;">☕ 赞助作者 / Donate</button>' +
            '<span style="flex:1;"></span>' +
            '</div>' +
            '<div style="text-align:right;">' +
            '<button id="bili-dir-cancel" style="margin-right:8px;padding:6px 14px;border:1px solid var(--bili-save-border);background:var(--bili-save-bg);color:var(--bili-save-fg);border-radius:6px;cursor:pointer;font-size:13px;">取消 / Cancel</button>' +
            '<button id="bili-dir-ok" style="padding:6px 16px;border:none;background:#00a1d6;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">保存 / Save</button>' +
            '</div>';
        document.body.appendChild(panel);
        const input = panel.querySelector('#bili-dir-input');
        const curEl = panel.querySelector('#bili-dir-current');
        panel.querySelector('#bili-donate-btn').addEventListener('click', () => { showDonatePanel(null); });
        getSaveDir().then(info => {
            curEl.textContent = '当前 / Current: ' + ((info && info.dir) || '未连接本地服务 / server not running');
        });
        const close = () => { panel.style.display = 'none'; };
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
            const modeRadio = panel.querySelector('input[name="bili-mode"]:checked');
            const downloadMode = modeRadio ? modeRadio.value : 'auto';
            const keys = Object.assign({}, DEFAULT_SETTINGS.keys, window.__biliPendingKeys || {});
            const ns = { saveDir: dir, intervalMs, timeoutMs, maxDownload, dedupe, downloadMode, keys };
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
                    window.__biliPendingKeys[which] = k;
                    btn.innerHTML = btn.getAttribute('data-key') === 'next' ? '下一页 <b>' + k + '</b>'
                        : btn.getAttribute('data-key') === 'prev' ? '上一页 <b>' + k + '</b>'
                        : btn.getAttribute('data-key') === 'download' ? '下载 <b>' + k + '</b>'
                        : '退出 <b>' + k + '</b>';
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
        const pageInfo = detectPageType();
        const isImagePage = !!(pageInfo && pageInfo.imagePage);
        getSaveDir().then(dirInfo => {
            if(dirInfo && dirInfo.dir){
                console.log('[check] 本地保存服务: connected');
            } else {
                console.log('[check] 本地保存服务: not connected');
                console.log('[提示] 文件不全：本地保存服务文件或配置缺失，请运行「一键启动.bat」。');
                console.log('[提示] 完整版请从 GitHub 下载: ' + REPO);
                if(isImagePage){
                    showToast('⚠️ 本地保存服务未运行，文件不全？请下载完整版：' + REPO);
                }
            }
        });
        if(DONATE_QR && DONATE_QR.indexOf('__QR_B64__') === -1 && DONATE_QR.length > 100){
            console.log('[check] 收款码: ready');
        } else {
            console.log('[check] 收款码: missing');
            console.log('[提示] 文件不全：脚本未内置收款码图片。');
            console.log('[提示] 完整版请从 GitHub 下载: ' + REPO);
        }
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
