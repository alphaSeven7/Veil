/* ==========================================================================
   Veil · 指纹浏览器 — 前端逻辑
   ========================================================================== */
'use strict';

/* ------------------------- 桥接 ------------------------- */
const hasNativeBridge = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.veil);
const Bridge = (() => {
  let seq = 0;
  const pending = new Map();
  window.__veilResolve = (id, val) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (val && typeof val === 'object' && val.__error) p.reject(new Error(val.__error));
    else p.resolve(val);
  };
  async function call(method, params) {
    if (hasNativeBridge) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.veil.postMessage({ id, method, params: params || {} });
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('调用超时: ' + method)); } }, 180000);
      });
    }
    // 浏览器直连模式（开发/远程管理）
    const r = await fetch('/__veil/bridge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: params || {} })
    });
    const v = await r.json();
    if (v && typeof v === 'object' && v.__error) throw new Error(v.__error);
    return v;
  }
  return { call, get native() { return hasNativeBridge; } };
})();

/* ------------------------- 全局状态 ------------------------- */
const S = {
  view: 'profiles',
  env: {}, settings: {}, host: {}, stats: {},
  profiles: [], groups: [], templates: [], running: [],
  sel: new Set(),
  query: '', groupId: '__all__', platform: 'all', runningOnly: false,
  sortKey: 'seq', sortDir: 1,
  editorTab: 'basic',
  geoCities: [], fontLists: {}, gpuLists: {},
  booting: true,
};

/* ------------------------- 工具 ------------------------- */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function on(root, evt, sel, fn) {
  root.addEventListener(evt, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
}
function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms), now = new Date();
  const p = n => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now - 86400000).toDateString() === d.toDateString();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (sameDay) return `今天 ${hm}`;
  if (yest) return `昨天 ${hm}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}
function fmtAgo(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
function fmtDur(sec) {
  sec = Math.floor(sec || 0);
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(sec % 60).padStart(2, '0')}s`;
  return `${sec}s`;
}
function copy(text, label) {
  const done = () => toast('ok', '已复制', label || '');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallback()); }
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('err', '复制失败', String(e)); }
    ta.remove();
  }
}
const OS_ICON = {
  windows: 'M3 5.5 10.2 4.4v7H3v-5.9Zm0 7.1h7.2v7L3 18.5v-5.9Zm8-.2H21V3.2l-9.9 1.5v7.7Zm0 1.4v7.7L21 20.8V11h-9.9Z',
  mac: 'M15.2 10.7c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7C7.3 6.2 6 7.4 5.3 8.6c-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2 1 0 1.4-.6 2.6-.6s1.6.6 2.6.6 1.7-.9 2.3-1.9c.7-1 1-2 1-2.1 0 0-2-.8-2.1-3.9ZM13.4 4.9c.5-.7.9-1.6.8-2.6-.8 0-1.8.5-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.9-.4 2.4-1.1Z',
  linux: 'M10 2c-1.7 0-2.6 1.2-2.6 3 0 1.3.2 2 .2 2.8 0 .9-.6 1.7-1.4 2.9C5 12.5 4 14 4 16c0 1.3.5 2.2 1.3 2.7.4.3.6.6.6 1 0 .4.2.7.6.7 1 0 1.6-1 1.6-2 0-.7-.3-1.2-.3-1.7 0-.5.4-1 1.2-1s1.2.5 1.2 1c0 .5-.3 1-.3 1.7 0 1 .6 2 1.6 2 .4 0 .6-.3.6-.7 0-.4.2-.7.6-1 .8-.5 1.3-1.4 1.3-2.7 0-2-1-3.5-2.2-5.3-.8-1.2-1.4-2-1.4-2.9 0-.8.2-1.5.2-2.8 0-1.8-.9-3-2.6-3Z',
  android: 'M6 9.5h12v6.2c0 .8-.6 1.4-1.4 1.4h-.9v2.2c0 .7-.6 1.2-1.2 1.2s-1.2-.6-1.2-1.2v-2.2h-2.6v2.2c0 .7-.6 1.2-1.2 1.2s-1.2-.6-1.2-1.2v-2.2h-.9C6.6 17.1 6 16.5 6 15.7V9.5ZM4.2 9.6c-.7 0-1.2.6-1.2 1.2v4.3c0 .7.5 1.2 1.2 1.2s1.2-.5 1.2-1.2v-4.3c0-.6-.5-1.2-1.2-1.2Zm15.6 0c-.7 0-1.2.6-1.2 1.2v4.3c0 .7.5 1.2 1.2 1.2s1.2-.5 1.2-1.2v-4.3c0-.6-.5-1.2-1.2-1.2ZM9.4 3.4 8.7 2.2a.3.3 0 0 1 .5-.3l.8 1.3A6.2 6.2 0 0 1 12 3c.7 0 1.4.1 2 .3l.8-1.3a.3.3 0 0 1 .5.3l-.7 1.2c1.3.7 2.2 1.9 2.4 3.3H7c.2-1.4 1.1-2.6 2.4-3.3ZM9.5 5.6a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm5 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
};
function osIcon(p) { return `<svg viewBox="0 0 20 22" width="13" height="13"><path fill="currentColor" d="${OS_ICON[p] || OS_ICON.windows}"/></svg>`; }
function osName(p) { return ({ windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android' })[p] || p; }
function proxyBadge(px) {
  if (!px || !px.type || px.type === 'none') return `<span class="badge px none">直连</span>`;
  if (px.type === 'custom') return `<span class="badge px">系统代理</span>`;
  const r = px.checkResult;
  const extra = r && r.ip ? ` · ${esc(r.ip)}` : '';
  return `<span class="badge px" title="${esc(px.host)}:${px.port}${extra}">${esc(px.type.toUpperCase())}${extra}</span>`;
}

/* ------------------------- Toast ------------------------- */
function toast(type, title, desc, ms) {
  const root = qs('#toastRoot'); if (!root) return;
  const icons = { ok: '✓', err: '✕', warn: '!', info: 'i' };
  const node = h(`<div class="toast ${type}">
      <div class="ic">${icons[type] || 'i'}</div>
      <div class="tx"><div class="tt">${esc(title)}</div>${desc ? `<div class="td">${esc(desc)}</div>` : ''}</div>
      <button class="cl" title="关闭">×</button></div>`).firstChild;
  root.appendChild(node);
  const kill = () => { node.classList.add('out'); setTimeout(() => node.remove(), 200); };
  node.querySelector('.cl').onclick = kill;
  setTimeout(kill, ms || (type === 'err' ? 7000 : 3200));
  while (root.children.length > 5) root.firstChild.remove();
  return node;
}

/* ------------------------- Modal ------------------------- */
function modal(opts) {
  const root = qs('#modalRoot');
  const mask = h(`<div class="modal-mask"></div>`).firstChild;
  const box = h(`<div class="modal ${opts.size || ''}" role="dialog">
      <div class="modal-head">
        <h2>${opts.icon ? `<span class="fp-head" style="padding:0;background:none;border:0"><span class="ic">${opts.icon}</span></span>` : ''}
            ${esc(opts.title)} ${opts.subtitle ? `<span class="sub">${esc(opts.subtitle)}</span>` : ''}</h2>
        ${opts.headExtra || ''}
        ${opts.dismissible === false ? '' : '<button class="x-btn" data-close title="关闭">✕</button>'}
      </div>
      ${opts.tabs ? `<div class="tabs">${opts.tabs}</div>` : ''}
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.footer === null ? '' : `<div class="modal-foot">${opts.footer || ''}</div>`}
    </div>`).firstChild;
  mask.appendChild(box);
  root.appendChild(mask);
  const api = {
    mask, box,
    body: qs('.modal-body', box),
    close() { mask.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); },
  };
  function onKey(e) { if (e.key === 'Escape' && opts.dismissible !== false) api.close(); }
  document.addEventListener('keydown', onKey);
  if (opts.dismissible !== false) mask.addEventListener('mousedown', e => { if (e.target === mask) api.close(); });
  qsa('[data-close]', box).forEach(b => b.onclick = () => api.close());
  if (opts.onMount) opts.onMount(api);
  return api;
}
function confirmDlg(opts) {
  return new Promise(res => {
    let done = false;
    const m = modal({
      title: opts.title || '请确认', size: '',
      body: `<div class="stack"><div class="notice ${opts.tone || 'warn'}">${opts.message || ''}</div>
             ${opts.detail ? `<div class="mono-s">${esc(opts.detail)}</div>` : ''}
             ${opts.extra || ''}</div>`,
      footer: `<div class="grow"></div>
               <button class="btn" data-no>${esc(opts.cancelText || '取消')}</button>
               <button class="btn ${opts.okClass || 'btn-primary'}" data-yes>${esc(opts.okText || '确定')}</button>`,
      onClose: () => { if (!done) { done = true; res(false); } },
      onMount(api) {
        qs('[data-no]', api.box).onclick = () => { done = true; api.close(); res(false); };
        qs('[data-yes]', api.box).onclick = () => { done = true; api.close(); res(true); };
        setTimeout(() => qs('[data-yes]', api.box).focus(), 40);
      }
    });
    void m;
  });
}
function promptDlg(opts) {
  return new Promise(res => {
    let done = false;
    const id = 'p' + Date.now();
    modal({
      title: opts.title || '请输入', size: '',
      body: `<div class="stack">
        ${opts.message ? `<div class="hint">${esc(opts.message)}</div>` : ''}
        ${opts.fields.map(f => `<div class="field"><label for="${id}_${f.key}">${esc(f.label)}</label>
          ${f.type === 'select'
            ? `<select id="${id}_${f.key}">${f.options.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(f.value) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`
            : f.type === 'textarea'
              ? `<textarea id="${id}_${f.key}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
              : `<input id="${id}_${f.key}" type="${f.type || 'text'}" value="${esc(f.value === undefined || f.value === null ? '' : f.value)}" placeholder="${esc(f.placeholder || '')}">`}
          ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}
      </div>`,
      footer: `<div class="grow"></div><button class="btn" data-no>取消</button>
               <button class="btn btn-primary" data-ok>${esc(opts.okText || '确定')}</button>`,
      onClose: () => { if (!done) { done = true; res(null); } },
      onMount(api) {
        const read = () => {
          const out = {};
          opts.fields.forEach(f => { out[f.key] = qs(`#${id}_${f.key}`, api.box).value; });
          return out;
        };
        qs('[data-no]', api.box).onclick = () => { done = true; api.close(); res(null); };
        qs('[data-ok]', api.box).onclick = () => { done = true; const v = read(); api.close(); res(v); };
        api.box.addEventListener('keydown', e => {
          if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); qs('[data-ok]', api.box).click(); }
        });
        const first = qs(`#${id}_${opts.fields[0].key}`, api.box);
        setTimeout(() => { first.focus(); if (first.select) first.select(); }, 40);
      }
    });
  });
}

/* ==========================================================================
   视图：窗口列表
   ========================================================================== */
function viewProfiles() {
  const st = S.stats || {};
  const groupOpts = [`<option value="__all__">全部分组</option>`]
    .concat(S.groups.map(g => `<option value="${esc(g.id)}" ${S.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`))
    .concat([`<option value="__none__" ${S.groupId === '__none__' ? 'selected' : ''}>未分组</option>`]).join('');
  const platformOpts = ['all', 'windows', 'mac', 'linux', 'android']
    .map(p => `<option value="${p}" ${S.platform === p ? 'selected' : ''}>${p === 'all' ? '全部系统' : osName(p)}</option>`).join('');

  return `<div class="view">
    <div class="view-head">
      <div class="view-title">
        <h1>窗口</h1>
        <p>每个窗口都是完全隔离的浏览器环境：独立 Cookie / 缓存 / 指纹</p>
      </div>
      <div class="view-tools">
        <select id="fGroup" style="width:132px">${groupOpts}</select>
        <select id="fPlatform" style="width:112px">${platformOpts}</select>
        <label class="switch" title="只看运行中的窗口"><input type="checkbox" id="fRunning" ${S.runningOnly ? 'checked' : ''}><span class="track"></span><span class="lb">运行中</span></label>
        <div style="width:1px;height:20px;background:var(--line)"></div>
        <button class="btn" id="btnBatchNew" title="批量新建">
          <svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M2 3h8v1H2V3Zm0 3h8v1H2V6Zm10-3v3h3v1h-3v3H9V7H6V6h3V3h3Z"/></svg>批量新建</button>
        <button class="btn" id="btnImport" title="导入窗口">导入</button>
        <button class="btn" id="btnExport" title="导出全部">导出</button>
        <button class="btn btn-primary" id="btnNew">
          <svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M8 2.5a.8.8 0 0 1 .8.8v3.9h3.9a.8.8 0 0 1 0 1.6H8.8v3.9a.8.8 0 0 1-1.6 0V8.8H3.3a.8.8 0 0 1 0-1.6h3.9V3.3a.8.8 0 0 1 .8-.8Z"/></svg>
          新建窗口</button>
      </div>
    </div>

    <div class="view-body">
      <div class="stats">
        <div class="stat ac"><div class="k">窗口总数</div><div class="v">${st.total || 0}</div></div>
        <div class="stat ok"><div class="k"><span class="dot dot-live"></span> 运行中</div><div class="v">${st.running || 0}</div></div>
        <div class="stat"><div class="k">已配代理</div><div class="v">${st.withProxy || 0}</div></div>
        <div class="stat"><div class="k">累计启动</div><div class="v">${st.totalOpens || 0}<small>次</small></div></div>
        <div class="stat warn"><div class="k">占用空间</div><div class="v">${(st.diskUsageMB || 0) > 1024 ? ((st.diskUsageMB / 1024).toFixed(2) + '') : (st.diskUsageMB || 0)}<small>${(st.diskUsageMB || 0) > 1024 ? 'GB' : 'MB'}</small></div></div>
      </div>

      ${bulkBar()}
      <div id="profileTable">${tableHTML()}</div>
    </div>
  </div>`;
}

function bulkBar() {
  const n = S.sel.size;
  if (!n) return '';
  return `<div class="row wrap" style="margin:0 0 10px;padding:9px 12px;background:var(--ac-soft);border:1px solid var(--ac-line);border-radius:var(--r-l);animation:fadeIn .15s">
    <b style="font-size:12.5px;color:#a9bcff">已选 ${n} 个窗口</b>
    <div style="width:1px;height:18px;background:var(--ac-line)"></div>
    <button class="btn btn-sm" data-bulk="open">▶ 批量打开</button>
    <button class="btn btn-sm" data-bulk="close">■ 批量关闭</button>
    <button class="btn btn-sm" data-bulk="group">移入分组</button>
    <button class="btn btn-sm" data-bulk="enable">启用</button>
    <button class="btn btn-sm" data-bulk="disable">停用</button>
    <button class="btn btn-sm" data-bulk="proxyCheck">检测代理</button>
    <button class="btn btn-sm" data-bulk="export">导出</button>
    <button class="btn btn-sm" data-bulk="clearCache">清除缓存</button>
    <button class="btn btn-sm btn-bad" data-bulk="delete">删除</button>
    <div class="grow"></div>
    <button class="btn btn-sm btn-ghost" data-bulk="none">取消选择</button>
  </div>`;
}

function sortedProfiles() {
  let list = S.profiles.slice();
  const k = S.sortKey, dir = S.sortDir;
  const get = p => {
    switch (k) {
      case 'seq': return p.seq;
      case 'name': return (p.name || '').toLowerCase();
      case 'platform': return p.fp ? p.fp.platform : '';
      case 'proxy': return p.proxy && p.proxy.host ? p.proxy.host : '';
      case 'country': return p.fp ? p.fp.timezone : '';
      case 'lastOpenedAt': return p.lastOpenedAt || 0;
      case 'status': return p.running ? 0 : 1;
      default: return p.seq;
    }
  };
  list.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  return list;
}

function tableHTML() {
  const list = sortedProfiles();
  if (!list.length) {
    return `<div class="empty">
      <div class="ic"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2.2 4.4 5.3v6.1c0 4.6 3.1 8.9 7.6 10.4 4.5-1.5 7.6-5.8 7.6-10.4V5.3L12 2.2Z"/></svg></div>
      <h3>${S.query || S.groupId !== '__all__' || S.platform !== 'all' ? '没有匹配的窗口' : '还没有窗口'}</h3>
      <p>${S.query || S.groupId !== '__all__' || S.platform !== 'all'
        ? '试试调整搜索词或筛选条件。'
        : '点击「新建窗口」创建第一个隔离环境。每个窗口拥有独立的 Cookie、缓存与一整套伪造指纹（Canvas / WebGL / 音频 / 字体 / 时区 / WebRTC / 硬件参数），并可单独绑定代理。'}</p>
      <button class="btn btn-primary btn-lg" id="btnEmptyNew">创建第一个窗口</button>
    </div>`;
  }
  const allSel = list.every(p => S.sel.has(p.id));
  const rows = list.map(p => {
    const running = !!p.running;
    const g = S.groups.find(x => x.id === p.groupId);
    const px = p.veil && p.veil.proxy ? p.veil.proxy : {};
    const fp = p.veil ? p.veil.fp : {};
    return `<tr data-id="${esc(p.id)}" class="${running ? 'run' : ''} ${S.sel.has(p.id) ? 'sel' : ''} ${p.enabled === false ? 'off' : ''}">
      <td class="c-check"><input type="checkbox" class="ck rowck" ${S.sel.has(p.id) ? 'checked' : ''}></td>
      <td class="c-seq"><span class="seq-badge">${p.seq}</span></td>
      <td><div class="name-cell"><div style="min-width:0"><div class="nm">${esc(p.name)}</div>
          ${p.remark ? `<div class="rk">${esc(p.remark)}</div>` : ''}</div></div></td>
      <td>${g ? `<span class="gchip" title="${esc(g.name)}"><i style="background:${esc(g.color)}"></i>${esc(g.name)}</span>` : '<span class="badge stop">未分组</span>'}</td>
      <td><span class="badge os-${esc(fp.platform || 'windows')}" title="${esc(fp.platform)}">${osIcon(fp.platform || 'windows')}&nbsp;${esc(osName(fp.platform || 'windows'))}</span></td>
      <td>${proxyBadge(px)}</td>
      <td class="ellipsis" title="${esc(fp.timezone || '')}">${esc(p.countryName || fp.timezone || '—')}</td>
      <td>${running ? `<span class="badge run"><i></i>运行中</span>`
        : (p.enabled === false ? `<span class="badge dis"><i></i>已停用</span>` : `<span class="badge stop"><i></i>未运行</span>`)}</td>
      <td class="ellipsis" title="${p.lastOpenedAt ? fmtTime(p.lastOpenedAt) : ''}">${p.lastOpenedAt ? fmtAgo(p.lastOpenedAt) : '从未'}</td>
      <td class="c-act"><div class="rowacts">
        ${running
          ? `<button class="btn btn-sm" data-act="detect" title="打开指纹自检页">自检</button>
             <button class="btn btn-sm btn-bad" data-act="close" title="关闭窗口">关闭</button>`
          : `<button class="btn btn-sm btn-ok" data-act="open" title="打开窗口">▶ 打开</button>`}
        <button class="btn btn-sm" data-act="edit" title="编辑 (双击行)">编辑</button>
        <button class="btn btn-sm btn-ghost" data-act="more" title="更多">⋯</button>
      </div></td>
    </tr>`;
  }).join('');

  return `<div class="tbl-wrap"><table class="tbl">
    <colgroup>
      <col style="width:34px"><col style="width:48px"><col><col style="width:118px"><col style="width:104px">
      <col style="width:150px"><col style="width:150px"><col style="width:96px"><col style="width:100px"><col style="width:206px">
    </colgroup>
    <thead><tr>
      <th class="c-check"><input type="checkbox" class="ck" id="ckAll" ${allSel ? 'checked' : ''}></th>
      <th data-sort="seq">#</th><th data-sort="name">名称</th><th>分组</th>
      <th data-sort="platform">系统</th><th>代理</th><th data-sort="country">地区 / 时区</th>
      <th data-sort="status">状态</th><th data-sort="lastOpenedAt">最后打开</th><th style="text-align:right">操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function bindProfiles(root) {
  on(root, 'click', '[data-sort]', (e, t) => {
    const k = t.dataset.sort;
    if (S.sortKey === k) S.sortDir = -S.sortDir; else { S.sortKey = k; S.sortDir = 1; }
    refreshTable();
  });
  on(root, 'change', '#ckAll', e => {
    const list = sortedProfiles();
    if (e.target.checked) list.forEach(p => S.sel.add(p.id)); else list.forEach(p => S.sel.delete(p.id));
    refreshTable(); renderBulk();
  });
  on(root, 'change', '.rowck', (e, t) => {
    const id = t.closest('tr').dataset.id;
    if (t.checked) S.sel.add(id); else S.sel.delete(id);
    t.closest('tr').classList.toggle('sel', t.checked);
    renderBulk();
    const ck = qs('#ckAll', root); const list = sortedProfiles();
    if (ck) { ck.checked = list.every(p => S.sel.has(p.id)); ck.indeterminate = !ck.checked && list.some(p => S.sel.has(p.id)); }
  });
  on(root, 'dblclick', 'tbody tr', (e, t) => { if (!e.target.closest('button,input')) openEditor(t.dataset.id); });
  on(root, 'click', '[data-act]', (e, t) => {
    const id = t.closest('tr').dataset.id;
    const act = t.dataset.act;
    if (act === 'open') doOpen([id]);
    else if (act === 'close') doClose([id]);
    else if (act === 'edit') openEditor(id);
    else if (act === 'detect') doDetect(id);
    else if (act === 'more') rowMore(t, id);
  });
  on(root, 'click', '[data-bulk]', (e, t) => doBulk(t.dataset.bulk));
  on(root, 'click', '#btnEmptyNew', () => quickNew());
  qs('#fGroup', root).onchange = e => { S.groupId = e.target.value; loadProfiles(); };
  qs('#fPlatform', root).onchange = e => { S.platform = e.target.value; loadProfiles(); };
  qs('#fRunning', root).onchange = e => { S.runningOnly = e.target.checked; loadProfiles(); };
}

function refreshTable() { const box = qs('#profileTable'); if (box) box.innerHTML = tableHTML(); }
function renderBulk() {
  const body = qs('#content .view-body'); if (!body || S.view !== 'profiles') return;
  let bar = qs('#bulkBarHost', body);
  const html = bulkBar();
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'bulkBarHost';
    body.insertBefore(bar, qs('#profileTable', body));
  }
  bar.innerHTML = html;
}

/* ------------------------- 行内「更多」菜单 ------------------------- */
function rowMore(anchor, id) {
  closePop();
  const p = S.profiles.find(x => x.id === id); if (!p) return;
  const items = [
    ['edit', '编辑窗口'], ['dup', '创建副本'], ['dupCache', '副本（含缓存/Cookie）'],
    ['-', ''],
    ['openNew', '在新标签打开网址…'], ['copyWs', '复制 CDP 连接信息'],
    ['cookies', 'Cookie 管理'], ['clearCache', '清除浏览器缓存'],
    ['-', ''],
    ['toggle', p.enabled === false ? '启用窗口' : '停用窗口'],
    ['revealDir', '在访达中显示目录'],
    ['-', ''], ['del', '删除窗口'],
  ];
  const pop = h(`<div class="pop">${items.map(([k, t]) => k === '-'
    ? '<div class="pop-sep"></div>'
    : `<button class="pop-i ${k === 'del' ? 'danger' : ''}" data-k="${k}">${esc(t)}</button>`).join('')}</div>`).firstChild;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', closePop, { once: true }), 0);
  on(pop, 'click', '.pop-i', (e, t) => { closePop(); rowAction(t.dataset.k, id); });
}
function closePop() { qsa('.pop').forEach(p => p.remove()); }

async function rowAction(k, id) {
  const p = S.profiles.find(x => x.id === id); if (!p && k !== 'del') return;
  switch (k) {
    case 'edit': openEditor(id); break;
    case 'dup': case 'dupCache': {
      const n = await promptDlg({ title: '创建副本', message: '副本会生成新的噪声种子（即不同指纹），但保留其它配置。', fields: [{ key: 'count', label: '副本数量', type: 'number', value: 1 }] });
      if (!n) return;
      const r = await Bridge.call('duplicateProfiles', { id, count: Math.max(1, parseInt(n.count) || 1), copyCache: k === 'dupCache' });
      toast('ok', `已创建 ${r.count} 个副本`); await loadProfiles(); break;
    }
    case 'openNew': {
      const v = await promptDlg({ title: '在窗口中打开网址', fields: [{ key: 'url', label: 'URL', placeholder: 'https://example.com' }] });
      if (!v || !v.url) return;
      const s = S.running.find(x => x.id === id);
      if (!s) { toast('warn', '窗口未运行', '正在先打开窗口…'); await doOpen([id]); }
      const r = await Bridge.call('navigate', { id, url: v.url });
      if (r.ok) toast('ok', '已跳转', v.url); else toast('err', '跳转失败', r.msg || '');
      break;
    }
    case 'copyWs': {
      const s = S.running.find(x => x.id === id);
      if (!s) { toast('warn', '窗口未运行', '请先打开窗口再复制 CDP 地址'); return; }
      copy(s.ws, s.ws); break;
    }
    case 'cookies': openCookieDlg(id); break;
    case 'clearCache': {
      const ok = await confirmDlg({ title: '清除浏览器缓存', tone: 'warn', message: '将删除该窗口的 <b>Cookie、LocalStorage、IndexedDB、缓存</b>等全部浏览数据。<br>窗口配置与指纹不受影响。', okText: '清除', okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('clearProfileData', { ids: [id] });
      toast('ok', '已清除', '下次打开时是全新环境'); break;
    }
    case 'toggle': {
      await Bridge.call('setEnabled', { ids: [id], enabled: p.enabled === false });
      await loadProfiles(); break;
    }
    case 'revealDir': await Bridge.call('reveal', { path: (S.env.supportDir || '') + '/profiles/' + id }); break;
    case 'del': {
      const ok = await confirmDlg({ title: '删除窗口', tone: 'bad', message: `确定删除 <b>${esc(p ? p.name : id)}</b>？<br>该窗口的浏览数据（Cookie / 缓存）会一并删除，且无法恢复。`, okText: '删除', okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('deleteProfiles', { ids: [id], deleteData: true });
      S.sel.delete(id); toast('ok', '已删除'); await loadProfiles(); break;
    }
  }
}

/* ==========================================================================
   核心动作
   ========================================================================== */
async function loadProfiles(keepSel) {
  const r = await Bridge.call('listProfiles', { query: S.query, groupId: S.groupId, platform: S.platform, runningOnly: S.runningOnly });
  S.profiles = r.list || [];
  S.groups = r.groups || [];
  if (!keepSel) { const ids = new Set(S.profiles.map(p => p.id)); S.sel = new Set([...S.sel].filter(i => ids.has(i))); }
  try { S.stats = await Bridge.call('profileStats', {}); } catch (e) { /* ignore */ }
  try { S.running = (await Bridge.call('running', {})).list || []; } catch (e) { S.running = []; }
  updateChrome();
  if (S.view === 'profiles') { refreshTable(); renderBulk(); updateFilterOptions(); }
  else if (S.view === 'running') renderView(true);
}
function updateFilterOptions() {
  const g = qs('#fGroup');
  if (g) {
    const cur = g.value;
    g.innerHTML = [`<option value="__all__">全部分组</option>`]
      .concat(S.groups.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`))
      .concat([`<option value="__none__">未分组</option>`]).join('');
    g.value = cur;
  }
}
function updateChrome() {
  const run = S.running.length || (S.stats && S.stats.running) || 0;
  qs('#tbRunning').textContent = run;
  qs('#tbTotal').textContent = (S.stats && S.stats.total) || S.profiles.length;
  qs('#navCountProfiles').textContent = (S.stats && S.stats.total) || 0;
  qs('#navCountRunning').textContent = run;
  qs('#navCountGroups').textContent = S.groups.length;
  qs('#navCountTemplates').textContent = S.templates.length;
  qs('#navApiPort').textContent = S.env.apiPort || '—';
  const live = run > 0;
  const d = qs('#tbStat .dot'); if (d) d.className = 'dot' + (live ? ' dot-live' : '');
}

