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
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(i18n.t('misc.timeout') + method)); } }, 180000);
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

/* ------------------------- i18n 简写 ------------------------- */
const __ = (k, p) => i18n.t(k, p);

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
  if (!ms) return i18n.t('misc.unknown');
  const d = new Date(ms), now = new Date();
  const p = n => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now - 86400000).toDateString() === d.toDateString();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (sameDay) return i18n.t('time.today', {hm: hm});
  if (yest) return i18n.t('time.yesterday', {hm: hm});
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}
function fmtAgo(ms) {
  if (!ms) return i18n.t('misc.unknown');
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return i18n.t('time.secondsAgo', {s: s});
  if (s < 3600) return i18n.t('time.minutesAgo', {n: Math.floor(s / 60)});
  if (s < 86400) return i18n.t('time.hoursAgo', {n: Math.floor(s / 3600)});
  return i18n.t('time.daysAgo', {n: Math.floor(s / 86400)});
}
function fmtDur(sec) {
  sec = Math.floor(sec || 0);
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(sec % 60).padStart(2, '0')}s`;
  return `${sec}s`;
}
function copy(text, label) {
  const done = () => toast('ok', i18n.t('toast.copied'), label || '');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallback()); }
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('err', i18n.t('toast.copyFailed'), String(e)); }
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
function osName(p) { return ({ windows: i18n.t('platform.windows'), mac: i18n.t('platform.mac'), linux: 'Linux', android: 'Android' })[p] || p; }
function proxyBadge(px) {
  if (!px || !px.type || px.type === 'none') return i18n.t('profile.proxyNone');
  if (px.type === 'custom') return i18n.t('profile.proxySystem');
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
      <button class="cl" title="$${'running.closeBtn'}">×</button></div>`).firstChild;
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
        ${opts.dismissible === false ? '' : '<button class="x-btn" data-close title="' + i18n.t('running.closeBtn') + '">✕</button>'}
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
      title: opts.title || i18n.t('dialog.confirmTitle'), size: '',
      body: `<div class="stack"><div class="notice ${opts.tone || 'warn'}">${opts.message || ''}</div>
             ${opts.detail ? `<div class="mono-s">${esc(opts.detail)}</div>` : ''}
             ${opts.extra || ''}</div>`,
      footer: `<div class="grow"></div>
               <button class="btn" data-no>${esc(opts.cancelText || i18n.t('common.cancel'))}</button>
               <button class="btn ${opts.okClass || 'btn-primary'}" data-yes>${esc(opts.okText || i18n.t('common.ok'))}</button>`,
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
      title: opts.title || i18n.t('dialog.promptTitle'), size: '',
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
      footer: `<div class="grow"></div><button class="btn" data-no>${i18n.t('common.cancel')}</button>
               <button class="btn btn-primary" data-ok>${esc(opts.okText || i18n.t('common.ok'))}</button>`,
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
   View: Profiles
   ========================================================================== */
function viewProfiles() {
  const st = S.stats || {};
  const groupOpts = [`<option value="__all__">${'common.allGroups'}</option>`]
    .concat(S.groups.map(g => `<option value="${esc(g.id)}" ${S.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`))
    .concat([`<option value="__none__" ${S.groupId === '__none__' ? 'selected' : ''}>${i18n.t('common.ungrouped')}</option>`]).join('');
  const platformOpts = ['all', 'windows', 'mac', 'linux', 'android']
    .map(p => `<option value="${p}" ${S.platform === p ? 'selected' : ''}>${p === 'all' ? i18n.t('common.allPlatforms') : osName(p)}</option>`).join('');

  return `<div class="view">
    <div class="view-head">
      <div class="view-title">
        <h1>${i18n.t('common.window')}</h1>
        <p>${i18n.t('profile.subtitle')}</p>
      </div>
      <div class="view-tools">
        <select id="fGroup" style="width:132px">${groupOpts}</select>
        <select id="fPlatform" style="width:112px">${platformOpts}</select>
        <label class="switch" title="$${'profile.showRunningOnly'}"><input type="checkbox" id="fRunning" ${S.runningOnly ? 'checked' : ''}><span class="track"></span><span class="lb">${'profile.statusRunning'}</span></label>
        <div style="width:1px;height:20px;background:var(--line)"></div>
        <button class="btn" id="btnBatchNew" title="$${'button.batchNew'}">
          <svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M2 3h8v1H2V3Zm0 3h8v1H2V6Zm10-3v3h3v1h-3v3H9V7H6V6h3V3h3Z"/></svg>${'button.batchNew'}</button>
        <button class="btn" id="btnImport" title="$${'button.importProfiles'}">${i18n.t('button.import')}</button>
        <button class="btn" id="btnExport" title="${i18n.t('button.exportAll')}">${i18n.t('button.export2')}</button>
        <button class="btn btn-primary" id="btnNew">
          <svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M8 2.5a.8.8 0 0 1 .8.8v3.9h3.9a.8.8 0 0 1 0 1.6H8.8v3.9a.8.8 0 0 1-1.6 0V8.8H3.3a.8.8 0 0 1 0-1.6h3.9V3.3a.8.8 0 0 1 .8-.8Z"/></svg>
          ${i18n.t('button.newProfile2')}</button>
      </div>
    </div>

    <div class="view-body">
      <div class="stats">
        <div class="stat ac"><div class="k">${'stats.totalProfiles'}</div><div class="v">${st.total || 0}</div></div>
        <div class="stat ok"><div class="k"><span class="dot dot-live"></span> i18n.t('profile.statusRunning')</div><div class="v">${st.running || 0}</div></div>
        <div class="stat"><div class="k">${'stats.withProxy'}</div><div class="v">${st.withProxy || 0}</div></div>
        <div class="stat"><div class="k">${'stats.totalOpens'}</div><div class="v">${st.totalOpens || 0}<small>${'stats.timesUnit'}</small></div></div>
        <div class="stat warn"><div class="k">${'stats.diskUsage'}</div><div class="v">${(st.diskUsageMB || 0) > 1024 ? ((st.diskUsageMB / 1024).toFixed(2) + '') : (st.diskUsageMB || 0)}<small>${(st.diskUsageMB || 0) > 1024 ? 'GB' : 'MB'}</small></div></div>
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
    <b style="font-size:12.5px;color:#a9bcff">${i18n.t('profile.selectedCount', {n: n})}</b>
    <div style="width:1px;height:18px;background:var(--ac-line)"></div>
    <button class="btn btn-sm" data-bulk="open">${'button.batchOpen'}</button>
    <button class="btn btn-sm" data-bulk="close">${'button.batchClose'}</button>
    <button class="btn btn-sm" data-bulk="group">${'button.moveToGroup'}</button>
    <button class="btn btn-sm" data-bulk="enable">${i18n.t('button.enable')}</button>
    <button class="btn btn-sm" data-bulk="disable">${i18n.t('button.disable')}</button>
    <button class="btn btn-sm" data-bulk="proxyCheck">${'button.checkProxyBtn'}</button>
    <button class="btn btn-sm" data-bulk="export">${i18n.t('button.export2')}</button>
    <button class="btn btn-sm" data-bulk="clearCache">${'button.clearCache'}</button>
    <button class="btn btn-sm btn-bad" data-bulk="delete">${'button.deleteAll'}</button>
    <div class="grow"></div>
    <button class="btn btn-sm btn-ghost" data-bulk="none">${'common.cancelSelection'}</button>
  </div>`;
}

