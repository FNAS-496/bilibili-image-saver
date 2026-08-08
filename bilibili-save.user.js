// ==UserScript==
// @name         哔哩哔哩 收藏夹/动态/作品 原图自动下载（B站二次元图片批量保存）
// @name:en      Bilibili Auto-Download Original Images
// @namespace    https://github.com/FNAS-496/bilibili-image-saver
// @version      0.8.0
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

    // ===== 配置 =====
    const AUTO_RUN = true;                 // 打开页面后自动提取保存（URL 加 ?bili_auto_save=0 可关闭）
    const MAX_CHILD_PAGES = 200;           // 收藏夹页最多抓取的子页面数（上限已提高）
    const CHILD_CONCURRENCY = 6;           // 抓取子页面的并发数
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

    // 把任意 B 站图片地址规范化为“原图 URL”：
    //  1) 反转义 JSON 中的 \u002F / \/（B 站把图片 URL 以转义形式藏在 JS 里）
    //  2) 补全协议相对 // 前缀
    //  3) 去掉 @ 缩略参数（xxx.png@316w_560h_1e_1c -> xxx.png，即原图）
    //  4) webp/avif 统一转为 jpg（hdslb/bilibili 域）
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

    // 判断是否为 B 站“内容图”（收藏/动态/文章里的图），
    // 排除头像(bfs/face)、favicon、活动图(activity-plat)、vip 图等无关图片。
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

        // B 站新版页面图片主要放在 <picture><source srcset="..."> 中，必须单独提取
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

        // 视频封面 poster 兜底
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
            // 作品(opus)或动态(t.bilibili.com/{id})详情页链接
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

        // 作品页 https://www.bilibili.com/opus/{id}
        const regexOpus = /https?:\/\/(?:www\.)?bilibili\.com\/opus\/(\d+)(?:\S*)/gi;
        let match;
        while((match = regexOpus.exec(text))) addNormalized(match[0]);
        const regexOpusRel = /(?:https?:)?\/\/(?:www\.)?bilibili\.com\/opus\/(\d+)(?:\S*)/gi;
        while((match = regexOpusRel.exec(text))) addNormalized(match[0]);
        const regexOpusPath = /\/[oO]pus\/(\d+)(?:\S*)/gi;
        while((match = regexOpusPath.exec(text))){
            links.add(normalizeUrl(match[0], window.location.origin).split('#')[0]);
        }

        // 动态详情页 https://t.bilibili.com/{id}
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
        // B 站把图片 URL 以 \u002F 转义形式藏在 JS 数据里，先全局反转义再提取
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

    // ===== UI 工具：状态栏（带进度/停止按钮）与 toast 提示 =====
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

    // ===== 发送到本地保存服务（优先 GM_xmlhttpRequest，不受 CORS 限制） =====
    function postJsonToServer(payload){
        if(typeof GM_xmlhttpRequest === 'function'){
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: LOCAL_SERVER,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(payload),
                    timeout: 300000, // 大批量下载可能耗时较长
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

    // ===== 智能页面识别：判断当前 B 站页面类型 =====
    // 返回 { type, uid, imagePage, label }
    // type: favlist | dynamic-list | dynamic-detail | opus | space-other | other
    function detectPageType(){
        const host = location.hostname;
        const path = location.pathname;
        const isSpace = host === 'space.bilibili.com';
        const uid = (isSpace && /^\/(\d+)/.test(path)) ? path.match(/^\/(\d+)/)[1] : null;

        // 收藏夹
        if(isSpace && /\/favlist/.test(path)){
            return { type:'favlist', uid, imagePage:true, label:'收藏夹' };
        }
        // 动态列表（空间动态 tab）
        if(isSpace && /\/dynamic/.test(path)){
            return { type:'dynamic-list', uid, imagePage:true, label:'动态列表' };
        }
        // 动态详情 t.bilibili.com/{id}
        if(host === 't.bilibili.com' && /^\d+$/.test(path.replace(/^\//,'').replace(/\/$/,''))){
            return { type:'dynamic-detail', uid, imagePage:true, label:'动态' };
        }
        // 作品 opus
        if(/\/opus\//.test(path)){
            return { type:'opus', uid, imagePage:true, label:'作品' };
        }
        // 空间其它 tab（视频/专栏等）或空间首页
        if(isSpace){
            const seg = path.split('/')[2] || '';
            const tabName = seg || '首页';
            return { type:'space-other', uid, imagePage:false, label:'空间·' + tabName };
        }
        // 其它 B 站页面（视频页、番剧等）——不作为图片页自动运行
        return { type:'other', uid, imagePage:false, label:'页面' };
    }

    // ===== 空间归属检测：自己的空间 or 他人的空间 =====
    // 自己的空间：有“编辑资料/投稿管理/更换头像”等入口；他人的空间：有“关注”按钮
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
        // 兜底：空间页 URL 有 uid 但无法判断
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

    async function collectAndSave(){
        stopFlag.stop = false;
        const pageUrls = new Set(extractUrlsFromDoc(document));
        const textUrls = extractUrlsFromText(document.documentElement.innerHTML);
        textUrls.forEach(u => pageUrls.add(u));
        const jsonUrls = extractUrlsFromJsonText(document.documentElement.innerHTML);
        jsonUrls.forEach(u => pageUrls.add(u));

        // 只有收藏夹页需要逐个抓子页面（收藏夹只显示封面缩略图）；
        // 动态列表页本身已包含每条动态的全部图片，直接提取即可，无需抓子页面。
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
            // SPA 页面内容可能尚未加载完成，自动延时重试（最多 3 次）
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
            return;
        }

        showProgress(`正在下载 ${urls.length} 张原图到本地...`, () => { stopFlag.stop = true; });
        window.__biliRetryCount = 0;
        const json = await sendUrlsToServer(urls);
        if(json && json.results){
            const c = countResults(json);
            showToast(`保存完成：新增 ${c.saved} 张，已存在 ${c.exists} 张，失败 ${c.failed} 张\n图片已保存到 bilibili_images 目录`);
            if(failCount) console.warn('解析失败的作品数:', failCount);
        }
    }

    // ===== 动态列表页：滚动加载出新动态后自动增量提取保存 =====
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

    // ===== 保存目录设置（服务器 POST /setdir、GET /getdir） =====
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

    // 首次使用：自动弹出一次“选择保存位置”窗口（之后可在设置中修改）
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

    // ===== 自动运行：打开页面即自动提取保存，无需点击 =====
    let autoStarted = false;
    function maybeAutoRun(){
        if(autoStarted) return;
        autoStarted = true;
        // 弹窗自动保存模式（收藏夹页打开的子页）→ 保存当前页后关闭
        if(isAutoSaveMode()){
            setTimeout(autoSaveCurrentOpusPage, 800);
            return;
        }
        if(!AUTO_RUN) return;
        // 智能识别页面类型：仅对包含图片的页面自动运行（整个 B 站注入，其余页面不干扰）
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

    function init(){
        setupOpusAutoSaveMessageListener();
        makeButton();
        setupDynamicListWatcher();
        maybeAutoRun();
        maybeAskDirOnce();
    }

    if(document.readyState === 'complete' || document.readyState === 'interactive'){
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
