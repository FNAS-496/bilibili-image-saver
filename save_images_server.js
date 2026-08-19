                                                                      
                                     
                                                                                                  
                                                                              

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

                                                                 
const QR_DIR = path.join(__dirname, 'watermark');
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
let OUT_DIR = (process.env.BILI_SAVE_DIR && process.env.BILI_SAVE_DIR.trim())
    ? path.resolve(process.env.BILI_SAVE_DIR)
    : (process.argv[2] ? path.resolve(process.argv[2]) : (() => {
        try{
            const persisted = fs.existsSync(DIR_FILE) ? fs.readFileSync(DIR_FILE, 'utf8').trim() : '';
            if(persisted) return path.resolve(persisted);
        }catch(e){}
        return path.join(__dirname, 'bilibili_images');
    })());
if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const VIDEO_DIR = path.join(OUT_DIR, 'videos');
if(!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

let VIDEO_OUT_DIR = VIDEO_DIR;

function extensionFromUrl(u){
    try{
        const parsed = new URL(u);
        const ext = path.extname(parsed.pathname);
        if(ext) return ext;
    }catch(e){}
    return '.jpg';
}

function sanitizeFilename(name){
    let s = String(name).replace(/[^a-z0-9._-]/gi, '_').replace(/\.{2,}/g, '_');
    if(!s || s === '.' || s === '..') s = '_';
    return s;
}

function getRequestHeaders(){
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.bilibili.com/'
    };
}

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

                                  
                                                             
