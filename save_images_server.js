                                                                      
                                     
                                                                                                  
                                                                              

const http = require('http');
const fs = require('fs');
const path = require('path');

                                                                 
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

                                                             
                                               
       
                                                                
                                             
let OUT_DIR = (process.env.BILI_SAVE_DIR && process.env.BILI_SAVE_DIR.trim())
    ? path.resolve(process.env.BILI_SAVE_DIR)
    : (process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'bilibili_images'));
if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function extensionFromUrl(u){
    try{
        const parsed = new URL(u);
        const ext = path.extname(parsed.pathname);
        if(ext) return ext;
    }catch(e){}
    return '.jpg';
}

function sanitizeFilename(name){
    return name.replace(/[^a-z0-9._-]/gi, '_');
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

async function downloadToFile(fileUrl, destPath){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
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

async function tryDownloadFile(rawUrl, index){
    const url = normalizeImageUrl(rawUrl);
    const variants = [url];
    const jpgVariant = getWebpToJpgVariant(url);
    if(jpgVariant && jpgVariant !== url) variants.unshift(jpgVariant);

    let lastError;
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
                                    
            if(fs.existsSync(outPath) && fs.statSync(outPath).size > 0){
                return { url: candidate, saved: outPath, exists: true };
            }
            const result = await downloadToFile(candidate, outPath);
            return { url: candidate, saved: outPath, contentType: result.contentType };
        }catch(err){
            lastError = err;
            console.warn('Download failed for', candidate, err.message);
        }
    }
    throw lastError || new Error('Download failed');
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if(req.method === 'OPTIONS'){
        res.writeHead(204);
        res.end();
        return;
    }

    if(req.method === 'POST' && req.url === '/save'){
        let body = '';
        req.on('data', chunk => body += chunk);
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
                        const result = await tryDownloadFile(u, i + 1);
                        results.push(result);
                        if(result.exists) console.log('Exists (skip)', result.saved);
                        else console.log('Saved', result.url, '->', result.saved);
                    }catch(err){
                        console.error('Failed', u, err.message);
                        results.push({ url: u, error: err.message });
                    }
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

    if(req.method === 'GET' && req.url === '/'){
        res.writeHead(200, {'Content-Type':'text/plain'});
        res.end('save_images_server running');
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, '127.0.0.1', ()=>{
    console.log(`save_images_server listening on http://127.0.0.1:${PORT}, output directory: ${OUT_DIR}`);
    if(!resolveQrPath()){
        console.log('[warn] 未在 watermark/ 目录找到收款码，打赏面板将不显示收款码。请放置 wechat_qr.jpg/png（勿删除本目录）。');
    }
});

process.on('uncaughtException', (e)=>{ console.error('uncaught', e); });
process.on('unhandledRejection', (e)=>{ console.error('unhandledRejection', e); });
