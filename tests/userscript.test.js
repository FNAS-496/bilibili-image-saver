/**
 * 用户脚本运行时单测（运行：node tests/userscript.test.js）
 *
 * 与其它几个测试不同，这里真的把两份产物（环境版 / 便携版）在 Node 的 vm 里
 * 完整求值一遍，只提供一个「无 DOM、无网络」的最小环境：
 *   · 顶层引用了一个不存在的变量（如重构时漏掉 const）→ 直接抛 ReferenceError，测试失败
 *   · 这让「纯文本断言查不出来、只有用户点了按钮才炸」的问题能被 CI 抓住
 *
 * 另外把脚本里不依赖 DOM 的纯函数（经 window.__BILI_PLUS_TEST__ 暴露）逐个单测。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// 最小沙箱：只给「脚本顶层 + 纯函数」真正需要的东西。
// document.readyState 故意设成 loading，于是脚本只会把 init 挂到 load 事件上，永远不跑 UI。
function makeSandbox() {
    const sandbox = {
        window: {
            __BILI_PLUS_TEST__: true,
            addEventListener() { },
            removeEventListener() { },
            location: { href: 'https://www.bilibili.com/video/BV1xx411c7mD', hostname: 'www.bilibili.com', pathname: '/video/BV1xx411c7mD' }
        },
        document: {
            readyState: 'loading',
            addEventListener() { },
            removeEventListener() { },
            documentElement: { innerHTML: '' }
        },
        localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
        navigator: { userAgent: 'node-test' },
        console: { log() { }, warn() { }, error() { }, info() { } },
        setTimeout, clearTimeout, setInterval, clearInterval,
        URL, URLSearchParams, TextEncoder, TextDecoder, Blob, AbortController,
        fetch() { return Promise.reject(new Error('测试环境不联网')); }
    };
    sandbox.self = sandbox.window;
    sandbox.globalThis = sandbox;
    return sandbox;
}

// 在沙箱里求值一份 userscript，返回它暴露的测试钩子
function loadUserscript(file) {
    const code = fs.readFileSync(file, 'utf8');
    const sandbox = makeSandbox();
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: file });
    const hooks = sandbox.window.__biliPlusTest;
    assert.ok(hooks, '脚本没有暴露 window.__biliPlusTest 钩子');
    return hooks;
}

const FULL = path.join(ROOT, 'bilibili-save.user.js');
const PORTABLE = path.join(ROOT, '便携版', 'bilibili-save.user.js');

console.log('userscript 运行时单测');

// ── 1. 两份产物都能完整求值 ──
const hooks = {};
for (const [label, file, portable] of [['环境版', FULL, false], ['便携版', PORTABLE, true]]) {
    check(label + '：在无 DOM 环境能完整求值（顶层没有未声明变量）', () => {
        assert.ok(fs.existsSync(file), '请先运行 node build.js');
        hooks[label] = loadUserscript(file);
    });
    check(label + '：构建模式正确', () => {
        assert.strictEqual(hooks[label].isPortable, portable, label + ' 的 BUILD_MODE 不对');
    });
}

// ── 2. 「下载选中」的目标挑选（曾把 skippedDone 写丢，导致下载成功后抛 ReferenceError）──
const targetCases = [
    ['跳过已下载，并统计跳过数量', [{ k: 'a' }, { k: 'b' }, { k: 'c' }], false, ['a'], { keys: ['b', 'c'], skipped: 1 }],
    ['全部已下载时目标为空', [{ k: 'a' }], false, ['a'], { keys: [], skipped: 1 }],
    ['force（🔄 重下）时一个都不跳过', [{ k: 'a' }, { k: 'b' }], true, ['a'], { keys: ['a', 'b'], skipped: 0 }],
    ['一个都没下过时 skipped 为 0', [{ k: 'a' }], false, [], { keys: ['a'], skipped: 0 }],
    ['空数组不炸', [], false, [], { keys: [], skipped: 0 }],
    ['非数组输入不炸', null, false, [], { keys: [], skipped: 0 }]
];
for (const [name, picked, force, downloadedKeys, expect] of targetCases) {
    check('planVideoTargets：' + name, () => {
        const t = hooks['环境版'].planVideoTargets(picked, force, it => downloadedKeys.indexOf(it.k) >= 0);
        assert.deepStrictEqual(Array.from(t.targets.map(it => it.k)), expect.keys);
        assert.strictEqual(t.skipped, expect.skipped, 'skipped 计数不对');
    });
}
check('planVideoTargets：不传 isDownloaded 时不会崩', () => {
    const t = hooks['环境版'].planVideoTargets([{ k: 'a' }], false);
    assert.deepStrictEqual(Array.from(t.targets.map(it => it.k)), ['a']);
    assert.strictEqual(t.skipped, 0);
});
check('planVideoTargets：force 返回的是副本，不会改动调用方数组', () => {
    const src = [{ k: 'a' }];
    const t = hooks['环境版'].planVideoTargets(src, true, () => true);
    assert.notStrictEqual(t.targets, src);
    assert.strictEqual(src.length, 1);
});

// ── 3. videoKey：多 P 必须带 cid 才能区分 ──
check('videoKey：单 P 只用 bvid', () => {
    assert.strictEqual(hooks['环境版'].videoKey({ bvid: 'BV1xx411c7mD' }), 'BV1xx411c7mD');
});
check('videoKey：多 P 带上 cid', () => {
    assert.strictEqual(hooks['环境版'].videoKey({ bvid: 'BV1xx411c7mD', multiPart: true, cid: 123 }), 'BV1xx411c7mD#123');
});
check('videoKey：空输入返回空串', () => {
    assert.strictEqual(hooks['环境版'].videoKey(null), '');
});

// ── 4. 原图地址规范化 ──
const toOriginal = hooks['环境版'].toOriginalImageUrl;
check('toOriginalImageUrl：http 升级成 https（否则 https 页面会被按混合内容拦掉）', () => {
    assert.strictEqual(toOriginal('http://i0.hdslb.com/bfs/album/ab.jpg'), 'https://i0.hdslb.com/bfs/album/ab.jpg');
});
check('toOriginalImageUrl：去 @ 缩略参数 + webp→jpg', () => {
    assert.strictEqual(toOriginal('https://i0.hdslb.com/bfs/album/ab.jpg@316w_560h_1c.webp'), 'https://i0.hdslb.com/bfs/album/ab.jpg');
});
check('toOriginalImageUrl：反转义 \\u002F 与 \\/', () => {
    assert.strictEqual(toOriginal('https:\\u002F\\u002Fi0.hdslb.com\\/bfs\\/album\\/ab.png'), 'https://i0.hdslb.com/bfs/album/ab.png');
});
check('toOriginalImageUrl：协议相对地址补 https', () => {
    assert.strictEqual(toOriginal('//i0.hdslb.com/bfs/album/ab.jpg'), 'https://i0.hdslb.com/bfs/album/ab.jpg');
});
check('toOriginalImageUrl：非 http(s) 一律拒绝', () => {
    assert.strictEqual(toOriginal('javascript:alert(1)'), null);
    assert.strictEqual(toOriginal('data:image/png;base64,AAAA'), null);
    assert.strictEqual(toOriginal(''), null);
});

check('normalizeUrl：相对路径按 base 补全', () => {
    assert.strictEqual(hooks['环境版'].normalizeUrl('/opus/123', 'https://www.bilibili.com/x'), 'https://www.bilibili.com/opus/123');
});
check('normalizeUrl：B 站域名的 http 也升级成 https', () => {
    assert.strictEqual(hooks['环境版'].normalizeUrl('http://www.bilibili.com/opus/123'), 'https://www.bilibili.com/opus/123');
});

check('isContentImageUrl：只认 hdslb 的正文图目录，头像/活动图不算', () => {
    const f = hooks['环境版'].isContentImageUrl;
    assert.strictEqual(f('https://i0.hdslb.com/bfs/album/ab.jpg'), true);
    assert.strictEqual(f('https://i0.hdslb.com/bfs/new_dyn/ab.png'), true);
    assert.strictEqual(f('https://i0.hdslb.com/bfs/face/avatar.jpg'), false);
    assert.strictEqual(f('https://evil.com/bfs/album/ab.jpg'), false);
    assert.strictEqual(f('https://i0.hdslb.com/bfs/album/ab.txt'), false);
});

check('extractUrlsFromText：从转义过的 JSON 文本里捞出正文图', () => {
    const text = '{"pic":"https:\\/\\/i0.hdslb.com\\/bfs\\/album\\/ab.jpg@100w.webp"}';
    assert.deepStrictEqual(Array.from(hooks['环境版'].extractUrlsFromText(text)), ['https://i0.hdslb.com/bfs/album/ab.jpg']);
});
check('extractUrlsFromText：普通（未转义）地址同样能捞出', () => {
    const text = '<img src="https://i0.hdslb.com/bfs/album/ab.jpg">';
    assert.deepStrictEqual(Array.from(hooks['环境版'].extractUrlsFromText(text)), ['https://i0.hdslb.com/bfs/album/ab.jpg']);
});

// ── 5. 取流解析 ──
const dashData = {
    timelength: 10000,
    support_formats: [{ quality: 80 }, { quality: 120, new_description: '4K 超清' }],
    dash: {
        duration: 10000,
        video: [
            { id: 80, codecs: 'avc1.640028', bandwidth: 1000000, baseUrl: 'https://cdn/v1.m4s', backupUrl: ['https://cdn/v2.m4s'], mimeType: 'video/mp4' },
            { id: 80, codecs: 'hev1.1.6.L120', bandwidth: 1000000, baseUrl: 'https://cdn/h1.m4s', mimeType: 'video/mp4' }
        ],
        audio: [{ id: 30280, bandwidth: 100000, baseUrl: 'https://cdn/a.m4s' }]
    }
};
check('parseDashStream：同一画质优先 avc1，且保留全部备用 CDN 地址', () => {
    const s = hooks['环境版'].parseDashStream(dashData, 0, false, true);
    assert.ok(s, '解析结果为空');
    assert.ok(/\/v1\.m4s$/.test(s.videoUrl), '没挑中 avc1 那条');
    assert.deepStrictEqual(Array.from(s.videoUrls), ['https://cdn/v1.m4s', 'https://cdn/v2.m4s']);
    assert.strictEqual(s.audioUrl, 'https://cdn/a.m4s');
    assert.strictEqual(s.ext, 'mp4');
});
check('parseDashStream：大小按 (视频+音频码率)×时长估算', () => {
    const s = hooks['环境版'].parseDashStream(dashData, 0, false, true);
    assert.strictEqual(s.size, Math.round((1000000 + 100000) * 10 / 8));
});
check('parseDashStream：声明支持但没给流的档位标成「拿不到」', () => {
    const s = hooks['环境版'].parseDashStream(dashData, 0, false, false);
    assert.strictEqual(s.blocked.length, 1);
    assert.strictEqual(s.blocked[0].id, 120);
    assert.strictEqual(s.blocked[0].reason, '需登录');
});
check('parseDashStream：没有 dash 时返回 null', () => {
    assert.strictEqual(hooks['环境版'].parseDashStream({ durl: [] }, 0, false, true), null);
});

check('parseDurlStream：单文件自带音轨，且带备用地址', () => {
    const s = hooks['环境版'].parseDurlStream({ quality: 64, durl: [{ url: 'https://cdn/x.mp4', backup_url: ['https://cdn/y.mp4'], size: 1000 }] });
    assert.strictEqual(s.merged, true);
    assert.strictEqual(s.audioUrl, null);
    assert.deepStrictEqual(Array.from(s.videoUrls), ['https://cdn/x.mp4', 'https://cdn/y.mp4']);
    assert.strictEqual(s.quality, 64);
});
check('parseDurlStream：没有 durl 时返回 null', () => {
    assert.strictEqual(hooks['环境版'].parseDurlStream({}), null);
});

check('pickStream：点名档位拿不到时降到「不超过它的最接近档」', () => {
    const list = [{ id: 80 }, { id: 64 }, { id: 32 }];
    assert.strictEqual(hooks['环境版'].pickStream(list, 74).id, 64);
    assert.strictEqual(hooks['环境版'].pickStream(list, 80).id, 80);
    assert.strictEqual(hooks['环境版'].pickStream(list, 0).id, 80);
    assert.strictEqual(hooks['环境版'].pickStream([], 0), null);
});

// ── 6. 便携版内核在脚本内确实可用（BS 内联到位）──
check('便携版：内联的 ZIP 分批能力可用', () => {
    const batches = hooks['便携版'].planZipBatches([{ name: 'a.jpg', data: new Uint8Array(10) }]);
    assert.strictEqual(batches.length, 1);
    assert.strictEqual(batches[0][0].name, 'a.jpg');
});

// ── 7. 视觉系统（src/lib/theme.js + 产物）──
const TH = require('../src/lib/theme.js');

check('主题名归一化：旧版 light / dark 映射到新主题', () => {
    assert.strictEqual(TH.normalizeTheme('light'), 'cloud');
    assert.strictEqual(TH.normalizeTheme('dark'), 'midnight');
    assert.strictEqual(TH.normalizeTheme('sakura'), 'sakura');
    assert.strictEqual(TH.normalizeTheme('不认识的'), TH.DEFAULT_THEME);
    assert.strictEqual(TH.normalizeTheme(null), TH.DEFAULT_THEME);
});

check('跟随系统：浅色用 cloud、深色用 midnight', () => {
    assert.strictEqual(TH.resolveTheme('auto', false), 'cloud');
    assert.strictEqual(TH.resolveTheme('auto', true), 'midnight');
    assert.strictEqual(TH.resolveTheme('sakura', true), 'sakura', '固定主题不该被系统设置覆盖');
});

check('三套色板 token 齐全且互不相同', () => {
    const keys = Object.keys(TH.VARS);
    for (const name of ['cloud', 'midnight', 'sakura']) {
        const p = TH.PALETTES[name];
        assert.ok(p, '缺少色板：' + name);
        for (const k of keys) assert.ok(p[k], name + ' 缺少 token：' + k);
    }
    assert.notStrictEqual(TH.PALETTES.cloud.surface, TH.PALETTES.midnight.surface, '明暗两套背景色撞了');
});

check('样式表：四套主题都有选择器，且没有依赖 color-mix 等新特性', () => {
    const css = TH.buildCss();
    for (const t of TH.THEMES) assert.ok(css.includes('data-bp-theme="' + t + '"'), '缺少主题选择器：' + t);
    assert.ok(css.includes('@media (prefers-color-scheme: dark)'), '跟随系统没接系统明暗');
    assert.ok(!/color-mix\(/.test(css), '用了 color-mix，老浏览器会失效');
    for (const cls of ['.bp-panel', '.bp-head', '.bp-btn--primary', '.bp-seg', '.bp-toast', '.bp-review']) {
        assert.ok(css.includes(cls), '样式表缺少组件：' + cls);
    }
    assert.ok(/prefers-reduced-motion/.test(css), '没尊重「减少动态效果」');
});

check('样式表：正文区能收缩（否则底部按钮会被内容顶掉）', () => {
    assert.ok(/\.bp-panel > \.bp-scroll\{flex:1;min-height:0;\}/.test(TH.buildCss()), '缺 .bp-panel > .bp-scroll 的收缩规则');
});

for (const [label, file] of [['环境版', FULL], ['便携版', PORTABLE]]) {
    check(label + '：内联了视觉系统，且面板不再写死白底 / 旧变量', () => {
        const t = fs.readFileSync(file, 'utf8');
        assert.ok(t.includes('__biliTheme'), '没内联 theme.js');
        assert.ok(t.includes('function buildCss'), 'theme.js 没真正内联（只有占位）');
        assert.ok(!/background:'#fff'/.test(t), '还有写死白底的面板（暗色主题下会刺眼）');
        assert.ok(!/--bili-save-/.test(t), '还在用旧的五个 CSS 变量');
        assert.ok(!/location\.reload\(\)/.test(t), '换主题不该刷新页面');
    });
}

// ── 8. 源码级守卫：这些坑没有 DOM 就测不到，但可以用结构断言钉住 ──
for (const [label, file] of [['环境版', FULL], ['便携版', PORTABLE]]) {
    check(label + '：写授权目录失败时会清掉半成品（否则下次查重会跳过坏文件）', () => {
        const t = fs.readFileSync(file, 'utf8');
        assert.ok(/async function writeBlobToDir\(dir, filename, blob, skipExisting\)\{[\s\S]{0,600}?await w\.abort\(\)/.test(t), '写入失败没有 abort 写流');
        assert.ok(/async function writeBlobToDir\(dir, filename, blob, skipExisting\)\{[\s\S]{0,700}?await dir\.removeEntry\(filename\)/.test(t), '写入失败没有删掉半成品');
    });
    check(label + '：关设置面板会丢弃没保存的键位改动', () => {
        const t = fs.readFileSync(file, 'utf8');
        assert.ok(/const close = \(\) => \{\n\s+panel\.remove\(\);\n\s+if\(pendingKeyListener\)\{[\s\S]{0,400}?window\.__biliPendingKeys = null;/.test(t), 'close() 没清空待保存键位');
    });
    check(label + '：点「重下」的 force 状态不会残留到下一次普通下载', () => {
        const t = fs.readFileSync(file, 'utf8');
        assert.ok(/const force = \!\!state\.force;\n\s+state\.force = false;\n\s+if\(!picked\.length\)/.test(t), 'force 取走得太晚');
    });
    check(label + '：设置面板的 ✕ 走 close()（连带注销键位录制的监听）', () => {
        const t = fs.readFileSync(file, 'utf8');
        assert.ok(/querySelector\('#bili-settings-x'\)\.addEventListener\('click', close\)/.test(t), '✕ 又变成直接 remove 了');
    });
}

check('版本号三处同步（package.json / 环境版 / 便携版）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const versionOf = f => {
        const m = fs.readFileSync(f, 'utf8').match(/@version\s+(\S+)/);
        assert.ok(m, '读不到 @version：' + f);
        return m[1];
    };
    assert.strictEqual(versionOf(FULL), pkg, '环境版 @version 与 package.json 不一致（已安装的用户收不到更新）');
    assert.strictEqual(versionOf(PORTABLE), pkg, '便携版 @version 与 package.json 不一致');
});

console.log('通过 ' + passed + ' 项' + (process.exitCode ? '，有失败 ❌' : '，全部通过 ✅'));