function sortedProfiles() {
  let list = S.profiles.slice();
  const k = S.sortKey, dir = S.sortDir;
  const get = p => {
    switch (k) {
      case 'seq': return p.seq;
      case 'name': return (p.name || '').toLowerCase();
      case i18n.t('editor.clientHintPlatform'): return p.fp ? p.fp.platform : '';
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
      <h3>${S.query || S.groupId !== '__all__' || S.platform !== 'all' ? 'profile.emptyMatch' : i18n.t('toast.templateApplyNoProfiles')}</h3>
      <p>${S.query || S.groupId !== '__all__' || S.platform !== 'all'
        ? 'profile.emptyHint'
        : 'profile.intro'}</p>
      <button class="btn btn-primary btn-lg" id="btnEmptyNew">profile.firstProfile</button>
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
      <td>${g ? `<span class="gchip" title="${esc(g.name)}"><i style="background:${esc(g.color)}"></i>${esc(g.name)}</span>` : '<span class="badge stop">' + i18n.t('common.ungrouped')}</span>'}</td>
      <td><span class="badge os-${esc(fp.platform || 'windows')}" title="${esc(fp.platform)}">${osIcon(fp.platform || 'windows')}&nbsp;${esc(osName(fp.platform || 'windows'))}</span></td>
      <td>${proxyBadge(px)}</td>
      <td class="ellipsis" title="${esc(fp.timezone || '')}">${esc(p.countryName || fp.timezone || i18n.t('misc.unknown'))}</td>
      <td>${running ? `<span class="badge run"><i></i>${'profile.statusRunning'}</span>`
        : (p.enabled === false ? `<span class="badge dis"><i></i>${'profile.statusDisabled'}</span>` : `<span class="badge stop"><i></i>${'profile.statusStopped'}</span>`)}</td>
      <td class="ellipsis" title="${p.lastOpenedAt ? fmtTime(p.lastOpenedAt) : ''}">${p.lastOpenedAt ? fmtAgo(p.lastOpenedAt) : i18n.t('profile.neverOpened')}</td>
      <td class="c-act"><div class="rowacts">
        ${running
          ? `<button class="btn btn-sm" data-act="detect" title="${i18n.t('profile.titleDetect')}">${i18n.t('button.fingerprintCheck')}</button>
             <button class="btn btn-sm btn-bad" data-act="close" title="$${'profile.closeWindow'}">${'running.closeBtn'}</button>`
          : `<button class="btn btn-sm btn-ok" data-act="open" title="${i18n.t('profile.openWindow')}">${i18n.t('button.open')} ▶</button>`}
        <button class="btn btn-sm" data-act="edit" title="$${'profile.editHint'}">${i18n.t('common.edit')}</button>
        <button class="btn btn-sm btn-ghost" data-act="more" title="$${i18n.t('common.more')}">⋯</button>
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
      <th data-sort="seq">#</th><th data-sort="name">${i18n.t('profile.name')}</th><th>${i18n.t('profile.group')}</th>
      <th data-sort=i18n.t('editor.clientHintPlatform')>${i18n.t('profile.platform')}</th><th>${i18n.t('profile.proxy')}</th><th data-sort="country">${i18n.t('profile.region')}</th>
      <th data-sort="status">${i18n.t('profile.status')}</th><th data-sort="lastOpenedAt">${'profile.lastOpenedAt'}</th><th style="text-align:right">${i18n.t('profile.actions')}</th>
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
    ['edit', i18n.t('row.editProfile')], ['dup', i18n.t('row.dupProfile')], ['dupCache', i18n.t('row.dupWithCache')],
    ['-', ''],
    ['openNew', i18n.t('row.openInNewTab')], ['copyWs', i18n.t('row.copyCdpInfo')],
    ['cookies', i18n.t('row.cookieManager')], ['clearCache', i18n.t('row.clearBrowserCache')],
    ['-', ''],
    ['toggle', p.enabled === false ? i18n.t('row.enableProfile') : i18n.t('row.disableProfile')],
    ['revealDir', i18n.t('row.revealInFinder')],
    ['-', ''], ['del', i18n.t('row.deleteProfile')],
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
      const n = await promptDlg({ title: i18n.t('row.dupProfile'), message: i18n.t('dialog.dupMessage'), fields: [{ key: 'count', label: i18n.t('dialog.duplicateCount'), type: 'number', value: 1 }] });
      if (!n) return;
      const r = await Bridge.call('duplicateProfiles', { id, count: Math.max(1, parseInt(n.count) || 1), copyCache: k === 'dupCache' });
      toast('ok', i18n.t('toast.duplicatedCount', {n: r.count})); await loadProfiles(); break;
    }
    case 'openNew': {
      const v = await promptDlg({ title: i18n.t('dialog.openInProfileTitle'), fields: [{ key: 'url', label: i18n.t('common.url'), placeholder: 'https://example.com' }] });
      if (!v || !v.url) return;
      const s = S.running.find(x => x.id === id);
      if (!s) { toast('warn', i18n.t('toast.profileNotRunning'), i18n.t('toast.openingProfile')); await doOpen([id]); }
      const r = await Bridge.call('navigate', { id, url: v.url });
      if (r.ok) toast('ok', i18n.t('toast.navigated'), v.url); else toast('err', i18n.t('toast.navigateFailed'), r.msg || '');
      break;
    }
    case 'copyWs': {
      const s = S.running.find(x => x.id === id);
      if (!s) { toast('warn', i18n.t('toast.profileNotRunning'), i18n.t('toast.startBeforeCopyCdp')); return; }
      copy(s.ws, s.ws); break;
    }
    case 'cookies': openCookieDlg(id); break;
    case 'clearCache': {
      const ok = await confirmDlg({ title: i18n.t('row.clearBrowserCache'), tone: 'warn', message: i18n.t('dialog.clearCacheMessage'), okText: i18n.t('common.clear'), okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('clearProfileData', { ids: [id] });
      toast('ok', i18n.t('toast.cleared'), i18n.t('toast.clearedDesc')); break;
    }
    case 'toggle': {
      await Bridge.call('setEnabled', { ids: [id], enabled: p.enabled === false });
      await loadProfiles(); break;
    }
    case 'revealDir': await Bridge.call('reveal', { path: (S.env.supportDir || '') + '/profiles/' + id }); break;
    case 'del': {
      const ok = await confirmDlg({ title: i18n.t('row.deleteProfile'), tone: 'bad', message: i18n.t('dialog.deleteProfileMessage', {n: esc(p ? p.name : id)}), okText: i18n.t('button.deleteAll'), okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('deleteProfiles', { ids: [id], deleteData: true });
      S.sel.delete(id); toast('ok', i18n.t('toast.deleted')); await loadProfiles(); break;
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
    g.innerHTML = [`<option value="__all__">${'common.allGroups'}</option>`]
      .concat(S.groups.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`))
      .concat([`<option value="__none__">${i18n.t('common.ungrouped')}</option>`]).join('');
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
  qs('#navApiPort').textContent = S.env.apiPort || i18n.t('misc.unknown');
  const live = run > 0;
  const d = qs('#tbStat .dot'); if (d) d.className = 'dot' + (live ? ' dot-live' : '');
}

async function doOpen(ids) {
  if (!ids.length) return;
  const t = toast('info', i18n.t('toast.openingNProfiles', {n: ids.length}), i18n.t('toast.openingDesc'), 60000);
  try {
    const res = await Bridge.call('openProfiles', { ids, concurrency: 2 });
    t.classList.add('out'); setTimeout(() => t.remove(), 200);
    const okN = res.filter(r => r.ok).length;
    const bad = res.filter(r => !r.ok);
    if (okN) toast('ok', i18n.t('toast.openedN', {okN: okN}), ids.length > 1 ? i18n.t('toast.failedN', {n: bad.length}) : '');
    bad.forEach(b => {
      const p = S.profiles.find(x => x.id === b.id);
      toast('err', i18n.t('toast.openFailedProfile', {n: p ? p.seq : '?', a: p ? p.name : b.id}), b.msg || '', 12000);
    });
  } catch (e) {
    t.classList.add('out'); setTimeout(() => t.remove(), 200);
    toast('err', i18n.t('toast.openFailedShort'), String(e.message || e), 10000);
  }
  await loadProfiles(true);
}
async function doClose(ids) {
  if (!ids.length) return;
  await Bridge.call('closeProfiles', { ids });
  toast('ok', i18n.t('toast.closedNProfiles', {n: ids.length}));
  await loadProfiles(true);
}
async function doDetect(id) {
  const r = await Bridge.call('detect', { id });
  if (r.ok) toast('ok', i18n.t('toast.detectOpened'), r.url);
  else toast('err', i18n.t('toast.detectOpenFailed'), r.msg || i18n.t('toast.profileNotRunning'));
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
      toast('ok', kind === 'enable' ? i18n.t('toast.enabled') : i18n.t('profile.statusDisabled'), i18n.t('group.profileCount', {n: ids.length}));
      return loadProfiles(true);
    case 'delete': {
      const withData = await confirmDlg({ title: i18n.t('dialog.deleteNProfiles', {n: ids.length}), tone: 'bad', message: i18n.t('dialog.deleteNMessage'), okText: i18n.t('button.deleteAll'), okClass: 'btn-bad', extra: `<label class="switch" style="margin-top:4px"><input type="checkbox" id="delKeep"><span class="track"></span><span class="lb">${'dialog.keepDataLabel'}</span></label>` });
      if (!withData) return;
      const keep = qs('#delKeep'); const keepData = keep ? keep.checked : false;
      await Bridge.call('deleteProfiles', { ids, deleteData: !keepData });
      ids.forEach(i => S.sel.delete(i));
      toast('ok', i18n.t('toast.deletedN', {n: ids.length})); return loadProfiles();
    }
    case 'group': {
      const v = await promptDlg({ title: i18n.t('button.moveToGroup'), fields: [{ key: 'g', label: i18n.t('dialog.targetGroup'), type: 'select', options: S.groups.map(g => ({ v: g.id, t: g.name })).concat([{ v: '', t: i18n.t('common.ungroupedParen') }]) }] });
      if (!v) return;
      for (const id of ids) {
        const p = S.profiles.find(x => x.id === id);
        if (p && p.veil) { p.veil.groupId = v.g; await Bridge.call('saveProfile', { profile: p.veil }); }
      }
      toast('ok', i18n.t('toast.movedN', {n: ids.length})); return loadProfiles(true);
    }
    case 'proxyCheck': {
      const t = toast('info', i18n.t('toast.checkingNProxies', {n: ids.length}), '', 120000);
      let okN = 0, failN = 0;
      for (const id of ids) {
        const p = S.profiles.find(x => x.id === id); if (!p || !p.veil || !p.veil.proxy || !p.veil.proxy.host) { failN++; continue; }
        try { const r = await Bridge.call('checkProxy', { proxy: p.veil.proxy, profileId: id }); if (r.ok) okN++; else failN++; } catch (e) { failN++; }
      }
      t.remove(); toast(okN ? 'ok' : 'warn', i18n.t('toast.proxyCheckDone'), i18n.t('toast.proxyCheckResult', {okN: okN, failN: failN}));
      return loadProfiles(true);
    }
    case 'export': return doExport(ids);
    case 'clearCache': {
      const ok = await confirmDlg({ title: i18n.t('button.clearCache'), tone: 'warn', message: i18n.t('dialog.clearNCacheMessage', {n: ids.length}), okText: i18n.t('common.clear'), okClass: 'btn-bad' });
      if (!ok) return;
      await Bridge.call('clearProfileData', { ids });
      toast('ok', i18n.t('toast.cleared')); return;
    }
  }
}

async function quickNew(platform) {
  const r = await Bridge.call('newProfile', { platform: platform || 'windows', groupId: (S.groupId !== '__all__' && S.groupId !== '__none__') ? S.groupId : '', count: 1 });
  const p = r.list[0];
  toast('ok', i18n.t('toast.createdWithSeq', {n: p.seq, a: p.name}), p.fp.timezone);
  await loadProfiles();
  openEditor(p.id);
}
async function batchNew() {
  const v = await promptDlg({
    title: i18n.t('dialog.batchNewTitle'),
    message: i18n.t('dialog.batchNewMessage'),
    fields: [
      { key: 'count', label: i18n.t('dialog.batchNewCount'), type: 'number', value: 5 },
      { key: i18n.t('editor.clientHintPlatform'), label: i18n.t('dialog.targetPlatform'), type: 'select', options: [{ v: 'windows', t: i18n.t('platform.windows') }, { v: 'mac', t: i18n.t('platform.mac') }, { v: 'linux', t: 'Linux' }] },
      { key: 'country', label: i18n.t('dialog.countryOptional'), type: 'select', options: [{ v: '', t: i18n.t('common.random') }].concat(countryOptions()) },
      { key: 'prefix', label: i18n.t('common.namePrefix'), placeholder: i18n.t('common.placeholderPrefix') },
    ],
    okText: i18n.t('common.create')
  });
  if (!v) return;
  const n = Math.max(1, Math.min(200, parseInt(v.count) || 1));
  const t = toast('info', i18n.t('toast.creatingNProfiles', {n: n}), '', 60000);
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
  toast('ok', i18n.t('toast.createdN', {n: created.length}), i18n.t('toast.seqRange', {n: created[0].seq, a: created[created.length - 1].seq}));
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
    const s = await Bridge.call('saveFile', { filename: r.filename, content: r.json, message: i18n.t('toast.exportMessage', {n: r.count}) });
    if (s.ok) toast('ok', i18n.t('toast.exported'), s.path);
  } else {
    const blob = new Blob([r.json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.filename; a.click();
    toast('ok', i18n.t('toast.exported'), r.filename);
  }
}
async function doImport() {
  let text = '';
  if (Bridge.native) {
    const f = await Bridge.call('openFile', { message: i18n.t('toast.chooseExportFile'), types: ['json', 'txt'] });
    if (!f.ok) return; text = f.text;
  } else {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.txt';
    text = await new Promise(res => { inp.onchange = () => { const fr = new FileReader(); fr.onload = () => res(fr.result); inp.files[0] && fr.readAsText(inp.files[0]); }; inp.click(); });
  }
  if (!text) return;
  try {
    const r = await Bridge.call('importProfiles', { json: text });
    toast('ok', i18n.t('toast.imported', {n: r.imported}));
    await loadProfiles();
  } catch (e) { toast('err', i18n.t('toast.importFailed'), String(e.message || e), 8000); }
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
  if (!p) { toast('err', i18n.t('toast.editorOpenFailed'), i18n.t('toast.profileNotFound')); return; }
  E.p = p; E.tab = 'basic'; E.dirty = false;
  const tabs = [['basic', i18n.t('editor.tabBasic')], ['proxy', i18n.t('profile.proxy')], ['fp', i18n.t('editor.tabFingerprint')], ['launch', i18n.t('editor.tabLaunch')], ['auto', i18n.t('editor.tabAutomation')]]
    .map(([k, t]) => `<button class="tab ${k === E.tab ? 'active' : ''}" data-tab="${k}">${t}</button>`).join('');
  E.api = modal({
    title: i18n.t('editor.title', {n: p.seq}), subtitle: p.name, size: 'wide', tabs,
    body: '<div class="busy"><div class="spinner lg"></div>' + i18n.t('common.loading') + '</div>',
    footer: `<div class="row" style="gap:6px;color:var(--tx-4);font-size:11px">
                 <span class="mono-s" title="$${'editor.fpSeed'}">seed ${esc((p.fp.seed || '').slice(0, 12))}…</span>
               </div>
               <div class="grow"></div>
               <button class="btn" data-act="cancel">${i18n.t('common.cancel')}</button>
               <button class="btn" data-act="saveTemplate">${'button.saveAsTemplate'}</button>
               <button class="btn" data-act="reset">${'button.resetFp'}</button>
               <button class="btn btn-primary" data-act="save">${i18n.t('common.save')}</button>`,
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
  if (!px || !px.type || px.type === 'none') return i18n.t('editor.proxyDirectFull');
  if (px.type === 'custom') return i18n.t('editor.proxyCustomFull');
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
  const gOpts = [`<option value="">${'common.ungroupedParen'}</option>`].concat(S.groups.map(g =>
    `<option value="${esc(g.id)}" ${p.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`)).join('');
  return `<div class="stack">
    <div class="grid2">
      <div class="field"><label>${'editor.profileName'}</label><input data-bind="name" value="${esc(p.name)}" placeholder="$" + i18n.t('editor.profileNamePlaceholder')}"></div>
      <div class="field"><label>${i18n.t('editor.seq')}</label><input data-bind="seq" type="number" min="1" value="${p.seq}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>${i18n.t('editor.group')}</label><select data-bind="groupId">${gOpts}</select></div>
      <div class="field"><label>${i18n.t('editor.targetPlatform')} <span class="hint" style="font-weight:400">${i18n.t('editor.platformHint')}</span></label>
        <select data-bind="fp.platform">
          ${['windows', 'mac', 'linux', 'android'].map(x => `<option value="${x}" ${p.fp.platform === x ? 'selected' : ''}>${osName(x)}</option>`).join('')}
        </select></div>
    </div>
    <div class="field"><label>${i18n.t('common.remark')}</label><textarea data-bind="remark" rows="2" placeholder="$" + i18n.t('editor.remarkPlaceholder')}">${esc(p.remark || '')}</textarea></div>
    <div class="field"><label>${'editor.tagsLabel'}</label><input data-bind="tags" value="${esc((p.tags || []).join(', '))}" placeholder="$" + i18n.t('editor.tagsPlaceholder')}"></div>
    <label class="switch"><input type="checkbox" class="ck" data-bind="enabled" ${p.enabled !== false ? 'checked' : ''}><span class="track"></span><span class="lb">${'editor.enabledLabel'}</span></label>
    <hr class="sep">
    <div class="fp-grid">
      ${kv(i18n.t('editor.profileId'), p.id)}
      ${kv(i18n.t('editor.createdAt'), fmtTime(p.createdAt))}
      ${kv(i18n.t('profile.lastOpenedAt'), p.lastOpenedAt ? fmtTime(p.lastOpenedAt) : i18n.t('profile.neverOpened'))}
      ${kv(i18n.t('editor.totalOpens'), (p.openCount || 0) + ' ' + i18n.t('stats.timesUnit'))}
      ${kv(i18n.t('editor.fpMode'), { random: i18n.t('editor.fpModeRandom'), custom: i18n.t('editor.fpModeCustom'), real: i18n.t('editor.fpModeReal') }[p.fp.mode] || p.fp.mode)}
      ${kv(i18n.t('editor.dataDir'), 'profiles/' + p.id + '/data')}
    </div>
    <div class="notice info">i18n.t('editor.isolationNote')</div>
  </div>`;
}
function kv(k, v) { return `<div><div class="lbl" style="margin-bottom:3px">${esc(k)}</div><div class="mono-s">${esc(v)}</div></div>`; }

/* ---------------- 代理 ---------------- */
function tabProxy(p) {
  const px = p.proxy || {};
  const r = px.checkResult;
  return `<div class="stack">
    <div class="notice info">i18n.t('editor.proxyNote')</div>
    <div class="grid2">
      <div class="field"><label>${i18n.t('editor.proxyType')}</label>
        <select data-bind="proxy.type">
          ${[['none', i18n.t('editor.proxyNone')], ['custom', i18n.t('editor.proxyCustom')], ['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']]
            .map(([v, t]) => `<option value="${v}" ${(px.type || 'none') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>${'editor.proxyPaste'}</label>
        <div class="row"><input id="pxPaste" placeholder="${i18n.t('editor.proxyPastePh')}" style="flex:1">
        <button class="btn" data-ed="parseProxy">${'button.parseProxy'}</button></div></div>
    </div>
    <div class="grid3">
      <div class="field"><label>${'editor.proxyHost'}</label><input data-bind="proxy.host" value="${esc(px.host || '')}" placeholder="${i18n.t('editor.placeholderIp')}"></div>
      <div class="field"><label>${'editor.proxyPort'}</label><input data-bind="proxy.port" type="number" value="${px.port || ''}" placeholder="${i18n.t('editor.placeholderPort')}"></div>
      <div class="field"><label>${'editor.proxyPreview'}</label><div class="mono-s" data-out="proxyLabel" style="padding-top:7px">${esc(proxySummary(px))}</div></div>
    </div>
    <div class="grid2">
      <div class="field"><label>${'editor.proxyUsername'}</label><input data-bind="proxy.username" value="${esc(px.username || '')}" autocomplete="off"></div>
      <div class="field"><label>${'editor.proxyPassword'}</label><input data-bind="proxy.password" type="password" value="${esc(px.password || '')}" autocomplete="off"></div>
    </div>
    <div class="row wrap">
      <button class="btn btn-primary" data-ed="checkProxy"><span class="spinner hidden" data-role="pxSpin"></span>${'button.checkProxyBtn'}</button>
      <button class="btn" data-ed="syncTz">${'editor.proxySyncTz'}</button>
      <div class="grow"></div>
      ${r ? `<span class="badge ${r.ok ? 'run' : 'dis'}">${r.ok ? i18n.t('editor.proxyOk') : i18n.t('editor.proxyBad')}</span>
             <span class="hint">${i18n.t('editor.probeAt', {time: fmtTime(r.checkedAt)})}</span>` : ''}
    </div>
    <div id="pxResult">${r ? proxyResultHTML(r) : ''}</div>
  </div>`;
}
function proxyResultHTML(r) {
  if (!r.ok) return `<div class="notice bad"><b>${'toast.proxyFailed'}</b> — ${esc(r.error || i18n.t('editor.proxyUnknownError'))}</div>`;
  return `<div class="fp-sec open"><div class="fp-head"><span class="ic">🌐</span><h4>${'editor.exitInfo'}</h4>
      <span class="d">${esc(r.ip)} · ${esc(r.country || '')} ${esc(r.city || '')} · ${r.latencyMs}ms</span></div>
    <div class="fp-body"><div class="fp-grid">
      ${kv(i18n.t('editor.exitIp'), r.ip)}${kv(i18n.t('editor.country'), `${r.country || i18n.t('misc.unknown')} (${r.countryCode || i18n.t('misc.unknown')})`)}
      ${kv(i18n.t('editor.city'), r.city || i18n.t('misc.unknown'))}${kv(i18n.t('editor.region'), r.region || i18n.t('misc.unknown'))}
      ${kv(i18n.t('editor.ipTimezone'), r.timezone || i18n.t('misc.unknown'))}${kv(i18n.t('editor.latency'), r.latencyMs + ' ms')}
    </div>
    ${r.timezone && r.timezone !== (E.p.fp.timezone) ? `<div class="notice warn">editor.tzMismatchWarn</div>` : ''}
    </div></div>`;
}
function bindProxyTab(root) { }

/* ---------------- 启动 ---------------- */
function tabLaunch(p) {
  const lc = p.launch || {};
  const browsers = (S.env.browsers || []).map(b => `<option value="${esc(b.path)}" ${lc.browserPath === b.path ? 'selected' : ''}>${esc(b.name)} ${esc(b.version || '')}</option>`).join('');
  return `<div class="stack">
    <div class="field"><label>${'editor.browserEngine'}</label>
      <div class="row"><select data-bind="launch.browserPath" style="flex:1">
          <option value="">${'editor.autoSelect'}</option>${browsers}
          ${lc.browserPath && !(S.env.browsers || []).some(b => b.path === lc.browserPath) ? `<option value="${esc(lc.browserPath)}" selected>${esc(lc.browserPath)}</option>` : ''}
        </select>
        <button class="btn" data-ed="pickBrowser">${i18n.t('button.browse')}</button>
        <button class="btn" data-ed="refreshBrowsers">${i18n.t('button.refresh')}</button></div>
      <div class="hint">editor.installed</div></div>
    <div class="field"><label>${i18n.t('editor.homepage')}</label>
      <div class="row"><input data-bind="launch.homepage" value="${esc(lc.homepage || '')}" placeholder="$" + i18n.t('editor.homepagePlaceholder')}" style="flex:1"></div>
      <div class="hint">${'editor.specialAddr'}</div></div>
    <div class="field"><label>${'editor.extraTabs'}</label>
      <textarea data-bind="launch.extraTabs" rows="2" placeholder="${i18n.t('common.urlPlaceholder')}">${esc((lc.extraTabs || []).join('\n'))}</textarea></div>
    <div class="grid2">
      <div class="field"><label>${'editor.windowPositionMode'}</label>
        <select data-bind="launch.windowPositionMode">
          ${[['cascade', i18n.t('editor.posCascade')], ['fixed', i18n.t('editor.posFixed')], ['auto', i18n.t('editor.posAuto')]]
            .map(([v, t]) => `<option value="${v}" ${(lc.windowPositionMode || 'cascade') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>${'editor.windowPosXY'}</label>
        <div class="row"><input data-bind="launch.windowPositionX" type="number" value="${lc.windowPositionX || 0}" style="width:50%">
        <input data-bind="launch.windowPositionY" type="number" value="${lc.windowPositionY || 0}" style="width:50%"></div></div>
    </div>
    <div class="field"><label>${'editor.extraArgs'}</label>
      <textarea data-bind="launch.extraArgs" rows="3" placeholder="--disable-gpu&#10;--ignore-certificate-errors">${esc((lc.extraArgs || []).join('\n'))}</textarea>
      <div class="hint">i18n.t('editor.extraArgsHint')</div></div>
    <hr class="sep">
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.useMockKeychain" ${lc.useMockKeychain !== false ? 'checked' : ''}><span class="track"></span><span class="lb">${'editor.useMockKeychain'}</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.hideDebugInfobar" ${lc.hideDebugInfobar !== false ? 'checked' : ''}><span class="track"></span><span class="lb">editor.hideDebugInfobar</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.incognito" ${lc.incognito ? 'checked' : ''}><span class="track"></span><span class="lb">editor.incognito</span></label>
    <label class="switch"><input type="checkbox" class="ck" data-bind="launch.keepRunningAfterQuit" ${lc.keepRunningAfterQuit !== false ? 'checked' : ''}><span class="track"></span><span class="lb">editor.keepRunningAfterQuit</span></label>
  </div>`;
}

/* ---------------- 自动化 ---------------- */
function tabAuto(p) {
  const a = p.automation || {};
  const cks = a.cookies || [];
  return `<div class="stack">
    <div class="field"><label>${'editor.autoScriptLabel'}</label>
      <textarea rows="5" id="autoScripts" placeholder="$" + i18n.t('editor.autoScriptPlaceholder')}">${esc((a.scripts || []).join('\n---\n'))}</textarea>
      <div class="hint">${'editor.autoScriptHint'}</div></div>
    <hr class="sep">
    <div class="row">
      <b style="font-size:13px">${'editor.cookieSection'}</b>
      <span class="badge">i18n.t('editor.cookiesCount')</span>
      <div class="grow"></div>
      <button class="btn btn-sm" data-ed="ckImport">${i18n.t('button.import')}</button>
      <button class="btn btn-sm" data-ed="ckExportJson">${'editor.cookieExportJson'}</button>
      <button class="btn btn-sm" data-ed="ckExportTxt">${'editor.cookieExportNetscape'}</button>
      <button class="btn btn-sm" data-ed="ckLive">${'editor.cookieLive'}</button>
      <button class="btn btn-sm btn-bad" data-ed="ckClear">${'button.cookieClear'}</button>
    </div>
    <div class="hint">${'editor.cookieHint'}</div>
    <div id="ckList">${cks.length ? `<div class="tbl-wrap" style="max-height:280px;overflow:auto"><table class="tbl">
      <thead><tr><th style="width:22%">${i18n.t('profile.name')}</th><th>${'editor.paramValue'}</th><th style="width:22%">${i18n.t('editor.cookieDomains')}</th><th style="width:14%">${i18n.t('editor.cookiePaths')}</th><th style="width:15%">${i18n.t('editor.cookieExpires')}</th></tr></thead>
      <tbody>${cks.slice(0, 400).map(c => `<tr>
        <td class="mono-s">${esc(c.name)}</td>
        <td class="mono-s ellipsis" title="${esc(c.value)}">${esc((c.value || '').slice(0, 60))}${(c.value || '').length > 60 ? '…' : ''}</td>
        <td class="mono-s">${esc(c.domain)}</td><td class="mono-s">${esc(c.path || '/')}</td>
        <td class="mono-s">${c.expires > 0 ? fmtTime(c.expires * 1000) : i18n.t('editor.cookieSession')}</td></tr>`).join('')}
      </tbody></table></div>${cks.length > 400 ? `<div class="hint">${i18n.t('editor.cookieFirst400', {n: cks.length})}</div>` : ''}`
      : `<div class="empty" style="padding:26px"><p style="max-width:none">${i18n.t('editor.cookieNoImport')}</p></div>`}</div>
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
  return `<select id="citySel" style="width:100%"><option value="">${'editor.citySelPlaceholder'}</option>${groups}</select>`;
}

function tabFingerprint(p) {
  const fp = p.fp, md = fp.uaMetadata || {};
  const warn = fpConsistency(p);
  return `<div class="stack">
    <div class="row wrap" style="gap:7px">
      <div class="seg">
        ${[['random', i18n.t('editor.fpModeRandom')], ['custom', i18n.t('editor.fpModeCustom')], ['real', i18n.t('editor.fpModeReal')]].map(([v, t]) =>
          `<button data-ed="mode:${v}" class="${fp.mode === v ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <div class="grow"></div>
      <button class="btn btn-sm" data-ed="reseed">${'editor.reseedFp'}</button>
      <button class="btn btn-sm" data-ed="useReal">${'editor.useRealFp'}</button>
      <button class="btn btn-sm" data-ed="loadTpl">${'editor.loadTplBtn'}</button>
    </div>

    <div class="fp-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div><div class="lbl" style="margin-bottom:3px">${'editor.fpSeedLabel'}</div>
        <div class="row"><input class="mono-s" data-bind="fp.seed" value="${esc(fp.seed)}" style="flex:1;font-family:var(--fm);font-size:10.5px">
        <button class="btn btn-sm" data-ed="reseed" title="${i18n.t('editor.fontRegenerate')}">↻</button></div></div>
      <div><div class="lbl" style="margin-bottom:3px">${'dialog.targetPlatform'}</div>
        <select data-bind="fp.platform">${['windows', 'mac', 'linux', 'android'].map(x =>
          `<option value="${x}" ${fp.platform === x ? 'selected' : ''}>${osName(x)}</option>`).join('')}</select></div>
      <div><div class="lbl" style="margin-bottom:3px">${'editor.fpModeDesc'}</div>
        <div class="mono-s" style="padding-top:6px">${{ random: i18n.t('editor.fpModeDescRandom'), custom: i18n.t('editor.fpModeDescCustom'), real: i18n.t('editor.fpModeDescReal') }[fp.mode] || fp.mode}</div></div>
    </div>

    ${warn.length ? `<div class="notice warn"><div><b>editor.fpConsistencyWarn</b><br>${warn.map(w => '· ' + w).join('<br>')}</div></div>` :
      `<div class="notice ok">${'editor.fpConsistencyOk'}</div>`}

    ${sec('base', '🌍', i18n.t('editor.fpSection1'), `${esc(fp.timezone)} · ${esc((fp.languages || []).join(', '))}`, `
      <div class="field"><label>${'editor.cityLabel'}</label>${citySelectHTML(fp)}</div>
      <div class="grid3">
        ${txt('fp.timezone', i18n.t('editor.timezoneLabel'), fp.timezone, i18n.t('editor.timezonePh'))}
        ${txt('fp.locale', i18n.t('editor.localeLabel'), fp.locale, i18n.t('editor.localePh'))}
        ${txt('fp.acceptLanguage', i18n.t('editor.acceptLangLabel'), fp.acceptLanguage, i18n.t('editor.acceptLangPh'))}
      </div>
      <div class="grid2">
        ${txt('fp.languages', i18n.t('editor.languagesLabel'), (fp.languages || []).join(', '), i18n.t('editor.languagesPh'))}
        <div class="field"><label>${'editor.geoLabel'}</label>
          <div class="row">${sw('fp.geo.enabled', fp.geo && fp.geo.enabled, i18n.t('editor.geoOverride'), '')}
          <input type="number" step="0.0001" data-bind="fp.geo.latitude" value="${fp.geo ? fp.geo.latitude : 0}" style="flex:1" placeholder="$" + i18n.t('editor.geoLat')}">
          <input type="number" step="0.0001" data-bind="fp.geo.longitude" value="${fp.geo ? fp.geo.longitude : 0}" style="flex:1" placeholder="$" + i18n.t('editor.geoLng')}"></div></div>
      </div>
      <hr class="sep">
      ${txt('fp.userAgent', i18n.t('fingerprint.ua'), fp.userAgent, '')}
      <details style="margin-top:2px"><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">${'editor.clientHintsTitle'}</summary>
        <div class="stack" style="margin-top:9px">
          <div class="grid3">
            ${txt('fp.uaMetadata.platform', i18n.t('editor.clientHintPlatform'), md.platform, i18n.t('platform.windows'))}
            ${txt('fp.uaMetadata.platformVersion', i18n.t('editor.clientHintPlatformVersion'), md.platformVersion, '15.0.0')}
            ${txt('fp.uaMetadata.fullVersion', i18n.t('editor.clientHintFullVersion'), md.fullVersion, i18n.t('editor.clientHintFullVersionPh'))}
          </div>
          <div class="grid4">
            ${txt('fp.uaMetadata.architecture', i18n.t('editor.clientHintArchitecture'), md.architecture, i18n.t('editor.clientHintArchitecturePh'))}
            ${txt('fp.uaMetadata.bitness', i18n.t('editor.clientHintBitness'), md.bitness, i18n.t('editor.clientHintBitnessPh'))}
            ${txt('fp.uaMetadata.model', i18n.t('editor.clientHintModel'), md.model, '')}
            ${sel('fp.uaMetadata.mobile', i18n.t('editor.clientHintMobile'), [{ v: 'false', t: 'false' }, { v: 'true', t: 'true' }], String(!!md.mobile))}
          </div>
          ${txt('fp.uaMetadata.brandsText', i18n.t('editor.brandsJson'), JSON.stringify(md.brands || []))}
          <div class="hint"editor.brandsJsonHint</div>
          <div class="row"><button class="btn btn-sm" data-ed="genUA">${'editor.genUaBtn'}</button></div>
        </div>
      </details>
    `, true)}

    ${sec('screen', '🖥️', i18n.t('editor.fpSection2'), `${fp.screenWidth}×${fp.screenHeight} · DPR ${fp.devicePixelRatio}`, `
      <div class="grid4">
        ${num('fp.screenWidth', i18n.t('editor.screenWidth'), fp.screenWidth)}
        ${num('fp.screenHeight', i18n.t('editor.screenHeight'), fp.screenHeight)}
        ${num('fp.colorDepth', i18n.t('editor.colorDepth'), fp.colorDepth)}
        ${num('fp.pixelDepth', i18n.t('editor.pixelDepth'), fp.pixelDepth)}
      </div>
      <div class="grid4">
        ${num('fp.devicePixelRatio', i18n.t('editor.dpr'), fp.devicePixelRatio, 'step="0.25" min="0.5" max="4"')}
        ${num('fp.availTopOffset', i18n.t('editor.availTopOffset'), fp.availTopOffset)}
        ${num('fp.windowWidth', i18n.t('editor.windowWidth'), fp.windowWidth)}
        ${num('fp.windowHeight', i18n.t('editor.windowHeight'), fp.windowHeight)}
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="resPreset">${'editor.resPresetsBtn'}</button>
        ${sw('fp.forceViewport', fp.forceViewport, i18n.t('editor.forceViewport'), i18n.t('editor.forceViewportHint'))}
      </div>
      <div class="hint">${'editor.screenHint'}</div>
    `)}

    ${sec('hw', '⚙️', i18n.t('editor.fpSection3'), `${fp.hardwareConcurrency} ${i18n.t('editor.cpuCores')} · ${fp.deviceMemory} GB`, `
      <div class="grid4">
        ${num('fp.hardwareConcurrency', i18n.t('editor.cpuCores'), fp.hardwareConcurrency, 'min="1" max="128"')}
        ${num('fp.deviceMemory', i18n.t('editor.deviceMemory'), fp.deviceMemory, 'min="0.25" step="0.25"')}
        ${num('fp.maxTouchPoints', i18n.t('editor.maxTouchPoints'), fp.maxTouchPoints, 'min="0" max="10"')}
        ${txt('fp.navPlatform', i18n.t('editor.navPlatform'), fp.navPlatform, i18n.t('editor.navPlatformPh'))}
      </div>
      <div class="grid2">
        ${txt('fp.navVendor', i18n.t('editor.navVendor'), fp.navVendor, i18n.t('editor.navVendorPh'))}
        ${sel('fp.effectiveType', i18n.t('editor.effectiveType'), ['4g', '3g', '2g', 'slow-2g'].map(v => ({ v, t: v })), fp.effectiveType)}
      </div>
      ${sw('fp.batterySpoof', fp.batterySpoof, i18n.t('editor.batterySpoof'), `${i18n.t('editor.batteryLevel', {n: (Math.round((fp.batteryLevel || 0.8) * 100))})}`)}
      <input type="range" data-bind="fp.batteryLevel" min="0.05" max="1" step="0.01" value="${fp.batteryLevel || 0.8}" style="width:100%">
      ${sw('fp.connectionSpoof', fp.connectionSpoof, i18n.t('editor.connectionSpoof'), '')}
      <div class="hint">${'editor.deviceMemoryHint'}</div>
    `)}

    ${sec('gl', '🎨', i18n.t('editor.fpSection4'), `${fp.canvasNoise ? i18n.t('editor.canvasSummary', {level: (+fp.canvasNoiseLevel).toFixed(3)}) : i18n.t('editor.canvasOff')} · ${esc((fp.webglRenderer || '').slice(0, 46))}`, `
      ${sw('fp.canvasNoise', fp.canvasNoise, i18n.t('editor.canvasNoise'), i18n.t('editor.canvasNoiseHint'))}
      ${rng('fp.canvasNoiseLevel', i18n.t('editor.canvasNoiseLevel'), fp.canvasNoiseLevel || 0.02, 0.002, 0.12, 0.002, 'canvasLevel', v => (+v).toFixed(3))}
      <div class="hint">${'editor.canvasNoiseDetail'}</div>
      <hr class="sep">
      ${sw('fp.webglSpoof', fp.webglSpoof, i18n.t('editor.webglSpoof'), '')}
      <div class="grid2">
        ${txt('fp.webglVendor', i18n.t('editor.webglVendorLabel'), fp.webglVendor, i18n.t('editor.webglVendorPh'))}
        ${txt('fp.webglRenderer', i18n.t('editor.webglRendererLabel'), fp.webglRenderer, '')}
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="gpuPreset">${'editor.gpuPresetsBtn'}</button>
        ${sw('fp.webglNoise', fp.webglNoise, i18n.t('editor.webglNoise'), '')}
        ${sw('fp.webgl2', fp.webgl2, i18n.t('editor.webgl2'), '')}
        ${sel('fp.webgpu', i18n.t('editor.webgpuLabel'), [{ v: 'auto', t: i18n.t('editor.webgpuAuto') }, { v: 'hide', t: i18n.t('editor.webgpuHide') }], fp.webgpu)}
      </div>
      ${txt('fp.webglVersion', i18n.t('editor.webglVersionLabel'), fp.webglVersion, i18n.t('editor.webglVersionPh'))}
      <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">${'editor.webglParamsTitle'}</summary>
        <div id="glParams" style="margin-top:9px">${glParamsHTML(fp.webglParams || {})}</div>
        <button class="btn btn-sm" data-ed="glParamAdd">${'editor.addParam'}</button></details>
      <div class="hint">${'editor.gpuHint'}</div>
    `)}

    ${sec('audio', '🔊', i18n.t('editor.fpSection5'), fp.audioNoise ? i18n.t('editor.audioSummaryOn') + (fp.audioNoiseLevel || 0).toExponential(1) : i18n.t('editor.audioSummaryOff'), `
      ${sw('fp.audioNoise', fp.audioNoise, i18n.t('editor.audioNoise'), i18n.t('editor.audioNoiseHint'))}
      ${rng('fp.audioNoiseLevel', i18n.t('editor.audioNoiseLevel'), fp.audioNoiseLevel || 0.0001, 0.00001, 0.0005, 0.00001, 'audioLevel', v => (+v).toExponential(1))}
      <div class="hint">${'editor.audioLevelHint'}</div>
    `)}

    ${sec('net', '🛰️', i18n.t('editor.fpSection6'), fp.webrtcMode, `
      ${sel('fp.webrtcMode', i18n.t('editor.webrtcStrategy'), [
        { v: 'disabled', t: i18n.t('editor.webrtcDisabled') },
        { v: 'proxy', t: i18n.t('editor.webrtcProxy') },
        { v: 'custom', t: i18n.t('editor.webrtcCustom') },
        { v: 'real', t: i18n.t('editor.webrtcReal') }], fp.webrtcMode)}
      <div class="grid2">
        ${txt('fp.webrtcPublicIp', i18n.t('editor.webrtcPublicIp'), fp.webrtcPublicIp, i18n.t('editor.webrtcPublicIpPh'))}
        ${txt('fp.webrtcLocalIps', i18n.t('editor.webrtcLocalIps'), (fp.webrtcLocalIps || []).join(', '), i18n.t('editor.webrtcLocalIpsPh'))}
      </div>
      <div class="hint">${'editor.webrtcHint'}</div>
      <hr class="sep">
      ${sw('fp.doNotTrack', fp.doNotTrack, i18n.t('editor.doNotTrack'), i18n.t('editor.doNotTrackHint'))}
      ${sw('fp.permissionsSpoof', fp.permissionsSpoof, i18n.t('editor.permissionsSpoof'), i18n.t('editor.permissionsSpoofHint'))}
      ${sw('fp.speechVoicesSpoof', fp.speechVoicesSpoof, i18n.t('editor.speechVoicesSpoof'), i18n.t('editor.speechVoicesSpoofHint'))}
      ${sw('fp.hideWebdriver', fp.hideWebdriver !== false, i18n.t('editor.hideWebdriver'), i18n.t('editor.hideWebdriverHint'))}
    `)}

    ${sec('fonts', '🔤', i18n.t('editor.fpSection7'), `${fp.fontsMode === 'system' ? i18n.t('editor.fontsSystemUsed') : i18n.t('editor.fontsSpoofed', {n: (fp.fonts || []).length})}`, `
      ${sel('fp.fontsMode', i18n.t('editor.fontsMode'), [
        { v: 'system', t: i18n.t('editor.fontsSystem') },
        { v: 'preset', t: i18n.t('editor.fontsPreset') },
        { v: 'strict', t: i18n.t('editor.fontsStrict') }], fp.fontsMode)}
      <div class="field"><label>${'editor.fontsLabel'}</label>
        <textarea data-bind="fp.fonts" rows="5">${esc((fp.fonts || []).join(', '))}</textarea>
        <div class="hint">${'editor.fontsHint'}</div></div>
      <div class="row wrap">
        <button class="btn btn-sm" data-ed="fontWin">${'editor.fontWin'}</button>
        <button class="btn btn-sm" data-ed="fontMac">${'editor.fontMac'}</button>
        <button class="btn btn-sm" data-ed="fontLinux">${i18n.t('editor.fontLinux')}</button>
        <button class="btn btn-sm" data-ed="fontReal">${i18n.t('editor.fontReal')}</button>
      </div>
      ${fp.fontsMode === 'strict' ? `<div class="notice warn">${i18n.t('editor.strictNote')}</div>` : ''}
    `)}

    ${sec('misc', '🧩', i18n.t('editor.fpSection8'), i18n.t('editor.deviceCount', {n: fp.audioInputs + fp.audioOutputs + fp.videoInputs}), `
      <div class="grid4">
        ${sw('fp.mediaDevicesSpoof', fp.mediaDevicesSpoof, i18n.t('editor.mediaDevicesSpoof'), '')}
        ${num('fp.audioInputs', i18n.t('editor.audioInputs'), fp.audioInputs, 'min="0" max="5"')}
        ${num('fp.audioOutputs', i18n.t('editor.audioOutputs'), fp.audioOutputs, 'min="0" max="6"')}
        ${num('fp.videoInputs', i18n.t('editor.videoInputs'), fp.videoInputs, 'min="0" max="4"')}
      </div>
      <hr class="sep">
      ${sw('fp.pdfViewer', fp.pdfViewer, 'editor.pdfViewerSpoof', '')}
      ${num('fp.pluginsCount', 'navigator.plugins.length', fp.pluginsCount, 'min="0" max="5"')}
      <div class="hint">editor.storageNote</div>
    `)}
  </div>`;
}

function glParamsHTML(params) {
  const keys = Object.keys(params);
  if (!keys.length) return `<div class="hint" style="margin-bottom:8px">editor.glParamsEmpty</div>`;
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
  if (uaPlat !== '?' && uaPlat !== fp.platform) w.push(i18n.t('editor.fpUaMismatch', {n: osName(uaPlat), a: osName(fp.platform)}));
  if (md.platform && md.platform.toLowerCase().indexOf(fp.platform === 'mac' ? 'mac' : fp.platform) !== 0)
    w.push(i18n.t('editor.fpChPlatMismatch', {n: esc(md.platform), a: osName(fp.platform)}));
  const navPlat = { windows: i18n.t('editor.navPlatformPh'), mac: 'MacIntel', linux: 'Linux x86_64', android: 'Linux armv8l' }[fp.platform];
  if (navPlat && fp.navPlatform !== navPlat) w.push(i18n.t('editor.fpNavPlatMismatch', {navPlat: navPlat, a: esc(fp.navPlatform)}));
  const r = fp.webglRenderer || '';
  if (fp.platform === 'windows' && !/Direct3D|D3D11/.test(r) && r) w.push(i18n.t('editor.fpWinWebgl'));
  if (fp.platform === 'mac' && !/Metal/.test(r) && r) w.push(i18n.t('editor.fpMacWebgl'));
  if (fp.platform === 'linux' && !/OpenGL/.test(r) && r) w.push(i18n.t('editor.fpLinuxWebgl'));
  const uaMajor = parseInt(((fp.userAgent || '').match(/Chrome\/(\d+)/) || [])[1] || '0', 10);
  const chMajor = parseInt((md.fullVersion || '').split('.')[0] || '0', 10);
  if (uaMajor && chMajor && uaMajor !== chMajor) w.push(i18n.t('editor.fpUaChMismatch', {uaMajor: uaMajor, chMajor: chMajor}));
  const installed = (S.host && S.host.chromeMajor) || 0;
  if (uaMajor && installed && Math.abs(uaMajor - installed) > 3) w.push(i18n.t('editor.fpChromeMismatch', {uaMajor: uaMajor, installed: installed, installed: installed}));
  const langs = fp.languages || [];
  if (langs.length && (fp.acceptLanguage || '').indexOf(langs[0]) !== 0) w.push(i18n.t('editor.fpAcceptLangMismatch', {n: esc(langs[0])}));
  if (fp.deviceMemory && [0.25, 0.5, 1, 2, 4, 8, 16, 32].indexOf(fp.deviceMemory) < 0) w.push(i18n.t('editor.fpDeviceMemoryMismatch', {n: fp.deviceMemory}));
  if (fp.windowWidth > fp.screenWidth || fp.windowHeight > fp.screenHeight - (fp.availTopOffset || 0))
    w.push(i18n.t('editor.fpWindowSizeMismatch'));
  if (fp.maxTouchPoints > 0 && fp.platform === 'windows') w.push(i18n.t('editor.fpMaxTouchOnWin'));
  const tzCity = (S.geoCities || []).find(c => c.timezone === fp.timezone);
  if (tzCity && langs.length && !langs.some(l => l.toLowerCase().startsWith(tzCity.locale.split('-')[0].toLowerCase())))
    w.push(i18n.t('editor.fpTzLangMismatch', {n: esc(tzCity.city), a: esc(langs.join(',')), b: esc(tzCity.locale)}));
  if (fp.doNotTrack) w.push(i18n.t('editor.fpDoNotTrackWarn'));
  if (p.proxy && p.proxy.host && (!p.proxy.port || p.proxy.port <= 0)) w.push(i18n.t('editor.fpProxyNoPort'));
  if (p.proxy && p.proxy.checkResult && p.proxy.checkResult.ok && p.proxy.checkResult.timezone && p.proxy.checkResult.timezone !== fp.timezone)
    w.push(i18n.t('editor.fpProxyTzMismatch', {n: esc(p.proxy.checkResult.timezone), a: esc(fp.timezone)}));
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
    toast('ok', i18n.t('toast.cityMatched', {n: c.city}), `${c.timezone} · ${c.languages.join(', ')}`);
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
      p.fp = fp; toast('ok', i18n.t('toast.realFpLoaded'), i18n.t('toast.realFpLoadedDesc'));
    }
    renderEditorTab(); return;
  }
  if (kind === 'reseed') {
    const platform = p.fp.platform, keepCustom = p.fp.mode === 'custom';
    const fp = await Bridge.call('randomFingerprint', { platform, seed: undefined });
    p.fp = fp; if (keepCustom) p.fp.mode = 'custom';
    E.dirty = true; renderEditorTab();
    toast('ok', i18n.t('toast.fpRegenerated'), `${fp.timezone} · ${fp.screenWidth}×${fp.screenHeight}`);
    return;
  }
  if (kind === 'useReal') {
    const fp = await Bridge.call('realFingerprint', {});
    if (!fp.userAgent) { toast('err', i18n.t('toast.realFpNotReady'), i18n.t('toast.realFpProbeHint')); return; }
    p.fp = fp; E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.realFpLoaded')); return;
  }
  if (kind === 'loadTpl') {
    const r = await Bridge.call('templates', {});
    const list = r.list || [];
    if (!list.length) { toast('warn', i18n.t('toast.noTemplates'), i18n.t('toast.noTemplatesHint')); return; }
    const v = await promptDlg({ title: i18n.t('dialog.loadTemplateTitle'), fields: [{ key: 'id', label: i18n.t('dialog.selectTemplate'), type: 'select', options: list.map(t => ({ v: t.id, t: `${t.name}（${osName(t.fp.platform)} · ${t.fp.timezone}）` })) }] });
    if (!v) return;
    const t = list.find(x => x.id === v.id);
    if (t) { const seed = p.fp.seed; p.fp = JSON.parse(JSON.stringify(t.fp)); p.fp.seed = seed; E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.templateLoaded'), t.name); }
    return;
  }
  if (kind === 'saveTpl') {
    const v = await promptDlg({ title: i18n.t('dialog.saveTemplateTitle'), message: i18n.t('dialog.templateOnlyFp'), fields: [{ key: 'name', label: i18n.t('dialog.templateName'), value: `${osName(p.fp.platform)} · ${p.fp.timezone}` }] });
    if (!v || !v.name) return;
    await Bridge.call('saveTemplate', { template: { id: '', name: v.name, fp: p.fp, createdAt: Date.now() } });
    S.templates = (await Bridge.call('templates', {})).list || [];
    updateChrome(); toast('ok', i18n.t('toast.templateSaved'), v.name); return;
  }
  if (kind === 'genUA') {
    const v = await promptDlg({ title: i18n.t('dialog.rebuildUaTitle'), message: i18n.t('dialog.localChromeMajor', {n: (S.host && S.host.chromeMajor) || i18n.t('settings.notDetectedShort')}), fields: [{ key: 'major', label: i18n.t('dialog.chromeMajor'), type: 'number', value: (S.host && S.host.chromeMajor) || 152 }] });
    if (!v) return;
    const fp = await Bridge.call('randomFingerprint', { platform: p.fp.platform });
    const major = parseInt(v.major) || fp.userAgent.match(/Chrome\/(\d+)/)[1];
    // 用目标版本重写，保留 GREASE 品牌（来自本机探针，仅在同大版本时准确）
    p.fp.userAgent = fp.userAgent.replace(/Chrome\/\d+/, 'Chrome/' + major);
    p.fp.uaMetadata = fp.uaMetadata;
    if (String(major) !== String((S.host || {}).chromeMajor))
      toast('warn', i18n.t('toast.greaseMismatch'), i18n.t('toast.greaseMismatchHint', {local: (S.host || {}).chromeMajor, target: major}), 8000);
    E.dirty = true; renderEditorTab(); return;
  }
  if (kind === 'resPreset') {
    const presets = p.fp.platform === 'mac'
      ? [[1512, 982, 2], [1728, 1117, 2], [2560, 1440, 2], [1920, 1080, 1], [3024, 1964, 2], [2880, 1800, 2], [1440, 900, 2]]
      : [[1920, 1080, 1], [2560, 1440, 1], [1366, 768, 1], [1536, 864, 1.25], [1600, 900, 1], [1440, 900, 1], [3840, 2160, 1.5], [1280, 720, 1]];
    const v = await promptDlg({ title: i18n.t('dialog.resolutionPresets'), fields: [{ key: 'r', label: i18n.t('button.select'), type: 'select', options: presets.map(x => ({ v: x.join(','), t: `${x[0]}×${x[1]} @${x[2]}x` })) }] });
    if (!v) return;
    const [w, hh, dpr] = v.r.split(',').map(Number);
    p.fp.screenWidth = w; p.fp.screenHeight = hh; p.fp.devicePixelRatio = dpr;
    p.fp.windowWidth = Math.min(w - 40, 1440); p.fp.windowHeight = Math.min(hh - 140, 860);
    E.dirty = true; renderEditorTab(); return;
  }
  if (kind === 'gpuPreset') {
    const g = (S.gpuLists || {})[p.fp.platform] || (S.gpuLists || {}).windows || [];
    if (!g.length) return;
    const v = await promptDlg({ title: i18n.t('dialog.gpuPresets'), fields: [{ key: 'i', label: i18n.t('dialog.gpuPresetMatched'), type: 'select', options: g.map((x, i) => ({ v: i, t: x.renderer })) }] });
    if (!v) return;
    const it = g[+v.i]; p.fp.webglVendor = it.vendor; p.fp.webglRenderer = it.renderer;
    E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.gpuPresetApplied')); return;
  }
  if (kind.startsWith('font')) {
    let list = [];
    if (kind === 'fontWin') list = S.fontLists.windows;
    else if (kind === 'fontMac') list = S.fontLists.mac;
    else if (kind === 'fontLinux') list = S.fontLists.linux;
    else if (kind === 'fontReal') list = (S.host && S.host.fonts) || [];
    if (!list.length) { toast('warn', i18n.t('toast.fontsListEmpty'), kind === 'fontReal' ? i18n.t('toast.fontsNotProbed') : ''); return; }
    p.fp.fonts = list.slice(); E.dirty = true; renderEditorTab();
    toast('ok', i18n.t('toast.fontsLoaded', {n: list.length})); return;
  }
  if (kind === 'glParamAdd') {
    const v = await promptDlg({ title: i18n.t('editor.addWebglParam'), message: i18n.t('editor.webglKeysHint'), fields: [{ key: 'k', label: i18n.t('editor.paramName'), value: 'MAX_TEXTURE_SIZE' }, { key: 'v', label: i18n.t('editor.paramValue'), value: '16384' }] });
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
    E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.parsed'), proxySummary(p.proxy)); return;
  }
  if (kind === 'checkProxy') {
    const spin = qs('[data-role=pxSpin]', api.box);
    if (spin) spin.classList.remove('hidden');
    if (el) el.disabled = true;
    try {
      const r = await Bridge.call('checkProxy', { proxy: p.proxy, profileId: p.id });
      p.proxy.checkResult = r;
      E.dirty = true; renderEditorTab();
      if (r.ok) toast('ok', i18n.t('toast.proxyOk'), `${r.ip} · ${r.country} ${r.city} · ${r.latencyMs}ms`);
      else toast('err', i18n.t('toast.proxyFailed'), r.error || '', 8000);
    } catch (e) { toast('err', i18n.t('toast.checkFailed'), String(e.message || e), 8000); }
    return;
  }
  if (kind === 'syncTz') {
    const r = p.proxy && p.proxy.checkResult;
    if (!r || !r.ok || !r.timezone) { toast('warn', i18n.t('toast.checkProxyFirst'), i18n.t('toast.needExitTz')); return; }
    const c = (S.geoCities || []).find(x => x.timezone === r.timezone);
    p.fp.timezone = r.timezone;
    if (c) { p.fp.locale = c.locale; p.fp.languages = c.languages.slice(); p.fp.acceptLanguage = acceptLang(c.languages); p.fp.geo = { enabled: true, latitude: c.lat, longitude: c.lon }; }
    E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.synced'), `${r.timezone}${c ? ' · ' + c.locale : ''}`); return;
  }
  // 启动
  if (kind === 'pickBrowser') {
    const r = await Bridge.call('pickBrowser', {});
    if (r.path) { p.launch.browserPath = r.path; E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.selected'), r.version || r.path); }
    return;
  }
  if (kind === 'refreshBrowsers') {
    S.env = await Bridge.call('env', {}); renderEditorTab(); toast('ok', i18n.t('toast.refreshBrowsers'), (S.env.browsers || []).length + i18n.t('editor.fontsCountUnit')); return;
  }
  // Cookie
  if (kind === 'ckImport') {
    const v = await promptDlg({
      title: i18n.t('dialog.importCookieTitle'), message: i18n.t('dialog.importCookieMsg'),
      fields: [{ key: 'text', label: i18n.t('dialog.cookieContent'), type: 'textarea', rows: 9, placeholder: '[{"name":"sid","value":"...","domain":".example.com","path":"/"}]' },
               { key: 'domain', label: i18n.t('dialog.cookieDefaultDomain'), placeholder: '.example.com' }],
      okText: i18n.t('button.import')
    });
    if (!v || !v.text) return;
    const r = await Bridge.call('cookieImport', { id: p.id, text: v.text, defaultDomain: v.domain });
    const full = await Bridge.call('getProfile', { id: p.id });
    p.automation = full.automation; E.dirty = false; renderEditorTab();
    toast('ok', i18n.t('toast.cookieImported', {n: r.imported})); return;
  }
  if (kind === 'ckExportJson' || kind === 'ckExportTxt') {
    const r = await Bridge.call('cookieExport', { id: p.id, format: kind === 'ckExportJson' ? 'json' : 'netscape' });
    if (!r.count) { toast('warn', i18n.t('toast.cookieExportNone')); return; }
    if (Bridge.native) { const s = await Bridge.call('saveFile', { filename: r.filename, content: r.text }); if (s.ok) toast('ok', i18n.t('toast.exported'), s.path); }
    else { copy(r.text, r.count + i18n.t('toast.cookieLiveCopied')); }
    return;
  }
  if (kind === 'ckLive') {
    const r = await Bridge.call('cookieLive', { id: p.id });
    if (!r.list || !r.list.length) { toast('warn', i18n.t('toast.cookieLiveNone'), r.msg || i18n.t('toast.cookieLiveNoneHint')); return; }
    const ok = await confirmDlg({ title: i18n.t('dialog.cookieLiveTitle', {n: r.count}), tone: 'info', message: i18n.t('dialog.cookieLiveMsg'), okText: i18n.t('dialog.cookieLiveOverwrite') });
    if (!ok) return;
    const text = JSON.stringify(r.list.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path, secure: !!c.secure,
      httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified', expirationDate: c.expires > 0 ? c.expires : undefined
    })), null, 1);
    await Bridge.call('cookieImport', { id: p.id, text });
    const full = await Bridge.call('getProfile', { id: p.id });
    p.automation = full.automation; renderEditorTab(); toast('ok', i18n.t('toast.cookieLiveSaved', {n: r.count})); return;
  }
  if (kind === 'ckClear') {
    const ok = await confirmDlg({ title: i18n.t('dialog.cookieClearTitle'), tone: 'warn', message: i18n.t('dialog.cookieClearMsg'), okText: i18n.t('button.cookieClear'), okClass: 'btn-bad' });
    if (!ok) return;
    p.automation = p.automation || {}; p.automation.cookies = []; E.dirty = true; renderEditorTab(); toast('ok', i18n.t('toast.clearedCookies')); return;
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
  if (!p.name || !p.name.trim()) { toast('warn', i18n.t('dialog.namingPrompt')); E.tab = 'basic'; renderEditorTab(); return; }
  const warn = fpConsistency(p);
  if (warn.length) {
    const go = await confirmDlg({ title: i18n.t('toast.fpConsistencyWarn'), tone: 'warn', message: i18n.t('dialog.fpConsistencyMessage', {n: warn.length, a: warn.map(w => '· ' + w).join('<br>')}), okText: i18n.t('toast.fpSaveAnyway') });
    if (!go) return;
  }
  try {
    const saved = await Bridge.call('saveProfile', { profile: p });
    E.dirty = false; api.close();
    toast('ok', i18n.t('toast.profileSaved', {n: saved.seq, a: saved.name}));
    await loadProfiles(true);
  } catch (e) { toast('err', i18n.t('toast.saveProfileFailed'), String(e.message || e), 8000); }
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
try{ R.webrtcLocalIp=await new Promise(res=>{ let done=false; const t=setTimeout(()=>{if(!done){done=true;res(i18n.t('probe.webrtcLocalIpBlocked'))}},3500);
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
  if(navigator.userAgentData){ const hi=await navigator.userAgentData.getHighEntropyValues(['fullVersionList',i18n.t('editor.clientHintPlatformVersion'),i18n.t('editor.clientHintArchitecture'),i18n.t('editor.clientHintBitness'),i18n.t('editor.clientHintModel'),'wow64']); R.uaDataHigh=hi; }
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
  { k: 'ua', label: i18n.t('fingerprint.ua'), get: a => a.ua },
  { k: i18n.t('editor.clientHintPlatform'), label: i18n.t('editor.navPlatform'), get: a => a.platform },
  { k: 'languages', label: i18n.t('probe.labelLanguages'), get: a => (a.languages || []).join(', ') },
  { k: 'timezone', label: i18n.t('probe.labelTimezone'), get: a => a.timezone },
  { k: 'tzOffset', label: i18n.t('probe.labelTzOffset'), get: a => a.tzOffset + i18n.t('probe.tzOffsetMin') },
  { k: 'screen', label: i18n.t('probe.labelScreen'), get: a => (a.screen || []).slice(0, 2).join(' × ') },
  { k: 'avail', label: i18n.t('probe.labelAvail'), get: a => (a.screen || []).slice(2, 4).join(' × ') },
  { k: 'dpr', label: i18n.t('editor.dpr'), get: a => a.dpr },
  { k: 'hc', label: 'hardwareConcurrency', get: a => a.hardwareConcurrency },
  { k: 'dm', label: 'deviceMemory', get: a => a.deviceMemory },
  { k: 'mtp', label: i18n.t('editor.maxTouchPoints'), get: a => a.maxTouchPoints },
  { k: 'webgl', label: i18n.t('detect.webglRenderer'), get: a => a.glUnmaskedRenderer },
  { k: 'webglv', label: i18n.t('detect.webglVendor'), get: a => a.glUnmaskedVendor },
  { k: 'canvas', label: i18n.t('probe.labelCanvas'), get: a => (a.canvasHashes || []).join(' / ') },
  { k: 'audio', label: i18n.t('probe.labelAudio'), get: a => (a.audioHashes || []).join(' / ') },
  { k: 'webrtc', label: i18n.t('probe.labelWebrtc'), get: a => a.webrtcLocalIp },
  { k: 'webdriver', label: 'navigator.webdriver', get: a => String(a.webdriver) },
  { k: 'plugins', label: 'plugins.length', get: a => a.plugins },
  { k: 'devices', label: i18n.t('probe.labelDevices'), get: a => a.deviceCounts && typeof a.deviceCounts === 'object' ? `${a.deviceCounts.in}/${a.deviceCounts.out}/${a.deviceCounts.video}` : a.deviceCounts },
  { k: 'battery', label: i18n.t('probe.labelBattery'), get: a => Array.isArray(a.battery) ? i18n.t('probe.batteryFormat', {n: Math.round(a.battery[0] * 100), a: a.battery[1] ? i18n.t('probe.charging') : ''}) : a.battery },
  { k: 'storage', label: i18n.t('probe.labelStorage'), get: a => a.storage && a.storage.quota ? i18n.t('probe.storageGB', {n: (a.storage.quota / 1073741824).toFixed(1)}) : i18n.t('misc.unknown') },
  { k: 'conn', label: i18n.t('probe.labelConn'), get: a => a.connection ? a.connection.t : i18n.t('misc.unknown') },
  { k: 'voices', label: i18n.t('probe.labelVoices'), get: a => a.voices },
  { k: 'cdc', label: i18n.t('probe.labelCdc'), get: a => (a.cdc && a.cdc.length) ? a.cdc.join(', ') : i18n.t('probe.cdcNone') },
  { k: 'native', label: i18n.t('probe.labelNative'), get: a => a.fnToStringNative === true ? i18n.t('misc.yes') : i18n.t('misc.no') },
  { k: 'getterNative', label: i18n.t('probe.labelGetterNative'), get: a => a.getterNative === true ? i18n.t('misc.yes') : (a.getterNative === false ? i18n.t('misc.no') : i18n.t('misc.unknown')) },
];

/* ==========================================================================
   View: Running
   ========================================================================== */
function viewRunning() {
  const list = S.running || [];
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>${'profile.statusRunning'}</h1><p>${i18n.t('running.subtitle')}</p></div>
      <div class="view-tools">
        <button class="btn" id="btnRefreshRun">${i18n.t('button.refresh')}</button>
        <button class="btn btn-bad" id="btnCloseAll" ${list.length ? '' : 'disabled'}>${'running.closeAll'}</button>
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
            <span>CDP</span><b title="${i18n.t('running.copyHint')}">${esc(r.http)}</b>
            <span>WebSocket</span><b class="ellipsis" title="${esc(r.ws)}">${esc((r.ws || '').slice(-34))}</b>
            <span>${'running.injPages'}</span><b>i18n.t('running.injPagesFormat')</b>
            <span>${i18n.t('profile.proxy')}</span><b>${esc(r.proxy || i18n.t('misc.unknown'))}</b>
            ${r.lastError ? `<span>${i18n.t('profile.status')}</span><b style="color:var(--warn)">${esc(r.lastError)}</b>` : ''}
          </div>
          <div class="acts">
            <button class="btn btn-sm" data-r="detect">${'running.fingerprintCheck'}</button>
            <button class="btn btn-sm" data-r="probe">${i18n.t('running.probe')}</button>
            <button class="btn btn-sm" data-r="nav">${'running.openUrl'}</button>
            <button class="btn btn-sm" data-r="copyws">${'running.copyCdp'}</button>
            <button class="btn btn-sm" data-r="edit">${i18n.t('common.edit')}</button>
            <div class="grow"></div>
            <button class="btn btn-sm btn-bad" data-r="close">${'running.closeBtn'}</button>
          </div>
        </div>`; }).join('')}</div>`
      : `<div class="empty"><div class="ic"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 4h11a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg></div>
          <h3>${'toast.noRunningProfiles'}</h3>
          <p>${'running.emptyHint'}</p>
          <button class="btn btn-primary" id="btnGoProfiles">${'running.gotoProfiles'}</button></div>`}
    </div></div>`;
}
function bindRunning(root) {
  qs('#btnRefreshRun', root) && (qs('#btnRefreshRun', root).onclick = () => loadProfiles(true));
  qs('#btnGoProfiles', root) && (qs('#btnGoProfiles', root).onclick = () => go('profiles'));
  const ca = qs('#btnCloseAll', root);
  if (ca) ca.onclick = async () => {
    if (!await confirmDlg({ title: i18n.t('dialog.closeAllTitle'), tone: 'warn', message: i18n.t('dialog.closeAllMessage', {n: S.running.length}), okText: i18n.t('running.closeAll'), okClass: 'btn-bad' })) return;
    await Bridge.call('closeProfiles', { ids: S.running.map(r => r.id) });
    toast('ok', i18n.t('common.allRunningClosed')); await loadProfiles(true);
  };
  on(root, 'click', '[data-r]', async (e, t) => {
    const id = t.closest('.rcard').dataset.id, k = t.dataset.r;
    if (k === 'close') { await doClose([id]); }
    else if (k === 'detect') { await doDetect(id); }
    else if (k === 'probe') { await runProbe(id); }
    else if (k === 'edit') { openEditor(id); }
    else if (k === 'copyws') { const r = S.running.find(x => x.id === id); copy(r.http, r.http); }
    else if (k === 'nav') {
      const v = await promptDlg({ title: i18n.t('dialog.openInProfileTitle'), fields: [{ key: 'url', label: i18n.t('common.url'), placeholder: 'https://example.com' }] });
      if (v && v.url) { const r = await Bridge.call('navigate', { id, url: v.url }); toast(r.ok ? 'ok' : 'err', r.ok ? i18n.t('toast.navigated') : i18n.t('toast.navigateFailed'), r.msg || ''); }
    }
  });
  on(root, 'dblclick', '.rcard .meta b', (e, t) => copy(t.textContent.trim(), t.textContent.trim()));
}

async function runProbe(id) {
  const p = S.profiles.find(x => x.id === id);
  const t = toast('info', i18n.t('toast.probingRun'), i18n.t('toast.needRunningProfile'), 30000);
  try {
    const r = await Bridge.call('evaluate', { id, expression: DETECT_JS });
    t.remove();
    if (!r || !r.ok) { toast('err', i18n.t('toast.probeFailed'), (r && r.msg) || ''); return; }
    showProbeResult(p, JSON.parse(r.result));
  } catch (e) { t.remove(); toast('err', i18n.t('toast.probeFailed'), String(e.message || e), 8000); }
}

function showProbeResult(p, actual) {
  const fp = p && p.veil ? p.veil.fp : (p ? p.fp : null);
  const rows = CHECKS.map(c => {
    let act, exp = '', pass = null;
    try { act = c.get(actual); } catch (e) { act = 'ERR'; }
    if (fp) {
      switch (c.k) {
        case 'ua': exp = fp.userAgent; pass = act === exp; break;
        case i18n.t('editor.clientHintPlatform'): exp = fp.navPlatform; pass = act === exp; break;
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
          exp = fp.webrtcMode === 'disabled' ? i18n.t('probe.webrtcDisabledResult') : (fp.webrtcMode === 'real' ? i18n.t('probe.webrtcReal') : i18n.t('probe.webrtcModified'));
          if (fp.webrtcMode === 'disabled') pass = /${i18n.t('probe.webrtcDisabledResult')}|${i18n.t('misc.timeoutShort')}|ERR/.test(String(act));
          else pass = null;
          break;
        case 'canvas':
          exp = fp.canvasNoise ? i18n.t('probe.expCanvasNoised') : i18n.t('probe.expCanvasReal');
          { const hs = (actual.canvasHashes || []); pass = hs.length === 2 && hs[0] === hs[1]; }
          break;
        case 'audio':
          exp = fp.audioNoise ? i18n.t('probe.expCanvasNoised') : i18n.t('probe.expCanvasReal');
          { const hs = (actual.audioHashes || []); pass = hs.length === 2 && hs[0] === hs[1]; }
          break;
        case 'cdc': pass = !(actual.cdc || []).length; break;
        case 'native': pass = actual.fnToStringNative === true; break;
        case 'getterNative': pass = actual.getterNative === true; break;
        case 'conn': exp = fp.connectionSpoof ? fp.effectiveType : i18n.t('probe.webrtcReal'); pass = fp.connectionSpoof ? act === fp.effectiveType : null; break;
        default: exp = ''; pass = null;
      }
    }
    return `<tr><td>${esc(c.label)}</td>
      <td class="mono-s" style="color:var(--tx)">${esc(String(act === undefined || act === null ? i18n.t('misc.unknown') : act)).slice(0, 180)}</td>
      <td class="mono-s">${exp ? esc(String(exp)).slice(0, 120) : i18n.t('misc.unknown')}</td>
      <td>${pass === null ? '<span class="badge stop">' + i18n.t('probe.ref') + '</span>'
        : pass ? '<span class="badge run"><i></i>' + i18n.t('probe.pass') + '</span>' : '<span class="badge dis"><i></i>' + i18n.t('probe.fail') + '</span>'}</td></tr>`;
  }).join('');
  const fails = CHECKS.filter(c => { const r = qs(`#probeTable tr`); return false; });
  void fails;
  modal({
    title: i18n.t('probe.titleFmt', {title: p ? '#' + p.seq + ' ' + p.name : i18n.t('misc.unnamed')}),
    subtitle: actual.ts ? new Date(actual.ts).toLocaleTimeString() : '', size: 'wide',
    body: `<div class="stack">
      <div class="notice info">${'profile.probeInMain'}</div>
      <div class="tbl-wrap"><table class="tbl" id="probeTable">
        <colgroup><col style="width:190px"><col><col style="width:30%"><col style="width:96px"></colgroup>
        <thead><tr><th>${i18n.t('profile.label')}</th><th>${i18n.t('profile.actual')}</th><th>${i18n.t('profile.expected')}</th><th>${i18n.t('profile.conclusion')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <details class="fp-sec"><summary class="fp-head"><span class="ic">{ }</span><h4>${'profile.rawJson'}</h4><span class="d">${'profile.probeRawJson'}</span></summary>
        <div class="fp-body"><div class="code" style="max-height:320px">${esc(JSON.stringify(actual, null, 1))}</div></div></details>
    </div>`,
    footer: `<div class="grow"></div><button class="btn" data-x>${'profile.copyJson'}</button><button class="btn btn-primary" data-close>${'dialog.completeBtn'}</button>`,
    onMount(api) { qs('[data-x]', api.box).onclick = () => copy(JSON.stringify(actual, null, 1), i18n.t('toast.jsonCopied')); }
  });
}

/* ==========================================================================
   View: Groups
   ========================================================================== */
function viewGroups() {
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>${i18n.t('profile.group')}</h1><p>${i18n.t('group.subtitle')}</p></div>
      <div class="view-tools"><button class="btn btn-primary" id="btnAddGroup">${'group.newGroup'}</button></div>
    </div>
    <div class="view-body"><div class="list" id="groupList">${groupListHTML()}</div></div></div>`;
}
const PALETTE = ['#7c8cff', '#3ddc97', '#ffb547', '#ff5c72', '#4fc3f7', '#ba68c8', '#f06292', '#9ccc65', '#ffd54f', '#90a4ae'];
function groupListHTML() {
  if (!S.groups.length) return `<div class="empty"><h3>${'toast.noGroups'}</h3><p>${'toast.noGroupsHint'}</p></div>`;
  return S.groups.map(g => {
    const n = S.profiles.filter(p => (p.veil ? p.veil.groupId : p.groupId) === g.id).length;
    return `<div class="li" data-id="${esc(g.id)}">
      <span class="swatch" style="background:${esc(g.color)}"></span>
      <div style="flex:1;min-width:0"><div class="nm">${esc(g.name)}</div><div class="sub">${esc(g.remark || i18n.t('group.remarkNone'))}</div></div>
      <span class="badge">i18n.t('profile.nProfiles')</span>
      <button class="btn btn-sm" data-g="edit">${i18n.t('common.edit')}</button>
      <button class="btn btn-sm" data-g="filter">${'button.filterProfile'}</button>
      <button class="btn btn-sm btn-ghost" data-g="del">${'button.deleteAll'}</button></div>`;
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
      if (!await confirmDlg({ title: i18n.t('group.deleteGroup'), tone: 'warn', message: `i18n.t('group.deleteMessageFull')`, okText: i18n.t('button.deleteAll'), okClass: 'btn-bad' })) return;
      await Bridge.call('deleteGroup', { id }); toast('ok', i18n.t('toast.groupDeleted')); await refreshAll();
    }
  });
}
async function groupEditor(g) {
  const isNew = !g;
  const v = await promptDlg({
    title: isNew ? i18n.t('dialog.newGroupTitle') : i18n.t('dialog.editGroupTitle'),
    fields: [
      { key: 'name', label: i18n.t('dialog.groupName'), value: g ? g.name : '' },
      { key: 'remark', label: i18n.t('common.remark'), value: g ? g.remark : '' },
      { key: 'color', label: i18n.t('dialog.color'), type: 'select', options: PALETTE.map(c => ({ v: c, t: c })) },
    ],
    extra: ''
  });
  if (!v) return;
  await Bridge.call('saveGroup', {
    group: { id: g ? g.id : '', name: v.name, remark: v.remark, color: v.color, sortIndex: 0, createdAt: g ? g.createdAt : Date.now() }
  });
  toast('ok', isNew ? i18n.t('toast.groupCreated') : i18n.t('toast.groupSaved'), v.name);
  await refreshAll();
}

/* ==========================================================================
   View: Templates
   ========================================================================== */
function viewTemplates() {
  const list = S.templates || [];
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>${i18n.t('template.title')}</h1><p>${i18n.t('template.subtitle')}</p></div>
      <div class="view-tools"><button class="btn" id="btnTplFromRandom">${'template.fromRandom'}</button></div>
    </div>
    <div class="view-body">
      ${list.length ? `<div class="cards">${list.map(t => `<div class="rcard" data-id="${esc(t.id)}" style="--x:1">
        <div class="top"><span class="badge os-${esc(t.fp.platform)}">${osIcon(t.fp.platform)}&nbsp;${esc(osName(t.fp.platform))}</span>
          <span class="nm">${esc(t.name)}</span></div>
        <div class="meta">
          <span>${i18n.t('template.timezone')}</span><b>${esc(t.fp.timezone)}</b>
          <span>${i18n.t('template.languages')}</span><b>${esc((t.fp.languages || []).join(', '))}</b>
          <span>${'probe.labelScreen'}</span><b>${t.fp.screenWidth}×${t.fp.screenHeight} @${t.fp.devicePixelRatio}x</b>
          <span>${i18n.t('template.gpu')}</span><b class="ellipsis" title="${esc(t.fp.webglRenderer)}">${esc(t.fp.webglRenderer)}</b>
          <span>${'template.cpuMemory'}</span><b>${t.fp.hardwareConcurrency} ${i18n.t('editor.cpuCores')} / ${t.fp.deviceMemory} GB</b>
          <span>${'editor.fpSection7'}</span><b>i18n.t('editor.fontsCount')</b>
        </div>
        <div class="acts"><button class="btn btn-sm" data-t="apply">${i18n.t('button.apply')}</button>
          <button class="btn btn-sm" data-t="view">${i18n.t('button.view')}</button>
          <div class="grow"></div><button class="btn btn-sm btn-ghost" data-t="del">${'button.deleteAll'}</button></div>
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="ic">🧬</div><h3>${i18n.t('toast.noTemplates')}</h3>
         <p>${'template.firstTime'}</p>
         <button class="btn btn-primary" id="btnTplFirst">${'template.fromRandom'}</button></div>`}
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
      if (!await confirmDlg({ title: i18n.t('dialog.templateDeleteTitle'), tone: 'warn', message: i18n.t('dialog.templateDeleteMessage', {n: esc(t.name)}), okText: i18n.t('button.deleteAll'), okClass: 'btn-bad' })) return;
      await Bridge.call('deleteTemplate', { id }); toast('ok', i18n.t('toast.deleted')); await refreshAll();
    } else if (k === 'view') {
      modal({ title: i18n.t('template.label') + t.name, size: 'mid', body: `<div class="code" style="max-height:60vh">${esc(JSON.stringify(t.fp, null, 1))}</div>`,
        footer: `<div class="grow"></div><button class="btn" data-c>${i18n.t('button.copy')}</button><button class="btn btn-primary" data-close>${'running.closeBtn'}</button>`,
        onMount(api) { qs('[data-c]', api.box).onclick = () => copy(JSON.stringify(t.fp, null, 1), i18n.t('toast.copied')); } });
    } else if (k === 'apply') {
      if (!S.profiles.length) { toast('warn', i18n.t('toast.templateApplyNoProfiles')); return; }
      const v = await promptDlg({ title: i18n.t('dialog.applyTemplateTitle'), message: i18n.t('dialog.applyTemplateMessage'),
        fields: [{ key: 'id', label: i18n.t('dialog.profileTarget'), type: 'select', options: S.profiles.map(p => ({ v: p.id, t: `#${p.seq} ${p.name}` })) }] });
      if (!v) return;
      const full = await Bridge.call('getProfile', { id: v.id });
      const seed = full.fp.seed;
      full.fp = JSON.parse(JSON.stringify(t.fp)); full.fp.seed = seed;
      await Bridge.call('saveProfile', { profile: full });
      toast('ok', i18n.t('toast.templateApplied'), `→ ${full.name}`); await loadProfiles(true);
    }
  });
}
async function tplFromRandom() {
  const v = await promptDlg({ title: i18n.t('dialog.createTemplateTitle'), fields: [
    { key: 'name', label: i18n.t('dialog.templateName'), value: i18n.t('dialog.templateDefaultName') },
    { key: i18n.t('editor.clientHintPlatform'), label: i18n.t('dialog.targetPlatform'), type: 'select', options: [{ v: 'windows', t: i18n.t('platform.windows') }, { v: 'mac', t: i18n.t('platform.mac') }, { v: 'linux', t: 'Linux' }] },
    { key: 'country', label: i18n.t('editor.region'), type: 'select', options: [{ v: '', t: i18n.t('common.random') }].concat(countryOptions()) }] });
  if (!v) return;
  const fp = await Bridge.call('randomFingerprint', { platform: v.platform, country: v.country || undefined });
  await Bridge.call('saveTemplate', { template: { id: '', name: v.name, fp, createdAt: Date.now() } });
  toast('ok', i18n.t('toast.templateCreated'), v.name); await refreshAll();
}

/* ==========================================================================
   View: Detect
   ========================================================================== */
function viewDetect() {
  const hostOK = !!(S.host && S.host.probedAt);
  const h = S.host || {};
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>${i18n.t('detect.title')}</h1><p>${i18n.t('detect.subtitle')}</p></div>
      <div class="view-tools">
        <button class="btn" id="btnOpenDetectPage">${'button.openDetectPage'}</button>
        <button class="btn" id="btnProbeHost">${'button.probeHost'}</button>
      </div>
    </div>
    <div class="view-body">
      <div class="fp-sec open"><div class="fp-head"><span class="ic">🖥️</span><h4>${'detect.hostBaseline'}</h4>
        <span class="d">${hostOK ? i18n.t('detect.hostBaselineHidden') : i18n.t('detect.hostNotProbed')}</span></div>
        <div class="fp-body">
          ${hostOK ? `<div class="fp-grid">
            ${kv('Chrome', `i18n.t('host.chromeVersion')`)}
            ${kv(i18n.t('detect.uaChPlatform'), `i18n.t('host.uaChPlatform')`)}
            ${kv(i18n.t('detect.greaseBrand'), `i18n.t('host.greaseBrand')`)}
            ${kv(i18n.t('detect.arch'), `${h.architecture} / bitness ${h.bitness}`)}
            ${kv(i18n.t('fingerprint.ua'), h.ua)}
            ${kv(i18n.t('editor.navPlatform'), h.navPlatform)}
            ${kv(i18n.t('probe.labelScreen'), `i18n.t('host.screenFull')`)}
            ${kv(i18n.t('detect.cpuMemory'), `i18n.t('host.cpuMemory')`)}
            ${kv(i18n.t('detect.tzLang'), `${h.timezone} · ${(h.languages || []).join(', ')}`)}
            ${kv(i18n.t('detect.webglVendor'), h.webglUnmaskedVendor || h.webglVendor)}
            ${kv(i18n.t('detect.webglRenderer'), h.webglUnmaskedRenderer || h.webglRenderer)}
            ${kv(i18n.t('detect.localFonts'), i18n.t('editor.fontsCountUnit', {n: (h.fonts || []).length}))}
            ${kv(i18n.t('detect.probeAt'), fmtTime(h.probedAt))}
            ${kv(i18n.t('detect.chromePath'), h.chromePath)}
          </div>
          <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">detect.fontsListTitle</summary>
            <div class="chips" style="margin-top:8px">${(h.fonts || []).map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div></details>
          <details><summary style="cursor:pointer;color:var(--tx-3);font-size:11.5px;padding:4px 0">${'detect.webglParams'}</summary>
            <div class="fp-grid" style="margin-top:8px">${Object.keys(h.webglParams || {}).map(k => kv(k, h.webglParams[k])).join('') || '<div class="hint">' + i18n.t('probe.cdcNone')}</div>'}</div></details>`
          : `<div class="empty" style="padding:30px"><h3>${i18n.t('toast.hostNotProbedYet')}</h3>
             <p>${i18n.t('detect.hostNotProbed')}<br>
             ${i18n.t('detect.hostProbeDescription')}</p>
             <button class="btn btn-primary" id="btnProbeNow">${i18n.t('toast.probeNow')}</button></div>`}
        </div></div>

      <div class="fp-sec open"><div class="fp-head"><span class="ic">🔍</span><h4>${'detect.windowSelfCheck'}</h4>
        <span class="d">${S.running.length ? i18n.t('detect.runningCount', {n: S.running.length}) : i18n.t('detect.needRunning')}</span></div>
        <div class="fp-body">
          ${S.running.length ? `<div class="row wrap">${S.running.map(r =>
            `<button class="btn" data-probe="${esc(r.id)}">#${esc(r.seq)} ${esc(r.name)}</button>`).join('')}
            <div class="grow"></div>
            <button class="btn btn-primary" data-probe="${esc(S.running[0].id)}">${'detect.runProbeArrow'}</button></div>
            <div class="hint">${'detect.runProbeHint'}</div>`
          : `<div class="notice warn">${'detect.openProfileFirst'}</div>`}
        </div></div>

      <div class="fp-sec"><div class="fp-head"><span class="ic">⚠️</span><h4>i18n.t('detect.knownLimits')</h4><span class="d">i18n.t('detect.knownLimitsDesc')</span></div>
        <div class="fp-body"><div class="stack">
          <div class="notice warn"><div>detect.tlsJa3</div></div>
          <div class="notice warn"><div>detect.fontMetrics</div></div>
          <div class="notice info"><div>detect.cdpPort</div></div>
          <div class="notice info"><div>detect.mediaCodec</div></div>
        </div></div></div>
    </div></div>`;
}
function bindDetect(root) {
  const probe = async () => {
    const t = toast('info', i18n.t('toast.probingHost'), i18n.t('detect.probeDoneDesc'), 60000);
    try {
      S.host = await Bridge.call('probeHost', {});
      t.remove();
      toast('ok', i18n.t('detect.probeDone'), `i18n.t('settings.probeDoneFmt')`);
      renderView(true); updateHostCard();
    } catch (e) { t.remove(); toast('err', i18n.t('toast.probeFailedShort'), String(e.message || e), 9000); }
  };
  qs('#btnProbeHost', root) && (qs('#btnProbeHost', root).onclick = probe);
  qs('#btnProbeNow', root) && (qs('#btnProbeNow', root).onclick = probe);
  qs('#btnOpenDetectPage', root) && (qs('#btnOpenDetectPage', root).onclick = async () => {
    if (!S.running.length) { toast('warn', i18n.t('toast.noRunningProfiles')); return; }
    const v = await promptDlg({ title: i18n.t('detect.chooseProfileForDetect'), fields: [{ key: 'id', label: i18n.t('common.window'), type: 'select', options: S.running.map(r => ({ v: r.id, t: `#${r.seq} ${r.name}` })) }] });
    if (v) await doDetect(v.id);
  });
  on(root, 'click', '[data-probe]', (e, t) => runProbe(t.dataset.probe));
}

/* ==========================================================================
   View: Local API
   ========================================================================== */
function viewAPI() {
  const ai = S.apiInfo || { port: 54345, base: 'http://127.0.0.1:54345', enabled: true, endpoints: [], snippets: [] };
  return `<div class="view">
    <div class="view-head">
      <div class="view-title"><h1>${i18n.t('api.title')}</h1>
        <p>${ai.enabled ? `i18n.t('api.bitBrowserIntro')` : i18n.t('api.disabledHint')}</p></div>
      <div class="view-tools">
        <button class="btn" id="btnCopyBase">${i18n.t('api.copyBase')}</button>
        <button class="btn" id="btnHealth">${i18n.t('api.testHealth')}</button>
      </div>
    </div>
    <div class="view-body">
      <div class="fp-sec open"><div class="fp-head"><span class="ic">⚡</span><h4>i18n.t('api.quickStart')</h4><span class="d">i18n.t('api.quickStartDesc')</span></div>
        <div class="fp-body">
          <div class="notice ok">api.cdpConnectStart
            api.cdpConnectMethods
            api.cdpConnectEnd</div>
          ${(ai.snippets || []).map(s => `<div>
            <div class="lbl" style="margin-bottom:5px">${esc(s.name)}</div>
            <div class="code-wrap"><button class="code-copy" data-copy>${i18n.t('button.copy')}</button><div class="code">${esc(s.code)}</div></div></div>`).join('')}
        </div></div>

      <div class="fp-sec open"><div class="fp-head"><span class="ic">📡</span><h4>${i18n.t('api.endpointsList')}</h4><span class="d">${(ai.endpoints || []).length} ${i18n.t('api.endpointsCount')}</span></div>
        <div class="fp-body"><div class="stack">
          ${(ai.endpoints || []).map((e, i) => `<div class="ep" data-i="${i}">
            <div class="ep-head"><span class="mth ${esc(e.method)}">${esc(e.method)}</span>
              <span class="ep-path">${esc(e.path)}</span><span class="ep-desc">${esc(e.desc)}</span>
              <svg class="chev" viewBox="0 0 12 12" width="11" height="11" style="color:var(--tx-4);transition:transform .18s"><path fill="currentColor" d="M4.5 2.5 8 6l-3.5 3.5z"/></svg></div>
            <div class="ep-body" style="display:none">
              ${e.body ? `<div><div class="lbl">${i18n.t('api.requestBody')}</div><div class="code">${esc(e.body)}</div></div>` : ''}
              <div><div class="lbl">${'dialog.curlExample'}</div>
                <div class="code-wrap"><button class="code-copy" data-copy>${i18n.t('button.copy')}</button>
                <div class="code">${esc(e.example || `curl -s -X ${e.method} ${ai.base}${e.path} -H 'Content-Type: application/json' -d '${e.body || '{}'}'`)}</div></div></div>
              <div class="row"><button class="btn btn-sm" data-try="${i}">${'button.tryRun'}</button><span class="hint">$${'api.tryRunning'}</span></div>
              <div class="tryout" id="tryout-${i}"></div>
            </div></div>`).join('')}
        </div></div></div>
    </div></div>`;
}
function bindAPI(root) {
  qs('#btnCopyBase', root) && (qs('#btnCopyBase', root).onclick = () => copy((S.apiInfo || {}).base || '', i18n.t('toast.baseCopied')));
  qs('#btnHealth', root) && (qs('#btnHealth', root).onclick = async () => {
    const base = (S.apiInfo || {}).base;
    try { const r = await (await fetch(base + '/health')).json(); toast('ok', i18n.t('toast.apiOk'), JSON.stringify(r.data || r)); }
    catch (e) { toast('err', i18n.t('toast.apiUnreachable'), String(e.message || e), 8000); }
  });
  on(root, 'click', '.ep-head', (e, t) => {
    const ep = t.closest('.ep'); ep.classList.toggle('open');
    const b = qs('.ep-body', ep); b.style.display = ep.classList.contains('open') ? '' : 'none';
    qs('.chev', t).style.transform = ep.classList.contains('open') ? 'rotate(90deg)' : '';
  });
  on(root, 'click', '[data-copy]', (e, t) => copy(qs('.code', t.parentElement).textContent, i18n.t('toast.copied')));
  on(root, 'click', '[data-try]', async (e, t) => {
    const i = +t.dataset.try;
    const ep = (S.apiInfo.endpoints || [])[i]; if (!ep) return;
    const out = qs('#tryout-' + i, root); out.innerHTML = '<div class="busy"><div class="spinner"></div>' + i18n.t('api.requesting') + '</div>';
    const base = (S.apiInfo || {}).base;
    let body = ep.body || '';
    if (ep.method === 'GET') body = '';
    else {
      const v = await promptDlg({ title: i18n.t('api.tryRunPath', {path: ep.path}), message: i18n.t('dialog.tryRunBody'), fields: [{ key: 'b', label: i18n.t('common.body'), type: 'textarea', rows: 6, value: ep.body || '{}' }], okText: i18n.t('api.sendBtn') });
      if (!v) { out.innerHTML = ''; return; }
      body = v.b;
    }
    const t0 = Date.now();
    try {
      const r = await fetch(base + ep.path, ep.method === 'GET' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const txt = await r.text();
      let pretty = txt; try { pretty = JSON.stringify(JSON.parse(txt), null, 1); } catch (e) { /* keep raw */ }
      out.innerHTML = `<div class="lbl">HTTP ${r.status} · ${Date.now() - t0}ms</div><div class="code" style="max-height:260px">${esc(pretty)}</div>`;
    } catch (err) { out.innerHTML = `<div class="notice bad">${i18n.t('api.failFmt', {error: esc(String(err.message || err))})}</div>`; }
  });
}

/* ==========================================================================
   View: Settings
   ========================================================================== */
function viewSettings() {
  const st = S.settings || {};
  return `<div class="view">
    <div class="view-head"><div class="view-title"><h1>${'settings.title2'}</h1><p>i18n.t('settings.versionLine')</p></div>
      <div class="view-tools"><button class="btn btn-primary" id="btnSaveSettings">${'button.save4'}</button></div></div>
    <div class="view-body"><div class="stack">
      ${sec('api', '🔌', i18n.t('api.title'), st.apiEnabled ? i18n.t('api.enabled', {n: st.apiPort}) : i18n.t('api.disabled'), `
        ${sw('apiEnabled', st.apiEnabled !== false, i18n.t('settings.apiEnabled'), i18n.t('settings.apiEnabledHint'))}
        <div class="grid2">
          ${num('apiPort', i18n.t('settings.apiPort'), st.apiPort || 54345, 'min="1024" max="65535"')}
          ${txt('apiToken', i18n.t('settings.apiToken'), st.apiToken || '', i18n.t('settings.apiTokenPh'))}
        </div>
        <div class="hint">${'settings.apiPortHint'}</div>
      `, true)}

      ${sec('browser', '🧭', i18n.t('settings.browserSection'), st.defaultBrowserPath || i18n.t('editor.autoSelect'), `
        <div class="field"><label>${'settings.defaultBrowserPath'}</label>
          <div class="row"><select data-bind="defaultBrowserPath" style="flex:1">
            <option value="">${i18n.t('editor.autoSelect')}</option>
            ${(S.env.browsers || []).map(b => `<option value="${esc(b.path)}" ${st.defaultBrowserPath === b.path ? 'selected' : ''}>${esc(b.name)} ${esc(b.version || '')}</option>`).join('')}
          </select><button class="btn" id="btnPickBrowser2">${i18n.t('button.browse')}</button></div>
          <div class="hint">${i18n.t('settings.browsersDetected', {n: ((S.env.browsers || []).length)})}：${(S.env.browsers || []).map(b => esc(b.name)).join(' · ') || i18n.t('probe.cdcNone')}</div></div>
        <div class="grid2">
          ${num('cascadeOffset', i18n.t('settings.cascadeOffset'), st.cascadeOffset || 28, 'min="0" max="200"')}
          ${sw('autoCheckProxyOnOpen', st.autoCheckProxyOnOpen, i18n.t('settings.autoCheckProxyOnOpen'), i18n.t('settings.autoCheckProxyOnOpenHint'))}
        </div>
      `, true)}

      ${sec('app', '🪟', i18n.t('settings.appSection'), '', `
        ${sw('keepInMenuBar', st.keepInMenuBar !== false, i18n.t('settings.keepInMenuBar'), i18n.t('settings.keepInMenuBarHint'))}
        ${sw('autoAttachOnLaunch', st.autoAttachOnLaunch !== false, i18n.t('settings.autoAttachOnLaunch'), '')}
      `)}

      ${sec('sec', '🔐', i18n.t('settings.securitySection'), st.masterPasswordEnabled ? i18n.t('settings.masterPwdEnabled') : i18n.t('settings.masterPwdNotEnabled'), `
        <div class="notice ${st.masterPasswordEnabled ? 'ok' : 'info'}"><div>${st.masterPasswordEnabled
          ? i18n.t('settings.encrypted')
          : i18n.t('settings.notEncrypted')}</div></div>
        <div class="row wrap">
          <button class="btn" id="btnSetPwd">${st.masterPasswordEnabled ? i18n.t('button.modifyPassword') : i18n.t('button.setPassword')}</button>
          <button class="btn" id="btnRevealData">${'button.openDataDir'}</button>
          <button class="btn" id="btnExportAll">${'button.exportAll2'}</button>
          <button class="btn" id="btnImportAll">${'button.importConfig'}</button>
        </div>
        ${kv(i18n.t('editor.dataDir'), S.env.supportDir || '')}
        ${kv(i18n.t('settings.injectScript'), S.env.injectFrom || '')}
        <div class="hint">${'settings.dataDirHint'}</div>
      `)}

      ${sec('about', 'ℹ️', i18n.t('settings.aboutSection'), '', `
        <div class="fp-grid">
          ${kv(i18n.t('settings.version'), S.env.version || '')}${kv(i18n.t('settings.localChrome'), S.host.chromeMajor ? S.host.chromeMajor + ' (' + S.host.chromeFullVersion + ')' : i18n.t('settings.notDetectedShort'))}
          ${kv(i18n.t('settings.profileCount'), String((S.stats || {}).total || 0))}${kv(i18n.t('profile.statusRunning'), String((S.stats || {}).running || 0))}
          ${kv(i18n.t('settings.injectChannel'), i18n.t('settings.injectChannelValue'))}
          ${kv(i18n.t('settings.nativeBridge'), Bridge.native ? i18n.t('settings.nativeBridgeValue') : i18n.t('settings.httpBridge'))}
        </div>
        <div class="notice info"><div>${i18n.t('settings.aboutWhyNoExtFull')}</div></div>
        <div class="row wrap"><button class="btn" id="btnOpenLog">${'button.viewLogs'}</button>
          <button class="btn" id="btnAbout">${i18n.t('button.about')}</button></div>
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
    try { await Bridge.call('saveSettings', { settings: S.settings }); toast('ok', i18n.t('toast.savedProbe')); S.env = await Bridge.call('env', {}); S.apiInfo = await Bridge.call('apiInfo', {}); updateChrome(); }
    catch (e) { toast('err', i18n.t('toast.saveProfileFailed'), String(e.message || e), 8000); }
  };
  qs('#btnPickBrowser2', root).onclick = async () => {
    const r = await Bridge.call('pickBrowser', {});
    if (r.path) { S.settings.defaultBrowserPath = r.path; S.env = await Bridge.call('env', {}); renderView(true); toast('ok', i18n.t('toast.selected'), r.path); }
  };
  qs('#btnRevealData', root).onclick = () => Bridge.call('reveal', { path: S.env.supportDir });
  qs('#btnExportAll', root).onclick = () => doExport(null);
  qs('#btnImportAll', root).onclick = () => doImport();
  qs('#btnOpenLog', root).onclick = () => showLogs();
  qs('#btnAbout', root).onclick = () => showAbout();
  qs('#btnSetPwd', root).onclick = async () => {
    const v = await promptDlg({ title: i18n.t('dialog.masterPassword'), message: i18n.t('dialog.masterPasswordSetup'),
      fields: [{ key: 'p1', label: i18n.t('dialog.masterPassword'), type: 'password', placeholder: i18n.t('dialog.passwordPlaceholder') }, { key: 'p2', label: i18n.t('dialog.passwordConfirm'), type: 'password' }] });
    if (!v) return;
    if (v.p1 !== v.p2) { toast('err', i18n.t('toast.passwordMismatch')); return; }
    await Bridge.call('setMasterPassword', { password: v.p1 });
    toast(v.p1 ? 'ok' : 'warn', v.p1 ? i18n.t('toast.passwordEnabled') : i18n.t('toast.passwordDisabled'), v.p1 ? i18n.t('toast.passwordEnabledHint') : '');
    S.settings = await Bridge.call('settings', {}); renderView(true);
  };
  on(root, 'click', 'summary', () => { /* details 原生行为 */ });
}
async function showLogs() {
  const r = await Bridge.call('logs', { tail: 800 });
  modal({ title: i18n.t('toast.runLogTitle'), subtitle: i18n.t('toast.runtimeLogSubtitle'), size: 'wide',
    body: `<div class="row" style="margin-bottom:9px"><button class="btn btn-sm" id="lgCopy">i18n.t('settings.logCopyAll')</button>
      <button class="btn btn-sm" id="lgReveal">i18n.t('settings.logReveal')</button><div class="grow"></div>
      <button class="btn btn-sm" id="lgRefresh">${i18n.t('button.refresh')}</button></div>
      <div class="code" id="logBox" style="max-height:58vh">${esc(r.text || i18n.t('toast.noLogs'))}</div>`,
    footer: `<div class="grow"></div><button class="btn btn-primary" data-close>${'running.closeBtn'}</button>`,
    onMount(api) {
      const box = qs('#logBox', api.box);
      qs('#lgCopy', api.box).onclick = () => copy(box.textContent, i18n.t('toast.copyLog'));
      qs('#lgReveal', api.box).onclick = () => Bridge.call('reveal', { path: S.env.supportDir + '/logs' });
      qs('#lgRefresh', api.box).onclick = async () => { box.textContent = (await Bridge.call('logs', { tail: 800 })).text || ''; box.scrollTop = box.scrollHeight; };
      setTimeout(() => { box.scrollTop = box.scrollHeight; }, 50);
    } });
}
function showAbout() {
  const h = S.host || {};
  modal({ title: i18n.t('toast.aboutVeil'), subtitle: 'v' + (S.env.version || ''), size: '',
    body: `<div class="stack">
      <div class="notice info"><div>i18n.t('settings.aboutVeil')</div></div>
      <div class="fp-grid">${kv(i18n.t('settings.version'), S.env.version || '')}${kv(i18n.t('settings.arch'), S.env.arch || '')}
        ${kv(i18n.t('platform.mac'), S.env.macOS || '')}${kv(i18n.t('settings.localChrome'), h.chromeMajor || i18n.t('misc.unknown'))}
        ${kv(i18n.t('common.window'), String((S.stats || {}).total || 0))}${kv(i18n.t('profile.statusRunning'), String((S.stats || {}).running || 0))}</div>
      <div class="hint">i18n.t('settings.dataHint')</div></div>`,
    footer: `<div class="grow"></div><button class="btn btn-primary" data-close>i18n.t('settings.okBtn')</button>` });
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
  const set = (id, v, title) => { const el = qs(id); if (el) { el.textContent = v || i18n.t('misc.unknown'); if (title !== undefined) el.title = title || v || ''; } };
  set('#hcChrome', h.chromeMajor ? `${h.chromeMajor}` : i18n.t('settings.notDetectedShort'), h.chromeFullVersion);
  set('#hcGpu', (h.webglUnmaskedRenderer || '').replace(/^ANGLE \(([^,]+), /, '$1: ').slice(0, 46), h.webglUnmaskedRenderer);
  set('#hcTz', h.timezone, h.timezone);
  set('#hcFonts', h.fonts ? `${h.fonts.length} ${i18n.t('detect.fontsCount')}` : i18n.t('misc.unknown'));
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
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">${'toast.initFailed'}</div>${esc(String(e.message || e))}</div>`;
    return;
  }
  if (S.env.locked) {
    const v = await promptDlg({ title: i18n.t('dialog.unlockTitle'), message: i18n.t('dialog.unlockMessage'), dismissible: false,
      fields: [{ key: 'pw', label: i18n.t('dialog.masterPassword'), type: 'password' }], okText: i18n.t('button.unlock') });
    if (v) {
      try { await Bridge.call('unlock', { password: v.pw }); S.env = await Bridge.call('env', {}); }
      catch (e) { toast('err', i18n.t('toast.unlockFailed'), String(e.message || e), 8000); }
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
    toast('info', i18n.t('toast.probingHost'), i18n.t('toast.hostNotProbedHint'), 5000);
  }
}

function bindShell() {
  on(document, 'click', '.nav-item', (e, t) => go(t.dataset.view));
  qs('#btnLogs').onclick = () => showLogs();
  qs('#btnProbe').onclick = () => { go('detect'); setTimeout(() => { const b = qs('#btnProbeHost'); if (b) b.click(); }, 60); };
  qs('#hcProbe').onclick = async () => {
    const t = toast('info', i18n.t('toast.probingHost'), '', 60000);
    try { S.host = await Bridge.call('probeHost', {}); updateHostCard(); t.remove(); toast('ok', i18n.t('detect.probeDone'), i18n.t('toast.probeDoneDesc', {n: S.host.chromeMajor, a: (S.host.fonts || []).length})); if (S.view === 'detect') renderView(true); }
    catch (e) { t.remove(); toast('err', i18n.t('toast.probeFailedShort'), String(e.message || e), 9000); }
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
    else if (k === 'o') { e.preventDefault(); if (S.sel.size) doOpen([...S.sel]); else toast('warn', i18n.t('toast.selectFirst')); }
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
    case 'openSelected': if (S.sel.size) doOpen([...S.sel]); else toast('warn', i18n.t('toast.selectInList')); break;
    case 'closeSelected': if (S.sel.size) doClose([...S.sel]); else toast('warn', i18n.t('toast.selectInList')); break;
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
  else if (name === 'reattached') { if (payload > 0) toast('info', i18n.t('toast.reattachedN', {payload: payload})); await loadProfiles(true); }
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
  if (!S.booting) toast('err', i18n.t('toast.uiError'), String(ev.message || ''), 8000);
});

boot().catch(e => {
  const b = qs('#boot');
  if (b) b.innerHTML = `<div style="color:#ff8fa0;font:13px/1.7 var(--ff)">i18n.t('settings.bootFailed')</div>`;
});
