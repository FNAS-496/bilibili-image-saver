/**
 * 便携版核心单测（运行：node tests/browser-save.test.js）
 *
 * 关键点：测试直接 require 被内联进 userscript 的同一份源码；
 * 期望值由独立的 Python 实现算出（跨语言比对），不是自己验自己。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BS = require('../src/lib/browser-save.js');

const ROOT = path.join(__dirname, '..');
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

// ── 独立实现的 ZIP 结构解析（不依赖任何第三方库）──
function parseStoredZip(buf) {
    const u16 = o => buf.readUInt16LE(o);
    const u32 = o => buf.readUInt32LE(o);
    const eocd = buf.length - 22;
    assert.strictEqual(u32(eocd), 0x06054b50, 'EOCD 签名不对');
    const count = u16(eocd + 10);
    const cdSize = u32(eocd + 12);
    const cdOff = u32(eocd + 16);
    assert.strictEqual(cdOff + cdSize, eocd, '中央目录位置/长度与 EOCD 不一致');

    const entries = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
        assert.strictEqual(u32(p), 0x02014b50, '中央目录头签名不对');
        const flags = u16(p + 8);
        const method = u16(p + 10);
        const crc = u32(p + 16);
        const csize = u32(p + 20);
        const usize = u32(p + 24);
        const nlen = u16(p + 28);
        const elen = u16(p + 30);
        const clen = u16(p + 32);
        const localOff = u32(p + 42);
        const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');

        assert.strictEqual(u32(localOff), 0x04034b50, '本地头签名不对：' + name);
        assert.strictEqual(u16(localOff + 6), flags, '本地头与中央目录标志位不一致：' + name);
        assert.strictEqual(u16(localOff + 8), method, '本地头与中央目录压缩方式不一致');
        assert.strictEqual(u32(localOff + 14), crc, '本地头与中央目录 CRC 不一致');
        const lNlen = u16(localOff + 26);
        const lElen = u16(localOff + 28);
        const dataStart = localOff + 30 + lNlen + lElen;
        const data = buf.slice(dataStart, dataStart + csize);

        entries.push({
            name, flags, method, crc, csize, usize, data,
            actualCrc: BS.crc32(new Uint8Array(data))
        });
        p += 46 + nlen + elen + clen;
    }
    return entries;
}

console.log('browser-save 单测');

// ── CRC32 ──
check('crc32 标准向量（"123456789" -> 0xCBF43926）', () => {
    assert.strictEqual(BS.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
check('crc32 空输入 -> 0', () => {
    assert.strictEqual(BS.crc32(new Uint8Array(0)), 0);
});
check('crc32 期望值（0x470B99F4 / 0x3ABCFCEE）', () => {
    assert.strictEqual(BS.crc32(new Uint8Array([1, 2, 3, 4, 5])), 0x470B99F4);
    assert.strictEqual(BS.crc32(Uint8Array.from({ length: 300 }, (_, i) => i & 0xFF)), 0x3ABCFCEE);
});

// ── 文件名规则（必须与本地服务端一致，两个版本产出同样的名字）──
check('hashFileNameFromUrl：去 @ 缩略参数并转 jpg', () => {
    assert.strictEqual(
        BS.hashFileNameFromUrl('https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp'),
        'c2c33ea113.jpg');
});
check('hashFileNameFromUrl：普通原图名保持不变', () => {
    assert.strictEqual(
        BS.hashFileNameFromUrl('https://i1.hdslb.com/bfs/archive/5242750857.jpg'),
        '5242750857.jpg');
});
check('sanitizeFilename：净化非法字符、去掉结尾点与空格', () => {
    assert.strictEqual(BS.sanitizeFilename('b:ad*name?.png'), 'b_ad_name_.png');
    assert.strictEqual(BS.sanitizeFilename('name.  '), 'name');
    assert.strictEqual(BS.sanitizeFilename(''), '_');
});
check('buildZipName：时间戳格式稳定', () => {
    assert.strictEqual(
        BS.buildZipName(new Date(2026, 9, 2, 18, 15, 30)),
        'B站图片_20261002_181530.zip');
});

// ── ZIP：跨语言哈希比对 + 结构自校验 ──
const entries = [
    { name: 'abc123.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'def456.png', data: Uint8Array.from({ length: 300 }, (_, i) => i & 0xFF) }
];

const runZipChecks = async () => {
    const blob = BS.zipStore(entries);
    const buf = Buffer.from(await blob.arrayBuffer());

    check('zipStore：Blob 类型为 application/zip', () => {
        assert.strictEqual(blob.type, 'application/zip');
    });
    check('zipStore：总字节数 = 519（与 Python 实现一致）', () => {
        assert.strictEqual(buf.length, 519);
    });
    check('zipStore：SHA-256 与 Python 独立实现一致', () => {
        assert.strictEqual(
            crypto.createHash('sha256').update(buf).digest('hex'),
            '24b56099ad7fa28b7946d4f32a098f368f42a25245a1715dea3ed9dce5a5c56b');
    });
    check('zipStore：结构自校验（签名 / 偏移 / CRC / STORE 方式）', () => {
        const parsed = parseStoredZip(buf);
        assert.strictEqual(parsed.length, 2);
        assert.deepStrictEqual(parsed.map(e => e.name), ['abc123.jpg', 'def456.png']);
        for (const e of parsed) {
            assert.strictEqual(e.method, 0, '必须是 STORE（图片已压缩，不做二次压缩）');
            assert.ok(e.flags & 0x0800, 'EFS(UTF-8) 标志未设置：' + e.name);
            assert.strictEqual(e.csize, e.usize);
            assert.strictEqual(e.actualCrc, e.crc, 'CRC 字段与实际内容不符：' + e.name);
        }
        assert.deepStrictEqual([...parsed[0].data], [1, 2, 3, 4, 5]);
        assert.deepStrictEqual([...parsed[1].data], [...entries[1].data]);
    });
    const cn = Buffer.from(await BS.zipStore([{ name: '测试 图片_01.jpg', data: new Uint8Array([7]) }]).arrayBuffer());
    check('zipStore：非 ASCII 条目名声明 EFS 且能用 UTF-8 原样读回', () => {
        const parsed = parseStoredZip(cn);
        assert.strictEqual(parsed[0].name, '测试 图片_01.jpg');
        assert.ok(parsed[0].flags & 0x0800);
    });
    const empty = Buffer.from(await BS.zipStore([]).arrayBuffer());
    check('zipStore：空集合生成合法空包（22 字节 EOCD）', () => {
        assert.strictEqual(empty.length, 22);
        assert.strictEqual(empty.readUInt32LE(0), 0x06054b50);
    });
    check('zipOverheadBytes：按条目计算额外开销', () => {
        assert.strictEqual(BS.zipOverheadBytes(entries), 22 + (30 + 46) * 2 + (10 + 10) * 2);
    });
    check('planZipBatches：条目数超限自动分包（65535 + 1）', () => {
        const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: 'i' + i + '.jpg', data: new Uint8Array(0) }));
        const batches = BS.planZipBatches(many);
        assert.strictEqual(batches.length, 2);
        assert.strictEqual(batches[0].length, 0xFFFF);
        assert.strictEqual(batches[1].length, 1);
    });
    check('planZipBatches：按体积分包，单条超限单独成批', () => {
        const GB = 1024 * 1024 * 1024;
        const list = [
            { name: 'a.bin', data: { length: 3 * GB } },
            { name: 'b.bin', data: { length: 3 * GB } },
            { name: 'c.bin', data: { length: 5 * GB } }
        ];
        assert.deepStrictEqual(BS.planZipBatches(list).map(b => b.length), [1, 1, 1]);
        assert.deepStrictEqual(BS.planZipBatches(list, 2 * GB).map(b => b.length), [1, 1, 1]);
    });
    check('planZipBatches：小批量不分包', () => {
        const batches = BS.planZipBatches(entries);
        assert.strictEqual(batches.length, 1);
        assert.strictEqual(batches[0].length, entries.length);
    });
    check('zipStore：条目数超过 65535 时明确抛错（不静默产出坏包）', () => {
        const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: 'i' + i + '.jpg', data: new Uint8Array(0) }));
        assert.throws(() => BS.zipStore(many), /65535/);
    });
    check('zipStore：总大小超过 4GB 时明确抛错（不静默产出坏包）', () => {
        assert.throws(() => BS.zipStore([{ name: 'big.bin', data: { length: 4 * 1024 * 1024 * 1024 } }]), /4GB/);
    });
    check('zipStore：文件名超过 65535 字节时明确抛错', () => {
        assert.throws(() => BS.zipStore([{ name: 'x'.repeat(0x10000), data: new Uint8Array(0) }]), /文件名过长/);
    });
};

// ── 构建产物集成检查：内联与模式裁剪是否真的生效 ──
const runBuildChecks = () => {
    const portable = path.join(ROOT, '便携版', 'bilibili-save.user.js');
    const full = path.join(ROOT, 'bilibili-save.user.js');

    check('便携版：已内联库、模式正确、无遗留占位符', () => {
        assert.ok(fs.existsSync(portable), '请先运行 node build.js');
        const t = fs.readFileSync(portable, 'utf8');
        assert.ok(t.includes('__biliBrowserSave') && t.includes('function zipStore') && t.includes('function planZipBatches'), '缺少内联的 browser-save 库（函数体未真正内联？）');
        assert.ok(t.includes("const BUILD_MODE = 'portable'"), 'BUILD_MODE 不是 portable');
        assert.ok(!/@@[^@]+@@/.test(t), '仍有未替换占位符');
    });
    check('便携版：不依赖本地服务、不自动更新到环境版', () => {
        const t = fs.readFileSync(portable, 'utf8');
        assert.ok(!/@connect\s+127\.0\.0\.1/.test(t), '不应再声明 127.0.0.1');
        assert.ok(!t.includes('@updateURL'), '便携版不应自动更新');
    });
    check('环境版：保留本地服务与自动更新', () => {
        const t = fs.readFileSync(full, 'utf8');
        assert.ok(/@connect\s+127\.0\.0\.1/.test(t));
        assert.ok(t.includes('@updateURL'));
        assert.ok(t.includes("const BUILD_MODE = 'full'"));
    });
    check('内置运行环境的便携包已同步（本地存在时才检查）', () => {
        const p = path.join(ROOT, '无需环境直接安装版', 'bilibili-save.user.js');
        if (!fs.existsSync(p)) return;
        assert.ok(fs.readFileSync(p, 'utf8').includes("const BUILD_MODE = 'full'"));
    });

    // ── 媒体请求必须带 Referer：B 站视频 CDN（upos-*.bilivideo.com）不带 Referer 一律 403 ──
    // （曾经便携版用 referrerPolicy:'no-referrer' 把 Referer 删掉，导致视频一个都下不动）
    // 只看代码不看注释：整行注释会先被剥掉（注意别按 '//' 硬切，URL 里也有 '//'）
    const codeOnly = text => text.split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
    for (const [label, file] of [['便携版', portable], ['环境版', full]]) {
        check(label + '：取媒体字节不抹掉 Referer（否则视频 CDN 403）', () => {
            const code = codeOnly(fs.readFileSync(file, 'utf8'));
            assert.ok(!/referrerPolicy\s*:\s*['"]no-referrer['"]/.test(code), '不能把 Referer 剥掉');
            assert.ok(code.includes("const MEDIA_REFERER = 'https://www.bilibili.com/'"), '缺少媒体 Referer 常量');
            assert.ok(/headers:\s*\{\s*'Referer':\s*MEDIA_REFERER\s*\}/.test(code), 'GM 通道没带 Referer');
        });
        check(label + '：取字节两条通道都在（fetch 优先拿进度，GM 兜底保证能下）', () => {
            const t = fs.readFileSync(file, 'utf8');
            const at = t.indexOf('async function fetchBytes');
            const fn = t.slice(at, at + 2000);
            assert.ok(fn.includes('await fetch(url, { signal: controller.signal })'), '缺直接请求通道');
            assert.ok(t.includes('return await gmFetchBytes(url, timeoutMs, onProgress)'), '缺 GM 兜底通道');
            assert.ok(fn.includes('res.body.getReader()'), '直接请求通道没走流式读取，拿不到下载进度');
        });
        check(label + '：声明了视频 CDN 的 @connect（否则 GM 到不了 CDN）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/@connect\s+bilivideo\.com/.test(t), '缺 @connect bilivideo.com');
            assert.ok(/@connect\s+bilivideo\.cn/.test(t), '缺 @connect bilivideo.cn');
            assert.ok(/@connect\s+mountaintoys\.cn/.test(t), '缺 @connect mountaintoys.cn（B 站 P2P 边缘 CDN）');
        });
    }

    // ── 清晰度选择：便携版默认走 durl（单文件带声音，封顶 720P），
    //    用户点名更高画质时要能改走 DASH —— 这是「只能下 720P」的修复 ──
    for (const [label, file] of [['便携版', portable], ['环境版', full]]) {
        check(label + '：有清晰度选择（下拉 + 档位表 + 按目标挑流）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(t.includes('id="bili-video-quality"'), '面板里没有清晰度下拉');
            assert.ok(/const QUALITY_CHOICES = \[/.test(t), '缺 QUALITY_CHOICES 档位表');
            assert.ok(/function pickStream\(/.test(t), '缺 pickStream（按目标画质挑流）');
            assert.ok(/videoQuality: 0/.test(t), '设置里没有 videoQuality 默认值');
            assert.ok(/fetchVideoStreams\(it\.bvid, it\.cid, currentQuality\(\)\)/.test(t), '取流时没把选中的清晰度传下去');
        });
        check(label + '：取流用 fnval=4048（含 8K/HDR 高位标志），不再是 16', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/await ask\(4048, /.test(t), '没有用 fnval=4048 请求 DASH');
            assert.ok(/p\.fnval = String\(fnval\)/.test(t), 'fnval 没进请求参数');
            assert.ok(!/\bfnval='\s*\+\s*16\b|146\b(?!\d)/.test(t), '疑似还残留 fnval=16 的旧写法');
        });
        check(label + '：未登录时补 try_look=1（实测画质上限 480P → 1080P）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/if\(!logged\) p\.try_look = '1'/.test(t), '没带 try_look，未登录用户会被白白限制在 480P');
            assert.ok(/const detectLoggedIn = /.test(t), '缺登录态探测，会误伤已登录用户');
            assert.ok(/navCache = null;/.test(t), '登录态探测结果没有失效机制');
            // 严格模式下引用未声明变量会直接抛错、整块功能点不动（改名时漏改一个引用就是这样炸的）
            assert.ok(!/loggedInProbe/.test(t), '残留了已改名的 loggedInProbe：严格模式下会 ReferenceError，按钮点了没反应');
        });
        check(label + '：playurl 带 wbi 签名，但必须有未签名回退（签名不能成为单点故障）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/WB\.signQuery\(params, keys\.imgKey, keys\.subKey\)/.test(t), '没有用 wbi 签名');
            assert.ok(/const keys = await getWbiKeys\(\);/.test(t), '没取签名用的 key');
            assert.ok(/return await get\(toQuery\(params\)\);/.test(t), '没有未签名回退：签名一失效就完全取不到流');
        });
        check(label + '：标注「本视频支持、但当前账号拿不到」的档位', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/function parseBlockedQualities\(/.test(t), '缺档位标注逻辑');
            assert.ok(t.includes('需大会员'), '没标出「需大会员」');
            assert.ok(/f\.limit_watch_reason/.test(t), '没用接口给的 limit_watch_reason');
        });
        check(label + '：高音质音轨是可选项，默认仍走普通音轨（兼容性优先）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/hiResAudio: false/.test(t), '默认值应为 false —— 无损 FLAC 很多播放器不支持');
            assert.ok(/function pickAudioStream\(/.test(t), '缺音轨挑选');
            assert.ok(/best\(normal\) \|\| best\(dolby\) \|\| best\(flac\)/.test(t), '默认没优先普通音轨');
            assert.ok(/best\(flac\) \|\| best\(dolby\) \|\| best\(normal\)/.test(t), '开了高音质没优先无损 FLAC');
            assert.ok(/\(Number\(y\.id\) \|\| 0\) - \(Number\(x\.id\) \|\| 0\)/.test(t),
                '同类音轨没按 id 档位挑（实测 30232/30280 带宽字段相同，只看带宽会挑错）');
        });
        check(label + '：下载失败必须说明原因（不能只丢一个「失败 N 个」）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/function friendlyNetError\(/.test(t), '没有把网络错误翻成人话，用户只会看到 Failed to fetch');
            assert.ok(/const firstFail = results\.find\(r => r\.error\)/.test(t), '失败原因没显示出来');
            assert.ok(/it\.errorMsg = why/.test(t), '失败项没记录原因');
            assert.ok(/下载失败/.test(t), '列表项没标出哪一项下载失败');
        });
        check(label + '：面板不能超出视口（内容长了要滚动）', () => {
            const t = fs.readFileSync(file, 'utf8');
            const at = t.indexOf("panel.id = 'bili-save-settings'");
            const seg = t.slice(at, at + 900);
            assert.ok(/maxHeight:'calc\(100vh - \d+px\)'/.test(seg), '设置面板没有高度上限，内容一长就顶出屏幕');
            assert.ok(/overflowY:'auto'/.test(seg), '设置面板不会滚动，超出屏幕的按钮点不到');
            const at2 = t.indexOf("panel.id = 'bili-video-panel'");
            const seg2 = t.slice(at2, at2 + 900);
            assert.ok(/maxHeight:'calc\(100vh - \d+px\)'/.test(seg2), '视频面板高度没用视口算，小屏会顶出去');
        });
        check(label + '：一条 CDN 地址失败要自动换备用地址（B 站给 baseUrl + backupUrl）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/backupUrl \|\| item\.backup_url/.test(t), '解析时没保留 backupUrl（实测常有首个节点不通）');
            assert.ok(/async function tryUrls\(urls, fn\)/.test(t), '缺「依次尝试候选地址」的辅助函数');
            assert.ok(/videoUrls: vUrls/.test(t) && /audioUrls: aUrls/.test(t), 'DASH 结果没带地址列表');
            assert.ok(/\(durl\.backup_url \|\| durl\.backupUrl \|\| \[\]\)/.test(t), '单文件 durl 没保留备用地址');
            const uses = (t.match(/tryUrls\(it\.(video|audio)Urls \|\| \[/g) || []).length;
            assert.ok(uses >= 6, '下载路径还有没用备用地址的（当前只有 ' + uses + ' 处）');
            assert.ok(/it\.videoUrls = s\.videoUrls/.test(t), 'applyStream 没保存地址列表');
        });
        check(label + '：blob 下载只能「下载」，绝不能退化成页面导航', () => {
            const t = fs.readFileSync(file, 'utf8');
            const at = t.indexOf('function triggerBlobDownload');
            const seg = t.slice(at, at + 800);
            assert.ok(/a\.download = String\(filename \|\| ''\)\.trim\(\) \|\| '/.test(seg),
                'download 没有兜底文件名：为空时浏览器会改成「导航」到 blob 地址（blob 的 origin 就是当前站点）');
            assert.ok(/a\.rel = 'noopener'/.test(seg), '缺 rel=noopener');
            assert.ok(/a\.target = '_self'/.test(seg), '缺显式 target');
            assert.ok(/setTimeout\(\(\) => \{ try\{ a\.remove\(\); \}/.test(seg),
                'click 同一个 tick 就摘节点，下载可能还没被浏览器接住');
        });
        check(label + '：已下载的能重新下载（force 覆盖，不再被记账挡住）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/bili-video-redl/.test(t), '列表里没有「重新下载」入口');
            assert.ok(/state\.force = true/.test(t), '点「重下」没有置强制标记');
            assert.ok(/const targets = force \? picked : picked\.filter/.test(t), '强制重下时仍会被「已下载」过滤掉');
            assert.ok(/async function saveVideosInBrowser\(items, ui, opts\)/.test(t), 'saveVideosInBrowser 没接 force');
            assert.ok(/, !force, fileProgress/.test(t), '目录模式落盘没按 force 覆盖同名文件');
            assert.ok(/postJsonToPath\('\/video\/save', \{ videos, jobId, force \}\)/.test(t), '环境版没把 force 传给服务端');
        });
        check(label + '：音画合并（合并不了必须退回分开存）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/const wantMerge = it =>/.test(t), '缺合并判定');
            assert.ok(/DM\.mergeDashStreams\(vBytes, aBytes\)/.test(t), '没调用合并');
            assert.ok(/mergeNotice = true;/.test(t), '合并失败没有回退提示');
            assert.ok(/DM\.shouldMerge\(it\.size\)/.test(t), '没做体积上限判断（大文件会把标签页撑爆）');
            if (label === '便携版') {
                assert.ok(t.includes('MP4BoxLib'), '便携版没内联 MP4Box，合不了音画');
                assert.ok(t.includes('__biliDashMerge'), '便携版没内联 dash-merge');
            } else {
                assert.ok(!t.includes('BoxRegistry'), '环境版不该带上 MP4Box（白白多几百 KB）');
            }
            assert.ok(t.includes('__biliWbi'), '缺 wbi 签名模块');
        });
        check(label + '：同画质多编码时优先 avc1（不依赖 B 站返回顺序）', () => {
            const t = fs.readFileSync(file, 'utf8');
            assert.ok(/const codecRank = /.test(t), '缺编码优先级表');
            assert.ok(/codecRank\(a\.codecs\) - codecRank\(b\.codecs\)/.test(t), 'pickStream 排序没用上编码优先级');
            assert.ok(/indexOf\('avc1'\) === 0/.test(t), '没有把 avc1 排在最前');
        });
    }
    check('便携版：点名更高画质时会改用 DASH，且不比单文件更差才采用', () => {
        const code = codeOnly(fs.readFileSync(portable, 'utf8'));
        assert.ok(/parseDurlStream\(/.test(code) && /parseDashStream\(/.test(code), '缺 durl / DASH 两个解析器');
        assert.ok(/\(dashStream\.quality \|\| 0\) > \(durlStream\.quality \|\| 0\)/.test(code),
            '没有比较 durl 与 DASH 的实际画质就切换（未登录时换 DASH 反而更差）');
    });

    // ── 下载进度条：两个版本都要在「下载过程中」持续刷新，而不是下完一个文件才跳一格 ──
    for (const [label, file] of [['便携版', portable], ['环境版', full]]) {
        check(label + '：下载过程中会持续刷新进度（进度条不再不动）', () => {
            const t = fs.readFileSync(file, 'utf8');
            if (label === '便携版') {
                assert.ok(/const fileProgress = /.test(t), '缺 fileProgress（按字节折算整体进度）');
                assert.ok(/lastPaintAt/.test(t), '缺节流：每个数据块都刷 DOM 会卡');
                assert.ok(/curEstimate/.test(t), '缺预估大小兜底（服务器不给 content-length 时进度分母为 0）');
            } else {
                assert.ok(/const curFrac = /.test(t), '整体进度没把「当前文件已下比例」算进去');
            }
            assert.ok(/res\.body\.getReader\(\)/.test(t) || /reader\.read\(\)/.test(t),
                '取字节没有走流式读取，拿不到下载进度');
            assert.ok(/onProgress/.test(t), '没有进度回调');
        });
    }
}

(async () => {
    await runZipChecks();
    runBuildChecks();
    console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，存在失败 ❌' : '，全部通过 ✅'));
})();
