#!/usr/bin/env node
/**
 * 把打好的发行包传到 GitHub Release（打 tag + 传附件）。
 *
 * 用法：node pack/publish.js --tag v0.9.32 --name "..." --notes-file pack/xxx.md 发行版/*.zip
 *      （一般不用手敲，交给 node pack/pack.js --publish 调用）
 *
 * 凭据优先级：环境变量 GH_TOKEN / GITHUB_TOKEN > git 凭据管理器里存的那份
 *（就是 git push 用的那个），全程不打印 token。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const UA = 'bilibili-plus-pack';

function readToken() {
    const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (env && env.trim()) return env.trim();
    const out = execFileSync('git', ['credential', 'fill'], {
        input: 'url=https://github.com\n\n',
        encoding: 'utf8'
    });
    const m = /^password=(.+)$/m.exec(out);
    if (!m || !m[1].trim()) {
        throw new Error('拿不到 GitHub 凭据：设置 GH_TOKEN，或先执行一次 git push 让凭据管理器记住');
    }
    return m[1].trim();
}

function repoSlug() {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    if (!m) throw new Error('origin 不是 GitHub 仓库：' + url);
    return { owner: m[1], repo: m[2] };
}

async function api(pathname, { method = 'GET', token, body } = {}) {
    const res = await fetch(API + pathname, {
        method,
        headers: {
            Authorization: 'token ' + token,
            Accept: 'application/vnd.github+json',
            'User-Agent': UA,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON 就当纯文本看 */ }
    if (!res.ok) {
        const err = new Error('GitHub API ' + method + ' ' + pathname + ' 失败：' + res.status +
            ' ' + ((json && json.message) || text.slice(0, 200)));
        err.status = res.status;
        throw err;
    }
    return json;
}

async function uploadAsset({ owner, repo, releaseId, token, file }) {
    const name = path.basename(file);
    const data = fs.readFileSync(file);
    const mb = (data.length / 1024 / 1024).toFixed(1);
    process.stdout.write('  上传 ' + name + '（' + mb + ' MB）... ');
    const t0 = Date.now();
    const res = await fetch(UPLOADS + '/repos/' + owner + '/' + repo + '/releases/' + releaseId +
        '/assets?name=' + encodeURIComponent(name), {
        method: 'POST',
        headers: {
            Authorization: 'token ' + token,
            Accept: 'application/vnd.github+json',
            'User-Agent': UA,
            'Content-Type': 'application/zip'
        },
        body: data
    });
    const text = await res.text();
    if (!res.ok) {
        let msg = text.slice(0, 300);
        try {
            const j = JSON.parse(text);
            msg = j.message || msg;
            if (Array.isArray(j.errors) && j.errors.length) {
                msg += ' → ' + j.errors.map(e => e.field ? (e.field + ' ' + e.code) : JSON.stringify(e)).join('；');
            }
        } catch (e) { /* 非 JSON 就用原文 */ }
        throw new Error('上传 ' + name + ' 失败：' + res.status + ' ' + msg);
    }
    console.log('ok（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
}

// 建或更新一次 Release，并把 assets 全部传上去；返回 release 的网页地址
// 决定哪些附件要清理：
//   replace —— 本次要上传的同名附件（不删会 422 name already_exists）
//   prune   —— 改名/改版留下的旧包，只在「本次是完整发布」时清（否则）
//   keep    —— 不认识的附件，留着
// 关键点：`--only env --publish` 这种局部发布绝不能按前缀大扫除——那会把同一个 Release 上的
// full / portable / source 一起删掉（full 有 70MB，删了得重传）。所以 prune 必须显式开启。
function planAssetCleanup(existing, wantedNames, { pruneStale = false, prefix = /^Bilibili-Plus[-_]/ } = {}) {
    const wanted = new Set(wantedNames);
    return existing.map(asset => {
        if (wanted.has(asset.name)) return { asset, action: 'replace' };
        if (pruneStale && prefix.test(asset.name)) return { asset, action: 'prune' };
        return { asset, action: 'keep' };
    });
}

async function publishRelease({ tag, name, body, assets, draft = false, prerelease = false, pruneStaleAssets = false,
                               targetCommitish = 'main', stalePrefix = /^Bilibili-Plus[-_]/ }) {
    const token = readToken();
    const { owner, repo } = repoSlug();
    const base = '/repos/' + owner + '/' + repo;

    // 附件名只能是纯 ASCII：GitHub 会把非 ASCII 字符直接抹掉（中文名会变成一串下划线）
    for (const file of assets) {
        const base = path.basename(file);
        if (/[^\x20-\x7e]/.test(base)) {
            throw new Error('附件名必须是纯 ASCII（GitHub 会抹掉非 ASCII 字符）：' + base);
        }
    }

    let release = null;
    try {
        release = await api(base + '/releases/tags/' + encodeURIComponent(tag), { token });
        console.log('已存在同名 Release，改为更新：' + release.html_url);
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    if (!release) {
        release = await api(base + '/releases', {
            method: 'POST',
            token,
            body: { tag_name: tag, target_commitish: targetCommitish, name, body, draft, prerelease }
        });
        console.log('已创建 Release：' + release.html_url);
    } else {
        release = await api(base + '/releases/' + release.id, {
            method: 'PATCH',
            token,
            body: { name, body, draft, prerelease }
        });
    }

    // 同名附件先删；改名/改版留下的旧包只在完整发布时清（见 planAssetCleanup 的注释）
    const existing = (await api(base + '/releases/' + release.id + '/assets?per_page=100', { token })) || [];
    for (const { asset, action } of planAssetCleanup(existing, assets.map(f => path.basename(f)),
        { pruneStale: pruneStaleAssets, prefix: stalePrefix })) {
        if (action === 'keep') {
            console.log('  保留不认识的附件：' + asset.name);
            continue;
        }
        await api(base + '/releases/assets/' + asset.id, { method: 'DELETE', token });
        console.log('  删掉旧附件：' + asset.name + (action === 'prune' ? '（改名前的旧包）' : '（要重新上传）'));
    }

    for (const file of assets) {
        if (!fs.existsSync(file)) throw new Error('找不到要上传的文件：' + file);
        await uploadAsset({ owner, repo, releaseId: release.id, token, file });
    }

    return release.html_url;
}

module.exports = { publishRelease, planAssetCleanup, readToken, repoSlug };

if (require.main === module) {
    const args = process.argv.slice(2);
    const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
    const files = args.filter(a => a.toLowerCase().endsWith('.zip'));
    if (!files.length) {
        console.error('用法：node pack/publish.js --tag v1.0.0 [--name 标题] [--notes-file x.md] 发行版/*.zip');
        process.exit(1);
    }
    const tag = flag('--tag');
    const notesFile = flag('--notes-file');
    publishRelease({
        tag: tag || 'v0.0.0',
        name: flag('--name') || tag || 'Release',
        body: notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : (flag('--body') || ''),
        assets: files,
        draft: args.includes('--draft'),
        prerelease: args.includes('--prerelease'),
        // 手动只传一两个包时别加这个开关，否则会按前缀把同一 Release 上的其它包一起删掉
        pruneStaleAssets: args.includes('--prune-stale')
    }).then(url => console.log('完成：' + url)).catch(e => {
        console.error('发布失败：' + e.message);
        process.exit(1);
    });
}
