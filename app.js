(function () {
  'use strict';

  var TZ = 'Asia/Colombo';
  var KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* The document this page republishes about itself. It must match index.html. */
  var RESET = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
  var HEAD = '<title>Sanya Indoor Stadium</title><meta name="claude:viewport-fit-sides" content="cover"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap"><link rel="stylesheet" href="style.css"><div id="app"></div>';
  function buildIndex(st) {
    var json = JSON.stringify(st).replace(/</g, '\\u003c');
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + RESET + '</style></head><body>' +
      HEAD + '<script type="application/json" id="state">' + json + '</script><script src="app.js"></script></body></html>';
  }

  /* ---------- helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function stable(o) {
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  function seq(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function nowHour() {
    return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()), 10) % 24;
  }
  function addDays(s, n) {
    var p = s.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function dowIdx(s) {
    var p = s.split('-').map(Number);
    return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7;
  }
  function dayNum(s) { return parseInt(s.slice(8), 10); }
  function monName(s) { return MON[parseInt(s.slice(5, 7), 10) - 1]; }
  function longDate(s) { return NAMES[KEYS[dowIdx(s)]] + ', ' + dayNum(s) + ' ' + monName(s); }
  function shortDate(s) { return NAMES[KEYS[dowIdx(s)]].slice(0, 3) + ' ' + dayNum(s) + ' ' + monName(s); }
  function fmtH(h) { h = ((h % 24) + 24) % 24; return (h % 12 === 0 ? 12 : h % 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fmtRange(s, e) { return fmtH(s) + ' – ' + fmtH(e); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function ranges(hs) {
    hs = hs.slice().sort(function (a, b) { return a - b; });
    var out = [], s = null, p = null;
    hs.forEach(function (h) {
      if (s === null) { s = p = h; } else if (h === p + 1) { p = h; } else { out.push([s, p + 1]); s = p = h; }
    });
    if (s !== null) out.push([s, p + 1]);
    return out;
  }
  function money(n) { return 'LKR ' + Number(n).toLocaleString('en-US'); }

  /* ---------- state ---------- */
  var app = document.getElementById('app');
  var pub = JSON.parse(document.getElementById('state').textContent);
  var cfg = clone(pub.config);
  var bookings = [];
  var db = null, artifact = null, isOwner = false;
  var cfgTimer = null, cfgWriting = false, cfgPending = false, loadTimer = null;
  var ui = {
    date: todayStr(), court: null, period: null, tab: 'schedule', mode: 'manage', sel: {}, form: null, err: '', confirmDel: false,
    filter: 'upcoming', q: '', loaded: false, loadErr: false, publishing: false, msg: '', copied: false
  };

  function normWa(v) {
    var d = String(v).replace(/\D/g, '');
    if (d.length === 10 && d.charAt(0) === '0') d = '94' + d.slice(1);
    return d.slice(0, 15);
  }
  function localNum(d) {
    d = String(d || '');
    var n = d.indexOf('94') === 0 ? '0' + d.slice(2) : d;
    return n.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
  }
  function single() { return cfg.courts.length === 1; }
  function str(v, max, def) { v = (typeof v === 'string') ? v.trim().slice(0, max) : ''; return v || def || ''; }
  function sanitizeCfg(c) {
    var d = pub.config;
    c = (c && typeof c === 'object') ? c : {};
    var out = { name: str(c.name, 80, d.name), area: str(c.area, 60, d.area), address: str(c.address, 200, d.address), notice: str(c.notice, 300, '') };
    out.offerOn = (c.offerOn === undefined ? d.offerOn !== false : c.offerOn !== false);
    out.offerOff = Math.min(100000, Math.max(0, c.offerOff === undefined ? (parseInt(d.offerOff, 10) || 0) : (parseInt(c.offerOff, 10) || 0)));
    var ph = Array.isArray(c.phones) ? c.phones : [];
    out.phones = [0].map(function (i) { return typeof ph[i] === 'string' ? ph[i].replace(/[^0-9+()\s-]/g, '').trim().slice(0, 24) : ''; });
    var wa = Array.isArray(c.whatsapps) ? c.whatsapps : (c.whatsapp ? [c.whatsapp] : []);
    out.whatsapps = [0, 1].map(function (i) { return (typeof wa[i] === 'string' || typeof wa[i] === 'number') ? normWa(wa[i]) : ''; });
    out.hours = {};
    KEYS.forEach(function (k) {
      var h = (c.hours && c.hours[k]) || d.hours[k] || { open: true, from: 0, to: 24 };
      var from = Math.min(23, Math.max(0, parseInt(h.from, 10) || 0)), to = Math.min(24, Math.max(1, parseInt(h.to, 10) || 24));
      if (to <= from) { from = 0; to = 24; }
      out.hours[k] = { open: h.open !== false, from: from, to: to };
    });
    out.closures = (Array.isArray(c.closures) ? c.closures : []).filter(function (x) { return x && validDate(x.date); }).slice(0, 200)
      .map(function (x) { return { date: x.date, label: str(x.label, 80, '') }; });
    out.courts = (Array.isArray(c.courts) ? c.courts : []).filter(function (x) { return x && typeof x.id === 'string' && /^[a-z0-9_-]{1,20}$/.test(x.id); }).slice(0, 4)
      .map(function (x) { return { id: x.id, name: str(x.name, 40, x.id), rate: Math.min(1000000, Math.max(0, parseInt(x.rate, 10) || 0)) }; });
    if (!out.courts.length) out.courts = clone(d.courts);
    return out;
  }
  function normCfg(c) { return sanitizeCfg(c); }
  function cleanBooking(d, id) {
    d = d || {};
    return {
      id: id, kind: d.kind === 'block' ? 'block' : 'booking', date: validDate(d.date) ? d.date : todayStr(), court: String(d.court || '').slice(0, 20),
      start: Math.min(23, Math.max(0, parseInt(d.start, 10) || 0)), hours: Math.min(24, Math.max(1, parseInt(d.hours, 10) || 1)),
      name: String(d.name || '').slice(0, 80), phone: String(d.phone || '').slice(0, 30),
      status: ['confirmed', 'pending', 'cancelled'].indexOf(d.status) >= 0 ? d.status : 'confirmed', note: String(d.note || '').slice(0, 200), createdAt: String(d.createdAt || '')
    };
  }
  cfg = normCfg(cfg);

  /* ---------- schedule logic ---------- */
  function dayInfo(date) {
    var c = (cfg.closures || []).find(function (x) { return x.date === date; });
    if (c) return { open: false, reason: c.label || 'Closed' };
    var d = cfg.hours[KEYS[dowIdx(date)]];
    if (!d || !d.open) return { open: false, reason: 'Closed' };
    return { open: true, from: d.from, to: d.to };
  }
  function hoursText(d) { return (d.from === 0 && d.to === 24) ? 'Open 24 hours' : fmtRange(d.from, d.to); }
  function openStatus() {
    var t = todayStr(), h = nowHour(), i = dayInfo(t);
    if (i.open && h >= i.from && h < i.to) {
      return { open: true, text: (i.from === 0 && i.to === 24) ? 'Open now · 24 hours' : 'Open now · until ' + fmtH(i.to) };
    }
    for (var n = 0; n <= 7; n++) {
      var d = addDays(t, n), x = dayInfo(d);
      if (x.open && (n > 0 || h < x.from)) {
        return { open: false, text: 'Closed now · opens ' + (n === 0 ? 'at ' + fmtH(x.from) : n === 1 ? 'tomorrow ' + fmtH(x.from) : shortDate(d) + ' ' + fmtH(x.from)) };
      }
    }
    return { open: false, text: 'Closed now' };
  }
  function computeBusy(list) {
    var out = {}, t = todayStr();
    list.forEach(function (b) {
      if (b.status === 'cancelled' || b.date < t || !cfg.courts.some(function (c) { return c.id === b.court; })) return;
      for (var k = 0; k < b.hours; k++) {
        var h = b.start + k;
        if (h > 23) break;
        var o = out[b.date] || (out[b.date] = {});
        var a = o[b.court] || (o[b.court] = []);
        if (a.indexOf(h) < 0) a.push(h);
      }
    });
    Object.keys(out).forEach(function (d) {
      Object.keys(out[d]).forEach(function (c) { out[d][c].sort(function (a, b) { return a - b; }); });
    });
    return out;
  }
  function canonBusy(b) {
    var t = todayStr(), r = [];
    Object.keys(b || {}).sort().forEach(function (d) {
      if (d < t) return;
      Object.keys(b[d]).sort().forEach(function (c) {
        r.push(d + '|' + c + '|' + b[d][c].slice().sort(function (x, y) { return x - y; }).join(','));
      });
    });
    return r.join(';');
  }
  function liveBusy() { return isOwner ? computeBusy(bookings) : (pub.busy || {}); }
  function isTaken(date, court, h) {
    var b = liveBusy();
    return !!(b[date] && b[date][court] && b[date][court].indexOf(h) >= 0);
  }
  function isPast(date, h) {
    var t = todayStr();
    return date < t || (date === t && h < nowHour());
  }
  function isDirty() {
    return stable(sanitizeCfg(cfg)) !== stable(pub.config) || canonBusy(computeBusy(bookings)) !== canonBusy(pub.busy);
  }
  function courtName(id) {
    var c = cfg.courts.find(function (x) { return x.id === id; });
    return c ? c.name : id;
  }
  function coverAt(date, court, h) {
    return bookings.find(function (b) {
      return b.status !== 'cancelled' && b.date === date && b.court === court && h >= b.start && h < b.start + b.hours;
    });
  }

  /* ---------- customer view ---------- */
  function waText() {
    var keys = Object.keys(ui.sel);
    if (!keys.length) return 'Hi ' + cfg.name + ', I would like to check availability.';
    var lines = keys.map(function (c) {
      return ranges(ui.sel[c]).map(function (r) { return '• ' + (single() ? '' : courtName(c) + ': ') + fmtRange(r[0], r[1]); }).join('\n');
    }).join('\n');
    return 'Hi ' + cfg.name + ', I would like to book on ' + shortDate(ui.date) + ':\n' + lines + '\nName: ';
  }
  function waLinks() {
    return (cfg.whatsapps || []).filter(Boolean).map(function (n) {
      return { label: localNum(n), href: 'https://wa.me/' + n + '?text=' + encodeURIComponent(waText()) };
    });
  }

  function headerHTML() {
    var st = openStatus();
    var nav = '';
    if (isOwner && ui.mode === 'manage') {
      var tab = function (k, label) { return '<button data-act="tab" data-tab="' + k + '" class="' + (ui.tab === k ? 'on' : '') + '">' + label + '</button>'; };
      nav = '<nav class="tabs" aria-label="Manage">' + tab('schedule', 'Schedule') + tab('bookings', 'Bookings') + tab('settings', 'Hours &amp; info') +
        '<span class="sp"></span><button data-act="preview">Customer view</button></nav>';
    } else if (isOwner) {
      nav = '<div class="previewbar"><span>Previewing what customers see</span><button class="btn small ghost-light" data-act="unpreview">Back to manage</button></div>';
    }
    return '<header class="top"><div class="wrap"><div class="top-in"><div class="brand"><img class="logo" src="img/logo.jpg" width="256" height="222" alt="Sanya Indoor Stadium logo"><div><p class="eyebrow">Cricket &amp; futsal · ' + esc(cfg.area || '') + '</p><h1>' + esc(cfg.name) + '</h1><p class="addr">' + esc(cfg.address) + '</p></div></div>' +
      '<div class="status ' + (st.open ? 'on' : 'off') + '"><span class="dot"></span>' + esc(st.text) + '</div></div>' + nav + '</div></header>';
  }

  function stripHTML() {
    var t = todayStr(), out = '';
    for (var i = 0; i < 14; i++) {
      var d = addDays(t, i), info = dayInfo(d);
      out += '<button class="day' + (d === ui.date ? ' on' : '') + (info.open ? '' : ' dim') + '" data-act="pick-date" data-date="' + d + '" aria-pressed="' + (d === ui.date) + '">' +
        '<span class="w">' + NAMES[KEYS[dowIdx(d)]].slice(0, 3) + '</span><span class="n">' + dayNum(d) + '</span><span class="m">' + monName(d) + '</span></button>';
    }
    return '<div class="strip" role="group" aria-label="Choose a date">' + out + '</div>';
  }

  function updatedText() {
    if (!pub.updatedAt) return 'recently';
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(pub.updatedAt)); } catch (e) { return 'recently'; }
  }

  var PERIODS = [
    { k: 'late', label: 'Late night', from: 0, to: 6 },
    { k: 'morning', label: 'Morning', from: 6, to: 12 },
    { k: 'afternoon', label: 'Afternoon', from: 12, to: 18 },
    { k: 'evening', label: 'Evening', from: 18, to: 24 }
  ];
  function curCourt() {
    if (!cfg.courts.some(function (c) { return c.id === ui.court; })) ui.court = cfg.courts[0].id;
    return ui.court;
  }
  function freeCount(date, court, p, info) {
    var n = 0;
    for (var h = Math.max(p.from, info.from); h < Math.min(p.to, info.to); h++) { if (!isPast(date, h) && !isTaken(date, court, h)) n++; }
    return n;
  }
  function periodKey(info, visible) {
    var court = curCourt();
    if (ui.period && visible.some(function (p) { return p.k === ui.period; })) return ui.period;
    var order = ['evening', 'afternoon', 'morning', 'late'];
    for (var i = 0; i < order.length; i++) {
      var p = visible.find(function (x) { return x.k === order[i]; });
      if (p && freeCount(ui.date, court, p, info) > 0) return p.k;
    }
    return visible[0].k;
  }
  function bookHTML() {
    var info = dayInfo(ui.date), court = curCourt();
    var sports = cfg.courts.map(function (c) {
      var on = c.id === court;
      return '<button class="sport' + (on ? ' on' : '') + '" data-act="pick-court" data-court="' + esc(c.id) + '" aria-pressed="' + on + '">' + esc(c.name) + (c.rate > 0 ? '<small>' + money(c.rate) + ' per hour</small>' : '') + '</button>';
    }).join('');
    var rate = cfg.courts[0] && cfg.courts[0].rate > 0 ? '<p class="price">' + money(cfg.courts[0].rate) + ' per hour</p>' : '';
    var top = single()
      ? '<section class="card"><h2>Book a slot</h2>' + rate + '<p class="step">1 · Choose a day</p>' + stripHTML() + '<p class="step">2 · Choose your hours</p>'
      : '<section class="card"><h2>Book a slot</h2><p class="step">1 · Choose a sport</p><div class="sports">' + sports + '</div><p class="step">2 · Choose a day</p>' + stripHTML() + '<p class="step">3 · Choose your hours</p>';
    if (!info.open) {
      return top + '<div class="closedmsg">We are closed on ' + esc(longDate(ui.date)) + (info.reason && info.reason !== 'Closed' ? ' (' + esc(info.reason) + ')' : '') + '. Please pick another day.</div></section>';
    }
    var visible = PERIODS.filter(function (p) { return p.to > info.from && p.from < info.to; });
    var per = periodKey(info, visible), pp = visible.find(function (x) { return x.k === per; });
    var tabs = visible.map(function (p) {
      var n = freeCount(ui.date, court, p, info), on = p.k === per;
      return '<button class="per' + (on ? ' on' : '') + '" data-act="pick-period" data-p="' + p.k + '" aria-pressed="' + on + '"><span>' + p.label + '</span><small>' + n + ' free</small></button>';
    }).join('');
    var chips = '', sel = ui.sel[court] || [];
    for (var h = Math.max(pp.from, info.from); h < Math.min(pp.to, info.to); h++) {
      var past = isPast(ui.date, h), taken = isTaken(ui.date, court, h), on = sel.indexOf(h) >= 0;
      if (past || taken) {
        chips += '<button class="chip' + (taken ? ' taken' : '') + '" disabled><span class="t">' + fmtH(h) + '</span><span class="s">' + (taken ? 'Booked' : 'Past') + '</span></button>';
      } else {
        chips += '<button class="chip' + (on ? ' sel' : '') + '" data-act="toggle-slot" data-court="' + esc(court) + '" data-h="' + h + '" aria-pressed="' + on + '"><span class="t">' + fmtH(h) + '</span><span class="s">' + (on ? 'Selected' : 'Free') + '</span></button>';
      }
    }
    return top + '<div class="pers" role="group" aria-label="Time of day">' + tabs + '</div><div class="chips">' + chips + '</div>' +
      '<p class="small muted hint">Each box is one hour. Tap a few in a row for a longer game, then send your request on WhatsApp. We confirm by reply.</p></section>';
  }

  function sendbarHTML() {
    var keys = Object.keys(ui.sel);
    if (!keys.length) return '';
    var c = keys[0], hrs = ui.sel[c];
    var rs = ranges(hrs).map(function (r) { return fmtRange(r[0], r[1]); }).join(', ');
    var ct = cfg.courts.find(function (x) { return x.id === c; });
    var total = '';
    if (ct && ct.rate > 0) {
      var sum = ct.rate * hrs.length, deal = cfg.offerOn && cfg.offerOff > 0 && hrs.length === 2;
      total = ' · ' + money(deal ? sum - cfg.offerOff : sum) + (deal ? ' (2 hour offer)' : '');
    }
    var links = waLinks(), phones = (cfg.phones || []).filter(Boolean);
    var act = links.map(function (l, i) {
      return '<a class="btn ' + (i === 0 ? 'ball' : '') + '" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">WhatsApp ' + esc(l.label) + '</a>';
    }).join('') || (phones[0] ? '<span class="small">Call <strong>' + esc(phones[0]) + '</strong></span>' : '');
    return '<div class="sendbar"><div class="wrap sendbar-in"><div class="sendtxt"><strong>' + (single() ? '' : esc(courtName(c)) + ' · ') + esc(shortDate(ui.date)) + '</strong><span>' + esc(rs) + esc(total) + '</span></div>' +
      '<div class="row"><button class="btn small" data-act="clear-sel">Clear</button>' + act + '</div></div></div>';
  }

  var PHOTOS = [
    { src: 'img/court.jpg', alt: 'Players on the indoor cricket court seen through the net', cap: 'Cricket court', pos: 'center 60%' },
    { src: 'img/futsal.jpg', alt: 'Friends playing futsal on the green indoor court', cap: 'Futsal court', pos: 'center 55%' },
    { src: 'img/machine.jpg', alt: 'Twin-wheel bowling machine on a tripod inside a net', cap: 'Bowling machine', pos: 'center 30%' },
    { src: 'img/controls.jpg', alt: 'Bowling machine controls and speed chart', cap: 'Machine controls', pos: 'center' }
  ];
  function galleryHTML() {
    return '<section class="card"><h2>The courts</h2><div class="gallery">' + PHOTOS.map(function (p) {
      return '<figure><img src="' + p.src + '" alt="' + esc(p.alt) + '" loading="lazy" style="object-position:' + p.pos + '"><figcaption>' + esc(p.cap) + '</figcaption></figure>';
    }).join('') + '</div></section>';
  }

  function infoHTML() {
    var t = todayStr(), today = KEYS[dowIdx(t)];
    var same = KEYS.every(function (k) { return stable(cfg.hours[k]) === stable(cfg.hours.mon); });
    var hrs;
    if (same) {
      hrs = '<p class="bigline">' + (cfg.hours.mon.open ? 'Every day · ' + esc(hoursText(cfg.hours.mon)) : 'Closed') + '</p>';
    } else {
      hrs = '<div class="hours">' + KEYS.map(function (k) {
        var d = cfg.hours[k];
        return '<div class="' + (k === today ? 'today' : '') + '"><span>' + NAMES[k] + '</span><span>' + (d.open ? esc(hoursText(d)) : 'Closed') + '</span></div>';
      }).join('') + '</div>';
    }
    var cl = (cfg.closures || []).filter(function (c) { return c.date >= t; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var clHTML = cl.length ? '<div class="closures"><h3>Closed dates</h3>' + cl.map(function (c) {
      return '<p>' + esc(shortDate(c.date)) + (c.label ? ' <span class="muted">· ' + esc(c.label) + '</span>' : '') + '</p>';
    }).join('') + '</div>' : '';
    var phones = (cfg.phones || []).filter(Boolean);
    return '<section class="card"><div class="contact-grid"><div><h2>Opening hours</h2>' + hrs + clHTML + '</div>' +
      '<div><h2>Find us</h2><dl class="contact-grid"><div><dt>Address</dt><dd>' + esc(cfg.address) + '</dd></div>' +
      (phones.length ? '<div><dt>Phone</dt><dd>' + phones.map(esc).join('<br>') + '</dd></div>' : '') + '</dl></div></div>' +
      '<p class="small muted">Availability last updated ' + esc(updatedText()) + '.</p></section>';
  }

  function offerHTML() {
    if (!cfg.offerOn) return '';
    var rate = cfg.courts[0] ? cfg.courts[0].rate : 0, two = rate * 2;
    var line = (rate > 0 && cfg.offerOff > 0)
      ? 'Book 2 hours and pay ' + money(two - cfg.offerOff) + ' instead of ' + money(two) + '.'
      : 'Ask us about our current offer.';
    return '<section class="card offer"><h2>Special offer</h2><figure><img src="img/offer.jpg" width="1136" height="943" alt="Special offer poster: futsal with your mates? Book our indoor court. Hourly rate 3000 LKR. Book 2 hours and get 500 LKR off, only 5,500 LKR instead of 6,000 LKR."><figcaption>' + esc(line) + '</figcaption></figure></section>';
  }

  function customerView() {
    return headerHTML() + (cfg.notice ? '<div class="notice" role="status">' + esc(cfg.notice) + '</div>' : '') +
      '<main class="wrap pad">' + offerHTML() + bookHTML() + galleryHTML() + infoHTML() + '</main>' + sendbarHTML();
  }

  /* ---------- owner: schedule ---------- */
  function newForm(court, h, date) {
    return { id: '', kind: 'booking', date: date || ui.date, court: court || cfg.courts[0].id, start: h == null ? 18 : h, hours: 1, name: '', phone: '', status: 'confirmed', note: '' };
  }
  function formHTML() {
    var f = ui.form;
    if (!f) return '';
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var isBlock = f.kind === 'block';
    return '<section class="card formcard"><h2>' + (f.id ? 'Edit booking' : 'New booking') + '</h2><div class="form-grid">' +
      '<div class="field"><label for="f-kind">Type</label><select id="f-kind" data-act-change="form-kind">' + opt('booking', 'Customer booking', f.kind) + opt('block', 'Block out time', f.kind) + '</select></div>' +
      '<div class="field"><label for="f-name">' + (isBlock ? 'Reason' : 'Customer name') + '</label><input id="f-name" type="text" maxlength="80" value="' + esc(f.name) + '" autocomplete="off"></div>' +
      (isBlock ? '' : '<div class="field"><label for="f-phone">Phone</label><input id="f-phone" type="text" inputmode="tel" maxlength="30" value="' + esc(f.phone) + '" autocomplete="off"></div>') +
      (single() ? '' : '<div class="field"><label for="f-court">Court</label><select id="f-court">' + cfg.courts.map(function (c) { return opt(c.id, c.name, f.court); }).join('') + '</select></div>') +
      '<div class="field"><label for="f-date">Date</label><input id="f-date" type="date" value="' + esc(f.date) + '"></div>' +
      '<div class="field"><label for="f-start">Starts</label><select id="f-start">' + seq(0, 23).map(function (h) { return opt(h, fmtH(h), f.start); }).join('') + '</select></div>' +
      '<div class="field"><label for="f-hours">Length</label><select id="f-hours">' + seq(1, 8).map(function (n) { return opt(n, n + (n === 1 ? ' hour' : ' hours'), f.hours); }).join('') + '</select></div>' +
      (isBlock ? '' : '<div class="field"><label for="f-status">Status</label><select id="f-status">' + opt('confirmed', 'Confirmed', f.status) + opt('pending', 'Pending', f.status) + opt('cancelled', 'Cancelled', f.status) + '</select></div>') +
      (isBlock ? '' : '<div class="field span2"><label for="f-note">Note</label><input id="f-note" type="text" maxlength="200" value="' + esc(f.note) + '" autocomplete="off"></div>') +
      '</div>' + (ui.err ? '<p class="err" role="alert">' + esc(ui.err) + '</p>' : '') +
      '<div class="actions"><button class="btn primary" data-act="save-booking">Save</button><button class="btn" data-act="cancel-form">Close</button><span class="sp"></span>' +
      (f.id ? (ui.confirmDel ? '<span class="small">Delete for good?</span><button class="btn danger" data-act="delete-yes">Yes, delete</button><button class="btn" data-act="delete-no">Keep</button>' : '<button class="btn danger" data-act="delete-ask">Delete</button>') : '') + '</div></section>';
  }
  function readForm() {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var f = ui.form;
    f.kind = g('f-kind') || f.kind;
    f.name = g('f-name').trim();
    f.phone = f.kind === 'block' ? '' : g('f-phone').trim();
    f.court = g('f-court') || f.court || cfg.courts[0].id; f.date = g('f-date');
    f.start = parseInt(g('f-start'), 10); f.hours = parseInt(g('f-hours'), 10);
    f.status = f.kind === 'block' ? 'confirmed' : (g('f-status') || 'confirmed');
    f.note = f.kind === 'block' ? '' : g('f-note').trim();
  }

  function scheduleView() {
    var info = dayInfo(ui.date);
    var nav = '<div class="datenav"><button class="btn small" data-act="date-prev" aria-label="Previous day">‹</button><button class="btn small" data-act="date-today">Today</button><button class="btn small" data-act="date-next" aria-label="Next day">›</button>' +
      '<h2>' + esc(longDate(ui.date)) + '</h2><button class="btn primary" data-act="new-booking">New booking</button></div>';
    var body;
    if (!info.open) {
      body = '<div class="closedmsg">Closed on this date (' + esc(info.reason) + '). You can still add a booking if you open for an event.</div>';
    } else {
      body = '<div class="courts">' + cfg.courts.map(function (c) {
        var rows = '';
        for (var h = info.from; h < info.to; h++) {
          var b = coverAt(ui.date, c.id, h), past = isPast(ui.date, h) ? ' past' : '';
          if (!b) {
            rows += '<button class="slot free' + past + '" data-act="new-booking" data-court="' + esc(c.id) + '" data-h="' + h + '"><span class="t">' + fmtH(h) + '</span><span class="d">Free</span></button>';
          } else {
            var cont = h > b.start, cls = b.kind === 'block' ? 'block' : (b.status === 'pending' ? 'pending' : 'booked');
            var label = cont ? '↳ ' + esc(b.name || 'Booked') : '<strong>' + esc(b.name || (b.kind === 'block' ? 'Unavailable' : 'Booked')) + '</strong>' +
              (b.phone ? ' · ' + esc(b.phone) : '') + ' · ' + b.hours + 'h' + (b.status === 'pending' ? ' · pending' : '');
            rows += '<button class="slot ' + cls + (cont ? ' cont' : '') + past + '" data-act="edit-booking" data-id="' + esc(b.id) + '"><span class="t">' + fmtH(h) + '</span><span class="d">' + label + '</span></button>';
          }
        }
        return '<section class="card"><div class="court-head"><h3>' + esc(c.name) + '</h3>' + (c.rate > 0 ? '<span class="muted small">' + money(c.rate) + ' / hr</span>' : '') + '</div><div class="slots">' + rows + '</div></section>';
      }).join('') + '</div>';
    }
    return formHTML() + '<section class="stack">' + nav + body + '</section>';
  }

  /* ---------- owner: bookings list ---------- */
  function listHTML() {
    var t = todayStr();
    var q = ui.q.trim().toLowerCase();
    var list = bookings.filter(function (b) {
      var upcoming = b.date >= t && b.status !== 'cancelled';
      var ok = ui.filter === 'all' ? true : ui.filter === 'upcoming' ? upcoming : ui.filter === 'past' ? (b.date < t && b.status !== 'cancelled') : b.status === 'cancelled';
      if (!ok) return false;
      if (!q) return true;
      return ((b.name || '') + ' ' + (b.phone || '') + ' ' + (b.note || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var ka = a.date + pad2(a.start), kb = b.date + pad2(b.start);
      return ui.filter === 'past' ? (ka < kb ? 1 : -1) : (ka < kb ? -1 : 1);
    });
    if (!ui.loaded && !ui.loadErr) return '<p class="muted">Loading bookings…</p>';
    if (ui.loadErr && !ui.loaded) return '<p class="err">The booking list could not be reached yet. Check your connection; it will fill in when it connects.</p>';
    if (!list.length) {
      return '<div class="empty"><p>' + (bookings.length ? 'No bookings match this view.' : 'No bookings yet. When someone books by phone or WhatsApp, add it here and it shows as taken on the public page.') + '</p><button class="btn primary" data-act="new-booking">New booking</button></div>';
    }
    return '<div class="blist">' + list.map(function (b) {
      var pill = b.kind === 'block' ? '<span class="pill block">Blocked</span>' : '<span class="pill ' + esc(b.status) + '">' + esc(b.status.charAt(0).toUpperCase() + b.status.slice(1)) + '</span>';
      return '<div class="bitem"><div class="when"><strong>' + esc(shortDate(b.date)) + '</strong><span class="muted small">' + esc(fmtRange(b.start, b.start + b.hours)) + '</span></div>' +
        '<div class="who"><strong>' + esc(b.name || (b.kind === 'block' ? 'Unavailable' : 'No name')) + '</strong> ' + pill + '<br><span class="muted small">' + [(single() ? '' : esc(courtName(b.court))), (b.phone ? esc(b.phone) : ''), (b.note ? esc(b.note) : '')].filter(Boolean).join(' · ') + (single() && !b.phone && !b.note ? '&nbsp;' : '') + '</span></div>' +
        '<button class="btn small" data-act="edit-booking" data-id="' + esc(b.id) + '">Edit</button></div>';
    }).join('') + '</div>';
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function bookingsView() {
    var seg = function (k, l) { return '<button data-act="filter" data-f="' + k + '" class="' + (ui.filter === k ? 'on' : '') + '">' + l + '</button>'; };
    return formHTML() + '<section class="card"><h2>Bookings</h2><div class="filters"><div class="seg">' + seg('upcoming', 'Upcoming') + seg('past', 'Past') + seg('cancelled', 'Cancelled') + seg('all', 'All') + '</div>' +
      '<input type="search" id="bsearch" placeholder="Search name or phone" value="' + esc(ui.q) + '" aria-label="Search bookings"><button class="btn" data-act="export-csv">Download backup</button><button class="btn primary" data-act="new-booking">New booking</button></div><div id="blist">' + listHTML() + '</div></section>';
  }

  /* ---------- owner: settings ---------- */
  function settingsView() {
    var hrs = KEYS.map(function (k) {
      var d = cfg.hours[k];
      var from = seq(0, 23).map(function (h) { return '<option value="' + h + '"' + (h === d.from ? ' selected' : '') + '>' + fmtH(h) + '</option>'; }).join('');
      var to = seq(1, 24).map(function (h) { return '<option value="' + h + '"' + (h === d.to ? ' selected' : '') + '>' + (h === 24 ? '12 AM (midnight)' : fmtH(h)) + '</option>'; }).join('');
      return '<div class="hrow"><strong>' + NAMES[k] + '</strong><label class="sw"><input type="checkbox" data-cfg="hours-open" data-day="' + k + '"' + (d.open ? ' checked' : '') + '> Open</label>' +
        '<div class="sel2">' + (d.open ? '<select data-cfg="hours-from" data-day="' + k + '" aria-label="' + NAMES[k] + ' opens">' + from + '</select> to <select data-cfg="hours-to" data-day="' + k + '" aria-label="' + NAMES[k] + ' closes">' + to + '</select>' : '<span class="muted">Closed all day</span>') + '</div></div>';
    }).join('');
    var cl = (cfg.closures || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (c, i) {
      return '<div class="clrow"><span>' + esc(shortDate(c.date)) + (c.label ? ' <span class="muted">· ' + esc(c.label) + '</span>' : '') + '</span><button class="btn small" data-act="del-closure" data-date="' + esc(c.date) + '">Remove</button></div>';
    }).join('') || '<p class="muted small">No closed dates set.</p>';
    var courts = cfg.courts.map(function (c, i) {
      return '<div class="form-grid"><div class="field"><label for="cr' + i + '">Price per hour (LKR). Leave empty to hide.</label><input id="cr' + i + '" data-cfg="court-rate" data-i="' + i + '" type="number" min="0" step="100" value="' + (c.rate > 0 ? c.rate : '') + '" placeholder="Not shown"></div></div>';
    }).join('');
    return '<section class="stack">' +
      '<section class="card"><h2>Opening hours</h2><p class="muted small" style="margin-bottom:.6rem">These repeat every week. Customers see them on the public page.</p>' + hrs + '<div class="actions"><button class="btn small" data-act="copy-monday">Copy Monday to every day</button></div></section>' +
      '<section class="card"><h2>Closed dates</h2>' + cl + '<div class="form-grid" style="margin-top:.8rem"><div class="field"><label for="cl-date">Date</label><input id="cl-date" type="date"></div><div class="field"><label for="cl-label">Reason (shown to customers)</label><input id="cl-label" type="text" placeholder="e.g. Poya day"></div></div><div class="actions"><button class="btn" data-act="add-closure">Add closed date</button></div></section>' +
      '<section class="card"><h2>Special offer</h2><label class="sw"><input type="checkbox" data-cfg="offer-on"' + (cfg.offerOn ? ' checked' : '') + '> Show the special offer poster on the public page</label>' +
      '<div class="form-grid" style="margin-top:.8rem"><div class="field"><label for="offoff">Discount for booking 2 hours (LKR)</label><input id="offoff" data-cfg="offer-off" type="number" min="0" step="100" value="' + (cfg.offerOff > 0 ? cfg.offerOff : '') + '" placeholder="0"></div></div>' +
      '<p class="muted small" style="margin-top:.6rem">The poster image itself is fixed at 3,000 LKR per hour and 500 LKR off. Send me a new poster if the offer changes.</p></section>' +
      '<section class="card"><h2>Notice banner</h2><div class="field"><label for="notice">Shown at the top of the public page. Leave empty for none.</label><textarea id="notice" data-cfg="notice" placeholder="e.g. Court B closed for maintenance until Friday">' + esc(cfg.notice) + '</textarea></div></section>' +
      '<section class="card"><h2>Price</h2><div class="stack">' + courts + '</div></section>' +
      '<section class="card"><h2>Contact</h2><div class="form-grid">' +
      '<div class="field"><label for="wa0">WhatsApp number 1 (bookings)</label><input id="wa0" data-cfg="whatsapp" data-i="0" type="text" inputmode="tel" maxlength="20" value="' + esc(localNum((cfg.whatsapps || [])[0])) + '"></div>' +
      '<div class="field"><label for="wa1">WhatsApp number 2 (bookings)</label><input id="wa1" data-cfg="whatsapp" data-i="1" type="text" inputmode="tel" maxlength="20" value="' + esc(localNum((cfg.whatsapps || [])[1])) + '"></div>' +
      '<div class="field"><label for="ph0">General phone</label><input id="ph0" data-cfg="phone" data-i="0" type="text" inputmode="tel" maxlength="24" value="' + esc((cfg.phones || [])[0] || '') + '"></div>' +
      '<div class="field span2"><label for="addr">Address</label><input id="addr" data-cfg="address" type="text" maxlength="200" value="' + esc(cfg.address) + '"></div></div></section></section>';
  }

  function manageView() {
    var warn = (!db && isOwner) ? '<p class="err" style="margin-bottom:1rem">Booking storage is not available in this view, so bookings cannot be saved. Reload the page.</p>' : '';
    var body = ui.tab === 'settings' ? settingsView() : ui.tab === 'bookings' ? bookingsView() : scheduleView();
    return headerHTML() + '<main class="wrap">' + warn + body + '</main>';
  }

  /* ---------- render ---------- */
  var view;
  function shell() { app.innerHTML = '<div id="bar"></div><div id="view"></div>'; view = document.getElementById('view'); }
  function render(focusSel) {
    view.innerHTML = (isOwner && ui.mode === 'manage') ? manageView() : customerView();
    updateBar();
    if (focusSel) { var el = view.querySelector(focusSel); if (el) el.focus(); }
  }
  function updateBar() {
    var el = document.getElementById('bar');
    if (!el) return;
    if (!isOwner || ui.mode !== 'manage') { el.innerHTML = ''; return; }
    var dirty = isDirty();
    var msg = ui.msg ? '<p class="err">' + esc(ui.msg) + '</p>' : '';
    el.innerHTML = '<div class="bar' + (dirty ? ' dirty' : '') + '"><div class="wrap bar-in">' +
      (dirty ? '<p><strong>Not live yet.</strong> Customers still see the old hours and availability.</p><button class="btn ball" data-act="publish"' + (ui.publishing ? ' disabled' : '') + '>' + (ui.publishing ? 'Publishing…' : 'Publish changes') + '</button>'
        : '<p>The public page is up to date.</p>') + msg + '</div></div>';
  }

  /* ---------- owner actions ---------- */
  function persistCfg() {
    if (!db) return;
    clearTimeout(cfgTimer);
    cfgTimer = setTimeout(flushCfg, 500);
  }
  function flushCfg() {
    if (!db) return Promise.resolve();
    if (cfgWriting) { cfgPending = true; return Promise.resolve(); }
    cfgWriting = true;
    return db.doc('config/public').set(clone(cfg)).catch(function () { ui.msg = 'Settings could not be saved yet. Try again.'; updateBar(); }).then(function () {
      cfgWriting = false;
      if (cfgPending) { cfgPending = false; flushCfg(); }
    });
  }
  function cfgChanged(structural) {
    persistCfg();
    if (structural) render(); else updateBar();
  }

  function saveBooking() {
    readForm();
    var f = ui.form;
    ui.confirmDel = false;
    if (!db) { ui.err = 'Booking storage is not available. Reload the page.'; return render(); }
    if (f.kind === 'booking' && !f.name) { ui.err = 'Enter the customer name.'; return render(); }
    if (!validDate(f.date)) { ui.err = 'Choose a valid date.'; return render(); }
    if (f.start + f.hours > 24) { ui.err = 'A booking cannot run past midnight. Shorten it or split it across two days.'; return render(); }
    if (f.status !== 'cancelled') {
      var clash = bookings.find(function (b) {
        return b.id !== f.id && b.status !== 'cancelled' && b.date === f.date && b.court === f.court && b.start < f.start + f.hours && f.start < b.start + b.hours;
      });
      if (clash) { ui.err = 'That overlaps ' + (clash.name || 'another booking') + ' (' + fmtRange(clash.start, clash.start + clash.hours) + (single() ? '' : ' on ' + courtName(clash.court)) + ').'; return render(); }
    }
    var id = f.id || ('b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var rec = { kind: f.kind, date: f.date, court: f.court, start: f.start, hours: f.hours, name: f.name, phone: f.phone, status: f.status, note: f.note, createdAt: f.createdAt || new Date().toISOString() };
    db.doc('bookings/' + id).set(rec).then(function () {
      ui.date = f.date; ui.form = null; ui.err = ''; render();
    }).catch(function () { ui.err = 'The booking could not be saved. Check your connection and try again.'; render(); });
  }
  function deleteBooking() {
    var id = ui.form && ui.form.id;
    if (!id || !db) return;
    db.doc('bookings/' + id).delete().then(function () { ui.form = null; ui.confirmDel = false; render(); })
      .catch(function () { ui.err = 'The booking could not be deleted. Try again.'; render(); });
  }
  function publishNow() {
    if (ui.publishing) return;
    if (!artifact) { ui.msg = 'Publishing is not available in this view.'; return updateBar(); }
    ui.publishing = true; ui.msg = ''; updateBar();
    clearTimeout(cfgTimer);
    var next = { config: sanitizeCfg(cfg), busy: computeBusy(bookings), updatedAt: new Date().toISOString() };
    artifact.publish(buildIndex(next)).catch(function (e) {
      ui.publishing = false;
      var c = e && e.code;
      if (c === 'conflict') return;
      ui.msg = (c === 'not_writer' || c === 'not_granted') ? 'You need edit access to publish this page.' : 'Publishing failed. Try again in a moment.';
      updateBar();
    });
  }

  function csvCell(v) {
    var x = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(x) && !/^\+[\d\s()-]+$/.test(x)) x = "'" + x;
    return '"' + x.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    window.claude.use('downloads').then(function (dl) {
      if (!dl) { ui.msg = 'Downloads are not available in this view.'; return updateBar(); }
      var rows = [['Date', 'Start', 'Hours', 'Court', 'Type', 'Name', 'Phone', 'Status', 'Note']].concat(
        bookings.slice().sort(function (a, b) { return (a.date + pad2(a.start)) < (b.date + pad2(b.start)) ? -1 : 1; }).map(function (b) {
          return [b.date, fmtH(b.start), b.hours, courtName(b.court), b.kind, b.name, b.phone, b.status, b.note];
        }));
      return dl.save({ filename: 'sanya-bookings-' + todayStr() + '.csv', data: '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') });
    }).catch(function (e) {
      if (e && e.code === 'declined') return;
      ui.msg = 'The file could not be saved.'; updateBar();
    });
  }

  /* ---------- events ---------- */
  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    switch (act) {
      case 'pick-date': ui.date = t.getAttribute('data-date'); ui.sel = {}; ui.period = null; render(); break;
      case 'pick-court': ui.court = t.getAttribute('data-court'); ui.sel = {}; ui.period = null; render(); break;
      case 'pick-period': ui.period = t.getAttribute('data-p'); render(); break;
      case 'toggle-slot': {
        var c = t.getAttribute('data-court'), h = parseInt(t.getAttribute('data-h'), 10);
        Object.keys(ui.sel).forEach(function (k) { if (k !== c) delete ui.sel[k]; });
        var arr = ui.sel[c] || (ui.sel[c] = []), i = arr.indexOf(h);
        if (i < 0) arr.push(h); else arr.splice(i, 1);
        if (!arr.length) delete ui.sel[c];
        ui.copied = false;
        render('[data-act="toggle-slot"][data-court="' + c + '"][data-h="' + h + '"]');
        break;
      }
      case 'clear-sel': ui.sel = {}; ui.copied = false; render(); break;
      case 'export-csv': exportCsv(); break;
      case 'copy-msg': {
        var text = waText();
        var done = function () { ui.copied = true; render(); };
        var fallback = function () { var pre = document.getElementById('msg'); if (pre && window.getSelection) { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } };
        try { navigator.clipboard.writeText(text).then(done, fallback); } catch (err) { fallback(); }
        break;
      }
      case 'tab': ui.tab = t.getAttribute('data-tab'); ui.form = null; ui.err = ''; ui.confirmDel = false; render(); break;
      case 'preview': ui.mode = 'customer'; ui.sel = {}; render(); window.scrollTo(0, 0); break;
      case 'unpreview': ui.mode = 'manage'; render(); break;
      case 'date-prev': ui.date = addDays(ui.date, -1); render(); break;
      case 'date-next': ui.date = addDays(ui.date, 1); render(); break;
      case 'date-today': ui.date = todayStr(); render(); break;
      case 'new-booking': {
        var ct = t.getAttribute('data-court'), hh = t.getAttribute('data-h');
        ui.form = newForm(ct, hh == null ? null : parseInt(hh, 10), ui.date); ui.err = ''; ui.confirmDel = false; render(); window.scrollTo(0, 0);
        setTimeout(function () { var n = document.getElementById('f-name'); if (n) n.focus(); }, 0);
        break;
      }
      case 'edit-booking': {
        var b = bookings.find(function (x) { return x.id === t.getAttribute('data-id'); });
        if (b) { ui.form = Object.assign({}, b); ui.err = ''; ui.confirmDel = false; render(); window.scrollTo(0, 0); }
        break;
      }
      case 'cancel-form': ui.form = null; ui.err = ''; ui.confirmDel = false; render(); break;
      case 'save-booking': saveBooking(); break;
      case 'delete-ask': readForm(); ui.confirmDel = true; render(); break;
      case 'delete-no': ui.confirmDel = false; render(); break;
      case 'delete-yes': deleteBooking(); break;
      case 'filter': ui.filter = t.getAttribute('data-f'); render(); break;
      case 'publish': publishNow(); break;
      case 'copy-monday': {
        var m = cfg.hours.mon;
        KEYS.forEach(function (k) { cfg.hours[k] = { open: m.open, from: m.from, to: m.to }; });
        cfgChanged(true); break;
      }
      case 'add-closure': {
        var d = document.getElementById('cl-date').value, l = document.getElementById('cl-label').value.trim();
        if (!validDate(d)) return;
        cfg.closures = (cfg.closures || []).filter(function (x) { return x.date !== d; }).concat([{ date: d, label: l }]);
        cfgChanged(true); break;
      }
      case 'del-closure': {
        var dd = t.getAttribute('data-date');
        cfg.closures = (cfg.closures || []).filter(function (x) { return x.date !== dd; });
        cfgChanged(true); break;
      }
    }
  });

  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-act-change') === 'form-kind') { readForm(); render(); return; }
    var k = t.getAttribute('data-cfg');
    if (!k) return;
    var day = t.getAttribute('data-day'), i = parseInt(t.getAttribute('data-i'), 10);
    if (k === 'offer-on') { cfg.offerOn = t.checked; cfgChanged(false); return; }
    if (k === 'offer-off') { cfg.offerOff = Math.max(0, parseInt(t.value, 10) || 0); cfgChanged(false); return; }
    if (k === 'hours-open') { cfg.hours[day].open = t.checked; cfgChanged(true); return; }
    if (k === 'hours-from') { var f = parseInt(t.value, 10); cfg.hours[day].from = f; if (cfg.hours[day].to <= f) cfg.hours[day].to = Math.min(24, f + 1); cfgChanged(true); return; }
    if (k === 'hours-to') { var to = parseInt(t.value, 10); cfg.hours[day].to = to; if (cfg.hours[day].from >= to) cfg.hours[day].from = Math.max(0, to - 1); cfgChanged(true); return; }
    if (k === 'notice') cfg.notice = t.value.trim();
    else if (k === 'court-name') cfg.courts[i].name = t.value.trim() || cfg.courts[i].name;
    else if (k === 'court-rate') cfg.courts[i].rate = Math.max(0, parseInt(t.value, 10) || 0);
    else if (k === 'phone') { var p = (cfg.phones || []).slice(); while (p.length < 2) p.push(''); p[i] = t.value.trim(); cfg.phones = p; }
    else if (k === 'whatsapp') { var w = (cfg.whatsapps || ['', '']).slice(); w[i] = normWa(t.value); cfg.whatsapps = w; }
    else if (k === 'address') cfg.address = t.value.trim();
    cfgChanged(false);
  });

  var searchTimer = null;
  app.addEventListener('input', function (e) {
    if (e.target.id !== 'bsearch') return;
    ui.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { var el = document.getElementById('blist'); if (el) el.innerHTML = listHTML(); }, 150);
  });

  /* ---------- start ---------- */
  shell();
  render();
  if (!(window.claude && window.claude.use)) return;
  Promise.all([window.claude.use('user'), window.claude.use('artifact'), window.claude.use('db')]).then(function (r) {
    var user = r[0];
    artifact = r[1];
    isOwner = !!(user && typeof user.canEdit === 'function' && user.canEdit());
    if (!isOwner) return;
    db = r[2];
    render();
    if (!db) return;
    loadTimer = setTimeout(function () { if (!ui.loaded) { ui.loadErr = true; render(); } }, 10000);
    db.collection('bookings').onSnapshot(function (snap) {
      bookings = snap.docs.map(function (d) { return cleanBooking(d.data(), d.id); });
      ui.loaded = true; ui.loadErr = false; clearTimeout(loadTimer);
      var editing = ui.form && document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (!editing) render(); else updateBar();
    }, function () { ui.loadErr = true; render(); });
    db.doc('config/public').onSnapshot(function (s) {
      if (s.metadata.hasPendingWrites || !s.exists) return;
      cfg = normCfg(s.data());
      if (ui.tab !== 'settings' || ui.mode === 'customer') render(); else updateBar();
    }, function () {});
  }).catch(function () { /* public view */ });
})();
