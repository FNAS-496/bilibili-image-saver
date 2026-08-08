// ==UserScript==
// @name         哔哩哔哩 收藏夹/动态/作品 原图自动下载（B站二次元图片批量保存）
// @name:en      Bilibili Auto-Download Original Images
// @namespace    https://github.com/FNAS-496/bilibili-image-saver
// @version      0.9.0
// @author       FNAS-496 <sijiudeliu@outlook.com>
// @description  自动下载 B 站收藏夹、动态、作品(opus)、空间中的原图到本地（自动运行，无需点击；需配合“一键保存.bat”启动本地服务）
// @description:en Auto-download original images from Bilibili favorites, dynamics, opus posts and space pages (runs automatically; needs the local server started via "一键保存.bat")
// @homepageURL  https://github.com/FNAS-496/bilibili-image-saver
// @supportURL   https://github.com/FNAS-496/bilibili-image-saver/issues
// @updateURL    https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @downloadURL  https://raw.githubusercontent.com/FNAS-496/bilibili-image-saver/main/bilibili-save.user.js
// @match        *://*.bilibili.com/*
// @match        *://bilibili.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      127.0.0.1
// @noframes
// @license      CC BY-NC-SA 4.0
// ==/UserScript==


(function(){
    'use strict';

    const LOCAL_SERVER = 'http://127.0.0.1:8765/save';
    const MSG_TYPE = 'bilibili-opus-image-save';
    const AUTO_SAVE_PARAM = 'bili_auto_save';

                      
    const AUTO_RUN = true;                                                             
    const MAX_CHILD_PAGES = 200;                                   
    const CHILD_CONCURRENCY = 6;                        
    const TOAST_MS = 4000;
    const DIR_ASKED_KEY = 'bili_save_dir_asked_v1';

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
        const resp = await fetch(url, { credentials: 'include' });
        if(!resp.ok) throw new Error('Fetch failed ' + resp.status + ' for ' + url);
        return await resp.text();
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

    async function sendUrlsToServer(urls){
        if(!urls.length) return { ok:false, error:'no urls' };
        try{
            const json = await postJsonToServer({ urls });
            console.log('本地保存服务返回', json);
            return json;
        }catch(err){
            console.error(err);
            showToast('❌ 未连接本地保存服务：\n请先双击「一键保存.bat」启动，然后刷新本页重试');
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

    function isAutoSaveMode(){
        return new URL(location.href).searchParams.get(AUTO_SAVE_PARAM) === '1';
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
 
    function setupOpusAutoSaveMessageListener(){
        window.addEventListener('message', event => {
            const data = event.data;
            if(data && data.type === MSG_TYPE){
                console.log('收到子页面自动保存消息', data.page, data.urls);
            }
        });
    }
 
    async function autoSaveCurrentOpusPage(){
        const urls = collectPageImageUrls();
        if(!urls.length){
            console.warn('Auto-save: no images found on', location.href);
            return;
        }
        await sendUrlsToServer(urls);
        if(window.opener && window.opener !== window){
            try{
                window.opener.postMessage({ type: MSG_TYPE, page: location.href, urls }, '*');
            }catch(e){
                console.warn('Cannot postMessage to opener', e);
            }
        }
        try{
            window.close();
        }catch(e){
            console.warn('Unable to close window automatically', e);
        }
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

                                               
    function showDonatePanel(stats){
        const existing = document.getElementById('bili-donate-panel');
        if(existing) existing.remove();
        const panel = document.createElement('div');
        panel.id = 'bili-donate-panel';
        Object.assign(panel.style, {
            position:'fixed', right:'20px', bottom:'180px', zIndex:999999,
            background:'#fff', color:'#222', padding:'16px', borderRadius:'12px',
            width:'330px', boxShadow:'0 8px 28px rgba(0,0,0,0.3)', fontSize:'13px'
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
            '<img src="http://127.0.0.1:8765/qr" alt="收款码" style="width:110px;height:110px;border:1px solid #eee;border-radius:8px;flex-shrink:0;background:#f7f7f7;" onerror="this.style.display=\'none\'">' +
            '<div style="line-height:1.8;">' +
            '<div><b>似玖得六（FNAS）</b></div>' +
            '<div style="color:#555;word-break:break-all;">GitHub: github.com/FNAS-496/bilibili-image-saver</div>' +
            '<div style="color:#555;">邮箱: sijiudeliu@outlook.com</div>' +
            '</div>' +
            '</div>' +
            '<div style="margin-top:10px;background:#fff8e1;border:1px solid #ffd700;color:#8a6d00;border-radius:8px;padding:8px 10px;text-align:center;">' +
            '觉得好用的话就打赏一杯奶茶钱吧 ☕' +
            '</div>' +
            '<div style="margin-top:12px;text-align:right;">' +
            '<button id="bili-donate-close" style="padding:6px 16px;border:none;background:#00a1d6;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">知道了</button>' +
            '</div>';
        document.body.appendChild(panel);
        panel.querySelector('#bili-donate-close').addEventListener('click', () => panel.remove());
        setTimeout(() => { if(panel.isConnected) panel.remove(); }, 8000);
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

        const urls = Array.from(pageUrls).filter(isContentImageUrl);
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

        showProgress(`正在下载 ${urls.length} 张原图到本地...`, () => { stopFlag.stop = true; });
        window.__biliRetryCount = 0;
        const json = await sendUrlsToServer(urls);
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
            background:'#fff', color:'#222', padding:'14px 16px', borderRadius:'10px',
            width:'340px', boxShadow:'0 6px 20px rgba(0,0,0,0.3)', fontSize:'13px'
        });
        panel.innerHTML =
            '<div style="font-weight:bold;font-size:14px;margin-bottom:10px;">⚙️ 保存设置 / Save Settings</div>' +
            '<div style="font-size:12px;color:#666;margin-bottom:6px;">保存目录 / Save directory（留空 = 默认 bilibili_images）</div>' +
            '<input id="bili-dir-input" type="text" placeholder="例如 D:\\bilibili_pics" ' +
            'style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #ccc;border-radius:6px;font-size:13px;margin-bottom:6px;">' +
            '<div id="bili-dir-current" style="font-size:12px;color:#888;margin-bottom:10px;word-break:break-all;"></div>' +
            '<div style="text-align:right;">' +
            '<button id="bili-dir-cancel" style="margin-right:8px;padding:6px 14px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">取消 / Cancel</button>' +
            '<button id="bili-dir-ok" style="padding:6px 16px;border:none;background:#00a1d6;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;">保存 / Save</button>' +
            '</div>';
        document.body.appendChild(panel);
        const input = panel.querySelector('#bili-dir-input');
        const curEl = panel.querySelector('#bili-dir-current');
        getSaveDir().then(info => {
            curEl.textContent = '当前 / Current: ' + ((info && info.dir) || '未连接本地服务 / server not running');
        });
        panel.querySelector('#bili-dir-cancel').addEventListener('click', () => {
            panel.style.display = 'none';
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });
        panel.querySelector('#bili-dir-ok').addEventListener('click', async () => {
            const dir = input.value.trim();
            const info = await setSaveDir(dir);
            if(info && info.ok){
                showToast('✅ 保存目录已设置：' + info.dir);
                panel.style.display = 'none';
            } else {
                showToast('❌ 设置失败：请先双击「一键保存.bat」启动本地服务');
            }
            try{ localStorage.setItem(DIR_ASKED_KEY, '1'); }catch(e){}
        });
    }

                                        
    function maybeAskDirOnce(){
        try{
            if(localStorage.getItem(DIR_ASKED_KEY) === '1') return;
        }catch(e){}
        setTimeout(openSettingsPanel, 1200);
    }

    function makeButton(){
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { position:'fixed', right:'20px', bottom:'20px', zIndex:999999, display:'flex', flexDirection:'column', gap:'8px', alignItems:'flex-end' });

        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = '⚙️ 保存位置';
        Object.assign(settingsBtn.style, {
            padding:'8px 14px', background:'#fff', color:'#00a1d6', border:'1px solid #00a1d6',
            borderRadius:'6px', cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.15)', fontSize:'13px'
        });
        settingsBtn.addEventListener('click', openSettingsPanel);
        wrap.appendChild(settingsBtn);

        const btn = document.createElement('button');
        btn.textContent = '重新提取并保存';
        Object.assign(btn.style, {
            padding: '10px 14px', background: '#00a1d6', color: '#fff', border: 'none',
            borderRadius: '6px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
        });
        btn.addEventListener('click', () => {
            btn.disabled = true;
            btn.textContent = '正在提取...';
            collectAndSave().finally(() => {
                btn.disabled = false;
                btn.textContent = '重新提取并保存';
            });
        });
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
    }

                                         
    let autoStarted = false;
    function maybeAutoRun(){
        if(autoStarted) return;
        autoStarted = true;
                                         
        if(isAutoSaveMode()){
            setTimeout(autoSaveCurrentOpusPage, 800);
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
        fetch('http://127.0.0.1:8765/getdir').then(r => r.json()).then(info => {
            console.log('[check] 本地保存服务: ' + (info && info.dir ? 'connected (' + info.dir + ')' : 'not connected'));
        }).catch(() => {
            console.log('[check] 本地保存服务: not connected');
        });
        fetch('http://127.0.0.1:8765/qr').then(r => {
            console.log('[check] 收款码: ' + (r.status === 200 ? 'ready' : 'missing'));
        }).catch(() => {});
    }

    function init(){
        setupOpusAutoSaveMessageListener();
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
