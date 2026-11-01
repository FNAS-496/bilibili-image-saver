




const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');


const QR_DIR = path.join(__dirname, 'watermark');
// ========================================================================
// 一、工具函数
// ========================================================================
// 定位收款码图片（watermark 目录，支持多种扩展名）
function resolveQrPath(){
    for(const n of ['wechat_qr.png','wechat_qr.jpg','wechat_qr.jpeg','wechat_qr.webp']){
        const c = path.join(QR_DIR, n);
        if(fs.existsSync(c)) return c;
    }
    if(fs.existsSync(QR_DIR)){
        const f = fs.readdirSync(QR_DIR).find(n => /\.(png|jpe?g|webp|gif)$/i.test(n));
        if(f) return path.join(QR_DIR, f);
    }
    return null;
}

const PORT = 8765;
const CONCURRENCY = 8;               






const DIR_FILE = path.join(__dirname, 'outdir.txt');

// 默认保存位置：桌面下的「B站下载」文件夹。
// 这样即使跑的是便携版（服务目录在子文件夹里），用户也能在桌面直接找到下载内容。
// 兼容 OneDrive 重定向的桌面；都取不到时回退到项目目录。
function resolveDefaultOutDir(){
    try{
        const home = os.homedir();
        if(home){
            const candidates = [
                path.join(home, 'Desktop'),
                path.join(home, 'OneDrive', 'Desktop'),
                path.join(home, 'OneDrive', '桌面'),
                path.join(home, '桌面')
            ];
            for(const c of candidates){
                try{
                    if(fs.existsSync(c) && fs.statSync(c).isDirectory()) return path.join(c, 'B站下载');
                }catch(e){}
            }
            return path.join(home, 'Desktop', 'B站下载');
        }
    }catch(e){}
    return path.join(__dirname, 'bilibili_images');
}

// 保存目录优先级：环境变量 > 命令行参数 > 已保存的设置（outdir.txt）> 默认（桌面「B站下载」）
let OUT_DIR = (process.env.BILI_SAVE_DIR && process.env.BILI_SAVE_DIR.trim())
    ? path.resolve(process.env.BILI_SAVE_DIR)
    : (process.argv[2] ? path.resolve(process.argv[2]) : (() => {
        try{
            const persisted = fs.existsSync(DIR_FILE) ? fs.readFileSync(DIR_FILE, 'utf8').trim() : '';
            if(persisted) return path.resolve(persisted);
        }catch(e){}
        return resolveDefaultOutDir();
    })());
if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const VIDEO_DIR = path.join(OUT_DIR, 'videos');
if(!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

let VIDEO_OUT_DIR = VIDEO_DIR;

const videoJobs = new Map();
let videoJobSeq = 0;

// 从 URL 推断文件扩展名
function extensionFromUrl(u){
    try{
        const parsed = new URL(u);
        const ext = path.extname(parsed.pathname);
        if(ext) return ext;
    }catch(e){}
    return '.jpg';
}

// 文件名净化：保留中文等 Unicode，仅替换非法字符与路径穿越
function sanitizeFilename(name){
    let s = String(name)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\.{2,}/g, '_')
        .replace(/[. ]+$/, '');
    if(!s) s = '_';
    if(s === '.' || s === '..') s = '_';
    return s;
}

// 从地址取落盘文件名（规则与便携版内核 hashFileNameFromUrl 保持一致，
// 否则同一张图在两个版本里会落成两个名字，跨版本查重失效）
function fileNameFromUrl(u){
    try{
        const raw = new URL(u).pathname.split('/').pop() || '';
        let decoded = raw;
        try{ decoded = decodeURIComponent(raw); }catch(e){ decoded = raw; }
        const name = sanitizeFilename(decoded.split('@')[0]);
        if(name && name !== '.' && name !== '..') return name;
    }catch(e){}
    return '';
}

// 视频扩展名白名单：ext 来自请求体，绝不允许夹带路径分隔符或 ".."
// （否则 path.join 会把 ".tmp_x_v.a/../../../pwn" 归一化成保存目录之外）
function normalizeVideoExt(ext){
    const s = String(ext == null ? '' : ext).trim().replace(/^\.+/, '');
    return /^[0-9a-z]{1,8}$/i.test(s) ? s.toLowerCase() : 'mp4';
}

// 断言目标路径落在 dir 内（名字已净化过，这里再挡一道越界）
function assertInsideDir(dir, target){
    const base = path.resolve(dir);
    const full = path.resolve(target);
    if(full !== base && !full.startsWith(base + path.sep) && !full.startsWith(base + '/')){
        throw new Error('拒绝越界写入：' + target);
    }
    return full;
}

// 目录内安全拼接：先净化名字，再断言不越界
function safeJoin(dir, name){
    return assertInsideDir(dir, path.join(dir, sanitizeFilename(name)));
}

// 文件存在且非空
function fileHasContent(p){
    try{ return fs.statSync(p).size > 0; }catch(e){ return false; }
}

// 下载请求头（模拟浏览器 UA / Referer）
function getRequestHeaders(){
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.bilibili.com/'
    };
}

// 生成 webp→jpg 的变体地址
function getWebpToJpgVariant(url){
    try{
        const parsed = new URL(url);
        if(/\.webp$/i.test(parsed.pathname)){
            parsed.pathname = parsed.pathname.replace(/\.webp$/i, '.jpg');
            return parsed.href;
        }
        if(/x-oss-process=image\/format,webp/i.test(parsed.href)){
            return parsed.href.replace(/x-oss-process=image\/format,webp/gi, 'x-oss-process=image/format,jpg');
        }
    }catch(e){}
    return null;
}



