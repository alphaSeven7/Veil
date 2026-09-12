/* Veil · 轻量 i18n 运行时（零依赖，原生 ES2017+）
 * 公共 API: init / t / setLocale / getLocale / applyToDOM /
 *          formatDate / formatNumber / formatRelative / listMissing
 */
(function (root) {
  'use strict';

  const state = {
    locale: 'zh-CN',
    fallback: 'zh-CN',
    dict: { 'zh-CN': {}, 'en-US': {} },
    loaded: { 'zh-CN': false, 'en-US': false },
    localesUrl: '/__veil/locales',
    missing: new Set(),
    ready: null, // Promise
  };

  function warn(msg) {
    if (typeof console !== 'undefined') console.warn('[i18n]', msg);
  }

  // 缺失键优雅降级：返回 key 名 + 记录
  function miss(key) {
    state.missing.add(key);
    return key;
  }

  // 加载指定语言字典
  async function loadLocale(locale) {
    if (state.loaded[locale]) return state.dict[locale];
    // 优先用 Swift 在 document start 注入的字典（避免 file:// 跨域 fetch 失败）
    if (root.__veilLocaleDicts && root.__veilLocaleDicts[locale]) {
      state.dict[locale] = root.__veilLocaleDicts[locale];
      state.loaded[locale] = true;
      console.log('[i18n] loaded ' + locale + ' (injected)');
      return state.dict[locale];
    }
    try {
      const res = await fetch(state.localesUrl + '/' + locale + '.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.dict[locale] = await res.json();
      state.loaded[locale] = true;
      console.log('[i18n] loaded ' + locale + ' (fetched)');
      return state.dict[locale];
    } catch (e) {
      console.warn('[i18n] load ' + locale + ' FAILED: ' + e.message);
      return {};
    }
  }

  // 按点分路径取字典值
  function lookup(dict, key) {
    if (!dict) return undefined;
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return undefined;
    }
    return (typeof cur === 'string') ? cur : undefined;
  }

  // 简易 ICU 子集（插值 + 复数 + select）
  function format(template, params) {
    if (!params) return template;
    return template.replace(
      /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}|\{\s*([a-zA-Z_][\w]*)\s*(?:,\s*(plural|select)\s*,)?\s*([^}]*)\}/g,
      (m, v1, v2, kind, body) => {
        if (v1) return String(params[v1] ?? '');
        const name = v2;
        const v = params[name];
        if (kind === 'plural') {
          const n = Number(v);
          const branches = parseBranches(body);
          const key = (n === 1 && 'one' in branches) ? 'one' : 'other';
          const tpl = branches[key] ?? branches.other ?? '';
          return tpl.replace(/#/g, String(n));
        }
        if (kind === 'select') {
          const branches = parseBranches(body);
          return branches[String(v)] ?? branches.other ?? '';
        }
        return String(v ?? '');
      }
    );
  }

  function parseBranches(body) {
    const out = {};
    const re = /(\w+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(body)) !== null) out[m[1]] = m[2];
    return out;
  }

  // 公共 API
  const i18n = {
    async init(opts) {
      opts = opts || {};
      state.locale = opts.locale || (root.__veilLocale || 'zh-CN');
      console.log('[i18n] init: locale=' + state.locale);
      state.fallback = opts.fallback || 'zh-CN';
      state.localesUrl = opts.localesUrl || '/__veil/locales';
      if (opts.dict) {
        for (const k of Object.keys(opts.dict)) {
          state.dict[k] = opts.dict[k];
          state.loaded[k] = true;
        }
      }
      // 强制重新加载（修复后即使 loaded=true 也会重读 __veilLocaleDicts）
      state.loaded[state.locale] = false;
      state.loaded[state.fallback] = false;
      state.ready = Promise.all([loadLocale(state.locale), loadLocale(state.fallback)]);
      await state.ready;
      return state.ready;
    },

    t(key, params) {
      let v = lookup(state.dict[state.locale], key);
      if (v === undefined && state.locale !== state.fallback) {
        v = lookup(state.dict[state.fallback], key);
      }
      if (v === undefined) return miss(key);
      return format(v, params);
    },

    async setLocale(locale) {
      await loadLocale(locale);
      state.locale = locale;
    },

    getLocale() { return state.locale; },

    applyToDOM(rootEl) {
      const root = rootEl || document;
      // 文本节点
      root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        const txt = i18n.t(key);
        if (el.textContent !== txt) el.textContent = txt;
      });
      // 多属性：data-i18n-attr="title:foo;aria-label:bar"
      root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        const spec = el.getAttribute('data-i18n-attr') || '';
        spec.split(';').forEach((pair) => {
          const [attr, key] = pair.split(':').map((s) => s.trim());
          if (!attr || !key) return;
          const txt = i18n.t(key);
          if (el.getAttribute(attr) !== txt) el.setAttribute(attr, txt);
        });
      });
      // 单属性快捷：data-i18n-placeholder / data-i18n-title / data-i18n-html
      ['placeholder', 'title', 'aria-label'].forEach((attr) => {
        const dn = 'data-i18n-' + attr;
        root.querySelectorAll('[' + dn + ']').forEach((el) => {
          const key = el.getAttribute(dn);
          const txt = i18n.t(key);
          if (el.getAttribute(attr) !== txt) el.setAttribute(attr, txt);
        });
      });
      // innerHTML（谨慎使用）
      root.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        el.innerHTML = i18n.t(key);
      });
    },

    formatDate(d, opts) {
      try {
        return new Intl.DateTimeFormat(state.locale, opts || {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit'
        }).format(d);
      } catch (e) { return String(d); }
    },

    formatNumber(n, opts) {
      try {
        return new Intl.NumberFormat(state.locale, opts).format(n);
      } catch (e) { return String(n); }
    },

    formatRelative(seconds) {
      try {
        const rtf = new Intl.RelativeTimeFormat(state.locale, { numeric: 'auto' });
        if (Math.abs(seconds) < 60) return rtf.format(-Math.round(seconds), 'second');
        if (Math.abs(seconds) < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
        if (Math.abs(seconds) < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
        return rtf.format(-Math.round(seconds / 86400), 'day');
      } catch (e) { return String(seconds); }
    },

    listMissing() { return Array.from(state.missing); },
  };

  root.i18n = i18n;

  // DEBUG ONLY: 暴露 state 到 window 用于 inspect
  if (typeof window !== 'undefined') { window.__i18nDebug = state; }
})(typeof window !== 'undefined' ? window : globalThis);