async function doOpen(ids) {
  if (!ids.length) return;
  const t = toast('info', `正在打开 ${ids.length} 个窗口…`, '启动浏览器并注入指纹', 60000);
  try {
    const res = await Bridge.call('openProfiles', { ids, concurrency: 2 });
    t.classList.add('out'); setTimeout(() => t.remove(), 200);
    const okN = res.filter(r => r.ok).length;
    const bad = res.filter(r => !r.ok);
    if (okN) toast('ok', `已打开 ${okN} 个窗口`, ids.length > 1 ? `失败 ${bad.length} 个` : '');
    bad.forEach(b => {
      const p = S.profiles.find(x => x.id === b.id);
      toast('err', `#${p ? p.seq : '?'} ${p ? p.name : b.id} 打开失败`, b.msg || '', 12000);
    });
  } catch (e) {
    t.classList.add('out'); setTimeout(() => t.remove(), 200);
    toast('err', '打开失败', String(e.message || e), 10000);
  }
  await loadProfiles(true);
}
async function doClose(ids) {
  if (!ids.length) return;
  await Bridge.call('closeProfiles', { ids });
  toast('ok', `已关闭 ${ids.length} 个窗口`);
  await loadProfiles(true);
}
async function doDetect(id) {
  const r = await Bridge.call('detect', { id });
  if (r.ok) toast('ok', '已在窗口中打开自检页', r.url);
  else toast('err', '无法打开自检页', r.msg || '窗口未运行');
}

