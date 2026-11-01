/**
 * 本地服务单测（运行：node tests/server.test.js）
 *
 * 重点盯防「请求体里的字符串被拼成路径」这一类越界写入：ext / 文件名 / 目标目录。
 * 这些函数是纯函数，require 服务模块时不会监听端口（listen 只在直接运行时发生）。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// require 之前先指定保存目录，免得测试真在桌面建「B站下载」
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-server-test-'));
process.env.BILI_SAVE_DIR = TMP;

const S = require('../save_images_server.js');
const BS = require('../src/lib/browser-save.js');

let passed = 0;
const check = (name, fn) => {
    try {
        fn();
        passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        console.error('  FAIL ' + name + '\n       ' + e.message);
        process.exitCode = 1;
    }
};

console.log('save_images_server 单测');

check('被 require 时不监听端口（端口留给真正启动的那次）', () => {
    assert.strictEqual(S.server.listening, false);
});

check('normalizeVideoExt：只放行扩展名，带路径/多段的输入一律退回 mp4', () => {
    assert.strictEqual(S.normalizeVideoExt('mp4'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('.M4S'), 'm4s');
    assert.strictEqual(S.normalizeVideoExt('mp4'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt(null), 'mp4');
    assert.strictEqual(S.normalizeVideoExt(''), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('..\\..\\..\\pwn'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('x/../../pwn'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('a.b'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('mp4.exe'), 'mp4');
});

check('assertInsideDir：目录内放行，越界一律拒绝', () => {
    const videoDir = path.join(TMP, 'videos');
    const inside = path.join(videoDir, 'ok.mp4');
    assert.strictEqual(S.assertInsideDir(videoDir, inside), path.resolve(inside));
    // ".tmp_1_v.a/../../../pwn" 会被 path.join 归一化成保存目录之外
    const escape = path.join(videoDir, '.tmp_1_1_v...a', '..', '..', '..', 'pwn');
    assert.throws(() => S.assertInsideDir(videoDir, escape), /拒绝越界写入/);
    assert.throws(() => S.assertInsideDir(videoDir, path.join(TMP, 'other', 'x.mp4')), /拒绝越界写入/);
});

check('safeJoin：先把名字净化掉，再保证不出目录', () => {
    assert.strictEqual(S.safeJoin(TMP, 'ok.png'), path.resolve(TMP, 'ok.png'));
    assert.strictEqual(S.safeJoin(TMP, '..\\..\\pwn.jpg'), path.resolve(TMP, '____pwn.jpg'));
    assert.strictEqual(S.safeJoin(TMP, '/etc/passwd'), path.resolve(TMP, '_etc_passwd'));
});

check('fileNameFromUrl：解码 + 去缩略参数 + 净化，穿越字符不残留', () => {
    assert.strictEqual(S.fileNameFromUrl('https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp'), 'c2c33ea113.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://i1.hdslb.com/bfs/archive/5242750857.jpg'), '5242750857.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://x.com/a/%E4%B8%AD%E6%96%87.jpg'), '中文.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://x.com/..%2F..%2Fpwn.jpg'), '____pwn.jpg');
    assert.strictEqual(S.fileNameFromUrl('not a url'), '');
});

check('fileNameFromUrl 与便携版内核同名（含 %编码 / @缩略 / 穿越 三种输入）', () => {
    const urls = [
        'https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp',
        'https://i1.hdslb.com/bfs/archive/5242750857.jpg',
        'https://x.com/a/%E4%B8%AD%E6%96%87.jpg',
        'https://x.com/..%2F..%2Fpwn.jpg',
        'https://x.com/pic.webp'
    ];
    for (const u of urls) {
        assert.strictEqual(S.fileNameFromUrl(u), BS.hashFileNameFromUrl(u), u);
    }
});

check('normalizeImageUrl：补协议 / 去缩略参数 / webp→jpg / 去 hash', () => {
    assert.strictEqual(S.normalizeImageUrl('//i0.hdslb.com/bfs/a.jpg@100w.webp'), 'https://i0.hdslb.com/bfs/a.jpg');
    assert.strictEqual(S.normalizeImageUrl('https://i0.hdslb.com/bfs/a.webp'), 'https://i0.hdslb.com/bfs/a.jpg');
    assert.strictEqual(S.normalizeImageUrl('https://i0.hdslb.com/bfs/a.jpg#frag'), 'https://i0.hdslb.com/bfs/a.jpg');
});
check('normalizeImageUrl：B 站域名的 http 升级成 https（不然会被按混合内容拦掉）', () => {
    assert.strictEqual(S.normalizeImageUrl('http://i0.hdslb.com/bfs/a.jpg'), 'https://i0.hdslb.com/bfs/a.jpg');
    assert.strictEqual(S.normalizeImageUrl('http://www.bilibili.com/bfs/a.jpg'), 'https://www.bilibili.com/bfs/a.jpg');
    // 第三方域名不擅自改协议
    assert.strictEqual(S.normalizeImageUrl('http://example.com/a.jpg'), 'http://example.com/a.jpg');
});

check('视频下载会逐条尝试备用 CDN 地址', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'save_images_server.js'), 'utf8');
    assert.ok(/const asUrlList = \(primary, extra\)/.test(src), '没有把 baseUrl 与 backupUrl 合成列表');
    assert.ok(/const videoUrls = asUrlList\(videoUrl, item\.videoUrls\)/.test(src), '视频地址列表没接上');
    assert.ok(/const audioUrls = audioUrl \? asUrlList\(audioUrl, item\.audioUrls\)/.test(src), '音频地址列表没接上');
    assert.ok(/const downloadAny = async \(urls, dest, phase, message\)/.test(src), '缺「逐个地址重试」的实现');
    assert.ok(/await downloadAny\(videoUrls, tmpVideo/.test(src), '视频没用重试逻辑');
    assert.ok(/await downloadAny\(audioUrls, tmpAudio/.test(src), '音频没用重试逻辑');
});

// 「🔄 重下」靠 force 打通三个环节：读请求体 → 跳过查重 → 传进保存流程
check('视频支持 force 重下（跳过查重、覆盖同名文件）', () => {    const src = fs.readFileSync(path.join(__dirname, '..', 'save_images_server.js'), 'utf8');
    assert.ok(/const force = !!payload\.force;/.test(src), '/video/save 没读请求体里的 force');
    assert.ok(/async function saveVideo\(item, index, job, force\)/.test(src), 'saveVideo 没有接 force 参数');
    assert.ok(/if\(!force && fileHasContent\(outMp4\)\)/.test(src), 'force 没有跳过 mp4 查重');
    assert.ok(/if\(!force && audioUrl && !hasFfmpeg/.test(src), 'force 没有跳过「音画分开」产物的查重');
    assert.ok(/await saveVideo\(v, i \+ 1, job, force\)/.test(src), 'force 没传进保存流程');
});

check('图像下载结果按下标落位并回带原始请求下标（客户端据此把「已下载」标回正确的图）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'save_images_server.js'), 'utf8');
    assert.ok(/const requestIdx = \[\];/.test(src), '没有记录「去重后下标 → 原始请求下标」的映射');
    assert.ok(/results\[i\] = Object\.assign\(\{ idx: requestIdx\[i\] \}, result\)/.test(src), '/save 没有按下标落位');
    assert.ok(/results\[i\] = \{ idx: requestIdx\[i\], url: u, error: err\.message \}/.test(src), '失败项也没带 idx');
});

// ── HTTP 层：Host / Origin 校验（真起一个临时端口，不碰 8765）──
const http = require('http');

const checkAsync = async (name, fn) => {
    try {
        await fn();
        passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        console.error('  FAIL ' + name + '\n       ' + e.message);
        process.exitCode = 1;
    }
};

function request(port, { path: reqPath = '/getdir', headers = {}, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
        const hdrs = Object.assign({}, headers);
        if (body) {
            hdrs['Content-Type'] = 'application/json';
            hdrs['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers: hdrs }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                resolve({ status: res.statusCode, headers: res.headers, raw, body: raw.toString('utf8') });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

(async () => {
    let port = 0;
    try {
        port = await new Promise((resolve, reject) => {
            S.server.once('error', reject);
            S.server.listen(0, '127.0.0.1', () => resolve(S.server.address().port));
        });
    } catch (e) {
        console.error('  FAIL 起临时端口失败：' + e.message);
        process.exitCode = 1;
    }

    if (port) {
        await checkAsync('Host 是本机时正常放行', async () => {
            const r = await request(port, { headers: { Host: '127.0.0.1:' + port } });
            assert.strictEqual(r.status, 200);
            assert.ok(JSON.parse(r.body).ok);
        });
        await checkAsync('Host 是恶意域名时拒绝（防 DNS rebinding）', async () => {
            const r = await request(port, { headers: { Host: 'evil.example.com' } });
            assert.strictEqual(r.status, 403);
            assert.ok(/forbidden host/.test(r.body), '没走到 Host 校验分支');
        });
        await checkAsync('Origin 是非 B 站域名时拒绝', async () => {
            const r = await request(port, { headers: { Host: '127.0.0.1:' + port, Origin: 'https://evil.example.com' } });
            assert.strictEqual(r.status, 403);
        });
        await checkAsync('Origin 是 bilibili.com 时放行', async () => {
            const r = await request(port, { headers: { Host: '127.0.0.1:' + port, Origin: 'https://www.bilibili.com' } });
            assert.strictEqual(r.status, 200);
        });
        await checkAsync('请求体超过上限时返回 413 而不是把连接掐断（客户端要看得懂原因）', async () => {
            const big = JSON.stringify({ dir: 'x'.repeat(1.5 * 1024 * 1024) });
            const r = await request(port, { path: '/setdir', method: 'POST', body: big });
            assert.strictEqual(r.status, 413);
            assert.ok(/too large/.test(r.body), '响应体里没有说明原因');
        });

        // ── 下载目录页（用户打开 http://127.0.0.1:8765/ 看到的那个页面）──
        await checkAsync('下载目录页：列出图片与视频，带搜索框和类型筛选', async () => {
            const r = await request(port, { path: '/' });
            assert.strictEqual(r.status, 200);
            assert.ok(/text\/html/.test(r.headers['content-type'] || ''), 'Content-Type 不是 html');
            assert.ok(/id="q"/.test(r.body), '缺搜索框 id="q"');
            assert.ok(/data-t="video"|'video'|"video"/.test(r.body), '缺视频类型筛选');
            assert.ok(/数据|download|相册|目录/.test(r.body), '页面看着不像下载目录');
        });
        await checkAsync('下载目录页：文件名里的特殊字符不会破坏页面', async () => {
            // Windows 文件名不能含 < > "，用 & ' # % 这几个合法但敏感的字符
            const evil = "xss-&'-1#%.jpg";
            fs.writeFileSync(path.join(TMP, evil), 'a');
            try{
                const r = await request(port, { path: '/' });
                assert.strictEqual(r.status, 200);
                assert.ok(r.body.includes('xss-&'), '清单里没列出这个文件（JSON 编码坏了）');
                // 清单是内联 JSON，防 </script> 截断必须把 < 转成 \u003c（Linux 文件名可含 <）
                const src = fs.readFileSync(path.join(__dirname, '..', 'save_images_server.js'), 'utf8');
                assert.ok(/JSON\.stringify\(all\)\.replace\(\/<\/g, '\\\\u003c'\)/.test(src),
                    '清单 JSON 没做 < 转义，文件名含 </script> 会截断页面');
            } finally {
                try{ fs.rmSync(path.join(TMP, evil), { force: true }); }catch(e){}
            }
        });
        await checkAsync('视频路由：支持 Range（206），否则播放器/断点续传会失败', async () => {
            const name = '测试视频.mp4';
            const vdir = path.join(TMP, 'videos');     // 视频固定落在 <保存目录>/videos
            fs.writeFileSync(path.join(vdir, name), Buffer.alloc(1000, 7));
            try{
                const full = await request(port, { path: '/video/' + encodeURIComponent(name) });
                assert.strictEqual(full.status, 200);
                assert.ok(/video\/mp4/.test(full.headers['content-type'] || ''), 'Content-Type 不是 video/mp4');
                assert.strictEqual(full.raw.length, 1000, '整段返回长度不对');
                const part = await request(port, {
                    path: '/video/' + encodeURIComponent(name),
                    headers: { Range: 'bytes=0-99' }
                });
                assert.strictEqual(part.status, 206, 'Range 请求没回 206');
                assert.strictEqual(part.raw.length, 100, '返回长度不对');
                assert.ok(/bytes 0-99\/1000/.test(part.headers['content-range'] || ''), 'Content-Range 不对');
            } finally {
                try{ fs.rmSync(path.join(vdir, name), { force: true }); }catch(e){}
            }
        });
        await checkAsync('视频路由：名字越界（../）一律拒绝', async () => {
            const r = await request(port, { path: '/video/..%2F..%2Fetc%2Fpasswd' });
            assert.ok(r.status === 400 || r.status === 403 || r.status === 404, '越界请求没被拒绝：' + r.status);
        });

        // ── 大视频：超时必须是「没有新数据」而不是「总共下太久」──
        // 一个 4K 视频几 GB，慢网速下正常就要下半小时以上。用绝对超时会全部判死。
        const slowServer = http.createServer((req, res) => {
            const mode = req.url === '/stall' ? 'stall' : 'slow';
            const chunk = Buffer.alloc(64 * 1024, 7);
            const total = 10;                                  // 声明的总长：10 × 64KB
            const sendUpTo = mode === 'slow' ? total : 4;      // stall：只发 4 块就停住（一半不到）
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(chunk.length * total) });
            let sent = 0;
            const timer = setInterval(() => {
                if(sent >= sendUpTo){
                    clearInterval(timer);
                    if(mode === 'slow') res.end();              // 正常结束
                    return;                                     // stall：挂着不动，既不发数据也不 end
                }
                res.write(chunk);
                sent++;
            }, 120);
            req.on('close', () => clearInterval(timer));
        });
        const slowPort = await new Promise(resolve => slowServer.listen(0, '127.0.0.1', () => resolve(slowServer.address().port)));

        await checkAsync('大视频：只要还在往下传，慢速也能一路下完（stall 超时不会杀长任务）', async () => {
            const dest = path.join(TMP, 'slow-download.mp4');
            // 总耗时约 1.2 秒，远超 500ms 的 stall 窗口；只要能下完就说明计时被重置了
            const n = await S.downloadVideoToFile('http://127.0.0.1:' + slowPort + '/slow', dest, 500);
            assert.strictEqual(n, 640 * 1024, '字节数不对：' + n);
            assert.strictEqual(fs.statSync(dest).size, 640 * 1024, '落盘大小不对');
            fs.rmSync(dest, { force: true });
        });

        await checkAsync('大视频：真的卡住（发一半不动）时按 stall 超时报错，而不是永远挂着', async () => {
            const dest = path.join(TMP, 'stall-download.mp4');
            const t0 = Date.now();
            let err = null;
            try{
                await S.downloadVideoToFile('http://127.0.0.1:' + slowPort + '/stall', dest, 500);
            }catch(e){ err = e; }
            const ms = Date.now() - t0;
            assert.ok(err, '卡住的下载居然成功了');
            assert.ok(/停滞/.test(err.message), '错误信息没说清是卡住：' + err.message);
            assert.ok(ms < 5000, '从卡住到放弃用了 ' + ms + 'ms，太久了');
            assert.ok(!fs.existsSync(dest) || fs.statSync(dest).size === 0, '卡住的下载不该留下半成品当成品');
            try{ fs.rmSync(dest, { force: true }); }catch(e){}
        });

        await checkAsync('大视频：上次异常退出留下的 .tmp_ 半成品会被清理，但不动新文件', async () => {
            const stale = path.join(TMP, 'videos', '.tmp_111_1_v.mp4');
            const fresh = path.join(TMP, 'videos', '.tmp_222_1_v.mp4');
            fs.writeFileSync(stale, Buffer.alloc(1024));
            fs.writeFileSync(fresh, Buffer.alloc(1024));
            const old = new Date(Date.now() - 48 * 3600 * 1000);
            fs.utimesSync(stale, old, old);                     // 48 小时前 = 上次残留
            S.cleanupStaleTempFiles();
            assert.ok(!fs.existsSync(stale), '48 小时前的半成品没被清掉');
            assert.ok(fs.existsSync(fresh), '刚写的临时文件被误删了');
            fs.rmSync(fresh, { force: true });
        });

        await checkAsync('大视频：文件从 50MB 涨到 200MB，内存几乎不变（真流式；整块读会线性暴涨）', async () => {
            const CHUNK = Buffer.alloc(1024 * 1024, 9);       // 源端复用同一块，不随文件大小涨
            const bigServer = http.createServer((req, res) => {
                const size = Number((req.url.match(/size=(\d+)/) || [])[1] || 0);
                res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(size) });
                let sent = 0;
                const pump = () => {
                    while(sent < size){
                        const n = Math.min(CHUNK.length, size - sent);
                        sent += n;
                        if(!res.write(CHUNK.subarray(0, n))) { res.once('drain', pump); return; }
                    }
                    res.end();
                };
                pump();
            });
            const bigPort = await new Promise(resolve => bigServer.listen(0, '127.0.0.1', () => resolve(bigServer.address().port)));
            const urlFor = size => 'http://127.0.0.1:' + bigPort + '/big.mp4?size=' + size;

            // 采样 arrayBuffers：整块读进内存时它必然 ≥ 文件大小
            const measurePeak = async(work) => {
                if(global.gc) global.gc();
                let peak = process.memoryUsage().arrayBuffers;
                const t = setInterval(() => {
                    const v = process.memoryUsage().arrayBuffers;
                    if(v > peak) peak = v;
                }, 10);
                try{ await work(); } finally { clearInterval(t); }
                return peak;
            };
            const dest = path.join(TMP, 'big-stream.mp4');
            const MB = 1048576;
            try{
                const peak50 = await measurePeak(async() => {
                    const n = await S.downloadVideoToFile(urlFor(50 * MB), dest, 5000);
                    assert.strictEqual(n, 50 * MB, '50MB 下载字节数不对');
                });
                const peak200 = await measurePeak(async() => {
                    const n = await S.downloadVideoToFile(urlFor(200 * MB), dest, 5000);
                    assert.strictEqual(n, 200 * MB, '200MB 下载字节数不对');
                });
                assert.strictEqual(fs.statSync(dest).size, 200 * MB, '落盘大小不对');
                // 对照组：同样 200MB，整块读进内存
                const peakWhole = await measurePeak(async() => {
                    const r = await fetch(urlFor(200 * MB));
                    const b = await r.arrayBuffer();
                    if(b.byteLength !== 200 * MB) throw new Error('对照下载字节数不对');
                });

                const toMB = v => (v / MB).toFixed(1);
                console.log('       （流式 50MB→' + toMB(peak50) + 'MB，流式 200MB→' + toMB(peak200)
                    + 'MB，整块 200MB→' + toMB(peakWhole) + 'MB）');
                assert.ok(peakWhole > 150 * MB, '对照组没有整块进内存，对比不成立：' + toMB(peakWhole) + 'MB');
                assert.ok(peak200 - peak50 < 50 * MB,
                    '文件大了 150MB，内存也涨了 ' + toMB(peak200 - peak50) + 'MB，说明没在流式写盘');
            } finally {
                try{ bigServer.close(); }catch(e){}
                try{ fs.rmSync(dest, { force: true }); }catch(e){}
            }
        });

        try{ slowServer.close(); }catch(e){}

        await new Promise(resolve => S.server.close(resolve));
    }

    try {
        fs.rmSync(TMP, { recursive: true, force: true });
    } catch (e) { /* 临时目录删不掉不影响结果 */ }

    console.log('通过 ' + passed + ' 项' + (process.exitCode ? '，有失败 ❌' : '，全部通过 ✅'));
})();