// 图片地址规范化（反转义 / 去 @ 缩略参数 / 格式转换 / 取原图）
function normalizeImageUrl(url){
    try{
        let u = String(url).replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        if(u.startsWith('//')) u = 'https:' + u;
        const parsed = new URL(u);
        // B 站页面走 https：把 http 原图地址升级成 https，否则会被浏览器按混合内容直接拦掉
        if(parsed.protocol === 'http:' && /(^|\.)(hdslb\.com|bilibili\.com)$/i.test(parsed.hostname)){
            parsed.protocol = 'https:';
        }
        let pathname = parsed.pathname.split('@')[0];
        if(/\.(webp|avif)$/i.test(pathname) && /(hdslb\.com|bilibili\.com)/i.test(parsed.hostname)){
            pathname = pathname.replace(/\.(webp|avif)$/i, '.jpg');
        }
        parsed.pathname = pathname;
        const process = parsed.searchParams.get('x-oss-process');
        if(process && /format,webp/i.test(process)){
            parsed.search = parsed.search.replace(/x-oss-process=[^&]*/g, m => m.replace(/format,webp/gi, 'format,jpg'));
        }
        parsed.hash = '';
        return parsed.href;
    }catch(e){
        return url;
    }
}

// ========================================================================
// 二、图片下载
// ========================================================================
// 下载并写入文件（带超时与 Content-Type 校验）
async function downloadToFile(fileUrl, destPath, timeoutMs){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try {
        const res = await fetch(fileUrl, {
            headers: getRequestHeaders(),
            redirect: 'follow',
            signal: controller.signal,
        });
        if(!res.ok){
            throw new Error('Status ' + res.status + ' ' + res.statusText);
        }
        const contentType = res.headers.get('content-type') || '';
        if(contentType.includes('text/html') || contentType.includes('application/json')){
            throw new Error('Server returned ' + contentType + ' instead of an image (blocked / risk page)');
        }


        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(destPath, buffer);
        return { path: destPath, contentType: res.headers.get('content-type') };
    } catch(err){
        if(err.name === 'AbortError'){
            throw new Error('timeout');
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

// 保存 base64 内嵌图片
async function saveBase64File(file, index){
    const filename = sanitizeFilename(file.filename || `image_${index}.jpg`);
    const outPath = safeJoin(OUT_DIR, filename);
    const buffer = Buffer.from(file.data, 'base64');
    await fs.promises.writeFile(outPath, buffer);
    return outPath;
}

// 判断图片是否已存在（按原图 hash 命名）
function imageExistsOnDisk(rawUrl){
    try{
        const url = normalizeImageUrl(rawUrl);
        const variants = [url];
        const jpgVariant = getWebpToJpgVariant(url);
        if(jpgVariant && jpgVariant !== url) variants.unshift(jpgVariant);
        for(const candidate of variants){
            const ext = extensionFromUrl(candidate) || '.jpg';
            let base = fileNameFromUrl(candidate);
            if(!base) continue;
            if(!path.extname(base)) base += ext;
            const outPath = assertInsideDir(OUT_DIR, path.join(OUT_DIR, base));
            if(fileHasContent(outPath)){
                return true;
            }
        }
    }catch(e){}
    return false;
}

// 单张图片下载（含重试与查重）
async function tryDownloadFile(rawUrl, index, opts){
    const url = normalizeImageUrl(rawUrl);
    const variants = [url];
    const jpgVariant = getWebpToJpgVariant(url);
    if(jpgVariant && jpgVariant !== url) variants.unshift(jpgVariant);
    const timeoutMs = (opts && opts.timeout) || 30000;
    const dedupe = (opts && opts.dedupe != null) ? opts.dedupe : true;

    let lastError;
    for(let attempt = 0; attempt < 2; attempt++){
        for(const candidate of variants){
            try{
                const ext = extensionFromUrl(candidate) || '.jpg';
                let base = fileNameFromUrl(candidate);
                if(!base) base = `image_${index}`;
                if(!path.extname(base)) base += ext;
                const outPath = assertInsideDir(OUT_DIR, path.join(OUT_DIR, base));
                if(dedupe && fileHasContent(outPath)){
                    return { url: candidate, saved: outPath, exists: true };
                }
                const result = await downloadToFile(candidate, outPath, timeoutMs);
                return { url: candidate, saved: outPath, contentType: result.contentType };
            }catch(err){
                lastError = err;
                console.warn('Download failed for', candidate, 'attempt', attempt + 1, err.message);
            }
        }
    }
    throw lastError || new Error('Download failed');
}

// ========================================================================
// 三、视频下载
// ========================================================================
// 下载视频 / 音频流（支持进度回调）
async function downloadVideoToFile(fileUrl, destPath, timeoutMs, onProgress){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 600000);
    let ws = null;
    try {
        const res = await fetch(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.bilibili.com/'
            },
            redirect: 'follow',
            signal: controller.signal,
        });
        if(!res.ok){
            throw new Error('Status ' + res.status + ' ' + res.statusText);
        }
        const contentType = res.headers.get('content-type') || '';
        if(contentType.includes('text/html')){
            throw new Error('Server returned text/html instead of video (blocked / risk page)');
        }
        const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
        let received = 0;
        // 边收边写：整段视频不进内存（4K 视频动辄几个 GB，全塞进 Buffer 会把服务撑爆）
        ws = fs.createWriteStream(destPath);
        let streamErr = null;
        ws.on('error', e => { streamErr = e; });
        const writeChunk = chunk => new Promise((resolve, reject) => {
            if(streamErr) return reject(streamErr);
            if(ws.write(chunk)) return resolve();
            const cleanup = () => { ws.removeListener('drain', onDrain); ws.removeListener('close', onClose); };
            const onDrain = () => { cleanup(); streamErr ? reject(streamErr) : resolve(); };
            const onClose = () => { cleanup(); reject(streamErr || new Error('写入中断')); };
            ws.once('drain', onDrain);
            ws.once('close', onClose);
        });
        if(res.body && typeof res.body.getReader === 'function'){
            const reader = res.body.getReader();
            for(;;){
                const { done, value } = await reader.read();
                if(done) break;
                if(value && value.length){
                    received += value.length;
                    if(onProgress) onProgress(received, total);
                    await writeChunk(Buffer.from(value));
                }
            }
        } else {
            const buf = Buffer.from(await res.arrayBuffer());
            received = buf.length;
            if(onProgress) onProgress(received, total);
            await writeChunk(buf);
        }
        await new Promise((resolve, reject) => ws.end(err => err ? reject(err) : resolve()));
        ws = null;
        return received;
    } catch(err){
        if(ws){ try{ ws.destroy(); }catch(e){} ws = null; }
        if(err.name === 'AbortError'){
            throw new Error('timeout');
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

// 定位 ffmpeg（项目内置目录优先，其次系统 PATH）
function resolveFfmpeg(){
    const candidates = [
        path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'),
        path.join(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    ];
    for(const c of candidates){
        if(fs.existsSync(c)) return c;
    }
    return 'ffmpeg';
}

// 检测 ffmpeg 是否可用
function ffmpegAvailable(){
    return new Promise(resolve => {
        execFile(resolveFfmpeg(), ['-version'], { timeout: 5000 }, (err) => resolve(!err));
    });
}

// 调用 ffmpeg 合并音视频为 mp4
// 先写 .part 再改名：ffmpeg 中途失败时不会留下一个"看着像成品"的半截 mp4
// （半截文件会被查重当成已完成，用户之后怎么重下都会被跳过）
function mergeWithFfmpeg(videoPath, audioPath, outPath){
    const tmpOut = outPath + '.part';
    return new Promise((resolve, reject) => {
        execFile(resolveFfmpeg(), ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', tmpOut],
            { timeout: 600000 }, (err) => {
                if(err){
                    try{ fs.unlinkSync(tmpOut); }catch(e){}
                    return reject(err);
                }
                try{ fs.renameSync(tmpOut, outPath); }
                catch(e){
                    try{ fs.unlinkSync(tmpOut); }catch(e2){}
                    return reject(e);
                }
                resolve();
            });
    });
}

// ========================================================================
// 四、视频保存
// ========================================================================
// 保存单个视频：下载流 → 有 ffmpeg 则合并，否则音画分开保存
// force = true（用户点了「🔄 重下」）：跳过查重，重新下载并覆盖同名文件
async function saveVideo(item, index, job, force){
    const rawTitle = String(item.title || '').trim();
    const safeTitle = sanitizeFilename(rawTitle) || `video_${index}`;
    const bvid = sanitizeFilename(String(item.bvid || '').trim());
    // 多 P 视频各分 P 共用同一个 BV 号：必须把 cid 也写进文件名，否则磁盘上分不清哪一 P 下过
    const cidTag = (item.multiPart && /^\d+$/.test(String(item.cid == null ? '' : item.cid))) ? '_c' + item.cid : '';
    const suffix = bvid ? '_' + bvid + cidTag : '';
    const maxBase = Math.max(40, 80 - suffix.length);
    const base = (safeTitle.length > maxBase ? safeTitle.slice(0, maxBase) : safeTitle) + suffix;
    const audioUrl = item.audioUrl ? String(item.audioUrl).trim() : '';
    // ext 来自请求体：只取扩展名，绝不放路径分隔符进来
    const ext = normalizeVideoExt(item.ext);

    const outMp4 = assertInsideDir(VIDEO_OUT_DIR, path.join(VIDEO_OUT_DIR, base + '.mp4'));
    const vOnly = assertInsideDir(VIDEO_OUT_DIR, path.join(VIDEO_OUT_DIR, base + '.video.' + ext));
    const aOnly = assertInsideDir(VIDEO_OUT_DIR, path.join(VIDEO_OUT_DIR, base + '.audio.m4a'));
    const identity = { title: rawTitle, bvid: item.bvid || '', cid: (item.cid == null ? null : item.cid), multiPart: !!item.multiPart };

    if(!force && fileHasContent(outMp4)){
        return Object.assign({ saved: outMp4, exists: true }, identity);
    }

    // 没装 ffmpeg 时产物是 .video/.audio 两个文件，它们也要参与查重，
    // 不然每次重下都会白下一遍（还会覆盖掉已经下好的）
    const hasFfmpeg = audioUrl ? await ffmpegAvailable() : false;
    if(!force && audioUrl && !hasFfmpeg && fileHasContent(vOnly) && fileHasContent(aOnly)){
        return Object.assign({ saved: vOnly, audio: aOnly, exists: true, note: '音画分开的产物已存在' }, identity);
    }

    const videoUrl = String(item.videoUrl || item.url || '').trim();
    if(!videoUrl){
        throw new Error('no video url');
    }
    // B 站对同一个流会给多条 CDN 地址（baseUrl + backupUrl）。实测常出现第一个节点连不上、
    // 后面的才通，所以逐条尝试，别因为一条坏节点就整个失败。
    const asUrlList = (primary, extra) => {
        const list = [];
        const push = u => { const s = String(u || '').trim(); if(s && list.indexOf(s) < 0) list.push(s); };
        push(primary);
        (Array.isArray(extra) ? extra : []).forEach(push);
        return list;
    };
    const videoUrls = asUrlList(videoUrl, item.videoUrls);
    const audioUrls = audioUrl ? asUrlList(audioUrl, item.audioUrls) : [];
    // 依次试候选地址直到有一条成功；全都失败就把最后一个错误抛出去
    const downloadAny = async (urls, dest, phase, message) => {
        let lastErr = null;
        for(const u of urls){
            try{
                await downloadVideoToFile(u, dest, null, (received, total) => setJob(phase, message, received, total));
                return u;
            }catch(e){
                lastErr = e;
                try{ if(fs.existsSync(dest)) fs.unlinkSync(dest); }catch(_e){}   // 半成品别留给下一次尝试
            }
        }
        throw lastErr || new Error('no usable url');
    };

    const tmpVideo = assertInsideDir(VIDEO_OUT_DIR, path.join(VIDEO_OUT_DIR, `.tmp_${Date.now()}_${index}_v.${ext}`));
    const tmpAudio = assertInsideDir(VIDEO_OUT_DIR, path.join(VIDEO_OUT_DIR, `.tmp_${Date.now()}_${index}_a.m4a`));
    const setJob = (phase, message, bytes, bytesTotal) => {
        if(job){ job.phase = phase; job.message = message; job.bytes = bytes || 0; job.bytesTotal = bytesTotal || 0; }
    };
    try{
        setJob('downloading-video', '下载视频流');
        await downloadAny(videoUrls, tmpVideo, 'downloading-video', '下载视频流');
        if(audioUrls.length){
            setJob('downloading-audio', '下载音频流');
            await downloadAny(audioUrls, tmpAudio, 'downloading-audio', '下载音频流');
            if(hasFfmpeg){
                setJob('merging', 'ffmpeg 合并音画');
                await mergeWithFfmpeg(tmpVideo, tmpAudio, outMp4);
                try{ fs.unlinkSync(tmpVideo); }catch(e){}
                try{ fs.unlinkSync(tmpAudio); }catch(e){}
                return Object.assign({ saved: outMp4, merged: true }, identity);
            }
            fs.renameSync(tmpVideo, vOnly);
            fs.renameSync(tmpAudio, aOnly);
            return Object.assign({ saved: vOnly, separate: true, audio: aOnly, note: 'ffmpeg 未找到，音画已分开保存' }, identity);
        }
        fs.renameSync(tmpVideo, outMp4);
        return Object.assign({ saved: outMp4 }, identity);
    } catch(err){
        try{ if(fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo); }catch(e){}
        try{ if(fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); }catch(e){}
        throw err;
    }
}

// 读请求体：限长（超了直接 413，别让无上限的拼接把内存吃光），
// 并兜住回调里抛出的异常（否则 async 回调的 reject 会变成 unhandledRejection）
// 限长按「字节」算：一个中文字符在 UTF-8 里占 3 字节，按字符串长度算会放过 3 倍的实际内存
function readBody(req, res, limit, onDone){
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', chunk => {
        if(tooBig) return;
        size += chunk.length;
        if(size > limit){
            tooBig = true;
            chunks.length = 0;
            // 不能在这里 req.destroy()：会把还没 flush 的响应一起掐掉，客户端只看到
            // ECONNRESET，根本不知道是体积超限。正确做法是先把 413 发完，
            // 再把剩下的请求体读掉丢弃（内存已经不攒了），连接由 Connection: close 收尾。
            try{
                res.writeHead(413, {'Content-Type':'application/json', 'Connection':'close'});
                res.end(JSON.stringify({ ok:false, error:'request body too large' }));
            }catch(e){}
            req.resume();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if(tooBig) return;
        const body = Buffer.concat(chunks).toString('utf8');
        Promise.resolve().then(() => onDone(body)).catch(err => {
            console.error('handler failed', err);
            try{
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error: err.message }));
            }catch(e){}
        });
    });
}