async function doBulk(kind) {
  const ids = [...S.sel];
  if (!ids.length) return;
  switch (kind) {
    case 'none': S.sel.clear(); refreshTable(); renderBulk(); return;
    case 'open': return doOpen(ids);
    case 'close': return doClose(ids);
    case 'enable': case 'disable':
      await Bridge.call('setEnabled', { ids, enabled: kind === 'enable' });
      toast('ok', kind === 'enable' ? '已启用' : '已停用', `${ids.length} 个窗口`);
      return loadProfiles(true);
    case 'delete': {
      const withData = await confirmDlg({ title: `删除 ${ids.length} 个窗口`, tone: 'bad', message: '将删除这些窗口及其浏览数据（Cookie / 缓存）。<br>此操作不可恢复。', okText: '删除', okClass: 'btn-bad', extra: `<label class="switch" style="margin-top:4px"><input type="checkbox" id="delKeep"><span class="track"></span><span class="lb">仅删除配置，保留浏览数据目录</span></label>` });
      if (!withData) return;
      const keep = qs('#delKeep'); const keepData = keep ? keep.checked : false;
      await Bridge.call('deleteProfiles', { ids, deleteData: !keepData });
      ids.forEach(i => S.sel.delete(i));
      toast('ok', `已删除 ${ids.length} 个窗口`); return loadProfiles();
    }
    case 'group': {
      const v = await promptDlg({ title: '移入分组', fields: [{ key: 'g', label: '目标分组', type: 'select', options: S.groups.map(g => ({ v: g.id, t: g.name })).concat([{ v: '', t: '（未分组）' }]) }] });
      if (!v) return;
      for (const id of ids) {
        const p = S.profiles.find(x => x.id === id);
        if (p && p.veil) { p.veil.groupId = v.g; await Bridge.call('saveProfile', { profile: p.veil }); }
      }
      toast('ok', `已移动 ${ids.length} 个窗口`); return loadProfiles(true);
    }
    case 'proxyCheck': {
      const t = toast('info', `正在检测 ${ids.length} 个代理…`, '', 120000);
      let okN = 0, failN = 0;
      for (const id of ids) {
        const p = S.profiles.find(x => x.id === id); if (!p || !p.veil || !p.veil.proxy || !p.veil.proxy.host) { failN++; continue; }
        try { const r = await Bridge.call('checkProxy', { proxy: p.veil.proxy, profileId: id }); if (r.ok) okN++; else failN++; } catch (e) { failN++; }
      }
      t.remove(); toast(okN ? 'ok' : 'warn', `代理检测完成`, `成功 ${okN} · 失败 ${failN}`);
      return loadProfiles(true);
    }
    case 'export': return doExport(ids);
    case 'clearCache': {
      const ok = await confirmDlg({ title: '清除缓存', tone: 'warn', message: `将删除 ${ids.length} 个窗口的全部浏览数据。`, okText: '清除', okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('clearProfileData', { ids });
      toast('ok', '已清除'); return;
    }
  }
}

async function quickNew(platform) {
  const r = await Bridge.call('newProfile', { platform: platform || 'windows', groupId: (S.groupId !== '__all__' && S.groupId !== '__none__') ? S.groupId : '', count: 1 });
  const p = r.list[0];
  toast('ok', `已创建 #${p.seq} ${p.name}`, p.fp.timezone);
  await loadProfiles();
  openEditor(p.id);
}
async function batchNew() {
  const v = await promptDlg({
    title: '批量新建窗口',
    message: '每个窗口都会生成互相独立的随机指纹与噪声种子。',
    fields: [
      { key: 'count', label: '数量（1-200）', type: 'number', value: 5 },
      { key: 'platform', label: '目标系统', type: 'select', options: [{ v: 'windows', t: 'Windows' }, { v: 'mac', t: 'macOS' }, { v: 'linux', t: 'Linux' }] },
      { key: 'country', label: '地区（可选，用于匹配时区/语言）', type: 'select', options: [{ v: '', t: '随机' }].concat(countryOptions()) },
      { key: 'prefix', label: '名称前缀（可选）', placeholder: '例如 FB广告账户' },
    ],
    okText: '创建'
  });
  if (!v) return;
  const n = Math.max(1, Math.min(200, parseInt(v.count) || 1));
  const t = toast('info', `正在创建 ${n} 个窗口…`, '', 60000);
  const created = [];
  for (let i = 0; i < n; i++) {
    const r = await Bridge.call('newProfile', {
      platform: v.platform, country: v.country || undefined,
      groupId: (S.groupId !== '__all__' && S.groupId !== '__none__') ? S.groupId : '',
      name: v.prefix ? `${v.prefix} ${i + 1}` : undefined
    });
    created.push(r.list[0]);
  }
  t.remove();
  toast('ok', `已创建 ${created.length} 个窗口`, `序号 ${created[0].seq} - ${created[created.length - 1].seq}`);
  await loadProfiles();
}
function countryOptions() {
  const seen = new Map();
  (S.geoCities || []).forEach(c => { if (!seen.has(c.cc)) seen.set(c.cc, c.country); });
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh')).map(([cc, name]) => ({ v: cc, t: `${name} (${cc})` }));
}

async function doExport(ids) {
  const r = await Bridge.call('exportProfiles', { ids: ids || null });
  if (Bridge.native) {
    const s = await Bridge.call('saveFile', { filename: r.filename, content: r.json, message: `导出 ${r.count} 个窗口配置` });
    if (s.ok) toast('ok', '已导出', s.path);
  } else {
    const blob = new Blob([r.json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.filename; a.click();
    toast('ok', '已导出', r.filename);
  }
}
async function doImport() {
  let text = '';
  if (Bridge.native) {
    const f = await Bridge.call('openFile', { message: '选择 Veil 导出的 JSON 文件', types: ['json', 'txt'] });
    if (!f.ok) return; text = f.text;
  } else {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.txt';
    text = await new Promise(res => { inp.onchange = () => { const fr = new FileReader(); fr.onload = () => res(fr.result); inp.files[0] && fr.readAsText(inp.files[0]); }; inp.click(); });
  }
  if (!text) return;
  try {
    const r = await Bridge.call('importProfiles', { json: text });
    toast('ok', `已导入 ${r.imported} 个窗口`);
    await loadProfiles();
  } catch (e) { toast('err', '导入失败', String(e.message || e), 8000); }
}

/* ==========================================================================
   窗口编辑器
   ========================================================================== */
const E = { p: null, tab: 'basic', dirty: false, api: null };

function byPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, val) {
  const ks = path.split('.'); const last = ks.pop();
  let o = obj; for (const k of ks) { if (o[k] == null) o[k] = {}; o = o[k]; }
  o[last] = val;
}
function castVal(el, cur) {
  const v = el.value;
  if (el.type === 'checkbox') return el.checked;
  if (typeof cur === 'number') { const n = parseFloat(v); return isNaN(n) ? cur : n; }
  if (Array.isArray(cur)) return v.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return v;
}

function openEditor(id) {
  const found = S.profiles.find(x => x.id === id);
  const p = found && found.veil ? JSON.parse(JSON.stringify(found.veil)) : null;
  if (!p) { toast('err', '无法打开编辑器', '未找到窗口数据'); return; }
  E.p = p; E.tab = 'basic'; E.dirty = false;
  const tabs = [['basic', '基础'], ['proxy', '代理'], ['fp', '指纹'], ['launch', '启动'], ['auto', '自动化']]
    .map(([k, t]) => `<button class="tab ${k === E.tab ? 'active' : ''}" data-tab="${k}">${t}</button>`).join('');
  E.api = modal({
    title: `编辑窗口 #${p.seq}`, subtitle: p.name, size: 'wide', tabs,
    body: '<div class="busy"><div class="spinner lg"></div>载入中…</div>',
    footer: `<div class="row" style="gap:6px;color:var(--tx-4);font-size:11px">
                 <span class="mono-s" title="指纹种子">seed ${esc((p.fp.seed || '').slice(0, 12))}…</span>
               </div>
               <div class="grow"></div>
               <button class="btn" data-act="cancel">取消</button>
               <button class="btn" data-act="saveTemplate">存为模板</button>
               <button class="btn" data-act="reset">重置指纹</button>
               <button class="btn btn-primary" data-act="save">保存</button>`,
    onMount(api) {
      renderEditorTab();
      on(api.box, 'click', '.tab', (e, t) => { E.tab = t.dataset.tab; qsa('.tab', api.box).forEach(x => x.classList.toggle('active', x === t)); renderEditorTab(); });
      on(api.box, 'input', '[data-bind]', e => { setPath(E.p, e.target.dataset.bind, castVal(e.target, byPath(E.p, e.target.dataset.bind))); E.dirty = true; afterBind(e.target); });
      on(api.box, 'change', '[data-bind]', e => { setPath(E.p, e.target.dataset.bind, castVal(e.target, byPath(E.p, e.target.dataset.bind))); E.dirty = true; afterBind(e.target); });
      on(api.box, 'click', '[data-ed]', (e, t) => editorAction(t.dataset.ed, t, api));
      qs('[data-act="cancel"]', api.box).onclick = () => api.close();
      qs('[data-act="save"]', api.box).onclick = () => saveEditor(api);
      qs('[data-act="reset"]', api.box).onclick = () => editorAction('reseed', null, api);
      qs('[data-act="saveTemplate"]', api.box).onclick = () => editorAction('saveTpl', null, api);
    }
  });
}

function afterBind(el) {
  const b = el.dataset.bind;
  if (b === 'fp.platform') { renderEditorTab(); return; }
  if (b && b.startsWith('fp.canvasNoiseLevel')) { const o = qs('[data-out=canvasLevel]'); if (o) o.textContent = (+el.value).toFixed(3); }
  if (b && b.startsWith('fp.audioNoiseLevel')) { const o = qs('[data-out=audioLevel]'); if (o) o.textContent = (+el.value).toExponential(1); }
  if (b === 'fp.timezone') syncCityFromTz();
  if (b === 'proxy.host' || b === 'proxy.port' || b === 'proxy.type') { const o = qs('[data-out=proxyLabel]'); if (o) o.textContent = proxySummary(E.p.proxy); }
}

function proxySummary(px) {
  if (!px || !px.type || px.type === 'none') return '直连（使用本机网络）';
  if (px.type === 'custom') return '跟随系统代理设置';
  const auth = px.username ? `${px.username}:****@` : '';
  return `${px.type}://${auth}${px.host || '?'}:${px.port || '?'}`;
}

function renderEditorTab() {
  if (!E.api || !E.p) return;
  const body = E.api.body;
  const p = E.p;
  if (E.tab === 'basic') body.innerHTML = tabBasic(p);
  else if (E.tab === 'proxy') { body.innerHTML = tabProxy(p); bindProxyTab(body); }
  else if (E.tab === 'fp') { body.innerHTML = tabFingerprint(p); bindFpTab(body); }
  else if (E.tab === 'launch') body.innerHTML = tabLaunch(p);
  else if (E.tab === 'auto') { body.innerHTML = tabAuto(p); bindAutoTab(body); }
  body.scrollTop = 0;
}

/* ---------------- 基础 ---------------- */
function tabBasic(p) {
  const gOpts = [`<option value="">（未分组）</option>`].concat(S.groups.map(g =>
    `<option value="${esc(g.id)}" ${p.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`)).join('');
  return `<div class="stack">
    <div class="grid2">
      <div class="field"><label>窗口名称</label><input data-bind="name" value="${esc(p.name)}" placeholder="例如 广告账户-A1"></div>
      <div class="field"><label>序号</label><input data-bind="seq" type="number" min="1" value="${p.seq}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>所属分组</label><select data-bind="groupId">${gOpts}</select></div>
      <div class="field"><label>目标系统 <span class="hint" style="font-weight:400">决定 UA / 显卡 / 字体集</span></label>
        <select data-bind="fp.platform">
          ${['windows', 'mac', 'linux', 'android'].map(x => `<option value="${x}" ${p.fp.platform === x ? 'selected' : ''}>${osName(x)}</option>`).join('')}
        </select></div>
    </div>
    <div class="field"><label>备注</label><textarea data-bind="remark" rows="2" placeholder="用途、账号、注意事项…">${esc(p.remark || '')}</textarea></div>
    <div class="field"><label>标签（逗号分隔）</label><input data-bind="tags" value="${esc((p.tags || []).join(', '))}" placeholder="例如 电商, 美国, 主号"></div>
    <label class="switch"><input type="checkbox" class="ck" data-bind="enabled" ${p.enabled !== false ? 'checked' : ''}><span class="track"></span><span class="lb">启用该窗口（停用后不会出现在批量打开列表中）</span></label>
    <hr class="sep">
    <div class="fp-grid">
      ${kv('窗口 ID', p.id)}
      ${kv('创建时间', fmtTime(p.createdAt))}
      ${kv('最后打开', p.lastOpenedAt ? fmtTime(p.lastOpenedAt) : '从未')}
      ${kv('累计启动', (p.openCount || 0) + ' 次')}
      ${kv('指纹模式', { random: '随机生成', custom: '完全自定义', real: '真实机器' }[p.fp.mode] || p.fp.mode)}
      ${kv('数据目录', 'profiles/' + p.id + '/data')}
    </div>
    <div class="notice info">每个窗口使用独立的 <code>--user-data-dir</code>，Cookie、LocalStorage、IndexedDB、缓存、Service Worker 完全隔离，互不影响。</div>
  </div>`;
}
function kv(k, v) { return `<div><div class="lbl" style="margin-bottom:3px">${esc(k)}</div><div class="mono-s">${esc(v)}</div></div>`; }

/* ---------------- 代理 ---------------- */
function tabProxy(p) {
  const px = p.proxy || {};
  const r = px.checkResult;
  return `<div class="stack">
    <div class="notice info">Chrome 的 <code>--proxy-server</code> 不支持带账号密码的代理。Veil 会在本地启动一个中继（<code>127.0.0.1:随机端口</code>），自动完成 HTTP / HTTPS / SOCKS5 认证后再转发，页面侧完全无感。</div>
    <div class="grid2">
      <div class="field"><label>代理类型</label>
        <select data-bind="proxy.type">
          ${[['none', '不使用代理（本机直连）'], ['custom', '跟随系统代理'], ['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']]
            .map(([v, t]) => `<option value="${v}" ${(px.type || 'none') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>粘贴代理字符串（自动解析）</label>
        <div class="row"><input id="pxPaste" placeholder="http://user:pass@1.2.3.4:8080" style="flex:1">
        <button class="btn" data-ed="parseProxy">解析</button></div></div>
    </div>
    <div class="grid3">
      <div class="field"><label>主机</label><input data-bind="proxy.host" value="${esc(px.host || '')}" placeholder="1.2.3.4"></div>
      <div class="field"><label>端口</label><input data-bind="proxy.port" type="number" value="${px.port || ''}" placeholder="8080"></div>
      <div class="field"><label>出口预览</label><div class="mono-s" data-out="proxyLabel" style="padding-top:7px">${esc(proxySummary(px))}</div></div>
    </div>
    <div class="grid2">
      <div class="field"><label>用户名</label><input data-bind="proxy.username" value="${esc(px.username || '')}" autocomplete="off"></div>
      <div class="field"><label>密码</label><input data-bind="proxy.password" type="password" value="${esc(px.password || '')}" autocomplete="off"></div>
    </div>
    <div class="row wrap">
      <button class="btn btn-primary" data-ed="checkProxy"><span class="spinner hidden" data-role="pxSpin"></span>检测代理</button>
      <button class="btn" data-ed="syncTz">用出口 IP 的时区/语言覆盖指纹</button>
      <div class="grow"></div>
      ${r ? `<span class="badge ${r.ok ? 'run' : 'dis'}">${r.ok ? '可用' : '不可用'}</span>
             <span class="hint">检测于 ${fmtTime(r.checkedAt)}</span>` : ''}
    </div>
    <div id="pxResult">${r ? proxyResultHTML(r) : ''}</div>
  </div>`;
}
function proxyResultHTML(r) {
  if (!r.ok) return `<div class="notice bad"><b>代理不可用</b> — ${esc(r.error || '未知错误')}</div>`;
  return `<div class="fp-sec open"><div class="fp-head"><span class="ic">🌐</span><h4>出口信息</h4>
      <span class="d">${esc(r.ip)} · ${esc(r.country || '')} ${esc(r.city || '')} · ${r.latencyMs}ms</span></div>
    <div class="fp-body"><div class="fp-grid">
      ${kv('出口 IP', r.ip)}${kv('国家', `${r.country || '—'} (${r.countryCode || '—'})`)}
      ${kv('城市', r.city || '—')}${kv('地区', r.region || '—')}
      ${kv('IP 时区', r.timezone || '—')}${kv('延迟', r.latencyMs + ' ms')}
    </div>
    ${r.timezone && r.timezone !== (E.p.fp.timezone) ? `<div class="notice warn">指纹时区为 <code>${esc(E.p.fp.timezone)}</code>，与出口 IP 时区 <code>${esc(r.timezone)}</code> 不一致 —— 这是常见的风控关联点，建议点「用出口 IP 的时区/语言覆盖指纹」。</div>` : ''}
    </div></div>`;
}
function bindProxyTab(root) { }

/* ---------------- 启动 ---------------- */
function tabLaunch(p) {
  const lc = p.launch || {};
  const browsers = (S.env.browsers || []).map(b => `<option value="${esc(b.path)}" ${lc.browserPath === b.path ? 'selected' : ''}>${esc(b.name)} ${esc(b.version || '')}</option>`).join('');
  return `<div class="stack">
    <div class="field"><label>浏览器内核</label>
      <div class="row"><select data-bind="launch.browserPath" style="flex:1">
          <option value="">自动选择（默认 Google Chrome）</option>${browsers}
          ${lc.browserPath && !(S.env.browsers || []).some(b => b.path === lc.browserPath) ? `<option value="${esc(lc.browserPath)}" selected>${esc(lc.browserPath)}</option>` : ''}
        </select>
        <button class="btn" data-ed="pickBrowser">浏览…</button>
        <button class="btn" data-ed="refreshBrowsers">刷新</button></div>
      <div class="hint">已安装：${(S.env.browsers || []).map(b => esc(b.name)).join(' · ') || '未检测到'}</div></div>
    <div class="field"><label>启动页</label>
      <div class="row"><input data-bind="launch.homepage" value="${esc(lc.homepage || '')}" placeholder="留空 = Chrome 新标签页；也可填 veil://detect 直接打开指纹自检页" style="flex:1"></div>
      <div class="hint">特殊地址：<code>veil://detect</code> = 内置指纹自检页</div></div>
    <div class="field"><label>同时打开的其它标签页（每行一个）</label>
      <textarea data-bind="launch.extraTabs" rows="2" placeholder="https://example.com">${esc((lc.extraTabs || []).join('\n'))}</textarea></div>
    <div class="grid2">
      <div class="field"><label>窗口位置策略</label>
        <select data-bind="launch.windowPositionMode">
          ${[['cascade', '级联排列（推荐，多开不重叠）'], ['fixed', '固定坐标'], ['auto', '由系统决定']]
            .map(([v, t]) => `<option value="${v}" ${(lc.windowPositionMode || 'cascade') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>固定坐标 X , Y</label>
        <div class="row"><input data-bind="launch.windowPositionX" type="number" value="${lc.windowPositionX || 0}" style="width:50%">
        <input data-bind="launch.windowPositionY" type="number" value="${lc.windowPositionY || 0}" style="width:50%"></div></div>
    </div>
    <div class="field"><label>额外命令行参数（每行一个）</label>
      <textarea data-bind="launch.extraArgs" rows="3" placeholder="--disable-gpu&#10;--ignore-certificate-errors">${esc((lc.extraArgs || []).join('\n'))}</textarea>
      <div class="hint">Veil 已自动附加：<code>--user-data-dir</code>、<code>--remote-debugging-port</code>、<code>--disable-blink-features=AutomationControlled</code>、<code>--proxy-server</code>、<code>--lang</code>、<code>--window-size</code> 等。</div></div>
    <hr class="sep">
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.useMockKeychain" ${lc.useMockKeychain !== false ? 'checked' : ''}><span class="track"></span><span class="lb">使用模拟钥匙串（避免频繁弹出 macOS 钥匙串授权）</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.hideDebugInfobar" ${lc.hideDebugInfobar !== false ? 'checked' : ''}><span class="track"></span><span class="lb">隐藏「不受支持的命令行标记」提示条</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.incognito" ${lc.incognito ? 'checked' : ''}><span class="track"></span><span class="lb">以隐身模式启动</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.keepRunningAfterQuit" ${lc.keepRunningAfterQuit !== false ? 'checked' : ''}><span class="track"></span><span class="lb">Veil 退出后保留该窗口运行（下次启动 Veil 会自动重新接管）</span></label>
  </div>`;
}

/* ---------------- 自动化 ---------------- */
function tabAuto(p) {
  const a = p.automation || {};
  const cks = a.cookies || [];
  return `<div class="stack">
    <div class="field"><label>窗口打开后执行的 JS（每段之间用一行 <code>---</code> 分隔，会在每个新文档中注入）</label>
      <textarea rows="5" id="autoScripts" placeholder="例如：屏蔽某个弹窗、设置 localStorage、模拟点击…">${esc((a.scripts || []).join('\n---\n'))}</textarea>
      <div class="hint">脚本运行在页面主世界，与指纹注入脚本同层，可用于站点专属的自动化处理。</div></div>
    <hr class="sep">
    <div class="row">
      <b style="font-size:13px">Cookie</b>
      <span class="badge">${cks.length} 条</span>
      <div class="grow"></div>
      <button class="btn btn-sm" data-ed="ckImport">导入</button>
      <button class="btn btn-sm" data-ed="ckExportJson">导出 JSON</button>
      <button class="btn btn-sm" data-ed="ckExportTxt">导出 Netscape</button>
      <button class="btn btn-sm" data-ed="ckLive">读取运行中窗口的 Cookie</button>
      <button class="btn btn-sm btn-bad" data-ed="ckClear">清空</button>
    </div>
    <div class="hint">保存的 Cookie 会在窗口启动、加载任何页面之前通过 CDP <code>Storage.setCookies</code> 写入。</div>
    <div id="ckList">${cks.length ? `<div class="tbl-wrap" style="max-height:280px;overflow:auto"><table class="tbl">
      <thead><tr><th style="width:22%">名称</th><th>值</th><th style="width:22%">域</th><th style="width:14%">路径</th><th style="width:15%">过期</th></tr></thead>
      <tbody>${cks.slice(0, 400).map(c => `<tr>
        <td class="mono-s">${esc(c.name)}</td>
        <td class="mono-s ellipsis" title="${esc(c.value)}">${esc((c.value || '').slice(0, 60))}${(c.value || '').length > 60 ? '…' : ''}</td>
        <td class="mono-s">${esc(c.domain)}</td><td class="mono-s">${esc(c.path || '/')}</td>
        <td class="mono-s">${c.expires > 0 ? fmtTime(c.expires * 1000) : '会话'}</td></tr>`).join('')}
      </tbody></table></div>${cks.length > 400 ? `<div class="hint">仅显示前 400 条，共 ${cks.length} 条。</div>` : ''}`
      : `<div class="empty" style="padding:26px"><p style="max-width:none">尚未导入 Cookie</p></div>`}</div>
  </div>`;
}
function bindAutoTab(root) {
  const ta = qs('#autoScripts', root);
  if (ta) {
    ta.oninput = () => {
      E.p.automation = E.p.automation || {};
      E.p.automation.scripts = ta.value.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
      E.dirty = true;
    };
  }
}

/* ==========================================================================
   指纹面板
   ========================================================================== */
function sec(id, icon, title, desc, body, open) {
  return `<details class="fp-sec" ${open ? 'open' : ''} id="sec-${id}">
    <summary class="fp-head"><span class="ic">${icon}</span><h4>${title}</h4><span class="d">${desc}</span>
      <svg class="chev" viewBox="0 0 12 12" width="11" height="11"><path fill="currentColor" d="M4.5 2.5 8 6l-3.5 3.5z"/></svg>
    </summary><div class="fp-body">${body}</div></details>`;
}
function sw(bind, checked, label, hint) {
  return `<label class="switch"><input type="checkbox" class="ck" data-bind="${bind}" ${checked ? 'checked' : ''}>
    <span class="track"></span><span class="lb">${label}${hint ? ` <span class="hint">· ${hint}</span>` : ''}</span></label>`;
}
function num(bind, label, val, extra) {
  return `<div class="field"><label>${label}</label><input type="number" data-bind="${bind}" value="${val}" ${extra || ''}></div>`;
}
function txt(bind, label, val, ph, extra) {
  return `<div class="field"><label>${label}</label><input type="text" data-bind="${bind}" value="${esc(val === undefined || val === null ? '' : val)}" placeholder="${esc(ph || '')}" ${extra || ''}></div>`;
}
function sel(bind, label, options, val) {
  return `<div class="field"><label>${label}</label><select data-bind="${bind}">${options.map(o =>
    `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;
}
function rng(bind, label, val, min, max, step, out, fmt) {
  return `<div class="field"><label>${label} <span class="mono-s" data-out="${out}" style="float:right">${fmt(val)}</span></label>
    <input type="range" data-bind="${bind}" value="${val}" min="${min}" max="${max}" step="${step}" style="width:100%;margin-top:5px"></div>`;
}

function citySelectHTML(fp) {
  const byCountry = {};
  (S.geoCities || []).forEach(c => { (byCountry[c.country] = byCountry[c.country] || []).push(c); });
  let groups = '';
  Object.keys(byCountry).sort().forEach(country => {
    groups += `<optgroup label="${esc(country)}">` + byCountry[country]
      .map(c => `<option value="${esc(c.timezone)}|${esc(c.locale)}" ${fp.timezone === c.timezone ? 'selected' : ''}>${esc(c.city)} — ${esc(c.timezone)}</option>`).join('') + `</optgroup>`;
  });
  return `<select id="citySel" style="width:100%"><option value="">— 选择城市自动匹配时区/语言/经纬度 —</option>${groups}</select>`;
}

function tabFingerprint(p) {
  const fp = p.fp, md = fp.uaMetadata || {};
  const warn = fpConsistency(p);
  return `<div class="stack">
    <div class="row wrap" style="gap:7px">
      <div class="seg">
        ${[['random', '随机生成'], ['custom', '完全自定义'], ['real', '真实机器']].map(([v, t]) =>
          `<button data-ed="mode:${v}" class="${fp.mode === v ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <div class="grow"></div>
      <button class="btn btn-sm" data-ed="reseed">🎲 换一个指纹</button>
      <button class="btn btn-sm" data-ed="useReal">用本机真实指纹</button>
      <button class="btn btn-sm" data-ed="loadTpl">载入模板…</button>
    </div>

    <div class="fp-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div><div class="lbl" style="margin-bottom:3px">噪声种子</div>
        <div class="row"><input class="mono-s" data-bind="fp.seed" value="${esc(fp.seed)}" style="flex:1;font-family:var(--fm);font-size:10.5px">
        <button class="btn btn-sm" data-ed="reseed" title="重新生成">↻</button></div></div>
      <div><div class="lbl" style="margin-bottom:3px">目标系统</div>
        <select data-bind="fp.platform">${['windows', 'mac', 'linux', 'android'].map(x =>
          `<option value="${x}" ${fp.platform === x ? 'selected' : ''}>${osName(x)}</option>`).join('')}</select></div>
      <div><div class="lbl" style="margin-bottom:3px">模式说明</div>
        <div class="mono-s" style="padding-top:6px">${{ random: '按种子可复现地生成', custom: '所有字段手动控制', real: '与本机完全一致' }[fp.mode] || fp.mode}</div></div>
    </div>

    ${warn.length ? `<div class="notice warn"><div><b>一致性提醒（${warn.length}）</b><br>${warn.map(w => '· ' + w).join('<br>')}</div></div>` :
      `<div class="notice ok"><b>指纹自洽</b> — UA、Client Hints、平台、显卡、字体、时区、语言之间未发现矛盾。</div>`}

    ${sec('base', '🌍', '基础环境', `${esc(fp.timezone)} · ${esc((fp.languages || []).join(', '))}`, `
      <div class="field"><label>城市（联动时区 / 语言 / 经纬度）</label>${citySelectHTML(fp)}</div>
      <div class="grid3">
        ${txt('fp.timezone', '时区 (IANA)', fp.timezone, 'America/New_York')}
        ${txt('fp.locale', '区域设置', fp.locale, 'en-US')}
        ${txt('fp.acceptLanguage', 'Accept-Language 头', fp.acceptLanguage, 'en-US,en;q=0.9')}
      </div>
      <div class="grid2">
        ${txt('fp.languages', 'navigator.languages（逗号分隔）', (fp.languages || []).join(', '), 'en-US,en')}
        <div class="field"><label>地理位置</label>
          <div class="row">${sw('fp.geo.enabled', fp.geo && fp.geo.enabled, '覆写', '')}
          <input type="number" step="0.0001" data-bind="fp.geo.latitude" value="${fp.geo ? fp.geo.latitude : 0}" style="flex:1" placeholder="纬度">
          <input type="number" step="0.0001" data-bind="fp.geo.longitude" value="${fp.geo ? fp.geo.longitude : 0}" style="flex:1" placeholder="经度"></div></div>
      </div>
      <hr class="sep">
      ${txt('fp.userAgent', 'User-Agent', fp.userAgent, '')}
      <details style="margin-top:2px"><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">Client Hints (sec-ch-ua*) — 点击展开</summary>
        <div class="stack" style="margin-top:9px">
          <div class="grid3">
            ${txt('fp.uaMetadata.platform', 'platform', md.platform, 'Windows')}
            ${txt('fp.uaMetadata.platformVersion', 'platformVersion', md.platformVersion, '15.0.0')}
            ${txt('fp.uaMetadata.fullVersion', 'fullVersion', md.fullVersion, '152.0.7977.83')}
          </div>
          <div class="grid4">
            ${txt('fp.uaMetadata.architecture', 'architecture', md.architecture, 'x86')}
            ${txt('fp.uaMetadata.bitness', 'bitness', md.bitness, '64')}
            ${txt('fp.uaMetadata.model', 'model', md.model, '')}
            ${sel('fp.uaMetadata.mobile', 'mobile', [{ v: 'false', t: 'false' }, { v: 'true', t: 'true' }], String(!!md.mobile))}
          </div>
          ${txt('fp.uaMetadata.brandsText', 'brands（JSON 数组，可选）', JSON.stringify(md.brands || []))}
          <div class="hint">留空/非法 JSON 时保持原值。GREASE 品牌串（如 <code>${esc((md.brands || []).find(b => (b.brand || '').startsWith('Not')) ? (md.brands || []).find(b => b.brand.startsWith('Not')).brand : 'Not?A_Brand')}</code>）随 Chrome 大版本轮换，Veil 通过本机探针取真值，建议只使用与本机 Chrome 相同的大版本。</div>
          <div class="row"><button class="btn btn-sm" data-ed="genUA">按当前 Chrome 版本重建 UA + Client Hints</button></div>
        </div>
      </details>
    `, true)}

    ${sec('screen', '🖥️', '屏幕与窗口', `${fp.screenWidth}×${fp.screenHeight} · DPR ${fp.devicePixelRatio}`, `
      <div class="grid4">
        ${num('fp.screenWidth', '屏幕宽', fp.screenWidth)}
        ${num('fp.screenHeight', '屏幕高', fp.screenHeight)}
        ${num('fp.colorDepth', '色深', fp.colorDepth)}
        ${num('fp.pixelDepth', '像素深度', fp.pixelDepth)}
      </div>
      <div class="grid4">
        ${num('fp.devicePixelRatio', 'devicePixelRatio', fp.devicePixelRatio, 'step="0.25" min="0.5" max="4"')}
        ${num('fp.availTopOffset', '任务栏/菜单栏占用高度', fp.availTopOffset)}
        ${num('fp.windowWidth', '窗口宽', fp.windowWidth)}
        ${num('fp.windowHeight', '窗口高', fp.windowHeight)}
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="resPreset">常用分辨率预设…</button>
        ${sw('fp.forceViewport', fp.forceViewport, '用 CDP 强制视口与 DPR', '开启后页面渲染尺寸也会被强制')}
      </div>
      <div class="hint">屏幕尺寸通过 JS 覆写 <code>screen.*</code> 实现；窗口真实尺寸由 <code>--window-size</code> 控制，二者已保持一致。</div>
    `)}

    ${sec('hw', '⚙️', '硬件特征', `${fp.hardwareConcurrency} 核 · ${fp.deviceMemory} GB`, `
      <div class="grid4">
        ${num('fp.hardwareConcurrency', 'CPU 逻辑核心数', fp.hardwareConcurrency, 'min="1" max="128"')}
        ${num('fp.deviceMemory', 'deviceMemory (GB)', fp.deviceMemory, 'min="0.25" step="0.25"')}
        ${num('fp.maxTouchPoints', 'maxTouchPoints', fp.maxTouchPoints, 'min="0" max="10"')}
        ${txt('fp.navPlatform', 'navigator.platform', fp.navPlatform, 'Win32')}
      </div>
      <div class="grid2">
        ${txt('fp.navVendor', 'navigator.vendor', fp.navVendor, 'Google Inc.')}
        ${sel('fp.effectiveType', 'navigator.connection.effectiveType', ['4g', '3g', '2g', 'slow-2g'].map(v => ({ v, t: v })), fp.effectiveType)}
      </div>
      ${sw('fp.batterySpoof', fp.batterySpoof, '伪造电池 API', `电量 ${(Math.round((fp.batteryLevel || 0.8) * 100))}%`)}
      <input type="range" data-bind="fp.batteryLevel" min="0.05" max="1" step="0.01" value="${fp.batteryLevel || 0.8}" style="width:100%">
      ${sw('fp.connectionSpoof', fp.connectionSpoof, '伪造 NetworkInformation', '')}
      <div class="hint">真实机器的 <code>deviceMemory</code> 只会是 0.25/0.5/1/2/4/8 之一（Chrome 的量化值），建议从中选取。</div>
    `)}

    ${sec('gl', '🎨', 'Canvas / WebGL', `${fp.canvasNoise ? 'Canvas 噪声 ' + (+fp.canvasNoiseLevel).toFixed(3) : 'Canvas 未开启'} · ${esc((fp.webglRenderer || '').slice(0, 46))}`, `
      ${sw('fp.canvasNoise', fp.canvasNoise, '启用 Canvas 指纹噪声', '对 toDataURL / toBlob / getImageData 的读取结果做确定性微扰')}
      ${rng('fp.canvasNoiseLevel', 'Canvas 噪声强度', fp.canvasNoiseLevel || 0.02, 0.002, 0.12, 0.002, 'canvasLevel', v => (+v).toFixed(3))}
      <div class="hint">噪声由指纹种子决定，同一窗口每次读取结果稳定一致（不会自相矛盾）；改动幅度在 ±2 LSB，肉眼不可见。</div>
      <hr class="sep">
      ${sw('fp.webglSpoof', fp.webglSpoof, '伪造 WebGL 厂商与渲染器', '')}
      <div class="grid2">
        ${txt('fp.webglVendor', 'UNMASKED_VENDOR_WEBGL', fp.webglVendor, 'Google Inc. (NVIDIA)')}
        ${txt('fp.webglRenderer', 'UNMASKED_RENDERER_WEBGL', fp.webglRenderer, '')}
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="gpuPreset">显卡预设…</button>
        ${sw('fp.webglNoise', fp.webglNoise, 'readPixels 噪声', '')}
        ${sw('fp.webgl2', fp.webgl2, '支持 WebGL2', '')}
        ${sel('fp.webgpu', 'WebGPU (navigator.gpu)', [{ v: 'auto', t: '保持默认' }, { v: 'hide', t: '隐藏（更常见）' }], fp.webgpu)}
      </div>
      ${txt('fp.webglVersion', 'gl.VERSION', fp.webglVersion, 'WebGL 1.0 (OpenGL ES 2.0 Chromium)')}
      <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">WebGL 参数覆写（MAX_TEXTURE_SIZE 等）</summary>
        <div id="glParams" style="margin-top:9px">${glParamsHTML(fp.webglParams || {})}</div>
        <button class="btn btn-sm" data-ed="glParamAdd">+ 添加参数</button></details>
      <div class="hint">显卡字符串必须与目标系统匹配：Windows 用 <code>ANGLE (NVIDIA, … Direct3D11 …)</code>，macOS 用 <code>ANGLE (Apple, ANGLE Metal Renderer: …)</code>，Linux 用 <code>ANGLE (…, OpenGL 4.x)</code>。用「显卡预设」可自动匹配。</div>
    `)}

    ${sec('audio', '🔊', '音频指纹', fp.audioNoise ? '噪声 ' + (fp.audioNoiseLevel || 0).toExponential(1) : '未开启', `
      ${sw('fp.audioNoise', fp.audioNoise, '启用 AudioContext 指纹噪声', '扰动 AudioBuffer.getChannelData 与 AnalyserNode 输出')}
      ${rng('fp.audioNoiseLevel', '音频噪声幅度', fp.audioNoiseLevel || 0.0001, 0.00001, 0.0005, 0.00001, 'audioLevel', v => (+v).toExponential(1))}
      <div class="hint">默认幅度约 -80 dB，人耳不可闻，但足以改变 AudioContext 指纹哈希。</div>
    `)}

    ${sec('net', '🛰️', 'WebRTC 与隐私', fp.webrtcMode, `
      ${sel('fp.webrtcMode', 'WebRTC 策略', [
        { v: 'disabled', t: '禁用（不暴露任何 IP，最安全）' },
        { v: 'proxy', t: '仅公网 IP（走代理出口）' },
        { v: 'custom', t: '自定义 IP 映射' },
        { v: 'real', t: '真实（不干预）' }], fp.webrtcMode)}
      <div class="grid2">
        ${txt('fp.webrtcPublicIp', '对外呈现的公网 IP', fp.webrtcPublicIp, '留空 = 自动丢弃候选')}
        ${txt('fp.webrtcLocalIps', '伪造的内网 IP（逗号分隔）', (fp.webrtcLocalIps || []).join(', '), '192.168.1.23')}
      </div>
      <div class="hint">禁用模式下 SDP 中的 <code>a=candidate</code> 与 <code>c=IN IP4</code> 会被清除，并附加 <code>--force-webrtc-ip-handling-policy=disable_non_proxied_udp</code> 双重保险。</div>
      <hr class="sep">
      ${sw('fp.doNotTrack', fp.doNotTrack, 'Do Not Track = 1', '仅约 2% 的真实用户开启，可能反而成为特征')}
      ${sw('fp.permissionsSpoof', fp.permissionsSpoof, '统一 Permissions API 返回值', '与 Notification.permission 保持一致')}
      ${sw('fp.speechVoicesSpoof', fp.speechVoicesSpoof, '过滤语音合成列表', 'getVoices() 会泄漏系统语言与版本')}
      ${sw('fp.hideWebdriver', fp.hideWebdriver !== false, '隐藏自动化痕迹', 'navigator.webdriver=false + 清理 cdc_/$cdc_ 等标记')}
    `)}

    ${sec('fonts', '🔤', '字体', `${fp.fontsMode === 'system' ? '使用真实字体' : (fp.fonts || []).length + ' 个伪装字体'}`, `
      ${sel('fp.fontsMode', '字体策略', [
        { v: 'system', t: '不干预（暴露本机真实字体）' },
        { v: 'preset', t: '预设列表（拦截 document.fonts.check 探测）' },
        { v: 'strict', t: '严格模式（额外注入 @font-face 做度量替换）' }], fp.fontsMode)}
      <div class="field"><label>允许的字体列表</label>
        <textarea data-bind="fp.fonts" rows="5">${esc((fp.fonts || []).join(', '))}</textarea>
        <div class="hint">逗号或换行分隔。应使用目标系统的常见字体集合。</div></div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="fontWin">Windows 字体集</button>
        <button class="btn btn-sm" data-ed="fontMac">macOS 字体集</button>
        <button class="btn btn-sm" data-ed="fontLinux">Linux 字体集</button>
        <button class="btn btn-sm" data-ed="fontReal">本机真实字体集</button>
      </div>
      ${fp.fontsMode === 'strict' ? `<div class="notice warn"><b>严格模式说明</b><br>会注入大量 <code>@font-face</code> 规则，用本机字体度量伪装成目标字体。副作用：<code>document.fonts</code> 中会多出这些 FontFace 条目，属于可被察觉的痕迹。一般推荐「预设列表」。</div>` : ''}
    `)}

    ${sec('misc', '🧩', '媒体设备 / 插件 / 存储', `${fp.audioInputs + fp.audioOutputs + fp.videoInputs} 个设备`, `
      <div class="grid4">
        ${sw('fp.mediaDevicesSpoof', fp.mediaDevicesSpoof, '伪造', '')}
        ${num('fp.audioInputs', '麦克风数', fp.audioInputs, 'min="0" max="5"')}
        ${num('fp.audioOutputs', '扬声器数', fp.audioOutputs, 'min="0" max="6"')}
        ${num('fp.videoInputs', '摄像头数', fp.videoInputs, 'min="0" max="4"')}
      </div>
      <hr class="sep">
      ${sw('fp.pdfViewer', fp.pdfViewer, '暴露 PDF 插件（真实 Chrome 恒为 5 个插件 / 2 个 MIME）', '')}
      ${num('fp.pluginsCount', 'navigator.plugins.length', fp.pluginsCount, 'min="0" max="5"')}
      <div class="hint">存储配额 <code>navigator.storage.estimate()</code> 会泄漏真实磁盘容量，Veil 按指纹种子生成一个合理值（无需配置）。</div>
    `)}
  </div>`;
}

function glParamsHTML(params) {
  const keys = Object.keys(params);
  if (!keys.length) return `<div class="hint" style="margin-bottom:8px">未覆写任何 WebGL 参数（使用真实值）。</div>`;
  return `<div class="stack" style="gap:6px">` + keys.map((k, i) => `<div class="row">
      <input value="${esc(k)}" data-glk="${i}" style="flex:1;font-family:var(--fm);font-size:11px">
      <input value="${esc(params[k])}" data-glv="${i}" style="flex:1;font-family:var(--fm);font-size:11px">
      <button class="btn btn-sm btn-ghost" data-ed="glParamDel:${esc(k)}">✕</button>
    </div>`).join('') + `</div>`;
}

function fpConsistency(p) {
  const w = [], fp = p.fp, md = fp.uaMetadata || {};
  const uaPlat = /Windows NT/.test(fp.userAgent || '') ? 'windows'
    : /Macintosh/.test(fp.userAgent || '') ? 'mac'
      : /Android/.test(fp.userAgent || '') ? 'android'
        : /Linux/.test(fp.userAgent || '') ? 'linux' : '?';
  if (uaPlat !== '?' && uaPlat !== fp.platform) w.push(`UA 声明的是 ${osName(uaPlat)}，但目标系统是 ${osName(fp.platform)}`);
  if (md.platform && md.platform.toLowerCase().indexOf(fp.platform === 'mac' ? 'mac' : fp.platform) !== 0)
    w.push(`Client Hints platform=<code>${esc(md.platform)}</code> 与目标系统 ${osName(fp.platform)} 不符`);
  const navPlat = { windows: 'Win32', mac: 'MacIntel', linux: 'Linux x86_64', android: 'Linux armv8l' }[fp.platform];
  if (navPlat && fp.navPlatform !== navPlat) w.push(`navigator.platform 建议为 <code>${navPlat}</code>，当前是 <code>${esc(fp.navPlatform)}</code>`);
  const r = fp.webglRenderer || '';
  if (fp.platform === 'windows' && !/Direct3D|D3D11/.test(r) && r) w.push('Windows 的 WebGL renderer 应包含 Direct3D11 / D3D11');
  if (fp.platform === 'mac' && !/Metal/.test(r) && r) w.push('macOS 的 WebGL renderer 应为 ANGLE Metal Renderer');
  if (fp.platform === 'linux' && !/OpenGL/.test(r) && r) w.push('Linux 的 WebGL renderer 通常包含 OpenGL');
  const uaMajor = parseInt(((fp.userAgent || '').match(/Chrome\/(\d+)/) || [])[1] || '0', 10);
  const chMajor = parseInt((md.fullVersion || '').split('.')[0] || '0', 10);
  if (uaMajor && chMajor && uaMajor !== chMajor) w.push(`UA 大版本(${uaMajor}) 与 Client Hints fullVersion(${chMajor}) 不一致`);
  const installed = (S.host && S.host.chromeMajor) || 0;
  if (uaMajor && installed && Math.abs(uaMajor - installed) > 3) w.push(`UA 版本 ${uaMajor} 与本机 Chrome ${installed} 相差较大 —— TLS/JA3 指纹仍会暴露真实版本，建议贴近 ${installed}`);
  const langs = fp.languages || [];
  if (langs.length && (fp.acceptLanguage || '').indexOf(langs[0]) !== 0) w.push(`Accept-Language 应以 <code>${esc(langs[0])}</code> 开头`);
  if (fp.deviceMemory && [0.25, 0.5, 1, 2, 4, 8, 16, 32].indexOf(fp.deviceMemory) < 0) w.push(`deviceMemory=<code>${fp.deviceMemory}</code> 不是 Chrome 的量化值（应为 0.25/0.5/1/2/4/8）`);
  if (fp.windowWidth > fp.screenWidth || fp.windowHeight > fp.screenHeight - (fp.availTopOffset || 0))
    w.push('窗口尺寸大于屏幕可用区域');
  if (fp.maxTouchPoints > 0 && fp.platform === 'windows') w.push('桌面版 Windows Chrome 的 maxTouchPoints 通常为 0');
  const tzCity = (S.geoCities || []).find(c => c.timezone === fp.timezone);
  if (tzCity && langs.length && !langs.some(l => l.toLowerCase().startsWith(tzCity.locale.split('-')[0].toLowerCase())))
    w.push(`时区在 ${esc(tzCity.city)}，但语言 <code>${esc(langs.join(','))}</code> 与 ${esc(tzCity.locale)} 不匹配`);
  if (fp.doNotTrack) w.push('Do Not Track 已开启（真实用户中极少见）');
  if (p.proxy && p.proxy.host && (!p.proxy.port || p.proxy.port <= 0)) w.push('代理主机已填写但端口缺失');
  if (p.proxy && p.proxy.checkResult && p.proxy.checkResult.ok && p.proxy.checkResult.timezone && p.proxy.checkResult.timezone !== fp.timezone)
    w.push(`出口 IP 时区 <code>${esc(p.proxy.checkResult.timezone)}</code> 与指纹时区 <code>${esc(fp.timezone)}</code> 不一致`);
  return w;
}

/* ---------------- 指纹面板交互 ---------------- */
function bindFpTab(root) {
  const citySel = qs('#citySel', root);
  if (citySel) citySel.onchange = () => {
    const v = citySel.value; if (!v) return;
    const [tz, locale] = v.split('|');
    const c = (S.geoCities || []).find(x => x.timezone === tz && x.locale === locale) || (S.geoCities || []).find(x => x.timezone === tz);
    if (!c) return;
    E.p.fp.timezone = c.timezone; E.p.fp.locale = c.locale; E.p.fp.languages = c.languages.slice();
    E.p.fp.acceptLanguage = acceptLang(c.languages);
    E.p.fp.geo = E.p.fp.geo || {};
    E.p.fp.geo.enabled = true;
    E.p.fp.geo.latitude = +(c.lat + (Math.random() - 0.5) * 0.05).toFixed(4);
    E.p.fp.geo.longitude = +(c.lon + (Math.random() - 0.5) * 0.05).toFixed(4);
    E.dirty = true; renderEditorTab();
    toast('ok', `已匹配 ${c.city}`, `${c.timezone} · ${c.languages.join(', ')}`);
  };
  on(root, 'input', '[data-glk],[data-glv]', e => {
    const params = E.p.fp.webglParams = E.p.fp.webglParams || {};
    const keys = Object.keys(params);
    const i = +(e.target.dataset.glk !== undefined ? e.target.dataset.glk : e.target.dataset.glv);
    const oldKey = keys[i];
    if (e.target.dataset.glk !== undefined) {
      const nk = e.target.value;
      const rebuilt = {};
      keys.forEach((k, idx) => { rebuilt[idx === i ? nk : k] = params[k]; });
      E.p.fp.webglParams = rebuilt;
    } else { params[oldKey] = e.target.value; }
    E.dirty = true;
  });
  on(root, 'change', '[data-bind="fp.uaMetadata.mobile"]', e => {
    E.p.fp.uaMetadata.mobile = e.target.value === 'true'; E.dirty = true;
  });
  on(root, 'input', '[data-bind="fp.uaMetadata.brandsText"]', e => {
    try {
      const arr = JSON.parse(e.target.value);
      if (Array.isArray(arr)) {
        E.p.fp.uaMetadata.brands = arr.map(x => ({ brand: x.brand || '', version: String(x.version || '') }));
        E.p.fp.uaMetadata.fullVersionList = arr.map(x => ({
          brand: x.brand || '',
          version: (x.brand || '').startsWith('Not') ? (x.version + '.0.0.0') : ((E.p.fp.uaMetadata.fullVersion) || (x.version + '.0.0.0'))
        }));
        e.target.style.borderColor = ''; E.dirty = true;
      }
    } catch (err) { e.target.style.borderColor = 'var(--bad)'; }
  });
}
function acceptLang(langs) {
  return langs.map((l, i) => i === 0 ? l : `${l};q=${(0.9 - (i - 1) * 0.1).toFixed(1)}`).join(',');
}
function syncCityFromTz() {
  const c = (S.geoCities || []).find(x => x.timezone === E.p.fp.timezone);
  if (c) {
    E.p.fp.locale = c.locale; E.p.fp.languages = c.languages.slice();
    E.p.fp.acceptLanguage = acceptLang(c.languages);
  }
}

async function editorAction(kind, el, api) {
  const p = E.p;
  if (kind.startsWith('mode:')) {
    p.fp.mode = kind.slice(5);
    if (p.fp.mode === 'real') {
      const fp = await Bridge.call('realFingerprint', {});
      p.fp = fp; toast('ok', '已载入本机真实指纹', '所有伪造开关已关闭');
    }
    renderEditorTab(); return;
  }
  if (kind === 'reseed') {
    const platform = p.fp.platform, keepCustom = p.fp.mode === 'custom';
    const fp = await Bridge.call('randomFingerprint', { platform, seed: undefined });
    p.fp = fp; if (keepCustom) p.fp.mode = 'custom';
    E.dirty = true; renderEditorTab();
    toast('ok', '已重新生成指纹', `${fp.timezone} · ${fp.screenWidth}×${fp.screenHeight}`);
    return;
  }
  if (kind === 'useReal') {
    const fp = await Bridge.call('realFingerprint', {});
    if (!fp.userAgent) { toast('err', '本机指纹尚未探测完成', '请在设置中执行「重新探测」'); return; }
    p.fp = fp; E.dirty = true; renderEditorTab(); toast('ok', '已载入本机真实指纹'); return;
  }
  if (kind === 'loadTpl') {
    const r = await Bridge.call('templates', {});
    const list = r.list || [];
    if (!list.length) { toast('warn', '还没有指纹模板', '可在当前指纹上调好后点「存为模板」'); return; }
    const v = await promptDlg({ title: '载入指纹模板', fields: [{ key: 'id', label: '选择模板', type: 'select', options: list.map(t => ({ v: t.id, t: `${t.name}（${osName(t.fp.platform)} · ${t.fp.timezone}）` })) }] });
    if (!v) return;
    const t = list.find(x => x.id === v.id);
    if (t) { const seed = p.fp.seed; p.fp = JSON.parse(JSON.stringify(t.fp)); p.fp.seed = seed; E.dirty = true; renderEditorTab(); toast('ok', '已载入模板', t.name); }
    return;
  }
  if (kind === 'saveTpl') {
    const v = await promptDlg({ title: '存为指纹模板', message: '模板只保存指纹部分，不含代理与 Cookie。', fields: [{ key: 'name', label: '模板名称', value: `${osName(p.fp.platform)} · ${p.fp.timezone}` }] });
    if (!v || !v.name) return;
    await Bridge.call('saveTemplate', { template: { id: '', name: v.name, fp: p.fp, createdAt: Date.now() } });
    S.templates = (await Bridge.call('templates', {})).list || [];
    updateChrome(); toast('ok', '已保存模板', v.name); return;
  }
  if (kind === 'genUA') {
    const v = await promptDlg({ title: '重建 UA + Client Hints', message: `本机 Chrome 大版本：${(S.host && S.host.chromeMajor) || '未知'}`, fields: [{ key: 'major', label: 'Chrome 大版本', type: 'number', value: (S.host && S.host.chromeMajor) || 152 }] });
    if (!v) return;
    const fp = await Bridge.call('randomFingerprint', { platform: p.fp.platform });
    const major = parseInt(v.major) || fp.userAgent.match(/Chrome\/(\d+)/)[1];
    // 用目标版本重写，保留 GREASE 品牌（来自本机探针，仅在同大版本时准确）
    p.fp.userAgent = fp.userAgent.replace(/Chrome\/\d+/, 'Chrome/' + major);
    p.fp.uaMetadata = fp.uaMetadata;
    if (String(major) !== String((S.host || {}).chromeMajor))
      toast('warn', 'GREASE 品牌可能不匹配', `本机 Chrome 是 ${(S.host || {}).chromeMajor}，你指定的是 ${major}；不同大版本的 sec-ch-ua GREASE 串不同`, 8000);
    E.dirty = true; renderEditorTab(); return;
  }
  if (kind === 'resPreset') {
    const presets = p.fp.platform === 'mac'
      ? [[1512, 982, 2], [1728, 1117, 2], [2560, 1440, 2], [1920, 1080, 1], [3024, 1964, 2], [2880, 1800, 2], [1440, 900, 2]]
      : [[1920, 1080, 1], [2560, 1440, 1], [1366, 768, 1], [1536, 864, 1.25], [1600, 900, 1], [1440, 900, 1], [3840, 2160, 1.5], [1280, 720, 1]];
    const v = await promptDlg({ title: '分辨率预设', fields: [{ key: 'r', label: '选择', type: 'select', options: presets.map(x => ({ v: x.join(','), t: `${x[0]}×${x[1]} @${x[2]}x` })) }] });
    if (!v) return;
    const [w, hh, dpr] = v.r.split(',').map(Number);
    p.fp.screenWidth = w; p.fp.screenHeight = hh; p.fp.devicePixelRatio = dpr;
    p.fp.windowWidth = Math.min(w - 40, 1440); p.fp.windowHeight = Math.min(hh - 140, 860);
    E.dirty = true; renderEditorTab(); return;
  }
  if (kind === 'gpuPreset') {
    const g = (S.gpuLists || {})[p.fp.platform] || (S.gpuLists || {}).windows || [];
    if (!g.length) return;
    const v = await promptDlg({ title: '显卡预设', fields: [{ key: 'i', label: '选择（已与目标系统匹配）', type: 'select', options: g.map((x, i) => ({ v: i, t: x.renderer })) }] });
    if (!v) return;
    const it = g[+v.i]; p.fp.webglVendor = it.vendor; p.fp.webglRenderer = it.renderer;
    E.dirty = true; renderEditorTab(); toast('ok', '已应用显卡预设'); return;
  }
  if (kind.startsWith('font')) {
    let list = [];
    if (kind === 'fontWin') list = S.fontLists.windows;
    else if (kind === 'fontMac') list = S.fontLists.mac;
    else if (kind === 'fontLinux') list = S.fontLists.linux;
    else if (kind === 'fontReal') list = (S.host && S.host.fonts) || [];
    if (!list.length) { toast('warn', '列表为空', kind === 'fontReal' ? '本机字体尚未探测' : ''); return; }
    p.fp.fonts = list.slice(); E.dirty = true; renderEditorTab();
    toast('ok', `已载入 ${list.length} 个字体`); return;
  }
  if (kind === 'glParamAdd') {
    const v = await promptDlg({ title: '添加 WebGL 参数覆写', message: '可用键：MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS / MAX_TEXTURE_IMAGE_UNITS / MAX_VERTEX_ATTRIBS / MAX_VARYING_VECTORS / MAX_VERTEX_UNIFORM_VECTORS / MAX_FRAGMENT_UNIFORM_VECTORS / MAX_COMBINED_TEXTURE_IMAGE_UNITS / MAX_CUBE_MAP_TEXTURE_SIZE / MAX_SAMPLES / ALIASED_LINE_WIDTH_RANGE', fields: [{ key: 'k', label: '参数名', value: 'MAX_TEXTURE_SIZE' }, { key: 'v', label: '值', value: '16384' }] });
    if (!v || !v.k) return;
    p.fp.webglParams = Object.assign({}, p.fp.webglParams, { [v.k.toUpperCase()]: v.v });
    E.dirty = true; renderEditorTab(); return;
  }
  if (kind.startsWith('glParamDel:')) {
    const k = kind.slice('glParamDel:'.length);
    const np = Object.assign({}, p.fp.webglParams); delete np[k]; p.fp.webglParams = np;
    E.dirty = true; renderEditorTab(); return;
  }
  // 代理
  if (kind === 'parseProxy') {
    const inp = qs('#pxPaste', api.box); if (!inp || !inp.value) return;
    const px = await Bridge.call('parseProxy', { text: inp.value });
    p.proxy = Object.assign(p.proxy || {}, px);
    E.dirty = true; renderEditorTab(); toast('ok', '已解析', proxySummary(p.proxy)); return;
  }
  if (kind === 'checkProxy') {
    const spin = qs('[data-role=pxSpin]', api.box);
    if (spin) spin.classList.remove('hidden');
    if (el) el.disabled = true;
    try {
      const r = await Bridge.call('checkProxy', { proxy: p.proxy, profileId: p.id });
      p.proxy.checkResult = r;
      E.dirty = true; renderEditorTab();
      if (r.ok) toast('ok', `代理可用`, `${r.ip} · ${r.country} ${r.city} · ${r.latencyMs}ms`);
      else toast('err', '代理不可用', r.error || '', 8000);
    } catch (e) { toast('err', '检测失败', String(e.message || e), 8000); }
    return;
  }
  if (kind === 'syncTz') {
    const r = p.proxy && p.proxy.checkResult;
    if (!r || !r.ok || !r.timezone) { toast('warn', '请先成功检测代理', '需要出口 IP 的时区信息'); return; }
    const c = (S.geoCities || []).find(x => x.timezone === r.timezone);
    p.fp.timezone = r.timezone;
    if (c) { p.fp.locale = c.locale; p.fp.languages = c.languages.slice(); p.fp.acceptLanguage = acceptLang(c.languages); p.fp.geo = { enabled: true, latitude: c.lat, longitude: c.lon }; }
    E.dirty = true; renderEditorTab(); toast('ok', '已同步', `${r.timezone}${c ? ' · ' + c.locale : ''}`); return;
  }
  // 启动
  if (kind === 'pickBrowser') {
    const r = await Bridge.call('pickBrowser', {});
    if (r.path) { p.launch.browserPath = r.path; E.dirty = true; renderEditorTab(); toast('ok', '已选择', r.version || r.path); }
    return;
  }
  if (kind === 'refreshBrowsers') {
    S.env = await Bridge.call('env', {}); renderEditorTab(); toast('ok', '已刷新浏览器列表', (S.env.browsers || []).length + ' 个'); return;
  }
  // Cookie
  if (kind === 'ckImport') {
    const v = await promptDlg({
      title: '导入 Cookie', message: '支持三种格式：① Chrome / EditThisCookie 导出的 JSON；② Netscape cookies.txt（Tab 分隔）；③ document.cookie 字符串。',
      fields: [{ key: 'text', label: 'Cookie 内容', type: 'textarea', rows: 9, placeholder: '[{"name":"sid","value":"...","domain":".example.com","path":"/"}]' },
               { key: 'domain', label: '默认域名（仅对 document.cookie 格式生效）', placeholder: '.example.com' }],
      okText: '导入'
    });
    if (!v || !v.text) return;
    const r = await Bridge.call('cookieImport', { id: p.id, text: v.text, defaultDomain: v.domain });
    const full = await Bridge.call('getProfile', { id: p.id });
    p.automation = full.automation; E.dirty = false; renderEditorTab();
    toast('ok', `已导入 ${r.imported} 条 Cookie`); return;
  }
  if (kind === 'ckExportJson' || kind === 'ckExportTxt') {
    const r = await Bridge.call('cookieExport', { id: p.id, format: kind === 'ckExportJson' ? 'json' : 'netscape' });
    if (!r.count) { toast('warn', '没有可导出的 Cookie'); return; }
    if (Bridge.native) { const s = await Bridge.call('saveFile', { filename: r.filename, content: r.text }); if (s.ok) toast('ok', '已导出', s.path); }
    else { copy(r.text, r.count + ' 条 Cookie 已复制到剪贴板'); }
    return;
  }
  if (kind === 'ckLive') {
    const r = await Bridge.call('cookieLive', { id: p.id });
    if (!r.list || !r.list.length) { toast('warn', '没有读取到 Cookie', r.msg || '窗口未运行或无 Cookie'); return; }
    const ok = await confirmDlg({ title: `读取到 ${r.count} 条 Cookie`, tone: 'info', message: '是否用运行中窗口的实时 Cookie 覆盖已保存的 Cookie？', okText: '覆盖保存' });
    if (!ok) return;
    const text = JSON.stringify(r.list.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path, secure: !!c.secure,
      httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified', expirationDate: c.expires > 0 ? c.expires : undefined
    })), null, 1);
    await Bridge.call('cookieImport', { id: p.id, text });
    const full = await Bridge.call('getProfile', { id: p.id });
    p.automation = full.automation; renderEditorTab(); toast('ok', `已保存 ${r.count} 条实时 Cookie`); return;
  }
  if (kind === 'ckClear') {
    const ok = await confirmDlg({ title: '清空 Cookie', tone: 'warn', message: '将删除该窗口已保存的全部 Cookie。', okText: '清空', okClass: 'btn-bad' });
    if (!ok) return;
    p.automation = p.automation || {}; p.automation.cookies = []; E.dirty = true; renderEditorTab(); toast('ok', '已清空'); return;
  }
}

async function saveEditor(api) {
  const p = E.p;
  // 数组型 textarea 归一化
  if (p.launch) {
    if (typeof p.launch.extraTabs === 'string') p.launch.extraTabs = p.launch.extraTabs.split('\n').map(s => s.trim()).filter(Boolean);
    if (typeof p.launch.extraArgs === 'string') p.launch.extraArgs = p.launch.extraArgs.split('\n').map(s => s.trim()).filter(Boolean);
  }
  if (typeof p.tags === 'string') p.tags = p.tags.split(',').map(s => s.trim()).filter(Boolean);
  if (p.fp && typeof p.fp.languages === 'string') p.fp.languages = p.fp.languages.split(',').map(s => s.trim()).filter(Boolean);
  if (p.fp && typeof p.fp.fonts === 'string') p.fp.fonts = p.fp.fonts.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  if (p.fp && typeof p.fp.webrtcLocalIps === 'string') p.fp.webrtcLocalIps = p.fp.webrtcLocalIps.split(',').map(s => s.trim()).filter(Boolean);
  if (p.fp && p.fp.uaMetadata && typeof p.fp.uaMetadata.mobile === 'string') p.fp.uaMetadata.mobile = p.fp.uaMetadata.mobile === 'true';
  if (p.fp && p.fp.uaMetadata) delete p.fp.uaMetadata.brandsText;
  if (!p.name || !p.name.trim()) { toast('warn', '请填写窗口名称'); E.tab = 'basic'; renderEditorTab(); return; }
  const warn = fpConsistency(p);
  if (warn.length) {
    const go = await confirmDlg({ title: '存在一致性提醒', tone: 'warn', message: `检测到 ${warn.length} 项可能降低伪装质量的问题：<br><br>${warn.map(w => '· ' + w).join('<br>')}<br><br>仍然保存吗？`, okText: '仍然保存' });
    if (!go) return;
  }
  try {
    const saved = await Bridge.call('saveProfile', { profile: p });
    E.dirty = false; api.close();
    toast('ok', `已保存 #${saved.seq} ${saved.name}`);
    await loadProfiles(true);
  } catch (e) { toast('err', '保存失败', String(e.message || e), 8000); }
}

/* ==========================================================================
   指纹探针（在目标窗口内执行，返回 JSON 字符串）
   ========================================================================== */
const DETECT_JS = `(async()=>{const R={};
const q=(f)=>{try{return f()}catch(e){return 'ERR:'+e.message}};
R.ua=navigator.userAgent; R.appVersion=navigator.appVersion;
R.platform=navigator.platform; R.vendor=navigator.vendor; R.language=navigator.language;
R.languages=Array.from(navigator.languages||[]); R.hardwareConcurrency=navigator.hardwareConcurrency;
R.deviceMemory=navigator.deviceMemory; R.maxTouchPoints=navigator.maxTouchPoints;
R.doNotTrack=navigator.doNotTrack; R.webdriver=navigator.webdriver;
R.plugins=navigator.plugins?navigator.plugins.length:-1;
R.mimeTypes=navigator.mimeTypes?navigator.mimeTypes.length:-1;
R.pluginNames=navigator.plugins?Array.from(navigator.plugins).map(p=>p.name):[];
R.screen=[screen.width,screen.height,screen.availWidth,screen.availHeight,screen.colorDepth,screen.pixelDepth];
R.dpr=window.devicePixelRatio; R.outer=[window.outerWidth,window.outerHeight];
R.inner=[window.innerWidth,window.innerHeight];
R.orientation=screen.orientation?screen.orientation.type+':'+screen.orientation.angle:null;
R.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
R.tzOffset=new Date().getTimezoneOffset();
R.localeNow=new Date().toLocaleString();
R.canvasHashes=[];
try{ for(let k=0;k<2;k++){ const c=document.createElement('canvas'); c.width=260;c.height=48;
  const x=c.getContext('2d'); x.textBaseline='alphabetic'; x.fillStyle='#f60'; x.fillRect(0,0,140,22);
  x.font='18px Arial'; x.fillStyle='#069'; x.fillText('Veil fp \\\\u{1F512} probe',3,36);
  x.font='14px Georgia'; x.strokeStyle='#f0f'; x.strokeText('canvas fingerprint',60,14);
  const d=c.toDataURL(); let hh=5381; for(let i=0;i<d.length;i++) hh=((hh*33)^d.charCodeAt(i))>>>0;
  R.canvasHashes.push(hh.toString(16)); } }catch(e){R.canvasHashes=['ERR:'+e.message]}
try{ const c=document.createElement('canvas'); const gl=c.getContext('webgl');
  if(gl){ const d=gl.getExtension('WEBGL_debug_renderer_info');
    R.glVendor=gl.getParameter(gl.VENDOR); R.glRenderer=gl.getParameter(gl.RENDERER);
    R.glUnmaskedVendor=d?gl.getParameter(d.UNMASKED_VENDOR_WEBGL):null;
    R.glUnmaskedRenderer=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):null;
    R.glVersion=gl.getParameter(gl.VERSION); R.glsl=gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
    R.glMaxTex=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    R.glMaxViewport=Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)||[]).join(',');
    R.glExtensions=(gl.getSupportedExtensions()||[]).length;
    R.hasDebugInfo=!!d;
  } else R.glVendor='NO_WEBGL';
}catch(e){R.glErr=String(e)}
try{ const c2=document.createElement('canvas'); R.webgl2=!!c2.getContext('webgl2'); }catch(e){R.webgl2=false}
R.audioHashes=[];
try{ const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  if(AC){ for(let k=0;k<2;k++){ const ctx=new AC(1,44100,44100);
    const osc=ctx.createOscillator(); osc.type='triangle'; osc.frequency.value=10000;
    const comp=ctx.createDynamicsCompressor();
    ['threshold','knee','ratio','reduction','attack','release'].forEach((n,i)=>{ if(comp[n]&&comp[n].value!==undefined&&comp[n].setValueAtTime) comp[n].setValueAtTime([-50,40,12,0.001,0.25][i]!==undefined?[-50,40,12,0.001,0.25][i]:0,0); });
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    const buf=await ctx.startRendering(); const d=buf.getChannelData(0);
    let s=0; for(let i=4500;i<5000;i++) s+=Math.abs(d[i]);
    R.audioHashes.push(s.toFixed(10)); } } else R.audioHashes=['NO_AC'];
}catch(e){R.audioHashes=['ERR:'+e.message]}
try{ R.webrtcLocalIp=await new Promise(res=>{ let done=false; const t=setTimeout(()=>{if(!done){done=true;res('无候选（已屏蔽/超时）')}},3500);
  const pc=new RTCPeerConnection({iceServers:[]});
  pc.createDataChannel(''); pc.onicecandidate=e=>{ if(done) return;
    if(!e.candidate){ return; }
    const m=/([0-9]{1,3}(\\.[0-9]{1,3}){3}|[a-f0-9:]+:[a-f0-9:.]+)/i.exec(e.candidate.candidate);
    if(m){ done=true; clearTimeout(t); res(m[1]); } };
  pc.createOffer().then(o=>pc.setLocalDescription(o)).catch(()=>{if(!done){done=true;clearTimeout(t);res('ERR')}}); });
}catch(e){R.webrtcLocalIp='ERR:'+e.message}
try{ const b=await navigator.getBattery(); R.battery=[b.level,b.charging]; }catch(e){R.battery='ERR:'+e.message}
try{ R.storage=await navigator.storage.estimate(); }catch(e){R.storage='ERR:'+e.message}
try{ R.connection=navigator.connection?{t:navigator.connection.effectiveType,d:navigator.connection.downlink,r:navigator.connection.rtt}:null; }catch(e){R.connection=null}
try{ R.uaData=navigator.userAgentData?{brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform}:null;
  if(navigator.userAgentData){ const hi=await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion','architecture','bitness','model','wow64']); R.uaDataHigh=hi; }
}catch(e){R.uaData='ERR:'+e.message}
try{ R.notificationPermission=Notification.permission;
  const ps=await navigator.permissions.query({name:'notifications'}); R.permNotifications=ps.state; }catch(e){R.permErr=String(e)}
try{ R.devices=await navigator.mediaDevices.enumerateDevices(); R.deviceCounts={in:R.devices.filter(d=>d.kind==='audioinput').length,out:R.devices.filter(d=>d.kind==='audiooutput').length,video:R.devices.filter(d=>d.kind==='videoinput').length}; }catch(e){R.deviceCounts='ERR:'+e.message}
try{ R.voices=speechSynthesis.getVoices().length; }catch(e){R.voices=-1}
try{ R.fontCheck=['Arial','Helvetica','Times New Roman','Courier New','Comic Sans MS','Impact','Segoe UI','PingFang SC','Menlo','DejaVu Sans'].map(f=>f+':'+document.fonts.check('16px "'+f+'"')).join(', '); }catch(e){R.fontCheck='ERR:'+e.message}
try{ R.hasChrome=!!window.chrome; R.hasChromeRuntime=!!(window.chrome&&window.chrome.runtime); }catch(e){}
try{ R.fnToStringNative=HTMLCanvasElement.prototype.toDataURL.toString().indexOf('[native code]')>=0;
  R.getterNative=(Object.getOwnPropertyDescriptor(Screen.prototype,'width')||{}).get?Object.getOwnPropertyDescriptor(Screen.prototype,'width').get.toString().indexOf('[native code]')>=0:null;
}catch(e){R.fnToStringNative='ERR:'+e.message}
try{ R.cdc=Object.keys(window).filter(k=>/cdc_|\\$cdc_|webdriver|selenium|puppeteer|playwright/i.test(k)); }catch(e){R.cdc=[]}
R.ts=Date.now();
return JSON.stringify(R);})()`;

const CHECKS = [
  { k: 'ua', label: 'User-Agent', get: a => a.ua },
  { k: 'platform', label: 'navigator.platform', get: a => a.platform },
  { k: 'languages', label: 'navigator.languages', get: a => (a.languages || []).join(', ') },
  { k: 'timezone', label: '时区 (Intl)', get: a => a.timezone },
  { k: 'tzOffset', label: 'getTimezoneOffset', get: a => a.tzOffset + ' 分钟' },
  { k: 'screen', label: '屏幕', get: a => (a.screen || []).slice(0, 2).join(' × ') },
  { k: 'avail', label: '可用区域', get: a => (a.screen || []).slice(2, 4).join(' × ') },
  { k: 'dpr', label: 'devicePixelRatio', get: a => a.dpr },
  { k: 'hc', label: 'hardwareConcurrency', get: a => a.hardwareConcurrency },
  { k: 'dm', label: 'deviceMemory', get: a => a.deviceMemory },
  { k: 'mtp', label: 'maxTouchPoints', get: a => a.maxTouchPoints },
  { k: 'webgl', label: 'WebGL Renderer', get: a => a.glUnmaskedRenderer },
  { k: 'webglv', label: 'WebGL Vendor', get: a => a.glUnmaskedVendor },
  { k: 'canvas', label: 'Canvas 哈希（两次）', get: a => (a.canvasHashes || []).join(' / ') },
  { k: 'audio', label: 'AudioContext 哈希', get: a => (a.audioHashes || []).join(' / ') },
  { k: 'webrtc', label: 'WebRTC 本地 IP', get: a => a.webrtcLocalIp },
  { k: 'webdriver', label: 'navigator.webdriver', get: a => String(a.webdriver) },
  { k: 'plugins', label: 'plugins.length', get: a => a.plugins },
  { k: 'devices', label: '媒体设备 (in/out/video)', get: a => a.deviceCounts && typeof a.deviceCounts === 'object' ? `${a.deviceCounts.in}/${a.deviceCounts.out}/${a.deviceCounts.video}` : a.deviceCounts },
  { k: 'battery', label: '电池', get: a => Array.isArray(a.battery) ? `${Math.round(a.battery[0] * 100)}% ${a.battery[1] ? '充电中' : ''}` : a.battery },
  { k: 'storage', label: 'storage.estimate 配额', get: a => a.storage && a.storage.quota ? (a.storage.quota / 1073741824).toFixed(1) + ' GB' : '—' },
  { k: 'conn', label: 'connection.effectiveType', get: a => a.connection ? a.connection.t : '—' },
  { k: 'voices', label: '语音合成数量', get: a => a.voices },
  { k: 'cdc', label: '自动化残留全局变量', get: a => (a.cdc && a.cdc.length) ? a.cdc.join(', ') : '无' },
  { k: 'native', label: 'toDataURL 伪装为原生', get: a => a.fnToStringNative === true ? '是' : '否' },
  { k: 'getterNative', label: 'screen.width getter 伪装', get: a => a.getterNative === true ? '是' : (a.getterNative === false ? '否' : '—') },
];

/* ==========================================================================
   视图：运行中
   ========================================================================== */
function viewRunning() {
  const list = S.running || [];
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>运行中</h1><p>当前由 Veil 接管的浏览器实例（CDP 会话保持中，新开标签页也会自动注入）</p></div>
      <div class="view-tools">
        <button class="btn" id="btnRefreshRun">刷新</button>
        <button class="btn btn-bad" id="btnCloseAll" ${list.length ? '' : 'disabled'}>全部关闭</button>
      </div>
    </div>
    <div class="view-body">
      ${list.length ? `<div class="cards">${list.map(r => {
        const p = S.profiles.find(x => x.id === r.id) || {};
        return `<div class="rcard" data-id="${esc(r.id)}">
          <div class="top">
            <span class="seq-badge">${esc(r.seq)}</span>
            <span class="nm">${esc(r.name)}</span>
            <span class="badge run"><i></i>${fmtDur(r.uptime)}</span>
          </div>
          <div class="meta">
            <span>PID</span><b>${r.pid}</b>
            <span>CDP</span><b title="点击复制">${esc(r.http)}</b>
            <span>WebSocket</span><b class="ellipsis" title="${esc(r.ws)}">${esc((r.ws || '').slice(-34))}</b>
            <span>已注入页面</span><b>${r.pages} 个 target · ${r.setupCount} 次</b>
            <span>代理</span><b>${esc(r.proxy || '—')}</b>
            ${r.lastError ? `<span>状态</span><b style="color:var(--warn)">${esc(r.lastError)}</b>` : ''}
          </div>
          <div class="acts">
            <button class="btn btn-sm" data-r="detect">指纹自检</button>
            <button class="btn btn-sm" data-r="probe">运行探针</button>
            <button class="btn btn-sm" data-r="nav">打开网址</button>
            <button class="btn btn-sm" data-r="copyws">复制 CDP</button>
            <button class="btn btn-sm" data-r="edit">编辑</button>
            <div class="grow"></div>
            <button class="btn btn-sm btn-bad" data-r="close">关闭</button>
          </div>
        </div>`; }).join('')}</div>`
      : `<div class="empty"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 4h11a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg></div>
          <h3>没有运行中的窗口</h3>
          <p>在「窗口」列表中点击 ▶ 打开，即可启动一个带独立指纹与代理的浏览器实例。</p>
          <button class="btn btn-primary" id="btnGoProfiles">前往窗口列表</button></div>`}
    </div></div>`;
}
function bindRunning(root) {
  qs('#btnRefreshRun', root) && (qs('#btnRefreshRun', root).onclick = () => loadProfiles(true));
  qs('#btnGoProfiles', root) && (qs('#btnGoProfiles', root).onclick = () => go('profiles'));
  const ca = qs('#btnCloseAll', root);
  if (ca) ca.onclick = async () => {
    if (!await confirmDlg({ title: '关闭全部窗口', tone: 'warn', message: `将关闭 ${S.running.length} 个运行中的浏览器。`, okText: '全部关闭', okClass: 'btn-bad' })) return;
    await Bridge.call('closeProfiles', { ids: S.running.map(r => r.id) });
    toast('ok', '已全部关闭'); await loadProfiles(true);
  };
  on(root, 'click', '[data-r]', async (e, t) => {
    const id = t.closest('.rcard').dataset.id, k = t.dataset.r;
    if (k === 'close') { await doClose([id]); }
    else if (k === 'detect') { await doDetect(id); }
    else if (k === 'probe') { await runProbe(id); }
    else if (k === 'edit') { openEditor(id); }
    else if (k === 'copyws') { const r = S.running.find(x => x.id === id); copy(r.http, r.http); }
    else if (k === 'nav') {
      const v = await promptDlg({ title: '在窗口中打开网址', fields: [{ key: 'url', label: 'URL', placeholder: 'https://example.com' }] });
      if (v && v.url) { const r = await Bridge.call('navigate', { id, url: v.url }); toast(r.ok ? 'ok' : 'err', r.ok ? '已跳转' : '跳转失败', r.msg || ''); }
    }
  });
  on(root, 'dblclick', '.rcard .meta b', (e, t) => copy(t.textContent.trim(), t.textContent.trim()));
}

async function runProbe(id) {
  const p = S.profiles.find(x => x.id === id);
  const t = toast('info', '正在运行指纹探针…', '需要窗口处于运行状态', 30000);
  try {
    const r = await Bridge.call('evaluate', { id, expression: DETECT_JS });
    t.remove();
    if (!r || !r.ok) { toast('err', '探针失败', (r && r.msg) || ''); return; }
    showProbeResult(p, JSON.parse(r.result));
  } catch (e) { t.remove(); toast('err', '探针失败', String(e.message || e), 8000); }
}

function showProbeResult(p, actual) {
  const fp = p && p.veil ? p.veil.fp : (p ? p.fp : null);
  const rows = CHECKS.map(c => {
    let act, exp = '', pass = null;
    try { act = c.get(actual); } catch (e) { act = 'ERR'; }
    if (fp) {
      switch (c.k) {
        case 'ua': exp = fp.userAgent; pass = act === exp; break;
        case 'platform': exp = fp.navPlatform; pass = act === exp; break;
        case 'languages': exp = (fp.languages || []).join(', '); pass = act === exp; break;
        case 'timezone': exp = fp.timezone; pass = act === exp; break;
        case 'screen': exp = `${fp.screenWidth} × ${fp.screenHeight}`; pass = act === exp; break;
        case 'avail': exp = `${fp.screenWidth} × ${fp.screenHeight - (fp.availTopOffset || 0)}`; pass = act === exp; break;
        case 'dpr': exp = String(fp.devicePixelRatio); pass = String(act) === exp; break;
        case 'hc': exp = String(fp.hardwareConcurrency); pass = String(act) === exp; break;
        case 'dm': exp = String(fp.deviceMemory); pass = String(act) === exp; break;
        case 'mtp': exp = String(fp.maxTouchPoints); pass = String(act) === exp; break;
        case 'webgl': exp = fp.webglRenderer; pass = act === exp; break;
        case 'webglv': exp = fp.webglVendor; pass = act === exp; break;
        case 'webdriver': exp = 'false'; pass = act === 'false'; break;
        case 'plugins': exp = String(fp.pdfViewer ? fp.pluginsCount : 0); pass = String(act) === exp; break;
        case 'devices': exp = `${fp.audioInputs}/${fp.audioOutputs}/${fp.videoInputs}`; pass = fp.mediaDevicesSpoof ? act === exp : null; break;
        case 'webrtc':
          exp = fp.webrtcMode === 'disabled' ? '无候选' : (fp.webrtcMode === 'real' ? '真实' : '已改写');
          if (fp.webrtcMode === 'disabled') pass = /无候选|超时|ERR/.test(String(act));
          else pass = null;
          break;
        case 'canvas':
          exp = fp.canvasNoise ? '两次读取一致且已扰动' : '真实值';
          { const hs = (actual.canvasHashes || []); pass = hs.length === 2 && hs[0] === hs[1]; }
          break;
        case 'audio':
          exp = fp.audioNoise ? '两次读取一致且已扰动' : '真实值';
          { const hs = (actual.audioHashes || []); pass = hs.length === 2 && hs[0] === hs[1]; }
          break;
        case 'cdc': pass = !(actual.cdc || []).length; break;
        case 'native': pass = actual.fnToStringNative === true; break;
        case 'getterNative': pass = actual.getterNative === true; break;
        case 'conn': exp = fp.connectionSpoof ? fp.effectiveType : '真实'; pass = fp.connectionSpoof ? act === fp.effectiveType : null; break;
        default: exp = ''; pass = null;
      }
    }
    return `<tr><td>${esc(c.label)}</td>
      <td class="mono-s" style="color:var(--tx)">${esc(String(act === undefined || act === null ? '—' : act)).slice(0, 180)}</td>
      <td class="mono-s">${exp ? esc(String(exp)).slice(0, 120) : '—'}</td>
      <td>${pass === null ? '<span class="badge stop">参考</span>'
        : pass ? '<span class="badge run"><i></i>符合</span>' : '<span class="badge dis"><i></i>不符</span>'}</td></tr>`;
  }).join('');
  const fails = CHECKS.filter(c => { const r = qs(`#probeTable tr`); return false; });
  void fails;
  modal({
    title: `指纹探针 — ${p ? '#' + p.seq + ' ' + p.name : '未命名'}`,
    subtitle: actual.ts ? new Date(actual.ts).toLocaleTimeString() : '', size: 'wide',
    body: `<div class="stack">
      <div class="notice info">探针在目标窗口的页面主世界中执行，读取的是<b>页面脚本实际能看到</b>的值 —— 这正是风控系统看到的。</div>
      <div class="tbl-wrap"><table class="tbl" id="probeTable">
        <colgroup><col style="width:190px"><col><col style="width:30%"><col style="width:96px"></colgroup>
        <thead><tr><th>检测项</th><th>实际值</th><th>期望值</th><th>结论</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <details class="fp-sec"><summary class="fp-head"><span class="ic">{ }</span><h4>原始 JSON</h4><span class="d">完整探针输出</span></summary>
        <div class="fp-body"><div class="code" style="max-height:320px">${esc(JSON.stringify(actual, null, 1))}</div></div></details>
    </div>`,
    footer: `<div class="grow"></div><button class="btn" data-x>复制 JSON</button><button class="btn btn-primary" data-close>完成</button>`,
    onMount(api) { qs('[data-x]', api.box).onclick = () => copy(JSON.stringify(actual, null, 1), '探针结果已复制'); }
  });
}

/* ==========================================================================
   视图：分组
   ========================================================================== */
function viewGroups() {
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>分组</h1><p>用分组管理窗口，批量操作时可按分组筛选</p></div>
      <div class="view-tools"><button class="btn btn-primary" id="btnAddGroup">+ 新建分组</button></div>
    </div>
    <div class="view-body"><div class="list" id="groupList">${groupListHTML()}</div></div></div>`;
}
const PALETTE = ['#7c8cff', '#3ddc97', '#ffb547', '#ff5c72', '#4fc3f7', '#ba68c8', '#f06292', '#9ccc65', '#ffd54f', '#90a4ae'];
function groupListHTML() {
  if (!S.groups.length) return `<div class="empty"><h3>还没有分组</h3><p>分组便于批量管理大量窗口。</p></div>`;
  return S.groups.map(g => {
    const n = S.profiles.filter(p => (p.veil ? p.veil.groupId : p.groupId) === g.id).length;
    return `<div class="li" data-id="${esc(g.id)}">
      <span class="swatch" style="background:${esc(g.color)}"></span>
      <div style="flex:1;min-width:0"><div class="nm">${esc(g.name)}</div><div class="sub">${esc(g.remark || '无备注')}</div></div>
      <span class="badge">${n} 个窗口</span>
      <button class="btn btn-sm" data-g="edit">编辑</button>
      <button class="btn btn-sm" data-g="filter">查看窗口</button>
      <button class="btn btn-sm btn-ghost" data-g="del">删除</button></div>`;
  }).join('');
}
function bindGroups(root) {
  qs('#btnAddGroup', root).onclick = () => groupEditor(null);
  on(root, 'click', '[data-g]', async (e, t) => {
    const id = t.closest('.li').dataset.id, k = t.dataset.g;
    const g = S.groups.find(x => x.id === id);
    if (k === 'edit') groupEditor(g);
    else if (k === 'filter') { S.groupId = id; go('profiles'); }
    else if (k === 'del') {
      const n = S.profiles.filter(p => (p.veil ? p.veil.groupId : p.groupId) === id).length;
      if (!await confirmDlg({ title: '删除分组', tone: 'warn', message: `将删除分组「${esc(g.name)}」。${n ? `其中 ${n} 个窗口会变为未分组（窗口本身不会被删除）。` : ''}`, okText: '删除', okClass: 'btn-bad' })) return;
      await Bridge.call('deleteGroup', { id }); toast('ok', '已删除分组'); await refreshAll();
    }
  });
}
async function groupEditor(g) {
  const isNew = !g;
  const v = await promptDlg({
    title: isNew ? '新建分组' : '编辑分组',
    fields: [
      { key: 'name', label: '分组名称', value: g ? g.name : '' },
      { key: 'remark', label: '备注', value: g ? g.remark : '' },
      { key: 'color', label: '颜色', type: 'select', options: PALETTE.map(c => ({ v: c, t: c })) },
    ],
    extra: ''
  });
  if (!v) return;
  await Bridge.call('saveGroup', {
    group: { id: g ? g.id : '', name: v.name, remark: v.remark, color: v.color, sortIndex: 0, createdAt: g ? g.createdAt : Date.now() }
  });
  toast('ok', isNew ? '已创建分组' : '已保存分组', v.name);
  await refreshAll();
}

/* ==========================================================================
   视图：指纹模板
   ========================================================================== */
function viewTemplates() {
  const list = S.templates || [];
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>指纹模板</h1><p>把调好的指纹存成模板，新建窗口时一键套用</p></div>
      <div class="view-tools"><button class="btn" id="btnTplFromRandom">从随机指纹创建</button></div>
    </div>
    <div class="view-body">
      ${list.length ? `<div class="cards">${list.map(t => `<div class="rcard" data-id="${esc(t.id)}" style="--x:1">
        <div class="top"><span class="badge os-${esc(t.fp.platform)}">${osIcon(t.fp.platform)}&nbsp;${esc(osName(t.fp.platform))}</span>
          <span class="nm">${esc(t.name)}</span></div>
        <div class="meta">
          <span>时区</span><b>${esc(t.fp.timezone)}</b>
          <span>语言</span><b>${esc((t.fp.languages || []).join(', '))}</b>
          <span>屏幕</span><b>${t.fp.screenWidth}×${t.fp.screenHeight} @${t.fp.devicePixelRatio}x</b>
          <span>显卡</span><b class="ellipsis" title="${esc(t.fp.webglRenderer)}">${esc(t.fp.webglRenderer)}</b>
          <span>CPU/内存</span><b>${t.fp.hardwareConcurrency} 核 / ${t.fp.deviceMemory} GB</b>
          <span>字体</span><b>${(t.fp.fonts || []).length} 个</b>
        </div>
        <div class="acts"><button class="btn btn-sm" data-t="apply">应用到窗口…</button>
          <button class="btn btn-sm" data-t="view">查看</button>
          <div class="grow"></div><button class="btn btn-sm btn-ghost" data-t="del">删除</button></div>
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="ic">🧬</div><h3>还没有模板</h3>
         <p>在窗口编辑器的「指纹」页调好参数后点「存为模板」，即可把这套指纹复用到其它窗口。</p>
         <button class="btn btn-primary" id="btnTplFirst">从随机指纹创建</button></div>`}
    </div></div>`;
}
function bindTemplates(root) {
  const f = () => tplFromRandom();
  qs('#btnTplFromRandom', root) && (qs('#btnTplFromRandom', root).onclick = f);
  qs('#btnTplFirst', root) && (qs('#btnTplFirst', root).onclick = f);
  on(root, 'click', '[data-t]', async (e, el) => {
    const id = el.closest('.rcard').dataset.id, k = el.dataset.t;
    const t = S.templates.find(x => x.id === id); if (!t) return;
    if (k === 'del') {
      if (!await confirmDlg({ title: '删除模板', tone: 'warn', message: `删除模板「${esc(t.name)}」？`, okText: '删除', okClass: 'btn-bad' })) return;
      await Bridge.call('deleteTemplate', { id }); toast('ok', '已删除'); await refreshAll();
    } else if (k === 'view') {
      modal({ title: '模板 · ' + t.name, size: 'mid', body: `<div class="code" style="max-height:60vh">${esc(JSON.stringify(t.fp, null, 1))}</div>`,
        footer: `<div class="grow"></div><button class="btn" data-c>复制</button><button class="btn btn-primary" data-close>关闭</button>`,
        onMount(api) { qs('[data-c]', api.box).onclick = () => copy(JSON.stringify(t.fp, null, 1), '已复制'); } });
    } else if (k === 'apply') {
      if (!S.profiles.length) { toast('warn', '还没有窗口'); return; }
      const v = await promptDlg({ title: '应用模板到窗口', message: '将覆盖目标窗口的全部指纹设置（噪声种子会保留，避免多个窗口指纹完全相同）。',
        fields: [{ key: 'id', label: '目标窗口', type: 'select', options: S.profiles.map(p => ({ v: p.id, t: `#${p.seq} ${p.name}` })) }] });
      if (!v) return;
      const full = await Bridge.call('getProfile', { id: v.id });
      const seed = full.fp.seed;
      full.fp = JSON.parse(JSON.stringify(t.fp)); full.fp.seed = seed;
      await Bridge.call('saveProfile', { profile: full });
      toast('ok', '已应用模板', `→ ${full.name}`); await loadProfiles(true);
    }
  });
}
async function tplFromRandom() {
  const v = await promptDlg({ title: '创建指纹模板', fields: [
    { key: 'name', label: '模板名称', value: '我的模板' },
    { key: 'platform', label: '目标系统', type: 'select', options: [{ v: 'windows', t: 'Windows' }, { v: 'mac', t: 'macOS' }, { v: 'linux', t: 'Linux' }] },
    { key: 'country', label: '地区', type: 'select', options: [{ v: '', t: '随机' }].concat(countryOptions()) }] });
  if (!v) return;
  const fp = await Bridge.call('randomFingerprint', { platform: v.platform, country: v.country || undefined });
  await Bridge.call('saveTemplate', { template: { id: '', name: v.name, fp, createdAt: Date.now() } });
  toast('ok', '已创建模板', v.name); await refreshAll();
}

/* ==========================================================================
   视图：指纹检测
   ========================================================================== */
function viewDetect() {
  const hostOK = !!(S.host && S.host.probedAt);
  const h = S.host || {};
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>指纹检测</h1><p>验证伪装是否真的生效 —— 在目标窗口内运行探针，对比「页面实际看到的值」与「配置期望值」</p></div>
      <div class="view-tools">
        <button class="btn" id="btnOpenDetectPage">在运行窗口中打开自检页</button>
        <button class="btn" id="btnProbeHost">重新探测本机</button>
      </div>
    </div>
    <div class="view-body">
      <div class="fp-sec open"><div class="fp-head"><span class="ic">🖥️</span><h4>本机指纹基线</h4>
        <span class="d">${hostOK ? '这是 Veil 需要「隐藏」的真实指纹' : '尚未探测 —— 点击右侧按钮执行'}</span></div>
        <div class="fp-body">
          ${hostOK ? `<div class="fp-grid">
            ${kv('Chrome', `${h.chromeMajor} (${h.chromeFullVersion})`)}
            ${kv('UA-CH 平台', `${h.platform} ${h.platformVersion}`)}
            ${kv('GREASE 品牌', `${h.greaseBrand} ; v="${h.greaseVersion}"`)}
            ${kv('架构', `${h.architecture} / bitness ${h.bitness}`)}
            ${kv('User-Agent', h.ua)}
            ${kv('navigator.platform', h.navPlatform)}
            ${kv('屏幕', `${h.screenWidth}×${h.screenHeight} (可用 ${h.availWidth}×${h.availHeight}) @${h.devicePixelRatio}x`)}
            ${kv('CPU / 内存', `${h.hardwareConcurrency} 核 / ${h.deviceMemory} GB`)}
            ${kv('时区 / 语言', `${h.timezone} · ${(h.languages || []).join(', ')}`)}
            ${kv('WebGL Vendor', h.webglUnmaskedVendor || h.webglVendor)}
            ${kv('WebGL Renderer', h.webglUnmaskedRenderer || h.webglRenderer)}
            ${kv('本机字体', `${(h.fonts || []).length} 个`)}
            ${kv('探测时间', fmtTime(h.probedAt))}
            ${kv('内核路径', h.chromePath)}
          </div>
          <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">本机字体列表（${(h.fonts || []).length}）</summary>
            <div class="chips" style="margin-top:8px">${(h.fonts || []).map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div></details>
          <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">WebGL 参数</summary>
            <div class="fp-grid" style="margin-top:8px">${Object.keys(h.webglParams || {}).map(k => kv(k, h.webglParams[k])).join('') || '<div class="hint">无</div>'}</div></details>`
          : `<div class="empty" style="padding:30px"><h3>尚未探测本机指纹</h3>
             <p>探测会静默启动一次本机 Chrome（headless 模式，不显示窗口），读取真实的 UA-CH、GREASE 品牌串、GPU、字体列表。<br>
             这些信息用于生成<b>与本机 Chrome 版本一致</b>的指纹（避免版本错配）以及「真实机器」模式。</p>
             <button class="btn btn-primary" id="btnProbeNow">立即探测</button></div>`}
        </div></div>

      <div class="fp-sec open"><div class="fp-head"><span class="ic">🔍</span><h4>窗口自检</h4>
        <span class="d">${S.running.length ? `${S.running.length} 个窗口正在运行` : '需要至少一个运行中的窗口'}</span></div>
        <div class="fp-body">
          ${S.running.length ? `<div class="row wrap">${S.running.map(r =>
            `<button class="btn" data-probe="${esc(r.id)}">#${esc(r.seq)} ${esc(r.name)}</button>`).join('')}
            <div class="grow"></div>
            <button class="btn btn-primary" data-probe="${esc(S.running[0].id)}">运行探针 →</button></div>
            <div class="hint">探针会在窗口的活动标签页中执行，读取 25 项指纹特征并与该窗口的配置逐项对比。</div>`
          : `<div class="notice warn">请先在「窗口」列表打开一个窗口，再回来运行探针。</div>`}
        </div></div>

      <div class="fp-sec"><div class="fp-head"><span class="ic">⚠️</span><h4>已知边界（诚实说明）</h4><span class="d">Veil 不修改 Chromium 内核，以下项目无法通过注入解决</span></div>
        <div class="fp-body"><div class="stack">
          <div class="notice warn"><div><b>TLS / JA3 / HTTP2 指纹</b><br>由真实的 Chrome 二进制决定，无法通过 JS 或 CDP 改写。因此建议把 UA 的 Chrome 大版本设置成<b>与本机 Chrome 相同</b>（Veil 已默认这样做），让二者一致而非互相矛盾。</div></div>
          <div class="notice warn"><div><b>字体度量</b><br>「预设列表」模式只能拦截 <code>document.fonts.check()</code> 探测；基于 canvas 度量的字体枚举仍会命中本机真实安装的字体。若需要更强隔离，请用「严格模式」（会注入 @font-face 做度量替换，但会留下 FontFace 痕迹）。</div></div>
          <div class="notice info"><div><b>CDP 连接端口</b><br>指纹注入依赖 <code>--remote-debugging-port</code>（仅绑定 127.0.0.1）。Veil 退出后<b>新开</b>的标签页将无法继续注入；建议在 Veil 运行期间使用窗口，或设置里开启「保留在菜单栏」。</div></div>
          <div class="notice info"><div><b>媒体编解码器</b><br><code>MediaSource.isTypeSupported()</code> 与 <code>canPlayType()</code> 反映真实系统的编解码支持，未做伪装。</div></div>
        </div></div></div>
    </div></div>`;
}
function bindDetect(root) {
  const probe = async () => {
    const t = toast('info', '正在探测本机指纹…', '会静默启动一次 Chrome（headless）', 60000);
    try {
      S.host = await Bridge.call('probeHost', {});
      t.remove();
      toast('ok', '探测完成', `Chrome ${S.host.chromeMajor} · ${(S.host.fonts || []).length} 个字体`);
      renderView(true); updateHostCard();
    } catch (e) { t.remove(); toast('err', '探测失败', String(e.message || e), 9000); }
  };
  qs('#btnProbeHost', root) && (qs('#btnProbeHost', root).onclick = probe);
  qs('#btnProbeNow', root) && (qs('#btnProbeNow', root).onclick = probe);
  qs('#btnOpenDetectPage', root) && (qs('#btnOpenDetectPage', root).onclick = async () => {
    if (!S.running.length) { toast('warn', '没有运行中的窗口'); return; }
    const v = await promptDlg({ title: '在哪个窗口打开自检页', fields: [{ key: 'id', label: '窗口', type: 'select', options: S.running.map(r => ({ v: r.id, t: `#${r.seq} ${r.name}` })) }] });
    if (v) await doDetect(v.id);
  });
  on(root, 'click', '[data-probe]', (e, t) => runProbe(t.dataset.probe));
}

/* ==========================================================================
   视图：本地 API
   ========================================================================== */
function viewAPI() {
  const ai = S.apiInfo || { port: 54345, base: 'http://127.0.0.1:54345', enabled: true, endpoints: [], snippets: [] };
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>本地 API</h1>
        <p>${ai.enabled ? `监听 <b class="mono">${esc(ai.base)}</b> —— 接口协议兼容比特浏览器（BitBrowser），现有对接脚本可直接改用` : '已关闭，可在设置中开启'}</p></div>
      <div class="view-tools">
        <button class="btn" id="btnCopyBase">复制 Base URL</button>
        <button class="btn" id="btnHealth">测试 /health</button>
      </div>
    </div>
    <div class="view-body">
      <div class="fp-sec open"><div class="fp-head"><span class="ic">⚡</span><h4>快速上手</h4><span class="d">打开窗口 → 拿到 CDP 地址 → 交给 Selenium / Playwright / Puppeteer</span></div>
        <div class="fp-body">
          <div class="notice ok">Veil 的 <code>/browser/open</code> 返回 <code>http</code> 与 <code>wsUrl</code> 字段，可直接喂给
            <code>playwright.chromium.connect_over_cdp()</code> 或 <code>puppeteer.connect({browserWSEndpoint})</code>。
            Veil 会在你连接期间持续为新开的标签页注入指纹，无需额外处理。</div>
          ${(ai.snippets || []).map(s => `<div>
            <div class="lbl" style="margin-bottom:5px">${esc(s.name)}</div>
            <div class="code-wrap"><button class="code-copy" data-copy>复制</button><div class="code">${esc(s.code)}</div></div></div>`).join('')}
        </div></div>

      <div class="fp-sec open"><div class="fp-head"><span class="ic">📡</span><h4>接口列表</h4><span class="d">${(ai.endpoints || []).length} 个</span></div>
        <div class="fp-body"><div class="stack">
          ${(ai.endpoints || []).map((e, i) => `<div class="ep" data-i="${i}">
            <div class="ep-head"><span class="mth ${esc(e.method)}">${esc(e.method)}</span>
              <span class="ep-path">${esc(e.path)}</span><span class="ep-desc">${esc(e.desc)}</span>
              <svg class="chev" viewBox="0 0 12 12" width="11" height="11" style="color:var(--tx-4);transition:transform .18s"><path fill="currentColor" d="M4.5 2.5 8 6l-3.5 3.5z"/></svg></div>
            <div class="ep-body" style="display:none">
              ${e.body ? `<div><div class="lbl">请求体</div><div class="code">${esc(e.body)}</div></div>` : ''}
              <div><div class="lbl">curl 示例</div>
                <div class="code-wrap"><button class="code-copy" data-copy>复制</button>
                <div class="code">${esc(e.example || `curl -s -X ${e.method} ${ai.base}${e.path} -H 'Content-Type: application/json' -d '${e.body || '{}'}'`)}</div></div></div>
              <div class="row"><button class="btn btn-sm" data-try="${i}">▶ 试运行</button><span class="hint">结果会显示在下方</span></div>
              <div class="tryout" id="tryout-${i}"></div>
            </div></div>`).join('')}
        </div></div></div>
    </div></div>`;
}
function bindAPI(root) {
  qs('#btnCopyBase', root) && (qs('#btnCopyBase', root).onclick = () => copy((S.apiInfo || {}).base || '', 'Base URL 已复制'));
  qs('#btnHealth', root) && (qs('#btnHealth', root).onclick = async () => {
    const base = (S.apiInfo || {}).base;
    try { const r = await (await fetch(base + '/health')).json(); toast('ok', 'API 正常', JSON.stringify(r.data || r)); }
    catch (e) { toast('err', 'API 不可达', String(e.message || e), 8000); }
  });
  on(root, 'click', '.ep-head', (e, t) => {
    const ep = t.closest('.ep'); ep.classList.toggle('open');
    const b = qs('.ep-body', ep); b.style.display = ep.classList.contains('open') ? '' : 'none';
    qs('.chev', t).style.transform = ep.classList.contains('open') ? 'rotate(90deg)' : '';
  });
  on(root, 'click', '[data-copy]', (e, t) => copy(qs('.code', t.parentElement).textContent, '已复制'));
  on(root, 'click', '[data-try]', async (e, t) => {
    const i = +t.dataset.try;
    const ep = (S.apiInfo.endpoints || [])[i]; if (!ep) return;
    const out = qs('#tryout-' + i, root); out.innerHTML = '<div class="busy"><div class="spinner"></div>请求中…</div>';
    const base = (S.apiInfo || {}).base;
    let body = ep.body || '';
    if (ep.method === 'GET') body = '';
    else {
      const v = await promptDlg({ title: '试运行 ' + ep.path, message: '可修改请求体 JSON', fields: [{ key: 'b', label: 'Body', type: 'textarea', rows: 6, value: ep.body || '{}' }], okText: '发送' });
      if (!v) { out.innerHTML = ''; return; }
      body = v.b;
    }
    const t0 = Date.now();
    try {
      const r = await fetch(base + ep.path, ep.method === 'GET' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const txt = await r.text();
      let pretty = txt; try { pretty = JSON.stringify(JSON.parse(txt), null, 1); } catch (e) { /* keep raw */ }
      out.innerHTML = `<div class="lbl">HTTP ${r.status} · ${Date.now() - t0}ms</div><div class="code" style="max-height:260px">${esc(pretty)}</div>`;
    } catch (err) { out.innerHTML = `<div class="notice bad">请求失败：${esc(String(err.message || err))}</div>`; }
  });
}

/* ==========================================================================
   视图：设置
   ========================================================================== */
function viewSettings() {
  const st = S.settings || {};
  return `<div class="view">
    <div class="view-head"><div class="view-title"><h1>设置</h1><p>Veil ${esc(S.env.version || '')} · macOS ${esc(S.env.macOS || '')} · ${esc(S.env.arch || '')}</p></div>
      <div class="view-tools"><button class="btn btn-primary" id="btnSaveSettings">保存设置</button></div></div>
    <div class="view-body"><div class="stack">
      ${sec('api', '🔌', '本地 API', st.apiEnabled ? `已启用 · 端口 ${st.apiPort}` : '已关闭', `
        ${sw('apiEnabled', st.apiEnabled !== false, '启用本地 HTTP API', '兼容比特浏览器协议，供 Selenium / Playwright / RPA 调用')}
        <div class="grid2">
          ${num('apiPort', '监听端口（仅 127.0.0.1）', st.apiPort || 54345, 'min="1024" max="65535"')}
          ${txt('apiToken', '访问令牌（可选）', st.apiToken || '', '留空 = 不校验；建议开启')}
        </div>
        <div class="hint">默认端口 <code>54345</code> 与比特浏览器一致，若本机同时装了 BitBrowser 会端口冲突，Veil 会自动改用随机端口（可在「本地 API」页看到实际端口）。</div>
      `, true)}

      ${sec('browser', '🧭', '浏览器', st.defaultBrowserPath || '自动选择', `
        <div class="field"><label>默认浏览器内核</label>
          <div class="row"><select data-bind="defaultBrowserPath" style="flex:1">
            <option value="">自动选择（优先 Google Chrome）</option>
            ${(S.env.browsers || []).map(b => `<option value="${esc(b.path)}" ${st.defaultBrowserPath === b.path ? 'selected' : ''}>${esc(b.name)} ${esc(b.version || '')}</option>`).join('')}
          </select><button class="btn" id="btnPickBrowser2">浏览…</button></div>
          <div class="hint">已检测到 ${((S.env.browsers || []).length)} 个：${(S.env.browsers || []).map(b => esc(b.name)).join(' · ') || '无'}</div></div>
        <div class="grid2">
          ${num('cascadeOffset', '多开窗口级联偏移 (px)', st.cascadeOffset || 28, 'min="0" max="200"')}
          ${sw('autoCheckProxyOnOpen', st.autoCheckProxyOnOpen, '打开窗口时自动检测代理', '会略微延长启动时间')}
        </div>
      `, true)}

      ${sec('app', '🪟', '应用行为', '', `
        ${sw('keepInMenuBar', st.keepInMenuBar !== false, '关闭窗口后保留在菜单栏', '重要：Veil 退出后新开的标签页将无法继续注入指纹')}
        ${sw('autoAttachOnLaunch', st.autoAttachOnLaunch !== false, '启动时自动接管仍在运行的窗口', '')}
      `)}

      ${sec('sec', '🔐', '安全与数据', st.masterPasswordEnabled ? '已启用主密码' : '未加密', `
        <div class="notice ${st.masterPasswordEnabled ? 'ok' : 'info'}"><div>${st.masterPasswordEnabled
          ? '配置文件已用 AES-256-GCM 加密，密钥由主密码经 PBKDF2-HMAC-SHA256（12 万次迭代）派生。'
          : '当前配置以明文 JSON 保存在本地。若本机存在其它用户或你不信任的软件，建议启用主密码加密。'}</div></div>
        <div class="row wrap">
          <button class="btn" id="btnSetPwd">${st.masterPasswordEnabled ? '修改 / 关闭主密码' : '设置主密码'}</button>
          <button class="btn" id="btnRevealData">打开数据目录</button>
          <button class="btn" id="btnExportAll">导出全部配置</button>
          <button class="btn" id="btnImportAll">导入配置</button>
        </div>
        ${kv('数据目录', S.env.supportDir || '')}
        ${kv('注入脚本', S.env.injectFrom || '')}
        <div class="hint">窗口浏览数据保存在 <code>profiles/&lt;窗口ID&gt;/data</code>，删除窗口时可选择一并删除。</div>
      `)}

      ${sec('about', 'ℹ️', '关于', '', `
        <div class="fp-grid">
          ${kv('版本', S.env.version || '')}${kv('本机 Chrome', S.host.chromeMajor ? S.host.chromeMajor + ' (' + S.host.chromeFullVersion + ')' : '未探测')}
          ${kv('窗口数', String((S.stats || {}).total || 0))}${kv('运行中', String((S.stats || {}).running || 0))}
          ${kv('注入通道', 'CDP (Page.addScriptToEvaluateOnNewDocument + Emulation.*)')}
          ${kv('原生桥', Bridge.native ? 'WKWebView' : 'HTTP (浏览器直连模式)')}
        </div>
        <div class="notice info"><div><b>为什么不用扩展注入？</b><br>Chrome 137 起，品牌版 Chrome 移除了 <code>--load-extension</code> 命令行开关。Veil 因此全程走 CDP：
          <code>Emulation.setUserAgentOverride</code>（含 Client Hints）、<code>setTimezoneOverride</code>、<code>setLocaleOverride</code>、<code>setGeolocationOverride</code>
          加上 <code>Page.addScriptToEvaluateOnNewDocument</code> 注入的主世界脚本，覆盖 Canvas / WebGL / 音频 / 字体 / WebRTC / 媒体设备 / 电池 / 插件 / 存储配额等 30+ 项。</div></div>
        <div class="row wrap"><button class="btn" id="btnOpenLog">查看完整日志</button>
          <button class="btn" id="btnAbout">关于 Veil</button></div>
      `)}
    </div></div></div>`;
}
function bindSettings(root) {
  on(root, 'input', '[data-bind]', e => {
    const k = e.target.dataset.bind;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'number') v = parseFloat(v) || 0;
    S.settings[k] = v;
  });
  on(root, 'change', '[data-bind]', e => {
    const k = e.target.dataset.bind;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'number') v = parseFloat(v) || 0;
    S.settings[k] = v;
  });
  qs('#btnSaveSettings', root).onclick = async () => {
    try { await Bridge.call('saveSettings', { settings: S.settings }); toast('ok', '设置已保存'); S.env = await Bridge.call('env', {}); S.apiInfo = await Bridge.call('apiInfo', {}); updateChrome(); }
    catch (e) { toast('err', '保存失败', String(e.message || e), 8000); }
  };
  qs('#btnPickBrowser2', root).onclick = async () => {
    const r = await Bridge.call('pickBrowser', {});
    if (r.path) { S.settings.defaultBrowserPath = r.path; S.env = await Bridge.call('env', {}); renderView(true); toast('ok', '已选择', r.path); }
  };
  qs('#btnRevealData', root).onclick = () => Bridge.call('reveal', { path: S.env.supportDir });
  qs('#btnExportAll', root).onclick = () => doExport(null);
  qs('#btnImportAll', root).onclick = () => doImport();
  qs('#btnOpenLog', root).onclick = () => showLogs();
  qs('#btnAbout', root).onclick = () => showAbout();
  qs('#btnSetPwd', root).onclick = async () => {
    const v = await promptDlg({ title: '主密码', message: '设置后配置文件将以 AES-256-GCM 加密保存。留空并确认 = 关闭加密。',
      fields: [{ key: 'p1', label: '主密码', type: 'password', placeholder: '留空则关闭加密' }, { key: 'p2', label: '再次输入', type: 'password' }] });
    if (!v) return;
    if (v.p1 !== v.p2) { toast('err', '两次输入不一致'); return; }
    await Bridge.call('setMasterPassword', { password: v.p1 });
    toast(v.p1 ? 'ok' : 'warn', v.p1 ? '已启用主密码加密' : '已关闭加密', v.p1 ? '请牢记密码，丢失将无法恢复配置' : '');
    S.settings = await Bridge.call('settings', {}); renderView(true);
  };
  on(root, 'click', 'summary', () => { /* details 原生行为 */ });
}
async function showLogs() {
  const r = await Bridge.call('logs', { tail: 800 });
  modal({ title: '运行日志', subtitle: 'Veil 主进程', size: 'wide',
    body: `<div class="row" style="margin-bottom:9px"><button class="btn btn-sm" id="lgCopy">复制全部</button>
      <button class="btn btn-sm" id="lgReveal">在访达中显示</button><div class="grow"></div>
      <button class="btn btn-sm" id="lgRefresh">刷新</button></div>
      <div class="code" id="logBox" style="max-height:58vh">${esc(r.text || '（暂无日志）')}</div>`,
    footer: `<div class="grow"></div><button class="btn btn-primary" data-close>关闭</button>`,
    onMount(api) {
      const box = qs('#logBox', api.box);
      qs('#lgCopy', api.box).onclick = () => copy(box.textContent, '日志已复制');
      qs('#lgReveal', api.box).onclick = () => Bridge.call('reveal', { path: S.env.supportDir + '/logs' });
      qs('#lgRefresh', api.box).onclick = async () => { box.textContent = (await Bridge.call('logs', { tail: 800 })).text || ''; box.scrollTop = box.scrollHeight; };
      setTimeout(() => { box.scrollTop = box.scrollHeight; }, 50);
    } });
}
function showAbout() {
  const h = S.host || {};
  modal({ title: 'Veil 指纹浏览器', subtitle: 'v' + (S.env.version || ''), size: '',
    body: `<div class="stack">
      <div class="notice info"><div>Veil 是一个 macOS 原生的反检测指纹浏览器控制台：为每个「窗口」维护完全隔离的浏览数据目录，并通过 CDP 注入一整套可复现的伪造指纹。</div></div>
      <div class="fp-grid">${kv('版本', S.env.version || '')}${kv('构建架构', S.env.arch || '')}
        ${kv('macOS', S.env.macOS || '')}${kv('本机 Chrome', h.chromeMajor || '—')}
        ${kv('窗口', String((S.stats || {}).total || 0))}${kv('运行中', String((S.stats || {}).running || 0))}</div>
      <div class="hint">数据存储于 ${esc(S.env.supportDir || '')}</div></div>`,
    footer: `<div class="grow"></div><button class="btn btn-primary" data-close>好</button>` });
}

/* ==========================================================================
   路由 / 启动
   ========================================================================== */
const VIEWS = {
  profiles: { render: viewProfiles, bind: bindProfiles },
  running: { render: viewRunning, bind: bindRunning },
  groups: { render: viewGroups, bind: bindGroups },
  templates: { render: viewTemplates, bind: bindTemplates },
  detect: { render: viewDetect, bind: bindDetect },
  api: { render: viewAPI, bind: bindAPI },
  settings: { render: viewSettings, bind: bindSettings },
};

function go(view) {
  if (!VIEWS[view]) view = 'profiles';
  S.view = view;
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  qs('#tbSearchWrap').style.display = (view === 'profiles') ? '' : 'none';
  renderView();
}

function renderView(keepScroll) {
  const c = qs('#content'); if (!c) return;
  const v = VIEWS[S.view];
  const prev = keepScroll ? c.scrollTop : 0;
  c.innerHTML = v.render();
  v.bind(c);
  if (keepScroll) { const b = qs('.view-body', c); if (b) b.scrollTop = prev; }
}

function updateHostCard() {
  const h = S.host || {};
  const set = (id, v, title) => { const el = qs(id); if (el) { el.textContent = v || '—'; if (title !== undefined) el.title = title || v || ''; } };
  set('#hcChrome', h.chromeMajor ? `${h.chromeMajor}` : '未探测', h.chromeFullVersion);
  set('#hcGpu', (h.webglUnmaskedRenderer || '').replace(/^ANGLE \(([^,]+), /, '$1: ').slice(0, 46), h.webglUnmaskedRenderer);
  set('#hcTz', h.timezone, h.timezone);
  set('#hcFonts', h.fonts ? `${h.fonts.length} 个` : '—');
}

async function refreshAll() {
  S.settings = await Bridge.call('settings', {});
  S.templates = (await Bridge.call('templates', {})).list || [];
  S.stats = await Bridge.call('profileStats', {});
  await loadProfiles(true);
  renderView(true);
}

async function boot() {
  try {
    S.env = await Bridge.call('env', {});
    S.settings = await Bridge.call('settings', {});
    S.host = S.env.host || {};
    S.apiInfo = await Bridge.call('apiInfo', {});

    S.templates = (await Bridge.call('templates', {})).list || [];
    try { S.geoCities = (await Bridge.call('geoCities', {})).list || []; } catch (e) { S.geoCities = []; }
    try { S.fontLists = await Bridge.call('fontLists', {}); } catch (e) { S.fontLists = {}; }
    try { S.gpuLists = await Bridge.call('gpuLists', {}); } catch (e) { S.gpuLists = {}; }
  } catch (e) {
    qs('#boot').innerHTML = `<div style="text-align:center;color:#ff8fa0;font:13px/1.7 var(--ff);max-width:520px">
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">初始化失败</div>${esc(String(e.message || e))}</div>`;
    return;
  }
  if (S.env.locked) {
    const v = await promptDlg({ title: '需要主密码', message: 'Veil 的配置文件已加密，请输入主密码解锁。', dismissible: false,
      fields: [{ key: 'pw', label: '主密码', type: 'password' }], okText: '解锁' });
    if (v) {
      try { await Bridge.call('unlock', { password: v.pw }); S.env = await Bridge.call('env', {}); }
      catch (e) { toast('err', '解锁失败', String(e.message || e), 8000); }
    }
  }
  qs('#tbVer').textContent = S.env.version || '';
  qs('#app').classList.remove('hidden');
  updateHostCard();
  bindShell();
  await loadProfiles();
  go('profiles');
  S.booting = false;
  const b = qs('#boot'); b.classList.add('gone'); setTimeout(() => b.remove(), 300);
  if (!S.host || !S.host.probedAt) {
    toast('info', '正在探测本机指纹…', '首次启动需要读取真实 Chrome 版本与字体，用于生成一致的指纹', 5000);
  }
}

function bindShell() {
  on(document, 'click', '.nav-item', (e, t) => go(t.dataset.view));
  qs('#btnLogs').onclick = () => showLogs();
  qs('#btnProbe').onclick = () => { go('detect'); setTimeout(() => { const b = qs('#btnProbeHost'); if (b) b.click(); }, 60); };
  qs('#hcProbe').onclick = async () => {
    const t = toast('info', '正在探测本机指纹…', '', 60000);
    try { S.host = await Bridge.call('probeHost', {}); updateHostCard(); t.remove(); toast('ok', '探测完成', `Chrome ${S.host.chromeMajor} · ${(S.host.fonts || []).length} 字体`); if (S.view === 'detect') renderView(true); }
    catch (e) { t.remove(); toast('err', '探测失败', String(e.message || e), 9000); }
  };
  const gs = qs('#globalSearch');
  let deb = null;
  gs.oninput = () => { clearTimeout(deb); deb = setTimeout(() => { S.query = gs.value.trim(); if (S.view === 'profiles') loadProfiles(true); }, 170); };
  gs.onkeydown = e => { if (e.key === 'Escape') { gs.value = ''; S.query = ''; loadProfiles(true); gs.blur(); } };
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); gs.focus(); gs.select(); return; }
    if (e.key === 'Escape') { closePop(); return; }
    if (!mod || S.booting) return;
    if (qs('.modal-mask')) return;
    const k = e.key.toLowerCase();
    if (k === 'n' && !e.shiftKey) { e.preventDefault(); quickNew(); }
    else if (k === 'n' && e.shiftKey) { e.preventDefault(); batchNew(); }
    else if (k === 'o') { e.preventDefault(); if (S.sel.size) doOpen([...S.sel]); else toast('warn', '请先勾选窗口'); }
    else if (k === 'e') { e.preventDefault(); doExport(S.sel.size ? [...S.sel] : null); }
    else if (k === 'r') { e.preventDefault(); refreshAll(); }
    else if (k >= '1' && k <= '7') { e.preventDefault(); go(Object.keys(VIEWS)[+k - 1]); }
  });
  // 定期刷新运行状态
  setInterval(async () => {
    if (S.booting || qs('.modal-mask')) return;
    try {
      const r = await Bridge.call('running', {});
      const before = (S.running || []).map(x => x.id + ':' + x.pid).join(',');
      S.running = r.list || [];
      const after = S.running.map(x => x.id + ':' + x.pid).join(',');
      if (before !== after) { await loadProfiles(true); if (S.view === 'running') renderView(true); }
      else updateChrome();
    } catch (e) { /* ignore */ }
  }, 3000);
}