function normalizeImageUrl(url){
    try{
        let u = String(url).replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        if(u.startsWith('//')) u = 'https:' + u;
        const parsed = new URL(u);
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

async function saveBase64File(file, index){
    const filename = sanitizeFilename(file.filename || `image_${index}.jpg`);
    const outPath = path.join(OUT_DIR, filename);
    const buffer = Buffer.from(file.data, 'base64');
    await fs.promises.writeFile(outPath, buffer);
    return outPath;
}

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
                let base = '';
                try{
                    base = path.basename(new URL(candidate).pathname).split('@')[0];
                }catch(e){}
                base = sanitizeFilename(base);
                if(!base || base === '.' || base === '..') base = `image_${index}`;
                if(!path.extname(base)) base += ext;
                const outPath = path.join(OUT_DIR, base);
                if(dedupe && fs.existsSync(outPath) && fs.statSync(outPath).size > 0){
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

async function downloadVideoToFile(fileUrl, destPath, timeoutMs){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 600000);
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
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(destPath, buffer);
        return buffer.length;
    } catch(err){
        if(err.name === 'AbortError'){
            throw new Error('timeout');
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

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

function ffmpegAvailable(){
    return new Promise(resolve => {
        execFile(resolveFfmpeg(), ['-version'], { timeout: 5000 }, (err) => resolve(!err));
    });
}

function mergeWithFfmpeg(videoPath, audioPath, outPath){
    return new Promise((resolve, reject) => {
        execFile(resolveFfmpeg(), ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', outPath],
            { timeout: 600000 }, (err) => err ? reject(err) : resolve());
    });
}

async function saveVideo(item, index){
    const title = sanitizeFilename(String(item.title || '').trim()) || `video_${index}`;
    const base = title.length > 80 ? title.slice(0, 80) : title;
    const outMp4 = path.join(VIDEO_OUT_DIR, base + '.mp4');
    if(fs.existsSync(outMp4) && fs.statSync(outMp4).size > 0){
        return { title: item.title, saved: outMp4, exists: true };
    }

    const videoUrl = String(item.videoUrl || item.url || '').trim();
    if(!videoUrl){
        throw new Error('no video url');
    }
    const audioUrl = item.audioUrl ? String(item.audioUrl).trim() : '';
    const ext = (item.ext || 'mp4').replace(/^\./, '');

    const tmpVideo = path.join(VIDEO_OUT_DIR, `.tmp_${Date.now()}_${index}_v.${ext}`);
    const tmpAudio = path.join(VIDEO_OUT_DIR, `.tmp_${Date.now()}_${index}_a.m4a`);
    try{
        await downloadVideoToFile(videoUrl, tmpVideo);
        if(audioUrl){
            await downloadVideoToFile(audioUrl, tmpAudio);
            if(await ffmpegAvailable()){
                await mergeWithFfmpeg(tmpVideo, tmpAudio, outMp4);
                try{ fs.unlinkSync(tmpVideo); }catch(e){}
                try{ fs.unlinkSync(tmpAudio); }catch(e){}
                return { title: item.title, saved: outMp4, merged: true };
            } else {
                const vOnly = path.join(VIDEO_OUT_DIR, base + '.video.' + ext);
                const aOnly = path.join(VIDEO_OUT_DIR, base + '.audio.m4a');
                fs.renameSync(tmpVideo, vOnly);
                fs.renameSync(tmpAudio, aOnly);
                return { title: item.title, saved: vOnly, exists: false, separate: true, audio: aOnly, note: 'ffmpeg 未找到，音画已分开保存' };
            }
        } else {
            fs.renameSync(tmpVideo, outMp4);
            return { title: item.title, saved: outMp4 };
        }
    } catch(err){
        try{ if(fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo); }catch(e){}
        try{ if(fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); }catch(e){}
        throw err;
    }
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
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if(req.method === 'OPTIONS'){
        res.writeHead(204);
        res.end();
        return;
    }

    if(req.method === 'POST' && req.url === '/save'){
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if(body.length > 50 * 1024 * 1024){ req.destroy(); }
        });
        req.on('end', async () => {
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
            for(const u of rawUrls){
                const n = normalizeImageUrl(u);
                if(n && !seen.has(n)){
                    seen.add(n);
                    urls.push(n);
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
                        results.push(result);
                        if(result.exists) console.log('Exists (skip)', result.saved);
                        else console.log('Saved', result.url, '->', result.saved);
                    }catch(err){
                        console.error('Failed', u, err.message);
                        results.push({ url: u, error: err.message });
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
        let body = '';
        req.on('data', chunk => { body += chunk; if(body.length > 50 * 1024 * 1024){ req.destroy(); } });
        req.on('end', async () => {
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
            const results = [];
            let idx = 0;
            const concurrency = Math.min(2, videos.length);
            async function worker(){
                while(idx < videos.length){
                    const i = idx++;
                    const v = videos[i];
                    try{
                        const result = await saveVideo(v, i + 1);
                        results.push(result);
                        if(result.exists) console.log('Video exists (skip)', result.saved);
                        else if(result.separate) console.log('Video saved (separate streams)', result.saved, '+', result.audio);
                        else console.log('Video saved', result.saved);
                    }catch(err){
                        console.error('Video failed', v && v.title, err.message);
                        results.push({ title: v && v.title, error: err.message });
                    }
                }
            }
            await Promise.all(Array.from({ length: concurrency }, () => worker()));
            const saved = results.filter(r => r.saved && !r.error && !r.exists && !r.separate).length;
            const separate = results.filter(r => r.separate).length;
            const exists = results.filter(r => r.exists).length;
            const failed = results.filter(r => r.error).length;
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok:true, total: videos.length, saved, separate, exists, failed, results }));
        });
        return;
    }

    if(req.method === 'POST' && req.url === '/setdir'){
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try{
                const p = JSON.parse(body);
                const dir = (p && p.dir && String(p.dir).trim()) || '';
                if(dir){
                    OUT_DIR = path.resolve(dir);
                    fs.mkdirSync(OUT_DIR, { recursive: true });
                    VIDEO_OUT_DIR = path.join(OUT_DIR, 'videos');
                    fs.mkdirSync(VIDEO_OUT_DIR, { recursive: true });
                    try{ fs.writeFileSync(DIR_FILE, OUT_DIR, 'utf8'); }catch(e){}
                    console.log('保存目录已更新为', OUT_DIR);
                    res.writeHead(200, {'Content-Type':'application/json'});
                    res.end(JSON.stringify({ ok:true, dir: OUT_DIR }));
                } else {
                    res.writeHead(200, {'Content-Type':'application/json'});
                    res.end(JSON.stringify({ ok:false, error:'dir required' }));
                }
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

    if(req.method === 'GET' && req.url === '/'){
        const files = fs.readdirSync(OUT_DIR).filter(n => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n) && fs.statSync(path.join(OUT_DIR, n)).isFile());
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const items = files.map(n => `<a href="/img/${encodeURIComponent(n)}" target="_blank" title="${esc(n)}"><img src="/img/${encodeURIComponent(n)}" loading="lazy" alt="${esc(n)}"></a>`).join('\n');
        const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>图片相册 - bilibili-image-saver</title>' +
        '<style>body{font-family:system-ui,sans-serif;background:#f5f6f7;margin:0;padding:16px;}h1{font-size:18px;color:#333;}h1 small{color:#999;font-weight:normal;font-size:13px;}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:12px;}.grid a{display:block;background:#fff;border-radius:8px;padding:6px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;}.grid img{width:100%;height:150px;object-fit:cover;border-radius:6px;display:block;}.empty{color:#999;padding:40px;text-align:center;}</style></head>' +
        '<body><h1>图片相册 <small>共 ' + files.length + ' 张 · ' + esc(OUT_DIR) + '</small></h1><div class="grid">' + (items || '<div class="empty">还没有图片，去 B 站页面触发下载吧</div>') + '</div></body></html>';
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(html);
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, '127.0.0.1', ()=>{
    console.log(`save_images_server listening on http://127.0.0.1:${PORT}, output directory: ${OUT_DIR}`);
    const qr = resolveQrPath();
    console.log(`[check] 打赏收款码(兼容 /qr): ${qr ? 'OK (' + path.basename(qr) + ')' : '无（脚本已内嵌收款码，不影响使用）'}`);
});

process.on('uncaughtException', (e)=>{ console.error('uncaught', e); });
process.on('unhandledRejection', (e)=>{ console.error('unhandledRejection', e); });
