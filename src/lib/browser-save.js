// ============================================================================
// 便携版核心：浏览器内取图 → 打 ZIP / 直写目录
// 该文件被 build.js 原样内联进 userscript，同时可直接被 Node require 做单测，
// 保证「测试的代码」与「发布的代码」是同一份。
// ============================================================================
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.__biliBrowserSave = api;                       // 供浏览器内自检 / 冒烟测试
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_EXT = '.jpg';

    // 与本地服务一致的非法字符净化规则（保证两个版本产出的文件名相同）
    function sanitizeFilename(name) {
        let s = String(name == null ? '' : name)
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\.{2,}/g, '_')
            .replace(/[. ]+$/, '');
        if (!s) s = '_';
        if (s === '.' || s === '..') s = '_';
        return s;
    }

    // 从地址推断扩展名（无扩展名时用）
    function extensionFromUrl(u) {
        try {
            const ext = new URL(u).pathname.split('@')[0].match(/\.[a-z0-9]{1,5}$/i);
            if (ext) return ext[0];
        } catch (e) { }
        return DEFAULT_EXT;
    }

    // 原图地址 → 落盘文件名（原图 hash 名，与服务端命名规则一致）
    function hashFileNameFromUrl(url) {
        let base = '';
        try {
            const pathname = new URL(url).pathname;
            base = decodeURIComponent(pathname.split('/').pop() || '');
        } catch (e) { }
        base = sanitizeFilename(base.split('@')[0]);
        if (!base || base === '_') base = 'image' + DEFAULT_EXT;
        if (!/\.[a-z0-9]{1,5}$/i.test(base)) base += extensionFromUrl(url);
        return sanitizeFilename(base);
    }

    // ZIP 包名：B站图片_20261002_181530.zip
    function buildZipName(date, prefix) {
        const d = date || new Date();
        const p = n => String(n).padStart(2, '0');
        const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
            '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
        return (prefix || 'B站图片') + '_' + stamp + '.zip';
    }

    // ------------------------------------------------------------------
    // CRC32（ZIP 必需）
    // ------------------------------------------------------------------
    const CRC_TABLE = (function () {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(u8) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // ------------------------------------------------------------------
    // STORE 模式 ZIP：图片本身已压缩，无需 deflate，零依赖零 CPU
    // entries: [{ name, data: Uint8Array }]  ->  Blob
    // 不做 Zip64：超过 32 位字段上限直接抛错（宁可不打包，也不产出坏包）
    // ------------------------------------------------------------------
    const MAX_U16 = 0xFFFF;
    const MAX_U32 = 0xFFFFFFFF;
    const ZIP_FLAGS_UTF8 = 0x0800;                  // EFS：声明条目名为 UTF-8

    function zipStore(entries) {
        if (entries.length > MAX_U16) throw new Error('ZIP 条目数超过 65535 上限，请减少单次保存数量后分批重试');
        const enc = new TextEncoder();
        let total = 22;                              // EOCD
        for (const e of entries) {
            const nameLen = enc.encode(e.name).length;
            if (nameLen > MAX_U16) throw new Error('ZIP 文件名过长，无法打包');
            total += 30 + nameLen + e.data.length + 46 + nameLen;
        }
        if (total > MAX_U32) throw new Error('ZIP 超过 4GB 上限，请减少单次保存数量后分批重试');

        const parts = [], central = [];
        const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
        const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
        let off = 0;
        for (const e of entries) {
            const nb = enc.encode(e.name);
            const data = e.data;
            const crc = crc32(data);
            const n = data.length;
            const local = new Uint8Array([
                ...u32(0x04034b50), ...u16(20), ...u16(ZIP_FLAGS_UTF8), ...u16(0), ...u16(0), ...u16(0),
                ...u32(crc), ...u32(n), ...u32(n), ...u16(nb.length), ...u16(0)
            ]);
            parts.push(local, nb, data);
            central.push(new Uint8Array([
                ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(ZIP_FLAGS_UTF8), ...u16(0), ...u16(0), ...u16(0),
                ...u32(crc), ...u32(n), ...u32(n), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0),
                ...u16(0), ...u32(0), ...u32(off)
            ]), nb);
            off += local.length + nb.length + n;
        }
        const cdOff = off;
        let cdLen = 0;
        for (const p of central) cdLen += p.length;
        const eocd = new Uint8Array([
            ...u32(0x06054b50), ...u16(0), ...u16(0),
            ...u16(entries.length), ...u16(entries.length), ...u32(cdLen), ...u32(cdOff), ...u16(0)
        ]);
        return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
    }

    // 分批规划：单个 ZIP 受 32 位字段限制（≤65535 条、≤4GB），超了就拆成多个包；
    // maxBytes 可传更小的软上限（如视频按内存预算分批）；单条超限时会单独成批（由 zipStore 兜底校验）
    function planZipBatches(entries, maxBytes) {
        const enc = new TextEncoder();
        const limit = Math.min(maxBytes || MAX_U32, MAX_U32);
        const batches = [];
        let cur = [], total = 22;
        for (const e of entries) {
            const add = 76 + enc.encode(e.name).length * 2 + e.data.length;
            if (cur.length && (cur.length >= MAX_U16 || total + add > limit)) {
                batches.push(cur);
                cur = []; total = 22;
            }
            cur.push(e);
            total += add;
        }
        if (cur.length) batches.push(cur);
        return batches;
    }

    // 打包体积 / 条目数统计（用于界面提示）
    function zipOverheadBytes(entries) {
        let n = 22;                                     // EOCD
        for (const e of entries) {
            n += 30 + 46;                               // 本地头 + 中央目录头
            n += new TextEncoder().encode(e.name).length * 2;
        }
        return n;
    }

    // ------------------------------------------------------------------
    // 已下载记账（IndexedDB）：浏览器无法扫目录时的跨会话查重
    // ------------------------------------------------------------------
    const IDB_NAME = 'bili_save_browser_v1';
    const IDB_FILES = 'files';        // 文件名集合
    const IDB_KV = 'kv';              // 杂项（目录句柄等）

    function idbOpen() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_FILES)) db.createObjectStore(IDB_FILES);
                if (!db.objectStoreNames.contains(IDB_KV)) db.createObjectStore(IDB_KV);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function idbTx(db, store, mode, fn) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const os = tx.objectStore(store);
            let out;
            try { out = fn(os); } catch (e) { reject(e); return; }
            tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    // 批量查询已存在记录 → Set(names)
    async function idbHasNames(names) {
        const db = await idbOpen();
        try {
            const found = new Set();
            await idbTx(db, IDB_FILES, 'readonly', os => {
                for (const n of names) {
                    const r = os.getKey(n);
                    r.onsuccess = () => { if (r.result !== undefined) found.add(n); };
                }
            });
            return found;
        } finally { db.close(); }
    }

    // 记账写入
    async function idbAddNames(names) {
        const db = await idbOpen();
        try {
            await idbTx(db, IDB_FILES, 'readwrite', os => {
                for (const n of names) os.put(Date.now(), n);
            });
        } finally { db.close(); }
    }

    async function idbClearNames() {
        const db = await idbOpen();
        try { await idbTx(db, IDB_FILES, 'readwrite', os => os.clear()); } finally { db.close(); }
    }

    // 列出已记账的名字（可用前缀过滤，如 'video:'）
    async function idbListNames(prefix) {
        const db = await idbOpen();
        try {
            return await new Promise((resolve, reject) => {
                const out = [];
                const req = db.transaction(IDB_FILES, 'readonly').objectStore(IDB_FILES).openKeyCursor();
                req.onsuccess = () => {
                    const cur = req.result;
                    if (!cur) { resolve(out); return; }
                    const k = String(cur.key);
                    if (!prefix || k.indexOf(prefix) === 0) out.push(k);
                    cur.continue();
                };
                req.onerror = () => reject(req.error);
            });
        } finally { db.close(); }
    }

    async function idbGetKV(key) {
        const db = await idbOpen();
        try {
            return await new Promise((resolve, reject) => {
                const r = db.transaction(IDB_KV, 'readonly').objectStore(IDB_KV).get(key);
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
            });
        } finally { db.close(); }
    }

    async function idbSetKV(key, value) {
        const db = await idbOpen();
        try {
            await new Promise((resolve, reject) => {
                const r = db.transaction(IDB_KV, 'readwrite').objectStore(IDB_KV).put(value, key);
                r.onsuccess = () => resolve();
                r.onerror = () => reject(r.error);
            });
        } finally { db.close(); }
    }

    async function idbDelKV(key) {
        const db = await idbOpen();
        try {
            await new Promise((resolve, reject) => {
                const r = db.transaction(IDB_KV, 'readwrite').objectStore(IDB_KV).delete(key);
                r.onsuccess = () => resolve();
                r.onerror = () => reject(r.error);
            });
        } finally { db.close(); }
    }

    return {
        sanitizeFilename,
        extensionFromUrl,
        hashFileNameFromUrl,
        buildZipName,
        crc32,
        zipStore,
        planZipBatches,
        zipOverheadBytes,
        idbOpen,
        idbHasNames,
        idbAddNames,
        idbClearNames,
        idbListNames,
        idbGetKV,
        idbSetKV,
        idbDelKV
    };
});