const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin || '');
    const trusted = !origin
        || /^https?:\/\/([\w-]+\.)*bilibili\.com(:[0-9]+)?$/i.test(origin)
        || /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?$/i.test(origin);
    if(!trusted){
        res.writeHead(403, {'Content-Type':'text/plain'});
        res.end('forbidden origin');
        return;
    }
    // 防 DNS rebinding：恶意域名可以把自己解析到 127.0.0.1 并绕过 Origin 检查（同源，
    // Origin 为空或是自己的域名），所以再核对 Host 头 —— 服务只绑 127.0.0.1，正常请求的
    // Host 只可能是 127.0.0.1 / localhost / [::1]。
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if(hostHeader && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader)){
        res.writeHead(403, {'Content-Type':'text/plain'});
        res.end('forbidden host');
        return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if(req.method === 'OPTIONS'){
        res.writeHead(204);
        res.end();
        return;
    }

    if(req.method === 'POST' && req.url === '/check'){
        readBody(req, res, 5 * 1024 * 1024, body => {
            let payload;
            try{
                payload = JSON.parse(body);
            }catch(e){
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ ok:false, error:'invalid json' }));
                return;
            }
            const rawUrls = Array.isArray(payload.urls) ? payload.urls : [];
            const results = rawUrls.map(u => ({ url: u, exists: imageExistsOnDisk(u) }));
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok:true, results }));
        });
        return;
    }

    if(req.method === 'POST' && req.url === '/save'){
        readBody(req, res, 50 * 1024 * 1024, async body => {
            let payload;
            try{
                payload = JSON.parse(body);
            }catch(e){
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ ok:false, error:'invalid json' }));
                return;
            }

            const results = [];

            if(Array.isArray(payload.files) && payload.files.length){
                for(let i = 0; i < payload.files.length; i++){
                    const file = payload.files[i];
                    try{
                        const saved = await saveBase64File(file, i + 1);
                        results.push({ filename: file.filename, saved });
                        console.log('Saved base64 file', file.filename, '->', saved);
                    }catch(err){
                        console.error('Failed to save base64 file', file && file.filename, err.message);
                        results.push({ filename: file && file.filename, error: err.message });
                    }
                }
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:true, results }));
                return;
            }

            const rawUrls = Array.isArray(payload.urls) ? payload.urls : [];
            if(!rawUrls.length){
                res.writeHead(400, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error:'no urls or files provided' }));
                return;
            }
            const dlTimeout = Math.max(5000, parseInt(payload.timeout, 10) || 30000);
            const dlDedupe = (payload.dedupe != null) ? !!payload.dedupe : true;
            const dlInterval = Math.max(0, parseInt(payload.interval, 10) || 0);
            const dlOpts = { timeout: dlTimeout, dedupe: dlDedupe };


            const seen = new Set();
            const urls = [];
            const requestIdx = [];                 // urls[i] 对应请求里的第几项（去重后下标会错位，得单独记）
            for(let ri = 0; ri < rawUrls.length; ri++){
                const n = normalizeImageUrl(rawUrls[ri]);
                if(n && !seen.has(n)){
                    seen.add(n);
                    urls.push(n);
                    requestIdx.push(ri);
                }
            }
            if(!urls.length){
                res.writeHead(400, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error:'no valid image urls' }));
                return;
            }


            let idx = 0;
            const concurrency = Math.min(CONCURRENCY, urls.length);
            async function worker(){
                while(idx < urls.length){
                    const i = idx++;
                    const u = urls[i];
                    try{
                        const result = await tryDownloadFile(u, i + 1, dlOpts);
                        // 按下标落位并带上请求下标：并发完成顺序 ≠ 请求顺序，
                        // 客户端要据此把「已下载」标回正确的那张图（url 可能是 webp→jpg 变体，认不回来）
                        results[i] = Object.assign({ idx: requestIdx[i] }, result);
                        if(result.exists) console.log('Exists (skip)', result.saved);
                        else console.log('Saved', result.url, '->', result.saved);
                    }catch(err){
                        console.error('Failed', u, err.message);
                        results[i] = { idx: requestIdx[i], url: u, error: err.message };
                    }
                    if(dlInterval > 0) await new Promise(r => setTimeout(r, dlInterval));
                }
            }
            await Promise.all(Array.from({ length: concurrency }, () => worker()));

            const saved = results.filter(r => r.saved && !r.error && !r.exists).length;
            const exists = results.filter(r => r.exists).length;
            const failed = results.filter(r => r.error).length;
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok:true, total: urls.length, saved, exists, failed, results }));
        });
        return;
    }


    if(req.method === 'POST' && req.url === '/video/save'){
        readBody(req, res, 50 * 1024 * 1024, body => {
            let payload;
            try{ payload = JSON.parse(body); }catch(e){
                res.writeHead(400, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error:'invalid json' }));
                return;
            }
            const videos = Array.isArray(payload.videos) ? payload.videos : [];
            if(!videos.length){
                res.writeHead(400, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error:'no videos provided' }));
                return;
            }
            const force = !!payload.force;                     // 客户端点了「🔄 重下」：跳过查重，重下并覆盖同名文件
            const jobId = (payload.jobId && String(payload.jobId).trim()) || ('job_' + (++videoJobSeq));
            if(videoJobs.size > 20){ videoJobs.delete(videoJobs.keys().next().value); }
            const job = {
                jobId, total: videos.length, done: 0,
                currentIndex: -1, currentTitle: '',
                phase: 'pending', message: '', bytes: 0, bytesTotal: 0,
                finished: false, summary: null
            };
            videoJobs.set(jobId, job);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok:true, jobId }));
            (async () => {
                const results = [];                       // 下标 = 请求里的下标，避免并发完成顺序打乱对应关系
                let idx = 0;
                const concurrency = Math.min(2, videos.length);
                async function worker(){
                    while(idx < videos.length){
                        const i = idx++;
                        const v = videos[i];
                        job.currentIndex = i;
                        job.currentTitle = (v && v.title) || '';
                        job.phase = 'downloading';
                        job.bytes = 0; job.bytesTotal = 0;
                        try{
                            const result = await saveVideo(v, i + 1, job, force);
                            results[i] = result;                  // 按下标落位：返回顺序必须与请求顺序一致
                            job.done++;
                            if(result.exists) console.log('Video exists (skip)', result.saved);
                            else if(result.separate) console.log('Video saved (separate streams)', result.saved, '+', result.audio);
                            else console.log('Video saved', result.saved);
                        }catch(err){
                            console.error('Video failed', v && v.title, err.message);
                            results[i] = { title: (v && v.title) || '', bvid: (v && v.bvid) || '', cid: (v && v.cid != null ? v.cid : null), multiPart: !!(v && v.multiPart), error: err.message };
                            job.done++;
                        }
                    }
                }
                await Promise.all(Array.from({ length: concurrency }, () => worker()));
                const saved = results.filter(r => r.saved && !r.error && !r.exists && !r.separate).length;
                const separate = results.filter(r => r.separate).length;
                const exists = results.filter(r => r.exists).length;
                const failed = results.filter(r => r.error).length;
                job.phase = 'done';
                job.message = '全部完成';
                job.finished = true;
                job.summary = { ok:true, total: videos.length, saved, separate, exists, failed, results };
            })().catch(err => {
                job.phase = 'error';
                job.message = err.message;
                job.finished = true;
                job.summary = { ok:false, error: err.message };
            });
        });
        return;
    }

    if(req.method === 'GET' && req.url.indexOf('/video/progress') === 0){
        let q = '';
        try{
            const u = new URL(req.url, 'http://localhost');
            q = u.searchParams.get('job') || '';
        }catch(e){}
        const p = videoJobs.get(q);
        if(!p){
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok:false, error:'job not found' }));
            return;
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({
            ok:true, jobId: p.jobId, total: p.total, done: p.done,
            currentIndex: p.currentIndex, currentTitle: p.currentTitle,
            phase: p.phase, message: p.message, bytes: p.bytes, bytesTotal: p.bytesTotal,
            finished: p.finished, summary: p.summary
        }));
        return;
    }

    if(req.method === 'POST' && req.url === '/setdir'){
        readBody(req, res, 1024 * 1024, body => {
            try{
                const p = JSON.parse(body);
                const dir = (p && p.dir && String(p.dir).trim()) || '';
                // 传空目录 = 恢复默认（桌面「B站下载」）：删掉持久化设置并回退
                const target = dir ? path.resolve(dir) : resolveDefaultOutDir();
                OUT_DIR = target;
                fs.mkdirSync(OUT_DIR, { recursive: true });
                VIDEO_OUT_DIR = path.join(OUT_DIR, 'videos');
                fs.mkdirSync(VIDEO_OUT_DIR, { recursive: true });
                try{
                    if(dir) fs.writeFileSync(DIR_FILE, OUT_DIR, 'utf8');
                    else if(fs.existsSync(DIR_FILE)) fs.unlinkSync(DIR_FILE);
                }catch(e){}
                console.log('保存目录已更新为', OUT_DIR);
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:true, dir: OUT_DIR, reset: !dir }));
            }catch(e){
                res.writeHead(400, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok:false, error:'invalid json' }));
            }
        });
        return;
    }

    if(req.method === 'GET' && req.url === '/getdir'){
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, dir: OUT_DIR }));
        return;
    }


    if(req.method === 'GET' && req.url === '/qr'){
        const qr = resolveQrPath();
        if(qr){
            const ext = path.extname(qr).toLowerCase();
            const type = ext === '.png' ? 'image/png'
                : ext === '.gif' ? 'image/gif'
                : ext === '.webp' ? 'image/webp'
                : 'image/jpeg';
            res.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-cache'});
            res.end(fs.readFileSync(qr));
        } else {
            res.writeHead(404, {'Content-Type':'text/plain'});
            res.end('qr not found (place your QR image in the watermark/ folder)');
        }
        return;
    }

    if(req.method === 'GET' && req.url.startsWith('/img/')){
        let name;
        try{
            name = path.basename(decodeURIComponent(req.url.slice(5)));
        }catch(e){
            res.writeHead(400, {'Content-Type':'text/plain'});
            res.end('bad request');
            return;
        }
        const filePath = path.join(OUT_DIR, name);
        if(!filePath.startsWith(OUT_DIR + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()){
            res.writeHead(404, {'Content-Type':'text/plain'});
            res.end('not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg';
        res.writeHead(200, {'Content-Type':type});
        res.end(fs.readFileSync(filePath));
        return;
    }

    if(req.method === 'GET' && req.url === '/video/list'){
        let videos = [];
        try{
            videos = fs.readdirSync(VIDEO_OUT_DIR).filter(n => /\.(mp4|m4s|flv)$/i.test(n) && fs.statSync(path.join(VIDEO_OUT_DIR, n)).isFile())
                .map(n => ({ name: n, size: fs.statSync(path.join(VIDEO_OUT_DIR, n)).size }));
        }catch(e){}
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, dir: VIDEO_OUT_DIR, videos }));
        return;
    }

    // ── 下载目录浏览页（图片 + 视频，带搜索 / 筛选 / 排序）──
    // 文件清单一次性以 JSON 内联进页面，搜索与筛选全在浏览器里做（零延迟）；
    // 缩略图走 loading="lazy"，几千张也不会一次性把带宽吃光。
    if(req.method === 'GET' && (req.url === '/' || req.url.indexOf('/?') === 0)){
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const MAX_ENTRIES = 20000;                   // 上限：超出只列最近的，避免页面被撑爆

        const collect = (dir, kind, re) => {
            const out = [];
            let names = [];
            try{ names = fs.readdirSync(dir); }catch(e){ return out; }
            for(const n of names){
                if(!re.test(n)) continue;
                let st;
                try{ st = fs.statSync(path.join(dir, n)); }catch(e){ continue; }
                if(!st.isFile()) continue;
                out.push({ n, s: st.size, t: Math.round(st.mtimeMs), k: kind });
            }
            return out;
        };

        let all = collect(OUT_DIR, 'image', /\.(png|jpe?g|gif|webp|bmp|avif)$/i)
            .concat(collect(VIDEO_OUT_DIR, 'video', /\.(mp4|m4s|flv|m4a)$/i));
        all.sort((a, b) => b.t - a.t);               // 新的在前
        const truncated = all.length > MAX_ENTRIES;
        if(truncated) all = all.slice(0, MAX_ENTRIES);
        // 给每项一个 URL：图片在 /img/，视频在 /video/
        all.forEach(f => { f.u = (f.k === 'image' ? '/img/' : '/video/') + encodeURIComponent(f.n); });

        const json = JSON.stringify(all).replace(/</g, '\\u003c');   // 防 </script> 截断

        const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>下载目录 · Bilibili-Plus</title>
<style>
  :root{--bg:#f6f7f8;--surface:#fff;--surface2:#f7f8fa;--hover:#e9ebef;--border:#e5e7eb;
    --text:#18191c;--text2:#61666d;--text3:#9499a0;--accent:#00a1d6;--accent-w:#e8f6fc;
    --radius:10px;--shadow:0 1px 3px rgba(16,20,28,.07)}
  @media (prefers-color-scheme: dark){
    :root{--bg:#14161a;--surface:#1b1d23;--surface2:#22252c;--hover:#2d313a;--border:#333844;
      --text:#e9eaee;--text2:#a6abb7;--text3:#71767f;--accent:#00b3e6;--accent-w:#16323d;
      --shadow:0 1px 3px rgba(0,0,0,.4)}}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--text);font-size:14px;line-height:1.6}
  header{position:sticky;top:0;z-index:10;background:var(--surface);border-bottom:1px solid var(--border);
    padding:12px 20px;box-shadow:var(--shadow)}
  .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  h1{font-size:16px;margin:0;font-weight:600}
  .count{font-size:12px;color:var(--text3)}
  .dir{font-size:11px;color:var(--text3);word-break:break-all;margin-top:4px}
  .search{position:relative;flex:1;min-width:180px;max-width:420px}
  .search input{width:100%;padding:8px 32px 8px 32px;border:1px solid var(--border);border-radius:var(--radius);
    background:var(--surface2);color:var(--text);font-size:13px;outline:none;font-family:inherit}
  .search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-w)}
  .search .ico{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:13px;pointer-events:none}
  .search .clr{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:var(--hover);
    color:var(--text2);width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;display:none}
  .search.has-val .clr{display:block}
  .seg{display:flex;gap:2px;padding:3px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius)}
  .seg button{border:none;background:transparent;color:var(--text2);padding:5px 12px;border-radius:7px;
    cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap;transition:.15s}
  .seg button:hover{color:var(--text)}
  .seg button[aria-pressed=true]{background:var(--surface);color:var(--accent);font-weight:600;box-shadow:var(--shadow)}
  select{border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);
    padding:6px 8px;font-size:12px;font-family:inherit;cursor:pointer;outline:none}
  main{padding:16px 20px 60px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;
    box-shadow:var(--shadow);transition:transform .15s,box-shadow .15s;position:relative;display:block;
    text-decoration:none;color:inherit}
  .card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(16,20,28,.14)}
  .thumb{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--surface2)}
  .thumb.video{object-fit:contain;background:#000}
  .badge{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.68);color:#fff;font-size:10px;
    padding:1px 6px;border-radius:999px;backdrop-filter:blur(4px)}
  .meta{padding:7px 9px}
  .name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub{font-size:10px;color:var(--text3);margin-top:2px;display:flex;justify-content:space-between;gap:6px}
  .empty{text-align:center;padding:70px 20px;color:var(--text3)}
  .empty b{display:block;font-size:15px;color:var(--text2);margin-bottom:6px}
  mark{background:#ffe58f;color:inherit;border-radius:2px;padding:0 1px}
  @media (prefers-color-scheme: dark){mark{background:#6b5a1e;color:#fff}}
</style></head>
<body>
<header>
  <div class="row">
    <h1>下载目录</h1>
    <span class="count" id="count"></span>
    <div class="search" id="searchWrap">
      <span class="ico">🔍</span>
      <input id="q" type="search" placeholder="搜索文件名…（按 / 聚焦，Esc 清空）" autocomplete="off">
      <button class="clr" id="clr" title="清空">✕</button>
    </div>
    <div class="seg" id="kind">
      <button data-k="all" aria-pressed="true">全部</button>
      <button data-k="image" aria-pressed="false">图片</button>
      <button data-k="video" aria-pressed="false">视频</button>
    </div>
    <select id="sort">
      <option value="new">最新优先</option>
      <option value="old">最旧优先</option>
      <option value="name">文件名 A→Z</option>
      <option value="size">体积从大到小</option>
    </select>
  </div>
  <div class="dir">${esc(OUT_DIR)}　·　视频：${esc(VIDEO_OUT_DIR)}${truncated ? '　·　⚠️ 文件太多，只列出最近 ' + MAX_ENTRIES + ' 个' : ''}</div>
</header>
<main><div class="grid" id="grid"></div><div class="empty" id="empty" hidden></div></main>
<script>
const FILES = ${json};
const $ = id => document.getElementById(id);
const grid = $('grid'), empty = $('empty');
let kind = 'all', sortBy = 'new', q = '';

const fmtSize = b => b < 1024 ? b + ' B'
  : b < 1048576 ? (b / 1024).toFixed(1) + ' KB'
  : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB'
  : (b / 1073741824).toFixed(2) + ' GB';
const fmtTime = t => {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// 命中高亮：把匹配片段包进 <mark>
function highlight(name, needle){
  if(!needle) return escHtml(name);
  const i = name.toLowerCase().indexOf(needle);
  if(i < 0) return escHtml(name);
  return escHtml(name.slice(0, i)) + '<mark>' + escHtml(name.slice(i, i + needle.length)) + '</mark>' +
         escHtml(name.slice(i + needle.length));
}

function apply(){
  const needle = q.trim().toLowerCase();
  let list = FILES.filter(f => {
    if(kind !== 'all' && f.k !== kind) return false;
    if(needle && f.n.toLowerCase().indexOf(needle) < 0) return false;
    return true;
  });
  if(sortBy === 'new') list.sort((a, b) => b.t - a.t);
  else if(sortBy === 'old') list.sort((a, b) => a.t - b.t);
  else if(sortBy === 'name') list.sort((a, b) => a.n.localeCompare(b.n, 'zh'));
  else if(sortBy === 'size') list.sort((a, b) => b.s - a.s);

  const imgs = list.filter(f => f.k === 'image').length;
  $('count').textContent = '共 ' + list.length + ' 个' +
    (list.length !== FILES.length ? '（已筛选，全部 ' + FILES.length + ' 个）' : '') +
    (list.length && kind === 'all' ? ' · 图片 ' + imgs + ' · 视频 ' + (list.length - imgs) : '');

  if(!list.length){
    grid.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = FILES.length
      ? '<b>没有匹配的文件</b>试试别的关键词，或把类型切回「全部」'
      : '<b>还是空的</b>去 B 站页面触发一次下载吧';
    return;
  }
  empty.hidden = true;
  // 用字符串拼接一次写入，比逐个 appendChild 快得多
  grid.innerHTML = list.map(f => {
    const isV = f.k === 'video';
    return '<a class="card" href="' + f.u + '" target="_blank" rel="noopener" title="' + escHtml(f.n) + '">' +
      (isV
        ? '<video class="thumb video" src="' + f.u + '" preload="metadata" muted></video>'
        : '<img class="thumb" src="' + f.u + '" loading="lazy" decoding="async" alt="">') +
      '<span class="badge">' + (isV ? '视频' : '图片') + '</span>' +
      '<div class="meta"><div class="name">' + highlight(f.n, needle) + '</div>' +
      '<div class="sub"><span>' + fmtSize(f.s) + '</span><span>' + fmtTime(f.t) + '</span></div></div></a>';
  }).join('');
}

$('q').addEventListener('input', e => {
  q = e.target.value;
  $('searchWrap').classList.toggle('has-val', !!q);
  apply();
});
$('clr').addEventListener('click', () => {
  $('q').value = ''; q = ''; $('searchWrap').classList.remove('has-val'); $('q').focus(); apply();
});
$('kind').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if(!b) return;
  kind = b.dataset.k;
  [...$('kind').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  apply();
});
$('sort').addEventListener('change', e => { sortBy = e.target.value; apply(); });

// 键盘：/ 聚焦搜索，Esc 清空
document.addEventListener('keydown', e => {
  if(e.key === '/' && document.activeElement !== $('q')){ e.preventDefault(); $('q').focus(); }
  else if(e.key === 'Escape' && document.activeElement === $('q')){ $('q').value=''; q=''; $('searchWrap').classList.remove('has-val'); apply(); }
});

apply();
</script>
</body></html>`;
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
        res.end(html);
        return;
    }

    // 视频文件（相册页里的视频卡片点开就是它）
    if(req.method === 'GET' && req.url.indexOf('/video/') === 0){
        let name;
        try{ name = path.basename(decodeURIComponent(req.url.slice(7))); }
        catch(e){ res.writeHead(400, {'Content-Type':'text/plain'}); res.end('bad request'); return; }
        const full = path.join(VIDEO_OUT_DIR, name);
        if(!full.startsWith(VIDEO_OUT_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()){
            res.writeHead(404, {'Content-Type':'text/plain'}); res.end('not found'); return;
        }
        const ext = path.extname(full).toLowerCase();
        const type = ext === '.mp4' ? 'video/mp4' : ext === '.m4s' ? 'video/mp4'
            : ext === '.m4a' ? 'audio/mp4' : ext === '.flv' ? 'video/x-flv' : 'application/octet-stream';
        const st = fs.statSync(full);
        // 支持 Range：拖进度条 / 播放器要它
        const range = req.headers.range;
        if(range){
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            if(m){
                const start = m[1] ? parseInt(m[1], 10) : 0;
                const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
                if(start <= end && start < st.size){
                    res.writeHead(206, {
                        'Content-Type': type, 'Accept-Ranges': 'bytes',
                        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
                        'Content-Length': end - start + 1
                    });
                    fs.createReadStream(full, { start, end }).pipe(res);
                    return;
                }
            }
        }
        res.writeHead(200, {'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes'});
        fs.createReadStream(full).pipe(res);
        return;
    }

    res.writeHead(404);
    res.end();
});

server.on('error', (e)=>{
    if(e && e.code === 'EADDRINUSE'){
        console.error(`端口 ${PORT} 已被占用：可能已经有一个保存服务在运行，或别的程序占了这个端口。`);
        console.error(`Port ${PORT} is already in use. Close the other program / server window, then retry.`);
    } else {
        console.error('server error', e);
    }
    process.exit(1);
});

if(require.main === module){
    server.listen(PORT, '127.0.0.1', ()=>{
        console.log(`save_images_server listening on http://127.0.0.1:${PORT}, output directory: ${OUT_DIR}`);
        const qr = resolveQrPath();
        console.log(`[check] 打赏收款码(兼容 /qr): ${qr ? 'OK (' + path.basename(qr) + ')' : '无（脚本已内嵌收款码，不影响使用）'}`);
    });
}

process.on('uncaughtException', (e)=>{
    console.error('uncaught', e);
    // 进程级未捕获异常说明状态已经不可信（写流没关、半成品文件还在、定时器还在跑）。
    // 记完就退出，让「一键启动.bat」重开一个干净的服务，别带着坏状态继续接请求。
    process.exit(1);
});
process.on('unhandledRejection', (e)=>{ console.error('unhandledRejection', e); });

// 导出纯函数供单测使用（被 require 时不会监听端口）
module.exports = {
    PORT,
    sanitizeFilename,
    fileNameFromUrl,
    normalizeVideoExt,
    normalizeImageUrl,
    extensionFromUrl,
    assertInsideDir,
    safeJoin,
    server
};
