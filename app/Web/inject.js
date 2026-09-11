/*
 * Veil Fingerprint Injection
 * 通过 CDP Page.addScriptToEvaluateOnNewDocument 注入到每个页面/框架的主世界，
 * 在页面任何脚本之前执行。配置由 __VEIL_CFG_JSON__ 替换。
 */
(function () {
  "use strict";
  var CFG;
  try { CFG = __VEIL_CFG_JSON__; } catch (e) { return; }
  if (!CFG || CFG.__disabled) return;

  // ---------- 可复现随机 ----------
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var baseSeed = hashStr(CFG.seed || "veil");
  function rngFor(extra) { return mulberry32((baseSeed ^ hashStr(String(extra))) >>> 0); }

  // ---------- 伪装 Function.prototype.toString ----------
  var NATIVE_SRC = new WeakMap();
  var origFnToString = Function.prototype.toString;
  function disguise(fn, src) { try { NATIVE_SRC.set(fn, src); } catch (e) {} return fn; }
  var patchedToString = function toString() {
    if (NATIVE_SRC.has(this)) return NATIVE_SRC.get(this);
    return origFnToString.call(this);
  };
  disguise(patchedToString, "function toString() { [native code] }");
  try { Function.prototype.toString = patchedToString; } catch (e) {}

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  // ---------- 属性覆写工具 ----------
  function defGet(obj, prop, value, opts) {
    if (!obj) return false;
    opts = opts || {};
    var get = function () { return value; };
    disguise(get, "function get " + prop + "() { [native code] }");
    var set = undefined;
    if (opts.writable) {
      var v = value;
      get = function () { return v; };
      set = function (x) { v = x; };
      disguise(get, "function get " + prop + "() { [native code] }");
      disguise(set, "function set " + prop + "() { [native code] }");
    }
    try {
      Object.defineProperty(obj, prop, {
        get: get, set: set,
        enumerable: opts.enumerable === undefined ? true : opts.enumerable,
        configurable: opts.configurable === undefined ? true : opts.configurable
      });
      return true;
    } catch (e) { return false; }
  }

  function defFn(obj, prop, impl) {
    if (!obj) return false;
    disguise(impl, "function " + prop + "() { [native code] }");
    try {
      Object.defineProperty(obj, prop, { value: impl, writable: true, enumerable: false, configurable: true });
      return true;
    } catch (e) { return false; }
  }

  function protoOf(name) { try { return window[name] && window[name].prototype; } catch (e) { return null; } }

  var W = window, N = W.navigator, D = W.document;

  // ============================================================
  // 1. navigator 基础属性
  // ============================================================
  var NP = protoOf("Navigator");
  if (CFG.navigator) {
    var nav = CFG.navigator;
    if (nav.platform !== undefined) defGet(NP, "platform", nav.platform);
    if (nav.hardwareConcurrency !== undefined) defGet(NP, "hardwareConcurrency", nav.hardwareConcurrency);
    if (nav.deviceMemory !== undefined) defGet(NP, "deviceMemory", nav.deviceMemory);
    if (nav.maxTouchPoints !== undefined) defGet(NP, "maxTouchPoints", nav.maxTouchPoints);
    if (nav.vendor !== undefined) defGet(NP, "vendor", nav.vendor);
    if (nav.language !== undefined) defGet(NP, "language", nav.language);
    if (nav.languages !== undefined) {
      var langs = Object.freeze(nav.languages.slice());
      defGet(NP, "languages", langs);
    }
    if (nav.doNotTrack !== undefined) defGet(NP, "doNotTrack", nav.doNotTrack);
    if (nav.vendorSub !== undefined) defGet(NP, "vendorSub", nav.vendorSub);
    if (nav.productSub !== undefined) defGet(NP, "productSub", nav.productSub);
    if (nav.webdriver === false) {
      // 正常浏览器 webdriver === false；确保不暴露 true
      defGet(NP, "webdriver", false);
    }
    if (nav.userAgent) defGet(NP, "userAgent", nav.userAgent);
    if (nav.appVersion) defGet(NP, "appVersion", nav.appVersion);
  }

  // ============================================================
  // 2. 屏幕 / 窗口尺寸
  // ============================================================
  if (CFG.screen) {
    var sc = CFG.screen, SP = protoOf("Screen");
    if (SP) {
      defGet(SP, "width", sc.width);
      defGet(SP, "height", sc.height);
      defGet(SP, "availWidth", sc.availWidth);
      defGet(SP, "availHeight", sc.availHeight);
      defGet(SP, "availLeft", sc.availLeft || 0);
      defGet(SP, "availTop", sc.availTop || 0);
      defGet(SP, "colorDepth", sc.colorDepth);
      defGet(SP, "pixelDepth", sc.pixelDepth);
    }
    if (sc.devicePixelRatio !== undefined) defGet(W, "devicePixelRatio", sc.devicePixelRatio);
    if (sc.orientation) {
      var SO = protoOf("ScreenOrientation");
      if (SO) {
        defGet(SO, "angle", sc.orientation.angle || 0);
        defGet(SO, "type", sc.orientation.type || "landscape-primary");
      }
    }
    if (sc.outerWidth) {
      defGet(W, "outerWidth", sc.outerWidth, { enumerable: false });
      defGet(W, "outerHeight", sc.outerHeight, { enumerable: false });
    }
  }

  // ============================================================
  // 3. 时区（CDP 已处理，这里做兜底一致性）
  // ============================================================
  if (CFG.timezone) {
    var tz = CFG.timezone;
    try {
      var origResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
      var patchedResolved = function resolvedOptions() {
        var r = origResolved.call(this);
        r.timeZone = tz;
        return r;
      };
      disguise(patchedResolved, "function resolvedOptions() { [native code] }");
      Intl.DateTimeFormat.prototype.resolvedOptions = patchedResolved;
    } catch (e) {}
    if (typeof CFG.timezoneOffset === "number") {
      var off = CFG.timezoneOffset;
      var DP = protoOf("Date");
      if (DP) {
        defFn(DP, "getTimezoneOffset", function getTimezoneOffset() { return off; });
      }
    }
  }

  // ============================================================
  // 4. Canvas 2D 噪声
  // ============================================================
  function perturbBytes(d, w, h, level, seedKey) {
    var rnd = rngFor("canvas:" + seedKey);
    var n = d.length;
    // 采样式扰动：影响约 level 比例的像素，每通道 ±1..2，保持 alpha 不变
    var count = Math.max(1, Math.floor((w * h) * Math.min(0.35, Math.max(0.002, level))));
    for (var i = 0; i < count; i++) {
      var px = Math.floor(rnd() * (w * h));
      var o = px * 4;
      if (o + 2 >= n) break;
      // 只扰动非全透明像素，避免破坏透明背景哈希之外的结构
      if (d[o + 3] === 0) continue;
      var ch = Math.floor(rnd() * 3);
      var delta = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2));
      var v = d[o + ch] + delta;
      d[o + ch] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
  }

  if (CFG.canvas && CFG.canvas.enabled) {
    (function () {
      var level = typeof CFG.canvas.level === "number" ? CFG.canvas.level : 0.02;
      var C2D = protoOf("CanvasRenderingContext2D");
      var HCE = protoOf("HTMLCanvasElement");
      var inFlight = new WeakSet();
      var noised = new WeakSet();

      var origGetImageData = C2D && C2D.getImageData;
      var origToDataURL = HCE && HCE.toDataURL;
      var origToBlob = HCE && HCE.toBlob;

      function keyFor(c) { return (c.width || 0) + "x" + (c.height || 0); }

      function snapshot(canvas, ctx) {
        if (inFlight.has(canvas) || noised.has(canvas)) return null;
        var w = canvas.width, h = canvas.height;
        if (!w || !h || w * h > 40000000) return null;
        var img;
        try { img = origGetImageData.call(ctx, 0, 0, w, h); } catch (e) { return null; }
        var data = img.data;
        var nonEmpty = false;
        for (var i = 3; i < data.length; i += 4 * 97) { if (data[i] !== 0) { nonEmpty = true; break; } }
        if (!nonEmpty) return null;
        var backup = new Uint8ClampedArray(data);
        perturbBytes(data, w, h, level, keyFor(canvas) + ":" + (canvas.__vk || ""));
        inFlight.add(canvas);
        try { ctx.putImageData(img, 0, 0); } catch (e) { inFlight.delete(canvas); return null; }
        noised.add(canvas);
        return { canvas: canvas, ctx: ctx, backup: backup, w: w, h: h };
      }

      function restore(s) {
        if (!s) return;
        try {
          var img = s.ctx.createImageData(s.w, s.h);
          img.data.set(s.backup);
          s.ctx.putImageData(img, 0, 0);
        } catch (e) {}
        inFlight.delete(s.canvas);
        noised.delete(s.canvas);
      }

      if (origToDataURL) {
        defFn(HCE, "toDataURL", function toDataURL() {
          var s = null;
          try { var ctx = this.getContext("2d"); if (ctx) s = snapshot(this, ctx); } catch (e) {}
          try { return origToDataURL.apply(this, arguments); } finally { restore(s); }
        });
      }
      if (origToBlob) {
        defFn(HCE, "toBlob", function toBlob() {
          var args = arguments, self = this, s = null;
          try { var ctx = self.getContext("2d"); if (ctx) s = snapshot(self, ctx); } catch (e) {}
          var cb = args[0];
          args[0] = function () { restore(s); s = null; return cb && cb.apply(null, arguments); };
          return origToBlob.apply(self, args);
        });
      }
      if (origGetImageData) {
        defFn(C2D, "getImageData", function getImageData() {
          var img = origGetImageData.apply(this, arguments);
          if (inFlight.has(this.canvas)) return img;
          try {
            var copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            perturbBytes(copy.data, img.width, img.height, level, keyFor(this.canvas) + ":gid");
            return copy;
          } catch (e) { return img; }
        });
      }
      // OffscreenCanvas
      var OC = protoOf("OffscreenCanvas");
      var OC2D = W.OffscreenCanvasRenderingContext2D && W.OffscreenCanvasRenderingContext2D.prototype;
      if (OC && OC.convertToBlob && OC2D && OC2D.getImageData) {
        var ocGet = OC2D.getImageData, ocConv = OC.convertToBlob;
        defFn(OC, "convertToBlob", function convertToBlob() {
          var s = null;
          try { var ctx = this.getContext("2d"); if (ctx) s = snapshot(this, ctx); } catch (e) {}
          var p = ocConv.apply(this, arguments);
          return p && p.then ? p.then(function (r) { restore(s); return r; }, function (e) { restore(s); throw e; }) : (restore(s), p);
        });
        defFn(OC2D, "getImageData", function getImageData() {
          var img = ocGet.apply(this, arguments);
          if (inFlight.has(this.canvas)) return img;
          try {
            var copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            perturbBytes(copy.data, img.width, img.height, level, keyFor(this.canvas) + ":os");
            return copy;
          } catch (e) { return img; }
        });
      }
    })();
  }

  // ============================================================
  // 5. WebGL
  // ============================================================
  if (CFG.webgl) {
    (function () {
      var cfg = CFG.webgl;
      var UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246; // 37445 / 37446
      var PARAM_ENUM = {
        MAX_TEXTURE_SIZE: 0x0D33, MAX_RENDERBUFFER_SIZE: 0x84E8, MAX_VIEWPORT_DIMS: 0x0D3A,
        MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_ATTRIBS: 0x8869, MAX_VARYING_VECTORS: 0x8DFC,
        MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
        MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, ALIASED_LINE_WIDTH_RANGE: 0x846E,
        ALIASED_POINT_SIZE_RANGE: 0x846D, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
        VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C, VENDOR: 0x1F00, RENDERER: 0x1F01,
        MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C, MAX_SAMPLES: 0x8D57
      };
      function parseVal(v) {
        if (typeof v !== "string") return v;
        if (/^-?\d+$/.test(v)) return parseInt(v, 10);
        if (/^-?[\d.]+(,\s*-?[\d.]+)+$/.test(v)) {
          var a = v.split(",").map(function (x) { return parseFloat(x); });
          return new Float32Array(a);
        }
        return v;
      }
      var overrides = {};
      if (cfg.params) for (var k in cfg.params) if (PARAM_ENUM[k] !== undefined) overrides[PARAM_ENUM[k]] = parseVal(cfg.params[k]);

      function patchCtxProto(P, isGL2) {
        if (!P || P.__veiled) return;
        P.__veiled = true;
        var origGetParameter = P.getParameter;
        defFn(P, "getParameter", function getParameter(p) {
          if (p === UNMASKED_VENDOR && cfg.spoof) return cfg.vendor;
          if (p === UNMASKED_RENDERER && cfg.spoof) return cfg.renderer;
          if (p === PARAM_ENUM.VENDOR && cfg.spoof) return "WebKit";
          if (p === PARAM_ENUM.RENDERER && cfg.spoof) return "WebKit WebGL";
          if (p === PARAM_ENUM.VERSION && cfg.version) return cfg.version;
          if (overrides[p] !== undefined) return overrides[p];
          return origGetParameter.call(this, p);
        });
        if (cfg.spoof) {
          var origGetExtension = P.getExtension;
          defFn(P, "getExtension", function getExtension(name) {
            if (cfg.hideExtensions && cfg.hideExtensions.indexOf(name) >= 0) return null;
            return origGetExtension.call(this, name);
          });
          var origGetSupported = P.getSupportedExtensions;
          defFn(P, "getSupportedExtensions", function getSupportedExtensions() {
            var list = origGetSupported.call(this) || [];
            if (!cfg.hideExtensions || !cfg.hideExtensions.length) return list;
            return list.filter(function (x) { return cfg.hideExtensions.indexOf(x) < 0; });
          });
        }
        if (cfg.noise) {
          var origReadPixels = P.readPixels;
          defFn(P, "readPixels", function readPixels() {
            origReadPixels.apply(this, arguments);
            var out = arguments[6];
            if (out && out.length) {
              var rnd = rngFor("webgl:" + arguments[0] + "x" + arguments[1] + ":" + arguments[2]);
              var cnt = Math.max(1, Math.floor(out.length / 4 * 0.06));
              for (var i = 0; i < cnt; i++) {
                var o = (Math.floor(rnd() * (out.length / 4)) * 4) + Math.floor(rnd() * 3);
                if (o < out.length) out[o] = (out[o] + (rnd() < 0.5 ? 1 : 255)) & 255;
              }
            }
            return undefined;
          });
          // getParameter 之外的浮点泄漏：shader precision
          if (P.getShaderPrecisionFormat && cfg.precisionJitter) {
            var origPrec = P.getShaderPrecisionFormat;
            defFn(P, "getShaderPrecisionFormat", function getShaderPrecisionFormat() {
              var r = origPrec.apply(this, arguments);
              if (r && typeof r.precision === "number") {
                var rnd = rngFor("prec:" + arguments[0] + ":" + arguments[1]);
                try { Object.defineProperty(r, "precision", { value: r.precision + (rnd() < 0.5 ? 0 : 0), configurable: true }); } catch (e) {}
              }
              return r;
            });
          }
        }
      }
      patchCtxProto(protoOf("WebGLRenderingContext"), false);
      patchCtxProto(protoOf("WebGL2RenderingContext"), true);

      // 关闭 WebGL2 时直接让 getContext('webgl2') 返回 null
      if (cfg.webgl2 === false) {
        var HC = protoOf("HTMLCanvasElement");
        var OCp = protoOf("OffscreenCanvas");
        [HC, OCp].forEach(function (P) {
          if (!P || !P.getContext) return;
          var orig = P.getContext;
          defFn(P, "getContext", function getContext(type) {
            if (type === "webgl2" || type === "experimental-webgl2") return null;
            return orig.apply(this, arguments);
          });
        });
      }
      // WebGPU 隐藏
      if (cfg.webgpu === "hide") {
        try { delete W.navigator.gpu; } catch (e) {}
        defGet(protoOf("Navigator"), "gpu", undefined, { enumerable: true });
      }
    })();
  }

  // ============================================================
  // 6. AudioContext 噪声
  // ============================================================
  if (CFG.audio && CFG.audio.enabled) {
    (function () {
      var level = typeof CFG.audio.level === "number" ? CFG.audio.level : 0.0001;
      var touched = new WeakSet();
      var AB = protoOf("AudioBuffer");
      if (AB && AB.getChannelData) {
        var origGet = AB.getChannelData;
        defFn(AB, "getChannelData", function getChannelData(ch) {
          var d = origGet.call(this, ch);
          try {
            if (d && d.length && d.length < 2000000 && !touched.has(this)) {
              touched.add(this);
              var rnd = rngFor("audio:" + this.length + ":" + this.sampleRate + ":" + this.numberOfChannels);
              for (var i = 0; i < d.length; i++) {
                d[i] = d[i] + (rnd() * 2 - 1) * level;
              }
            }
          } catch (e) {}
          return d;
        });
      }
      var AN = protoOf("AnalyserNode");
      if (AN) {
        ["getFloatFrequencyData", "getByteFrequencyData", "getFloatTimeDomainData", "getByteTimeDomainData"].forEach(function (m) {
          if (!AN[m]) return;
          var orig = AN[m];
          defFn(AN, m, function () {
            orig.apply(this, arguments);
            var a = arguments[0];
            if (!a || !a.length) return;
            var rnd = rngFor("analyser:" + m + ":" + a.length);
            var scale = m.indexOf("Byte") === 0 ? 1 : level * 10;
            for (var i = 0; i < a.length; i += 3) { a[i] = a[i] + (rnd() * 2 - 1) * scale; }
          });
        });
      }
      // ScriptProcessor / AudioWorklet 输出
      var SP = protoOf("ScriptProcessorNode");
      if (SP && SP.onaudioprocess !== undefined) {
        // 通过包装 addEventListener 注入噪声成本较高，保持默认（getChannelData 已覆盖）
      }
    })();
  }

  // ============================================================
  // 7. WebRTC
  // ============================================================
  if (CFG.webrtc) {
    (function () {
      var cfg = CFG.webrtc;
      if (cfg.mode === "real" || !cfg.mode) return;
      var Orig = W.RTCPeerConnection;
      if (!Orig) return;

      function scrubSdp(sdp) {
        if (typeof sdp !== "string") return sdp;
        var lines = sdp.split("\r\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (cfg.mode === "disabled") {
            if (l.indexOf("a=candidate:") === 0) continue;
            if (l.indexOf("c=IN IP4") === 0) { out.push("c=IN IP4 0.0.0.0"); continue; }
            if (l.indexOf("c=IN IP6") === 0) { out.push("c=IN IP6 ::"); continue; }
            out.push(l);
            continue;
          }
          // custom / proxy: 用指定 IP 替换
          if (l.indexOf("a=candidate:") === 0) {
            var isLocal = /\b(typ\s+host|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80)/i.test(l);
            if (isLocal) {
              if (cfg.localIps && cfg.localIps.length) {
                var lip = cfg.localIps[hashStr(l) % cfg.localIps.length];
                l = l.replace(/(a=candidate:\d+ \d+ \w+ \d+ )[\da-fA-F:.]+( \d+ )/, "$1" + lip + "$2");
                out.push(l);
              }
              continue; // 丢弃未映射的本地候选
            }
            if (cfg.publicIp) l = l.replace(/(a=candidate:\d+ \d+ \w+ \d+ )[\da-fA-F:.]+( \d+ )/, "$1" + cfg.publicIp + "$2");
            out.push(l);
            continue;
          }
          if (l.indexOf("c=IN IP4") === 0) { out.push("c=IN IP4 " + (cfg.publicIp || "0.0.0.0")); continue; }
          if (l.indexOf("c=IN IP6") === 0 && !cfg.publicIpv6) { continue; }
          out.push(l);
        }
        return out.join("\r\n");
      }

      function Wrapped(config) {
        var c = config || {};
        if (cfg.mode === "disabled") { c = Object.assign({}, c); c.iceServers = []; c.iceTransportPolicy = "relay"; }
        var pc = new Orig(c);
        // 抑制 icecandidate
        var origAdd = pc.addEventListener.bind(pc);
        pc.addEventListener = function (type, fn, opt) {
          if (type === "icecandidate") {
            if (cfg.mode === "disabled") { wrappedListeners.push(fn); return; }
            var w = function (ev) {
              try {
                if (ev.candidate && ev.candidate.candidate) {
                  var s = scrubSdp("a=candidate:" + ev.candidate.candidate + "\r\n");
                  if (!s.trim()) return; // 丢弃
                }
              } catch (e) {}
              return fn.call(this, ev);
            };
            return origAdd(type, w, opt);
          }
          return origAdd(type, fn, opt);
        };
        var wrappedListeners = [];
        try {
          Object.defineProperty(pc, "onicecandidate", {
            configurable: true,
            get: function () { return null; },
            set: function (fn) {
              if (cfg.mode === "disabled") { wrappedListeners.push(fn); return; }
              origAdd("icecandidate", function (ev) {
                try {
                  if (ev.candidate && ev.candidate.candidate) {
                    var s = scrubSdp("a=candidate:" + ev.candidate.candidate + "\r\n");
                    if (!s.trim()) return;
                  }
                } catch (e) {}
                if (fn) fn.call(pc, ev);
              });
            }
          });
        } catch (e) {}
        return pc;
      }
      Wrapped.prototype = Orig.prototype;
      Object.setPrototypeOf(Wrapped, Orig);
      try { defGet(W, "RTCPeerConnection", Wrapped, { enumerable: false, configurable: true }); } catch (e) {}

      ["createOffer", "createAnswer"].forEach(function (m) {
        if (!Orig.prototype[m]) return;
        var orig = Orig.prototype[m];
        defFn(Orig.prototype, m, function () {
          var p = orig.apply(this, arguments);
          if (!p || !p.then) return p;
          return p.then(function (desc) {
            try {
              if (desc && typeof desc.sdp === "string") {
                var ns = scrubSdp(desc.sdp);
                if (ns !== desc.sdp) return new RTCSessionDescription({ type: desc.type, sdp: ns });
              }
            } catch (e) {}
            return desc;
          });
        });
      });
      if (W.webkitRTCPeerConnection) {
        try { defGet(W, "webkitRTCPeerConnection", Wrapped, { enumerable: false, configurable: true }); } catch (e) {}
      }
    })();
  }

  // ============================================================
  // 8. 字体
  // ============================================================
  if (CFG.fonts && CFG.fonts.mode && CFG.fonts.mode !== "system" && CFG.fonts.list && CFG.fonts.list.length) {
    (function () {
      var allowed = {};
      CFG.fonts.list.forEach(function (f) { allowed[f.toLowerCase()] = true; });
      // 系统必然存在的基础字体不拦截，避免误判
      ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "math", "emoji", "fangsong",
       "arial", "times new roman", "courier new", "helvetica", "times", "courier", "verdana", "tahoma",
       "georgia", "trebuchet ms", "impact", "comic sans ms"].forEach(function (f) { allowed[f] = true; });

      try {
        var FS = protoOf("FontFaceSet");
        if (FS && FS.check) {
          var origCheck = FS.check;
          defFn(FS, "check", function check(font, text) {
            try {
              var m = /^\s*(['"]?)([^'"]+)\1\s*$/.exec(String(font || "").split(",").pop() || "");
              var fam = (m ? m[2] : String(font || "")).trim().toLowerCase();
              if (fam && !allowed[fam]) return false;
            } catch (e) {}
            return origCheck.call(this, font, text);
          });
        }
      } catch (e) {}

      // strict 模式：用本地字体覆盖未授权字体，阻断度量探测
      if (CFG.fonts.mode === "strict" && CFG.fonts.substitutes) {
        try {
          var css = [];
          for (var fam in CFG.fonts.substitutes) {
            var sub = CFG.fonts.substitutes[fam];
            css.push("@font-face{font-family:'" + fam.replace(/'/g, "") + "';src:local('" + sub.replace(/'/g, "") + "');}");
          }
          if (css.length) {
            var st = D.createElement("style");
            st.setAttribute("data-v", "1");
            st.textContent = css.join("");
            (D.head || D.documentElement).appendChild(st);
          }
        } catch (e) {}
      }
    })();
  }

  // ============================================================
  // 9. 媒体设备
  // ============================================================
  if (CFG.media && CFG.media.enabled) {
    (function () {
      var cfg = CFG.media;
      function mkId(kind, i) {
        var rnd = rngFor("dev:" + kind + ":" + i);
        var s = "";
        for (var k = 0; k < 64; k++) s += "0123456789abcdef"[Math.floor(rnd() * 16)];
        return s;
      }
      var devices = [];
      for (var i = 0; i < (cfg.audioInputs || 0); i++) devices.push({ deviceId: mkId("ai", i), kind: "audioinput", label: "", groupId: mkId("g", i) });
      for (var j = 0; j < (cfg.audioOutputs || 0); j++) devices.push({ deviceId: mkId("ao", j), kind: "audiooutput", label: "", groupId: mkId("g", j) });
      for (var k = 0; k < (cfg.videoInputs || 0); k++) devices.push({ deviceId: mkId("vi", k), kind: "videoinput", label: "", groupId: mkId("g", k + 50) });
      var frozen = devices.map(function (d) {
        var o = {};
        ["deviceId", "kind", "label", "groupId"].forEach(function (p) { defGet(o, p, d[p], { enumerable: true }); });
        o.toJSON = function () { return { deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId }; };
        disguise(o.toJSON, "function toJSON() { [native code] }");
        return o;
      });
      var MD = protoOf("MediaDevices");
      if (MD && MD.enumerateDevices) {
        defFn(MD, "enumerateDevices", function enumerateDevices() { return Promise.resolve(frozen.slice()); });
      }
      if (MD && MD.getUserMedia && (cfg.videoInputs || 0) === 0) {
        var origGUM = MD.getUserMedia;
        defFn(MD, "getUserMedia", function getUserMedia(constraints) {
          if (constraints && constraints.video) {
            return Promise.reject(new DOMException("Requested device not found", "NotFoundError"));
          }
          return origGUM.call(this, constraints);
        });
      }
    })();
  }

  // ============================================================
  // 10. 电池
  // ============================================================
  if (CFG.battery && CFG.battery.enabled) {
    (function () {
      var lvl = typeof CFG.battery.level === "number" ? CFG.battery.level : 0.86;
      var charging = CFG.battery.charging === true;
      function fakeBattery() {
        var t = {};
        var ET = protoOf("EventTarget") || Object;
        defGet(t, "charging", charging);
        defGet(t, "chargingTime", charging ? 0 : Infinity);
        defGet(t, "dischargingTime", charging ? Infinity : Math.round(lvl * 21600));
        defGet(t, "level", lvl);
        t.addEventListener = function () {}; t.removeEventListener = function () {}; t.dispatchEvent = function () { return true; };
        ["addEventListener", "removeEventListener", "dispatchEvent"].forEach(function (m) { disguise(t[m], "function " + m + "() { [native code] }"); });
        t.onchargingchange = null; t.onchargingtimechange = null; t.ondischargingtimechange = null; t.onlevelchange = null;
        return t;
      }
      defFn(protoOf("Navigator"), "getBattery", function getBattery() { return Promise.resolve(fakeBattery()); });
    })();
  }

  // ============================================================
  // 11. Permissions / Notification 一致性
  // ============================================================
  if (CFG.permissions && CFG.permissions.enabled) {
    (function () {
      var PM = protoOf("Permissions");
      if (!PM || !PM.query) return;
      var orig = PM.query;
      defFn(PM, "query", function query(desc) {
        var name = desc && desc.name;
        return orig.call(this, desc).then(function (st) {
          try {
            var map = { notifications: "prompt", camera: "prompt", microphone: "prompt", geolocation: CFG.geo ? "granted" : "prompt", midi: "granted", "background-sync": "granted", "persistent-storage": "prompt" };
            if (map[name] !== undefined && st.state !== "denied") {
              defGet(Object.getPrototypeOf(st), "state", map[name]);
            }
          } catch (e) {}
          return st;
        }, function (e) { throw e; });
      });
    })();
  }

  // ============================================================
  // 12. SpeechSynthesis 语音列表（泄漏语言/系统）
  // ============================================================
  if (CFG.speech && CFG.speech.enabled) {
    (function () {
      var langs = (CFG.navigator && CFG.navigator.languages) || ["en-US"];
      var prefix = langs.map(function (l) { return l.split("-")[0].toLowerCase(); });
      var SS = protoOf("SpeechSynthesis");
      if (!SS || !SS.getVoices) return;
      var orig = SS.getVoices;
      var cache = null;
      defFn(SS, "getVoices", function getVoices() {
        if (cache) return cache;
        try {
          var all = orig.call(this) || [];
          cache = all.filter(function (v) {
            var l = (v.lang || "").toLowerCase();
            return prefix.some(function (p) { return l.indexOf(p) === 0; });
          });
          if (!cache.length) cache = all.slice(0, 2);
        } catch (e) { cache = []; }
        return cache;
      });
    })();
  }

  // ============================================================
  // 13. navigator.connection
  // ============================================================
  if (CFG.connection && CFG.connection.enabled) {
    (function () {
      var NP2 = protoOf("Navigator");
      var rnd = rngFor("conn");
      var et = CFG.connection.effectiveType || "4g";
      var downlink = et === "4g" ? (5 + Math.floor(rnd() * 60) + rnd()) : (1 + rnd() * 4);
      var rtt = et === "4g" ? [50, 100, 150, 200][Math.floor(rnd() * 4)] : 200;
      var o = {};
      defGet(o, "effectiveType", et);
      defGet(o, "downlink", Math.round(downlink * 10) / 10);
      defGet(o, "rtt", rtt);
      defGet(o, "saveData", false);
      defGet(o, "type", CFG.navigator && CFG.navigator.maxTouchPoints > 0 ? "cellular" : undefined);
      o.addEventListener = function () {}; o.removeEventListener = function () {}; o.dispatchEvent = function () { return true; };
      defGet(NP2, "connection", o);
    })();
  }

  // ============================================================
  // 14. plugins / mimeTypes
  // ============================================================
  if (CFG.plugins && CFG.plugins.enabled !== undefined) {
    (function () {
      var NP3 = protoOf("Navigator");
      function mkMime(type, desc, suffixes) {
        var m = { type: type, description: desc, suffixes: suffixes, enabledPlugin: null };
        var o = {};
        ["type", "description", "suffixes"].forEach(function (p) { defGet(o, p, m[p]); });
        defGet(o, "enabledPlugin", null, { configurable: true });
        return o;
      }
      function mkPlugin(name, desc, filename, mimes) {
        var o = {};
        defGet(o, "name", name); defGet(o, "description", desc); defGet(o, "filename", filename);
        defGet(o, "length", mimes.length);
        mimes.forEach(function (m, i) { defGet(o, String(i), m); m.enabledPlugin = o; });
        o.item = function (i) { return mimes[i] || null; };
        o.namedItem = function (n) { for (var i = 0; i < mimes.length; i++) if (mimes[i].type === n || mimes[i].description === n) return mimes[i]; return null; };
        disguise(o.item, "function item() { [native code] }");
        disguise(o.namedItem, "function namedItem() { [native code] }");
        return o;
      }
      var plugins = [], mimeTypes = [];
      if (CFG.plugins.enabled) {
        var defs = [
          ["PDF Viewer", "Portable Document Format", "internal-pdf-viewer", [["application/pdf", "Portable Document Format", "pdf"]]],
          ["Chrome PDF Viewer", "Portable Document Format", "internal-pdf-viewer", [["application/pdf", "Portable Document Format", "pdf"]]],
          ["Chromium PDF Viewer", "Portable Document Format", "internal-pdf-viewer", [["application/pdf", "Portable Document Format", "pdf"]]],
          ["Microsoft Edge PDF Viewer", "Portable Document Format", "internal-pdf-viewer", [["application/pdf", "Portable Document Format", "pdf"]]],
          ["WebKit built-in PDF", "Portable Document Format", "internal-pdf-viewer", [["application/pdf", "Portable Document Format", "pdf"]]]
        ];
        var n = Math.min(defs.length, CFG.plugins.count === undefined ? 5 : CFG.plugins.count);
        for (var i = 0; i < n; i++) {
          var ms = defs[i][3].map(function (x) { return mkMime(x[0], x[1], x[2]); });
          var p = mkPlugin(defs[i][0], defs[i][1], defs[i][2], ms);
          plugins.push(p);
          ms.forEach(function (m) { if (!mimeTypes.some(function (q) { return q.type === m.type; })) mimeTypes.push(m); });
        }
        var tp = mkMime("text/pdf", "Portable Document Format", "pdf");
        mimeTypes.push(tp);
      }
      function mkArray(items, protoName) {
        var o = {};
        defGet(o, "length", items.length);
        items.forEach(function (it, i) { defGet(o, String(i), it); });
        o.item = function (i) { return items[i] || null; };
        o.namedItem = function (n) { for (var i = 0; i < items.length; i++) if (items[i].name === n || items[i].type === n) return items[i]; return null; };
        o.refresh = function () {};
        o[Symbol.iterator] = function () { var i = 0; return { next: function () { return i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }; } }; };
        ["item", "namedItem", "refresh"].forEach(function (m) { disguise(o[m], "function " + m + "() { [native code] }"); });
        disguise(o[Symbol.iterator], "function [Symbol.iterator]() { [native code] }");
        return o;
      }
      defGet(NP3, "plugins", mkArray(plugins, "PluginArray"));
      defGet(NP3, "mimeTypes", mkArray(mimeTypes, "MimeTypeArray"));
      if (protoOf("PluginArray")) defFn(protoOf("PluginArray"), "refresh", function refresh() {});
    })();
  }

  // ============================================================
  // 15. storage.estimate（磁盘容量泄漏）
  // ============================================================
  if (CFG.storage && CFG.storage.quota) {
    (function () {
      var SM = W.navigator && W.navigator.storage;
      if (!SM) return;
      var proto = Object.getPrototypeOf(SM);
      if (!proto || !proto.estimate) return;
      var q = CFG.storage.quota, u = CFG.storage.usage;
      defFn(proto, "estimate", function estimate() {
        return Promise.resolve({ quota: q, usage: u, usageDetails: u ? { fileSystems: u } : {} });
      });
    })();
  }

  // ============================================================
  // 16. 自动化痕迹清理
  // ============================================================
  (function () {
    try { if (N.webdriver === true) defGet(protoOf("Navigator"), "webdriver", false); } catch (e) {}
    try {
      // 移除 CDP / 自动化框架可能留下的标记
      ["cdc_", "$cdc_", "__webdriver", "_selenium", "callSelenium", "__driver_evaluate", "__webdriver_evaluate",
       "__selenium_evaluate", "__fxdriver_evaluate", "domAutomation", "domAutomationController"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(W, k)) { try { delete W[k]; } catch (e) {} }
        if (D && Object.prototype.hasOwnProperty.call(D, k)) { try { delete D[k]; } catch (e) {} }
      });
    } catch (e) {}
    try {
      // Permissions 与 Notification 一致
      if (CFG.permissions && CFG.permissions.enabled && W.Notification && Notification.permission !== "default") {
        defGet(protoOf("Notification"), "permission", "default");
      }
    } catch (e) {}
    try {
      // window.chrome 存在性（有头 Chrome 本身具备，此处仅确保不被删除后暴露）
      if (!W.chrome) { W.chrome = {}; }
      if (!W.chrome.app) { W.chrome.app = { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } }; }
    } catch (e) {}
    try {
      // Error.prepareStackTrace / 堆栈中的注入痕迹：让本脚本函数名看起来正常
    } catch (e) {}
  })();

  // ============================================================
  // 17. 自定义启动脚本
  // ============================================================
  if (CFG.automation && CFG.automation.length) {
    CFG.automation.forEach(function (src) {
      try { (0, eval)(src); } catch (e) {}
    });
  }
})();