/* ---------------- 菜单回调（来自原生 AppKit 菜单） ---------------- */
window.__veilMenu = async (action, payload) => {
  closePop();
  switch (action) {
    case 'new': if (S.view !== 'profiles') go('profiles'); quickNew(); break;
    case 'batchNew': if (S.view !== 'profiles') go('profiles'); batchNew(); break;
    case 'import': doImport(); break;
    case 'exportAll': doExport(S.sel.size ? [...S.sel] : null); break;
    case 'openSelected': if (S.sel.size) doOpen([...S.sel]); else toast('warn', '请先在列表中勾选窗口'); break;
    case 'closeSelected': if (S.sel.size) doClose([...S.sel]); else toast('warn', '请先在列表中勾选窗口'); break;
    case 'detect': go('detect'); break;
    case 'apiDocs': go('api'); break;
    case 'logs': showLogs(); break;
    case 'probe': go('detect'); setTimeout(() => { const b = qs('#btnProbeHost'); if (b) b.click(); }, 80); break;
    case 'settings': go('settings'); break;
    default: break;
  }
  void payload;
};

window.__veilEvent = async (name, payload) => {
  if (name === 'hostReady') { S.host = payload || {}; updateHostCard(); if (S.view === 'detect') renderView(true); }
  else if (name === 'reattached') { if (payload > 0) toast('info', `已重新接管 ${payload} 个运行中的窗口`); await loadProfiles(true); }
  else if (name === 'ready') { /* noop */ }
  else if (name === 'sessionClosed') { await loadProfiles(true); }
};

/* ---------------- 顶部工具按钮（列表页） ---------------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('#btnNew,#btnBatchNew,#btnImport,#btnExport');
  if (!t) return;
  if (t.id === 'btnNew') quickNew();
  else if (t.id === 'btnBatchNew') batchNew();
  else if (t.id === 'btnImport') doImport();
  else if (t.id === 'btnExport') doExport(S.sel.size ? [...S.sel] : null);
});

window.addEventListener('error', ev => {
  if (!S.booting) toast('err', '界面错误', String(ev.message || ''), 8000);
});

boot().catch(e => {
  const b = qs('#boot');
  if (b) b.innerHTML = `<div style="color:#ff8fa0;font:13px/1.7 var(--ff)">启动失败：${esc(String(e && e.message || e))}</div>`;
});
