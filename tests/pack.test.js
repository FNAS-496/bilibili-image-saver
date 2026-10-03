/**
 * 打包工具链单测（运行：node tests/pack.test.js）
 *
 * 覆盖三块：
 *   pack/zip.js    ZIP 写入器（结构、中文名 EFS、CRC、坏包能被发现）
 *   pack/notes.js  备注注入（JS / TXT / GITIGNORE 各自的注释写法）
 *   pack/pack.js   发行包内容（打出来的 zip 里有啥、说明文档全不全）
 *
 * 机器上有 Python 时，再用 Python 的 zipfile 交叉验证一遍（不是自己验自己）。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { writeZip, listZip, verifyZip, ZIP_FLAGS_UTF8 } = require('../pack/zip.js');
const { noteFor, annotate } = require('../pack/notes.js');
const pack = require('../pack/pack.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-pack-test-'));
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

// ── Python 交叉验证（没有 Python 就跳过，不当失败）──
const PY = (() => {
    try {
        execFileSync('python', ['-c', 'pass'], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
})();

function pythonInspect(zipPath) {
    const script = path.join(TMP, 'inspect_zip.py');
    if (!fs.existsSync(script)) {
        fs.writeFileSync(script, [
            'import sys, zipfile, json, io',
            'out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")',
            'z = zipfile.ZipFile(sys.argv[1])',
            'res = {"bad": z.testzip(), "names": z.namelist()}',
            'for n in res["names"]:',
            '    if n.endswith(".txt"):',
            '        res.setdefault("texts", {})[n] = z.read(n).decode("utf-8")',
            'out.write(json.dumps(res, ensure_ascii=False))'
        ].join('\n'), 'utf8');
    }
    const out = execFileSync('python', [script, zipPath], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    return JSON.parse(out);
}

console.log('pack 单测（打包工具链）');

// ── pack/zip.js ──
const TXT = 'Bilibili-Plus 打包测试：中文内容 & 换行。\n'.repeat(30);
const JS = '// ' + 'x'.repeat(400) + '\n';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const smallZip = path.join(TMP, 'small.zip');
const when = new Date(2026, 9, 2, 18, 0, 0);

writeZip(smallZip, [
    { name: '使用说明.txt', data: Buffer.from(TXT, 'utf8'), mtime: when },
    { name: 'images/封面 图片.jpg', data: JPG, mtime: when },
    { name: 'src/app.js', data: Buffer.from(JS, 'utf8'), mtime: when }
]);

const listed = listZip(smallZip);

check('writeZip：条目名按写入顺序在中央目录里原样出现', () => {
    assert.deepStrictEqual(listed.map(e => e.name), ['使用说明.txt', 'images/封面 图片.jpg', 'src/app.js']);
});

check('writeZip：非 ASCII 名字置了 EFS(0x0800) 标志', () => {
    for (const e of listed) assert.ok(e.flags & ZIP_FLAGS_UTF8, '缺 EFS：' + e.name);
    assert.strictEqual(ZIP_FLAGS_UTF8, 0x0800);
});

check('writeZip：已压缩格式走 STORE，文本走 DEFLATE 且确实更小', () => {
    const byName = Object.fromEntries(listed.map(e => [e.name, e]));
    assert.strictEqual(byName['images/封面 图片.jpg'].method, 0, '图片不该再压缩');
    assert.strictEqual(byName['使用说明.txt'].method, 8, '文本应该 deflate');
    assert.strictEqual(byName['src/app.js'].method, 8, '重复文本应该 deflate');
    assert.ok(byName['src/app.js'].packed < byName['src/app.js'].size, 'deflate 后反而更大就不该用 deflate');
    assert.strictEqual(byName['images/封面 图片.jpg'].packed, JPG.length);
});

check('writeZip：回读校验通过，且未压缩长度与原文一致', () => {
    const entries = verifyZip(smallZip);
    assert.strictEqual(entries.length, 3);
    const txt = entries.find(e => e.name === '使用说明.txt');
    assert.strictEqual(txt.size, Buffer.byteLength(TXT));
});

check('writeZip：CRC 与运行时自带的 zlib.crc32 一致', () => {
    if (typeof zlib.crc32 !== 'function') return;         // Node < 22 没有这个函数
    const payloads = {
        '使用说明.txt': Buffer.from(TXT, 'utf8'),
        'images/封面 图片.jpg': JPG,
        'src/app.js': Buffer.from(JS, 'utf8')
    };
    for (const e of listed) {
        assert.strictEqual(e.crc >>> 0, zlib.crc32(payloads[e.name]) >>> 0, 'CRC 不一致：' + e.name);
    }
});

check('writeZip：单个条目名超过 65535 字节直接报错', () => {
    assert.throws(() => writeZip(path.join(TMP, 'longname.zip'), [{ name: 'x'.repeat(70000) + '.txt', data: Buffer.from('a') }]),
        /条目名过长/);
});

check('verifyZip：内容被改一个字节能查出来（坏包别想发出去）', () => {
    const bad = path.join(TMP, 'tamper.zip');
    fs.copyFileSync(smallZip, bad);
    const buf = fs.readFileSync(bad);
    const jpg = listZip(bad).find(e => e.name.endsWith('.jpg'));
    const nameLen = buf.readUInt16LE(jpg.offset + 26);
    const extraLen = buf.readUInt16LE(jpg.offset + 28);
    const at = jpg.offset + 30 + nameLen + extraLen;
    buf[at] = buf[at] ^ 0xff;
    fs.writeFileSync(bad, buf);
    assert.throws(() => verifyZip(bad), /CRC|长度|签名|不一致/, '篡改后没报错');
});

if (PY) {
    const py = pythonInspect(smallZip);
    check('Python zipfile 交叉验证：中文名不乱码、testzip 无坏条目', () => {
        assert.strictEqual(py.bad, null);
        assert.deepStrictEqual(py.names, ['使用说明.txt', 'images/封面 图片.jpg', 'src/app.js']);
    });
    check('Python 读出的 txt 内容与写进去的一模一样', () => {
        assert.strictEqual(py.texts['使用说明.txt'], TXT);
    });
} else {
    console.log('  skip 未找到 python，跳过交叉验证');
}

// ── pack/notes.js ──
check('noteFor：没备注的文件直接报错（逼着维护者补备注）', () => {
    assert.throws(() => noteFor('随便一个不存在的文件.txt', 'env'), /没有备注/);
    assert.ok(noteFor('node/node.exe', 'full').length > 0);
    assert.ok(noteFor('bilibili-save.user.js', 'portable').includes('便携版'));
});

check('annotate：用户脚本的备注插在 ==/UserScript== 之后', () => {
    const src = '// ==UserScript==\n// @name x\n// ==/UserScript==\nconsole.log(1);\n';
    const out = annotate('bilibili-save.user.js', Buffer.from(src, 'utf8'), 'env').toString('utf8');
    assert.ok(out.startsWith('// ==UserScript=='), '头部不能被挤掉');
    assert.ok(out.includes('// 【备注】'));
    assert.ok(out.indexOf('// 【备注】') < out.indexOf('console.log(1)'));
});

check('annotate：txt 前置备注，.gitignore 用 # 注释，json 不动', () => {
    const txt = annotate('使用说明.txt', Buffer.from('正文\n', 'utf8'), 'env').toString('utf8');
    assert.ok(txt.startsWith('【备注】'));
    assert.ok(txt.endsWith('正文\n'));
    const gi = annotate('.gitignore', Buffer.from('node_modules/\n', 'utf8'), 'source').toString('utf8');
    assert.ok(gi.startsWith('# 【备注】'));
    const json = Buffer.from('{"a":1}', 'utf8');
    assert.strictEqual(annotate('package.json', json, 'source'), json);
});

check('一键启动.bat：备注写在源文件里（GBK 编码，打包时原样带走）', () => {
    const raw = fs.readFileSync(path.join(ROOT, '一键启动.bat'));
    let text;
    try {
        text = new TextDecoder('gbk').decode(raw);
    } catch (e) {
        console.log('       （本机 Node 不支持 gbk 解码，跳过内容断言）');
        return;
    }
    assert.ok(/^@echo off\r?\n/.test(text), '首行必须是 @echo off');
    const noteAt = text.indexOf('备注（本文件是启动脚本）');
    assert.ok(noteAt > 0, 'bat 里没有备注块');
    assert.ok(text.indexOf('setlocal') > noteAt, '备注要插在 @echo off 之后、逻辑之前');
    assert.ok(text.includes('set "PATH=%~dp0node;%PATH%"'), '内置 Node 优先的写法不见了');
    assert.ok(text.includes('cmd /k "node save_images_server.js"'), '真正的启动行不该被改');
    assert.ok(text.includes('::#FILE:watermark'), '内嵌收款码数据段还在');
});

// ── pack/pack.js：发行包内容 ──
const specOf = id => pack.editionSpecs().find(s => s.id === id);

check('editionSpecs：四个发行版都在，且 id 唯一', () => {
    const specs = pack.editionSpecs();
    assert.deepStrictEqual(specs.map(s => s.id), ['portable', 'env', 'full', 'source']);
    assert.strictEqual(new Set(specs.map(s => s.suffix)).size, 4);
});

const envResult = pack.buildEdition(specOf('env'), TMP);
const portableResult = pack.buildEdition(specOf('portable'), TMP);

check('发行包：zip 文件名纯 ASCII，顶层目录用中文（GitHub 附件名会抹掉非 ASCII）', () => {
    for (const r of [envResult, portableResult]) {
        const base = path.basename(r.zipPath, '.zip');
        assert.ok(/^[\x20-\x7e]+$/.test(base), 'zip 文件名有非 ASCII 字符：' + base);
        assert.strictEqual(base, 'Bilibili-Plus_v' + pack.VERSION + '_' + r.spec.key);
        const names = listZip(r.zipPath).map(e => e.name);
        const folder = 'Bilibili-Plus_v' + pack.VERSION + '_' + r.spec.suffix;
        assert.ok(names.every(n => n.startsWith(folder + '/')), '顶层目录不对：' + r.zipPath);
    }
});

check('环境版：脚本 + 服务 + 启动脚本 + 两份说明都在，没有运行时二进制', () => {
    const names = listZip(envResult.zipPath).map(e => e.name.split('/').slice(1).join('/'));
    for (const want of ['一键启动.bat', 'save_images_server.js', 'bilibili-save.user.js', '使用说明.txt', '文件说明.txt', 'LICENSE']) {
        assert.ok(names.includes(want), '少了 ' + want);
    }
    assert.ok(!names.some(n => /node\.exe|ffmpeg\.exe/.test(n)), '环境版不该带运行时');
});

check('便携版：带的是便携版脚本（没有 @connect 127.0.0.1）', () => {
    const script = portableResult.items.find(i => i.to === 'bilibili-save.user.js').data.toString('utf8');
    assert.ok(script.includes('// @name'), '不是用户脚本');
    assert.ok(!/@connect\s+127\.0\.0\.1/.test(script), '便携版不该连本地服务');
    assert.ok(!/@updateURL/.test(script), '便携版不做自动更新');
});

check('「文件说明.txt」把包内每个文件都列了一遍，备注不是空话', () => {
    const text = envResult.items.find(i => i.to === '文件说明.txt').data.toString('utf8');
    for (const it of envResult.items) {
        const shown = it.to.split('/').join('\\');
        assert.ok(text.includes('【文件】' + shown), '文件说明里漏了 ' + shown);
    }
    assert.ok(!text.includes('undefined'), '备注没填上（出现 undefined）');
    assert.ok(text.includes('本地保存服务'), '服务端脚本的备注没写进文件说明');
    assert.ok(text.includes('（大小见文件本身）'), '文件说明自己那一条没标注大小');
});

check('每个包都有自己的使用说明（四个包不再共用一份模板）', () => {
    const env = pack.usageText(specOf('env'));
    const full = pack.usageText(specOf('full'));
    const source = pack.usageText(specOf('source'));
    assert.notStrictEqual(env, full, '环境版和完整版还在用同一份说明');
    assert.notStrictEqual(env, source);
    assert.ok(env.includes('本包不带，需要自己装'), '环境版该说「自己装 Node」');
    assert.ok(full.includes('本包已内置'), '完整版该说「已内置运行时」');
    assert.ok(source.includes('npm run pack'), '源码版该讲怎么重新打包');
    for (const text of [env, full, source]) {
        assert.ok(text.includes('Bilibili-Plus v' + pack.VERSION), '版本号没替换');
        assert.ok(!/@@(?!VERSION@@)/.test(text) && !/@@VERSION@@/.test(text), '还有没替换的占位符');
    }
    assert.throws(() => pack.usageText(specOf('portable')), /还没有自己的使用说明/,
        '便携版应该直接用仓库里的 便携版/使用说明.txt，不该再有第四份模板');
});

check('「使用说明.txt」随包发出，且没有 @@ 残留', () => {
    for (const r of [envResult, portableResult]) {
        const text = r.items.find(i => i.to === '使用说明.txt').data.toString('utf8');
        assert.ok(text.length > 300, '说明太短，是不是读到模板了');
        assert.ok(!/@@[A-Z_]+@@/.test(text), '还有占位符没替换');
    }
    const envText = envResult.items.find(i => i.to === '使用说明.txt').data.toString('utf8');
    assert.ok(envText.includes('本包不带，需要自己装'));
    const portableText = portableResult.items.find(i => i.to === '使用说明.txt').data.toString('utf8');
    assert.ok(portableText.includes('便携版'), '便携版包里应该还是那份便携版说明');
});

check('备注注入到了包里的脚本文件（装完看一眼文件就知道是啥）', () => {
    const server = envResult.items.find(i => i.to === 'save_images_server.js').data.toString('utf8');
    assert.ok(server.startsWith('// 【备注】'), '服务端脚本缺备注');
    assert.ok(server.includes("require('http')"), '备注把代码顶掉了？');
});

check('完整版：本地有内置运行时就带上，没有就跳过（不硬编一个假包）', () => {
    const needs = ['node/node.exe', 'ffmpeg/ffmpeg.exe'].map(p => path.join(pack.BUNDLE_DIR, ...p.split('/')));
    const haveAll = needs.every(p => fs.existsSync(p));
    if (!haveAll) {
        const r = pack.buildEdition(specOf('full'), TMP);
        assert.ok(r.skipped && r.skipped.includes('缺少内置运行时'), '缺运行时却还在打包');
        return;
    }
    const r = pack.buildEdition(specOf('full'), TMP);
    const names = listZip(r.zipPath).map(e => e.name);
    assert.ok(names.some(n => n.endsWith('/node/node.exe')));
    assert.ok(names.some(n => n.endsWith('/ffmpeg/ffmpeg.exe')));
});

check('同一个包打两次字节一致（生成的说明用固定时间戳，产物可复现）', () => {
    const sha = b => crypto.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
    const dirA = fs.mkdtempSync(path.join(TMP, 'a-'));
    const dirB = fs.mkdtempSync(path.join(TMP, 'b-'));
    const a = pack.buildEdition(specOf('env'), dirA);
    const b = pack.buildEdition(specOf('env'), dirB);
    assert.strictEqual(path.basename(a.zipPath), path.basename(b.zipPath));
    assert.strictEqual(sha(a.zipPath), sha(b.zipPath), '两次打包的字节不一样，产物不可复现');
});

check('Release 说明：占位符都换掉了，附件名和版本都列进去了', () => {
    const body = pack.releaseBody([envResult, portableResult]);
    assert.ok(!/@@[A-Z_]+@@/.test(body), '还有占位符没替换');
    assert.ok(body.includes(path.basename(envResult.zipPath)));
    assert.ok(body.includes(path.basename(portableResult.zipPath)));
    assert.ok(body.includes('**环境版**'));
    assert.ok(body.includes('Bilibili-Plus v' + pack.VERSION));
});

if (PY) {
    const py = pythonInspect(envResult.zipPath);
    check('Python zipfile 交叉验证：发行包结构正常、说明文字没乱码', () => {
        const folder = 'Bilibili-Plus_v' + pack.VERSION + '_' + envResult.spec.suffix;
        assert.strictEqual(py.bad, null);
        assert.strictEqual(py.names.length, listZip(envResult.zipPath).length);
        const notes = py.texts[folder + '/文件说明.txt'];
        assert.ok(notes && notes.includes('【备注】'), 'Python 读出来的文件说明不对');
    });
}

// ── 收款码：内嵌在脚本里，用户打开打赏面板就能看到（不依赖任何文件）──
const builtCache = new Map();
const buildOnce = spec => {
    if (!builtCache.has(spec.id)) builtCache.set(spec.id, pack.buildEdition(spec, TMP));
    return builtCache.get(spec.id);
};

check('打赏收款码内嵌在用户脚本里（能看见即可，不需要附带图片文件）', () => {
    for (const r of [portableResult, envResult]) {
        const script = r.items.find(i => i.to === 'bilibili-save.user.js').data.toString('utf8');
        const m = /data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]{100,})/.exec(script);
        assert.ok(m, r.spec.id + ' 的脚本里没找到内嵌的收款码');
        const bytes = Buffer.from(m[1], 'base64');
        assert.ok(bytes.length > 1000, '收款码数据太小，可能是坏的');
        assert.deepStrictEqual([...bytes.slice(0, 3)], [0xff, 0xd8, 0xff], '内嵌的数据不是一张 jpg');
    }
});

check('备注不会把 #! 挤到第二行（否则 node 直接语法错误）', () => {
    const out = annotate('build.js', Buffer.from('#!/usr/bin/env node\nconsole.log(1);\n', 'utf8'), 'source').toString('utf8');
    assert.ok(out.startsWith('#!/usr/bin/env node\n'), '首行必须还是 shebang');
    assert.ok(out.includes('// 【备注】'), '备注没插进去');
    const f = path.join(TMP, 'shebang.js');
    fs.writeFileSync(f, out);
    execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' });   // 抛错就是失败
});

check('备注注入是幂等的（从源码包重打包不会层层叠加）', () => {
    for (const [name, kind, body] of [
        ['pack/zip.js', 'source', '#!/usr/bin/env node\nconsole.log(1);\n'],
        ['使用说明.txt', 'env', '正文\n'],
        ['README.md', 'source', '# 标题\n\n正文\n'],
        ['.gitignore', 'source', 'node_modules/\n']
    ]) {
        const once = annotate(name, Buffer.from(body, 'utf8'), kind);
        const twice = annotate(name, once, kind);
        assert.strictEqual(twice.toString('utf8'), once.toString('utf8'), name + ' 注了两次备注');
        assert.strictEqual((twice.toString('utf8').match(/【备注】/g) || []).length, 1, name + ' 出现了多条备注');
    }
});

check('源码包里每个 .js 都能通过 node --check（备注没把文件改坏）', () => {
    const r = buildOnce(specOf('source'));
    const dir = fs.mkdtempSync(path.join(TMP, 'check-'));
    let count = 0;
    for (const it of r.items) {
        if (!it.to.endsWith('.js')) continue;
        const f = path.join(dir, ...it.to.split('/'));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, it.data);
        try {
            execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' });
        } catch (e) {
            assert.fail(it.to + ' 语法检查没过（备注插错位置了？）');
        }
        count++;
    }
    assert.ok(count >= 8, '源码包的 js 文件数不对，只查到 ' + count + ' 个');
});

check('从源码包构建，产物里不会跟着跑出打包备注', () => {
    const r = buildOnce(specOf('source'));
    const dir = fs.mkdtempSync(path.join(TMP, 'rebuild-'));
    for (const it of r.items) {
        if (!/^(build\.js|src\/)/.test(it.to)) continue;
        const f = path.join(dir, ...it.to.split('/'));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, it.data);
    }
    execFileSync(process.execPath, ['build.js'], { cwd: dir, stdio: 'ignore' });
    const generated = fs.readFileSync(path.join(dir, 'bilibili-save.user.js'), 'utf8');
    assert.ok(!generated.includes('// 【备注】'), '打包备注跟着构建产物跑出去了');
    assert.ok(generated.includes('// ==UserScript=='), '生成物不像用户脚本');
    execFileSync(process.execPath, ['--check', path.join(dir, 'bilibili-save.user.js')], { stdio: 'ignore' });
    assert.ok(fs.existsSync(path.join(dir, '便携版', 'bilibili-save.user.js')), '便携版产物没生成');
});

check('源码版：带上源码、构建与打包工具，不带生成物', () => {
    const r = buildOnce(specOf('source'));
    const names = listZip(r.zipPath).map(e => e.name.split('/').slice(1).join('/'));
    for (const want of ['src/bilibili-save.user.js', 'src/lib/browser-save.js', 'build.js', 'pack/pack.js', 'pack/zip.js',
        'package.json', 'README.md', '.gitignore', '使用说明.txt',
        '一键启动.bat', 'save_images_server.js', '便携版/使用说明.txt']) {
        assert.ok(names.includes(want), '少了 ' + want);
    }
    assert.ok(!names.includes('bilibili-save.user.js'), '源码版不该混进根目录的生成物');
    assert.ok(!names.includes('便携版/bilibili-save.user.js'), '便携版脚本是生成物，不该进源码包');
});

check('source 版 README 备注不会破坏 Markdown 标题', () => {
    const r = buildOnce(specOf('source'));
    const readme = r.items.find(i => i.to === 'README.md').data.toString('utf8');
    assert.ok(readme.startsWith('> 【备注】'));
    assert.ok(/^# /m.test(readme), 'README 的一级标题不见了');
});

// ── 收尾 ──
fs.rmSync(TMP, { recursive: true, force: true });
console.log(passed + ' 项通过' + (process.exitCode ? '，有失败项' : ''));
