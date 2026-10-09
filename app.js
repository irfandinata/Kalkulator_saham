(() => {
  'use strict';

  const LOT_SIZE = 100;
  const STORE_KEY = 'kalkulator-saham:v2';
  const OLD_STORE_KEY = 'kalkulator-right-issue:v1';
  const MAX_BUYS = 6;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const pos = (n) => Number.isFinite(n) && n > 0;

  // ---------- Format angka (id-ID: titik ribuan, koma desimal) ----------
  const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  const nfPct = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const num = (n) => nf0.format(Math.round(n));
  const rp = (n) => {
    const r = Math.round(n);
    return (r < 0 ? '−' : '') + 'Rp' + nf0.format(Math.abs(r));
  };
  const rp2 = (n) => (n < 0 ? '−' : '') + 'Rp' + nf2.format(Math.abs(n));
  const pct = (r) => nfPct.format(Math.abs(r) * 100) + '%';
  const pctRound = (r) => Math.round(r * 100) + '%';
  const sanitizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  function lotText(shares) {
    const lots = Math.floor(shares / LOT_SIZE);
    const rest = shares % LOT_SIZE;
    if (!lots) return `${num(rest)} lembar`;
    return rest ? `${num(lots)} lot + ${num(rest)} lembar` : `${num(lots)} lot`;
  }

  function parseNum(str) {
    if (!str) return NaN;
    const n = parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatDigits(raw, allowDecimal) {
    const s = String(raw).replace(allowDecimal ? /[^\d,]/g : /\D/g, '');
    let int = s;
    let dec = null;
    if (allowDecimal) {
      const i = s.indexOf(',');
      if (i !== -1) {
        int = s.slice(0, i);
        dec = s.slice(i + 1).replace(/,/g, '').slice(0, 2);
      }
    }
    int = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (dec !== null) return (int || '0') + ',' + dec;
    return int;
  }

  // Angka JS -> teks input gaya Indonesia.
  const toField = (n, allowDecimal = false) =>
    formatDigits(String(allowDecimal ? n : Math.round(n)).replace('.', ','), allowDecimal);

  // Format saat mengetik sambil menjaga posisi kursor (dihitung dari kanan).
  function onNumericInput(el) {
    const allowDecimal = el.dataset.decimal === 'true';
    const isSig = (ch) => /\d/.test(ch) || (allowDecimal && ch === ',');
    const at = el.selectionStart ?? el.value.length;
    const after = [...el.value.slice(at)].filter(isSig).length;
    const next = formatDigits(el.value, allowDecimal);
    el.value = next;
    let i = next.length;
    let count = 0;
    while (i > 0 && count < after) {
      i -= 1;
      if (isSig(next[i])) count += 1;
    }
    if (document.activeElement === el) el.setSelectionRange(i, i);
  }

  function refs(root) {
    const o = {};
    root.querySelectorAll('[data-ref]').forEach((el) => { o[el.dataset.ref] = el; });
    return o;
  }

  // ---------- Komponen bersama ----------
  const tweens = new WeakMap();
  function setNum(el, to, fmt) {
    const from = parseFloat(el.dataset.value);
    cancelAnimationFrame(tweens.get(el));
    if (!Number.isFinite(to)) {
      el.dataset.value = '';
      el.textContent = '—';
      return;
    }
    el.dataset.value = String(to);
    if (reduceMotion || !Number.isFinite(from) || from === to) {
      el.textContent = fmt(to);
      return;
    }
    const start = performance.now();
    const dur = 280;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(t === 1 ? to : from + (to - from) * e);
      if (t < 1) tweens.set(el, requestAnimationFrame(step));
    };
    tweens.set(el, requestAnimationFrame(step));
  }

  const statHtml = (label, value, sub = '') =>
    `<div class="t-stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  const ledgerRow = (label, value, sub = '', cls = '', valueCls = '') =>
    `<div class="lg-row ${cls}"><dt>${label}${sub ? `<small>${sub}</small>` : ''}</dt><dd class="${valueCls}">${value}</dd></div>`;

  function setDelta(el, change) {
    if (!Number.isFinite(change)) {
      el.hidden = true;
      return;
    }
    const dir = Math.abs(change) < 5e-5 ? 'tetap' : change < 0 ? 'turun' : 'naik';
    el.hidden = false;
    el.dataset.dir = dir;
    el.textContent = dir === 'tetap' ? 'Tetap' : `${dir === 'turun' ? '▼ Turun' : '▲ Naik'} ${pct(change)}`;
  }

  // Peta harga: titik-titik harga pada satu garis, label diatur agar tidak bertabrakan.
  function renderPriceMap(r, points, names, rangePair) {
    const pts = points.filter((p) => pos(p.v));
    if (pts.length < 2) {
      r.pmap.hidden = true;
      return false;
    }
    r.pmap.hidden = false;

    const vals = pts.map((p) => p.v);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const span = hi - lo || hi * 0.2;
    lo -= span * 0.06;
    hi += span * 0.06;
    const x = (val) => (val - lo) / (hi - lo);

    r.pmDots.innerHTML = pts
      .map((p) => `<span class="pm-dot" data-k="${p.k}" style="left:${(x(p.v) * 100).toFixed(3)}%"></span>`)
      .join('');

    if (rangePair && pos(rangePair[0]) && pos(rangePair[1])) {
      const a = x(Math.min(...rangePair));
      const b = x(Math.max(...rangePair));
      r.pmRange.hidden = false;
      r.pmRange.style.left = `${a * 100}%`;
      r.pmRange.style.width = `${(b - a) * 100}%`;
    } else {
      r.pmRange.hidden = true;
    }

    r.pmTop.textContent = '';
    r.pmBottom.textContent = '';
    [...pts].sort((p, q) => p.v - q.v).forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'pm-label';
      el.dataset.k = p.k;
      el.dataset.x = String(x(p.v));
      el.innerHTML = `<span>${names[p.k]}</span><b>${rp2(p.v)}</b>`;
      (i % 2 ? r.pmBottom : r.pmTop).appendChild(el);
    });
    layoutLabels(r);
    return true;
  }

  function layoutLabels(r) {
    [r.pmTop, r.pmBottom].forEach((row) => {
      const W = row.clientWidth;
      if (!W) return;
      const gap = 10;
      const boxes = [...row.children].map((el) => {
        const w = el.offsetWidth;
        const left = Math.max(0, Math.min(W - w, Number(el.dataset.x) * W - w / 2));
        return { el, w, left };
      });
      let prevRight = -Infinity;
      boxes.forEach((b) => {
        if (b.left < prevRight + gap) b.left = prevRight + gap;
        prevRight = b.left + b.w;
      });
      let nextLeft = W + gap;
      for (let i = boxes.length - 1; i >= 0; i -= 1) {
        const b = boxes[i];
        if (b.left + b.w > nextLeft - gap) b.left = nextLeft - gap - b.w;
        nextLeft = b.left;
      }
      boxes.forEach((b) => { b.el.style.left = `${Math.max(0, b.left)}px`; });
    });
  }

  function syncUnitButtons(root, unit) {
    root.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === unit)));
  }

  // =====================================================================
  // Mode 1: Hitung Avg
  // =====================================================================
  const avgMode = (() => {
    const root = $('panel-avg');
    const r = refs(root);
    const f = {
      code: $('avg-code'),
      qty: $('avg-qty'),
      avg: $('avg-avg'),
      market: $('avg-market'),
      target: $('avg-target'),
      targetPrice: $('avg-target-price'),
    };
    const FIELDS = Object.keys(f);
    const SAMPLE = {
      values: { code: 'ABCD', qty: '50', avg: '1.250', market: '1.050', target: '1.150', targetPrice: '900' },
      buys: [['20', '1.000'], ['10', '900']],
    };
    const NAMES = { lama: 'Avg lama', beli: 'Harga beli', baru: 'Avg baru', pasar: 'Harga pasar' };

    let unit = 'lot';
    let isSample = false;
    let last = null;

    const buyRows = () => [...r.buys.querySelectorAll('.buy-row')];

    function addBuyRow(qty = '', price = '') {
      if (buyRows().length >= MAX_BUYS) return null;
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.innerHTML = `
        <span class="buy-n"></span>
        <div class="control">
          <input type="text" inputmode="numeric" placeholder="0" data-num data-buy="qty">
          <span class="affix" data-unit-affix>lot</span>
        </div>
        <div class="control">
          <span class="affix">Rp</span>
          <input type="text" inputmode="numeric" placeholder="0" data-num data-buy="price">
        </div>
        <button type="button" class="icon-btn" data-action="remove-buy">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <p class="buy-sub" data-buy-sub></p>`;
      row.querySelector('[data-buy="qty"]').value = qty;
      row.querySelector('[data-buy="price"]').value = price;
      r.buys.appendChild(row);
      relabelRows();
      return row;
    }

    function relabelRows() {
      buyRows().forEach((row, i) => {
        const n = i + 1;
        row.querySelector('.buy-n').textContent = n;
        row.querySelector('[data-buy="qty"]').setAttribute('aria-label', `Jumlah pembelian ${n} (${unit})`);
        row.querySelector('[data-buy="price"]').setAttribute('aria-label', `Harga beli pembelian ${n}`);
        row.querySelector('[data-action="remove-buy"]').setAttribute('aria-label', `Hapus pembelian ${n}`);
        row.querySelector('[data-unit-affix]').textContent = unit === 'lot' ? 'lot' : 'lbr';
      });
      r.unitText.textContent = unit === 'lot' ? 'Jumlah (lot)' : 'Jumlah (lembar)';
      r.addBuy.disabled = buyRows().length >= MAX_BUYS;
    }

    function setBuys(list) {
      r.buys.textContent = '';
      (list.length ? list : [['', '']]).forEach(([q, p]) => addBuyRow(q, p));
    }

    function read() {
      const mult = unit === 'lot' ? LOT_SIZE : 1;
      return {
        code: sanitizeCode(f.code.value),
        shares: pos(parseNum(f.qty.value)) ? Math.floor(parseNum(f.qty.value)) * mult : 0,
        avg: parseNum(f.avg.value),
        market: parseNum(f.market.value),
        buys: buyRows().map((row) => {
          const q = parseNum(row.querySelector('[data-buy="qty"]').value);
          const p = parseNum(row.querySelector('[data-buy="price"]').value);
          const shares = pos(q) ? Math.floor(q) * mult : 0;
          return { row, shares, price: p, valid: shares > 0 && pos(p) };
        }),
        target: parseNum(f.target.value),
        targetPrice: parseNum(f.targetPrice.value),
      };
    }

    function compute(v) {
      const hasAvg = pos(v.avg);
      const hasMarket = pos(v.market);
      const buys = v.buys.filter((b) => b.valid).map((b) => ({ ...b, cost: b.shares * b.price }));
      const buyShares = buys.reduce((s, b) => s + b.shares, 0);
      const buyCost = buys.reduce((s, b) => s + b.cost, 0);
      const buyAvg = buyShares ? buyCost / buyShares : NaN;
      const baseOk = v.shares === 0 || hasAvg;
      const oldCapital = v.shares && hasAvg ? v.shares * v.avg : 0;
      const totalShares = v.shares + buyShares;
      const totalCapital = oldCapital + buyCost;
      const ready = buyShares > 0 && baseOk;
      const newAvg = ready ? totalCapital / totalShares : NaN;
      const avgChange = ready && v.shares && hasAvg ? newAvg / v.avg - 1 : NaN;

      const valueAfter = hasMarket ? totalShares * v.market : NaN;
      const plAfter = valueAfter - totalCapital;
      const plBefore = hasMarket && v.shares && hasAvg ? v.shares * v.market - oldCapital : NaN;

      return {
        hasAvg, hasMarket, buys, buyShares, buyCost, buyAvg, oldCapital, totalShares, totalCapital,
        ready, newAvg, avgChange, valueAfter, plAfter, plBefore,
      };
    }

    function render() {
      const v = read();
      const m = compute(v);
      last = { v, m };

      // hint & subtotal per baris
      r.qtyHint.textContent = v.shares
        ? (unit === 'lot' ? `= ${num(v.shares)} lembar` : `= ${lotText(v.shares)}`)
        : 'Kosongkan kalau belum punya saham ini.';
      v.buys.forEach((b) => {
        const sub = b.row.querySelector('[data-buy-sub]');
        sub.textContent = b.valid
          ? `${unit === 'lot' ? `${num(b.shares)} lembar · ` : `${lotText(b.shares)} · `}${rp(b.shares * b.price)}`
          : '';
      });

      renderTicket(v, m);
      renderMap(v, m);
      renderLedger(v, m);
      renderTarget(v, m);
      r.sampleNote.hidden = !isSample;
    }

    function renderTicket(v, m) {
      r.ticker.textContent = v.code || 'SAHAM';
      r.tMeta.textContent = m.buys.length ? `${m.buys.length} pembelian` : 'Average';
      const empty = !v.shares && !m.buys.length;
      r.btnCopy.hidden = !m.ready;
      r.btnSample.hidden = !empty;

      if (!m.ready) {
        setNum(r.tBig, NaN, rp2);
        setDelta(r.tDelta, NaN);
        r.tSub.textContent = v.shares && !m.hasAvg
          ? 'Isi harga rata-rata posisi sekarang.'
          : 'Isi minimal satu pembelian baru.';
        r.tStats.innerHTML = statHtml('Total saham', '—') + statHtml('Dana pembelian', '—');
        r.tNote.textContent = empty ? 'Belum ada angka? Coba pakai contoh dulu.' : '';
        return;
      }

      setNum(r.tBig, m.newAvg, rp2);
      setDelta(r.tDelta, m.avgChange);
      r.tSub.textContent = v.shares ? `Sebelumnya ${rp2(v.avg)}` : 'Posisi baru dari pembelian.';
      r.tStats.innerHTML =
        statHtml('Total saham', lotText(m.totalShares), `${num(m.totalShares)} lembar`) +
        statHtml('Dana pembelian', rp(m.buyCost), `${lotText(m.buyShares)} baru`);

      if (m.hasMarket) {
        const word = m.plAfter >= 0 ? 'untung' : 'rugi';
        let note = `Di harga ${rp2(v.market)}: <b>${word} ${rp(Math.abs(m.plAfter))} (${pct(m.plAfter / m.totalCapital)})</b>.`;
        if (Number.isFinite(m.plBefore)) {
          note += ` Sebelum beli: ${m.plBefore >= 0 ? 'untung' : 'rugi'} ${pct(m.plBefore / m.oldCapital)}.`;
        }
        r.tNote.innerHTML = note;
      } else {
        r.tNote.textContent = 'Isi harga pasar sekarang untuk melihat untung/rugi.';
      }
    }

    function renderMap(v, m) {
      const many = m.buys.length > 1;
      const names = { ...NAMES, beli: many ? 'Beli rata-rata' : 'Harga beli' };
      const shown = renderPriceMap(r, [
        { k: 'beli', v: m.buyAvg },
        { k: 'baru', v: m.newAvg },
        { k: 'lama', v: v.shares && m.hasAvg ? v.avg : NaN },
        { k: 'pasar', v: m.hasMarket ? v.market : NaN },
      ], names, [m.buyAvg, v.shares && m.hasAvg ? v.avg : NaN]);

      r.mapNote.textContent = shown && v.shares && m.ready
        ? 'Avg baru selalu jatuh di antara harga beli dan avg lama. Makin banyak yang dibeli, makin dekat ke harga beli.'
        : 'Isi posisi sekarang dan pembelian baru untuk melihat posisi avg barumu.';
    }

    function renderLedger(v, m) {
      const dash = '—';
      const rows = [];
      const qtyLabel = (shares) => (unit === 'lot' && shares % LOT_SIZE === 0 ? `${num(shares / LOT_SIZE)} lot` : `${num(shares)} lembar`);

      if (v.shares) {
        rows.push(ledgerRow(
          'Posisi awal',
          m.hasAvg ? rp(m.oldCapital) : dash,
          m.hasAvg ? `${qtyLabel(v.shares)} × ${rp2(v.avg)}` : qtyLabel(v.shares)
        ));
      }
      m.buys.forEach((b) => {
        const i = v.buys.findIndex((x) => x.row === b.row) + 1;
        rows.push(ledgerRow(`Pembelian ${i}`, rp(b.cost), `${qtyLabel(b.shares)} × ${rp2(b.price)}`));
      });
      if (!rows.length) rows.push(ledgerRow('Posisi & pembelian', dash, 'Belum ada data'));

      const odd = m.totalShares % LOT_SIZE;
      rows.push(ledgerRow(
        'Total saham',
        m.totalShares ? lotText(m.totalShares) : dash,
        m.totalShares ? `${num(m.totalShares)} lembar${odd ? ` · ${num(odd)} lembar odd lot` : ''}` : ''
      ));
      rows.push(ledgerRow('Total modal', m.ready ? rp(m.totalCapital) : dash, '', 'total'));
      rows.push(ledgerRow('Avg baru', m.ready ? rp2(m.newAvg) : dash, '', 'final'));

      if (m.ready && m.hasMarket) {
        rows.push(ledgerRow('Nilai di harga pasar', rp(m.valueAfter), `${num(m.totalShares)} × ${rp2(v.market)}`));
        const cls = m.plAfter > 0.5 ? 'up' : m.plAfter < -0.5 ? 'down' : '';
        const before = Number.isFinite(m.plBefore)
          ? `Sebelum beli: ${rp(m.plBefore)} (${m.plBefore < 0 ? '−' : ''}${pct(m.plBefore / m.oldCapital)})`
          : '';
        rows.push(ledgerRow(
          'Untung/rugi',
          `${m.plAfter > 0.5 ? '+' : ''}${rp(m.plAfter)} (${m.plAfter < -0.5 ? '−' : ''}${pct(m.plAfter / m.totalCapital)})`,
          before, '', cls
        ));
      }
      r.ledger.innerHTML = rows.join('');
    }

    function renderTarget(v, m) {
      const T = v.target;
      const P = v.targetPrice;
      const msg = (text) => { r.tgResult.innerHTML = `<p class="tg-msg">${text}</p>`; };

      if (!v.shares || !m.hasAvg) return msg('Isi jumlah dan harga rata-rata posisi sekarang dulu.');
      if (!pos(T) || !pos(P)) return msg('Isi target avg dan harga beli yang kamu rencanakan.');
      if (Math.abs(P - v.avg) < 1e-9) return msg('Harga beli sama dengan avg sekarang, jadi avg tidak akan berubah.');
      const between = (P < T && T < v.avg) || (P > T && T > v.avg);
      if (!between) {
        return msg(`Target harus berada di antara harga beli (${rp2(P)}) dan avg sekarang (${rp2(v.avg)}).`);
      }

      const need = (v.shares * (v.avg - T)) / (T - P);
      const lots = Math.max(1, Math.ceil(need / LOT_SIZE - 1e-9));
      const sh = lots * LOT_SIZE;
      const result = (v.shares * v.avg + sh * P) / (v.shares + sh);
      r.tgResult.innerHTML = `
        <p class="tg-label">Perlu beli</p>
        <p class="tg-big">${num(lots)} lot</p>
        <p class="tg-sub">${num(sh)} lembar × ${rp2(P)} = <b>${rp(sh * P)}</b></p>
        <p class="tg-sub">Avg jadi ${rp2(result)} · total ${lotText(v.shares + sh)}</p>`;
    }

    function summary() {
      const { v, m } = last;
      const lines = [`Hitung avg${v.code ? ' ' + v.code : ''}`];
      if (v.shares) lines.push(`• Posisi awal: ${lotText(v.shares)} @ ${rp2(v.avg)}`);
      m.buys.forEach((b, i) => lines.push(`• Pembelian ${i + 1}: ${lotText(b.shares)} @ ${rp2(b.price)}`));
      lines.push(`• Total: ${lotText(m.totalShares)} (${num(m.totalShares)} lembar), modal ${rp(m.totalCapital)}`);
      let avgLine = `• Avg baru: ${rp2(m.newAvg)}`;
      if (Number.isFinite(m.avgChange)) {
        avgLine += Math.abs(m.avgChange) < 5e-5 ? ' (tetap)' : ` (${m.avgChange < 0 ? 'turun' : 'naik'} ${pct(m.avgChange)})`;
      }
      lines.push(avgLine);
      if (m.hasMarket) lines.push(`• Di harga ${rp2(v.market)}: ${m.plAfter >= 0 ? 'untung' : 'rugi'} ${rp(Math.abs(m.plAfter))}`);
      lines.push('Simulasi, bukan rekomendasi. Belum termasuk biaya broker.');
      return lines.join('\n');
    }

    function dock() {
      const m = last && last.m;
      return {
        ready: !!(m && m.ready),
        items: [
          ['Avg baru', m && m.ready ? rp2(m.newAvg) : '—'],
          ['Dana beli', m && m.ready ? rp(m.buyCost) : '—'],
        ],
      };
    }

    function setUnit(next) {
      if (next === unit) return;
      const convert = (el) => {
        const val = parseNum(el.value);
        if (!Number.isFinite(val)) return;
        el.value = toField(next === 'lembar' ? Math.floor(val) * LOT_SIZE : Math.floor(val / LOT_SIZE));
      };
      convert(f.qty);
      buyRows().forEach((row) => convert(row.querySelector('[data-buy="qty"]')));
      unit = next;
      syncUnitButtons(root, unit);
      relabelRows();
    }

    function applySample() {
      FIELDS.forEach((k) => { f[k].value = SAMPLE.values[k]; });
      unit = 'lot';
      syncUnitButtons(root, unit);
      setBuys(SAMPLE.buys);
      isSample = true;
    }

    function clear() {
      FIELDS.forEach((k) => { f[k].value = ''; });
      setBuys([]);
      isSample = false;
      f.qty.focus();
    }

    function onInput(el) {
      if (el.matches('[data-code]')) el.value = sanitizeCode(el.value);
      isSample = false;
    }

    function onAction(action, btn) {
      if (action === 'unit') setUnit(btn.dataset.unit);
      else if (action === 'add-buy') {
        const row = addBuyRow();
        if (row) row.querySelector('[data-buy="qty"]').focus();
      } else if (action === 'remove-buy') {
        const row = btn.closest('.buy-row');
        if (buyRows().length > 1) {
          row.remove();
          relabelRows();
        } else {
          row.querySelectorAll('input').forEach((i) => { i.value = ''; });
        }
      } else if (action === 'clear') clear();
      else if (action === 'sample') applySample();
      else return;
      if (action !== 'sample') isSample = false;
      render();
    }

    // Terima data dari mode Right Issue.
    function receive({ code, shares, exercised, price }) {
      const useLot = shares % LOT_SIZE === 0 && exercised % LOT_SIZE === 0;
      unit = useLot ? 'lot' : 'lembar';
      syncUnitButtons(root, unit);
      if (isSample) FIELDS.forEach((k) => { f[k].value = ''; });
      f.code.value = code;
      f.qty.value = toField(useLot ? shares / LOT_SIZE : shares);
      setBuys([[toField(useLot ? exercised / LOT_SIZE : exercised), toField(price)]]);
      isSample = false;
      render();
      return !pos(parseNum(f.avg.value));
    }

    function serialize() {
      const values = {};
      FIELDS.forEach((k) => { values[k] = f[k].value; });
      const buys = buyRows().map((row) => [
        row.querySelector('[data-buy="qty"]').value,
        row.querySelector('[data-buy="price"]').value,
      ]);
      return { values, buys, unit, sample: isSample };
    }

    function restore(s) {
      if (!s || !s.values) return applySample();
      FIELDS.forEach((k) => {
        const val = s.values[k] ?? '';
        f[k].value = k === 'code' ? sanitizeCode(val) : formatDigits(val, f[k].dataset.decimal === 'true');
      });
      unit = s.unit === 'lembar' ? 'lembar' : 'lot';
      syncUnitButtons(root, unit);
      const buys = Array.isArray(s.buys) ? s.buys.slice(0, MAX_BUYS).map(([q, p]) => [formatDigits(q || '', false), formatDigits(p || '', false)]) : [];
      setBuys(buys);
      isSample = !!s.sample;
    }

    return {
      key: 'avg', root, ticket: $('avg-ticket'), focusField: f.avg,
      render, summary, dock, onInput, onAction, receive, serialize, restore,
      relayout: () => layoutLabels(r),
      isReady: () => !!(last && last.m.ready),
    };
  })();

  // =====================================================================
  // Mode 2: Right Issue
  // =====================================================================
  const riMode = (() => {
    const root = $('panel-ri');
    const r = refs(root);
    const f = {
      code: $('ri-code'),
      qty: $('ri-qty'),
      ra: $('ri-ra'),
      rb: $('ri-rb'),
      price: $('ri-price'),
      market: $('ri-market'),
    };
    const FIELDS = Object.keys(f);
    const SAMPLE = { code: 'ABCD', qty: '50', ra: '10', rb: '3', price: '900', market: '1.100' };
    const NAMES = { tebus: 'Harga tebus', terp: 'Teoritis', pasar: 'Harga cum' };
    const range = $('ri-exercise');
    const chips = [...root.querySelectorAll('.chip')];

    let share = 1;
    let unit = 'lot';
    let isSample = false;
    let last = null;

    function read() {
      const q = parseNum(f.qty.value);
      return {
        code: sanitizeCode(f.code.value),
        shares: pos(q) ? Math.floor(q) * (unit === 'lot' ? LOT_SIZE : 1) : 0,
        ra: parseNum(f.ra.value),
        rb: parseNum(f.rb.value),
        price: parseNum(f.price.value),
        market: parseNum(f.market.value),
      };
    }

    function compute(v) {
      const ratioOk = pos(v.ra) && pos(v.rb);
      const rights = v.shares && ratioOk ? Math.floor((v.shares * v.rb) / v.ra) : 0;
      const hasPrice = pos(v.price);
      const hasMarket = pos(v.market);
      const ready = v.shares > 0 && ratioOk && hasPrice;
      const exercised = Math.min(rights, Math.max(0, Math.round(rights * share)));
      const cost = hasPrice ? exercised * v.price : NaN;
      const totalShares = v.shares + exercised;
      const terp = ratioOk && hasPrice && hasMarket ? (v.ra * v.market + v.rb * v.price) / (v.ra + v.rb) : NaN;
      const rightValue = Number.isFinite(terp) ? Math.max(0, terp - v.price) : NaN;
      const discount = hasMarket && hasPrice ? 1 - v.price / v.market : NaN;
      const dilution = ratioOk ? v.rb / (v.ra + v.rb) : NaN;
      const ownershipKept = ready ? totalShares / (v.shares * (v.ra + v.rb) / v.ra) : NaN;
      return {
        ratioOk, rights, hasPrice, hasMarket, ready, exercised, cost, totalShares,
        terp, rightValue, discount, dilution, ownershipKept,
      };
    }

    function render() {
      const v = read();
      const m = compute(v);
      last = { v, m };
      renderForm(v, m);
      renderTicket(v, m);
      renderMap(v, m);
      renderLedger(v, m);
      renderScenarios(v, m);
      r.btnToAvg.hidden = !m.ready;
      r.sampleNote.hidden = !isSample;
    }

    function renderForm(v, m) {
      r.qtyHint.textContent = v.shares
        ? (unit === 'lot' ? `= ${num(v.shares)} lembar` : `= ${lotText(v.shares)}`)
        : 'Jumlah yang kamu pegang saat cum date.';
      r.ratioHint.textContent = m.ratioOk
        ? `Setiap ${nf2.format(v.ra)} saham lama mendapat ${nf2.format(v.rb)} HMETD. 1 HMETD = hak beli 1 saham baru.`
        : 'Lihat di prospektus. Contoh 10 : 3 artinya setiap 10 saham lama mendapat 3 HMETD.';

      range.max = String(m.rights);
      range.value = String(m.exercised);
      range.disabled = !m.rights;
      range.style.setProperty('--fill', m.rights ? `${(m.exercised / m.rights) * 100}%` : '0%');
      r.exCount.textContent = num(m.exercised);
      r.exOf.textContent = m.rights ? `dari ${num(m.rights)} HMETD` : 'HMETD';
      r.exPct.textContent = m.rights ? pctRound(m.exercised / m.rights) : '–';
      chips.forEach((chip) => {
        chip.disabled = !m.rights;
        chip.setAttribute('aria-pressed', String(m.rights > 0 && Math.abs(Number(chip.dataset.share) - share) < 1e-6));
      });
    }

    function renderTicket(v, m) {
      r.ticker.textContent = v.code || 'SAHAM';
      r.tMeta.textContent = m.ratioOk ? `Rasio ${nf2.format(v.ra)} : ${nf2.format(v.rb)}` : 'Rasio —';
      const empty = !v.shares && !m.ratioOk && !m.hasPrice;
      r.btnCopy.hidden = !m.ready;
      r.btnSample.hidden = !empty;

      if (!m.ready) {
        setNum(r.tBig, NaN, rp);
        r.tSub.textContent = 'Lengkapi jumlah saham, rasio, dan harga tebus.';
        r.tStats.innerHTML = statHtml('HMETD diterima', '—') + statHtml('Saham setelah tebus', '—');
        r.tNote.textContent = empty ? 'Belum ada angka? Coba pakai contoh dulu.' : '';
        return;
      }

      setNum(r.tBig, m.cost, rp);
      r.tSub.textContent = m.exercised
        ? `${num(m.exercised)} HMETD × ${rp2(v.price)}`
        : 'Tidak ada HMETD yang ditebus.';

      let stats =
        statHtml('HMETD diterima', num(m.rights), `dari ${lotText(v.shares)}`) +
        statHtml('Saham setelah tebus', lotText(m.totalShares), `${num(m.totalShares)} lembar`);
      if (Number.isFinite(m.terp)) {
        stats +=
          statHtml('Harga teoritis', rp2(m.terp), 'setelah ex-date') +
          statHtml('Nilai 1 HMETD', rp2(m.rightValue), 'secara teori');
      }
      r.tStats.innerHTML = stats;

      if (Number.isFinite(m.discount) && Math.abs(m.discount) > 5e-5) {
        r.tNote.textContent = m.discount > 0
          ? `Harga tebus ${pct(m.discount)} lebih murah dari harga saat cum.`
          : `Harga tebus ${pct(m.discount)} lebih mahal dari harga saat cum.`;
      } else if (!m.hasMarket) {
        r.tNote.textContent = 'Isi harga saat cum untuk melihat harga teoritis.';
      } else {
        r.tNote.textContent = 'Harga tebus sama dengan harga saat cum.';
      }
    }

    function renderMap(v, m) {
      const shown = renderPriceMap(r, [
        { k: 'tebus', v: m.hasPrice ? v.price : NaN },
        { k: 'terp', v: m.terp },
        { k: 'pasar', v: m.hasMarket ? v.market : NaN },
      ], NAMES, [m.hasPrice ? v.price : NaN, m.hasMarket ? v.market : NaN]);

      r.mapNote.textContent = shown
        ? 'Harga teoritis jatuh di antara harga tebus dan harga saat cum. Jaraknya ke harga tebus adalah nilai 1 HMETD.'
        : 'Isi harga tebus dan harga saat cum untuk melihat harga teoritis.';
    }

    function renderLedger(v, m) {
      const dash = '—';
      const rows = [];
      const left = m.rights - m.exercised;

      rows.push(ledgerRow('Saham lama', v.shares ? lotText(v.shares) : dash, v.shares ? `${num(v.shares)} lembar` : ''));
      rows.push(ledgerRow(
        'HMETD diterima',
        v.shares && m.ratioOk ? num(m.rights) : dash,
        v.shares && m.ratioOk ? `${num(v.shares)} × ${nf2.format(v.rb)} ÷ ${nf2.format(v.ra)}, dibulatkan ke bawah` : ''
      ));
      rows.push(ledgerRow('HMETD ditebus', m.rights ? `${num(m.exercised)} (${pctRound(m.exercised / m.rights)})` : dash));
      if (left > 0) rows.push(ledgerRow('HMETD tidak ditebus', num(left), 'Bisa dijual selama masa perdagangan HMETD'));

      const odd = m.totalShares % LOT_SIZE;
      rows.push(ledgerRow(
        'Saham setelah tebus',
        m.ready ? lotText(m.totalShares) : dash,
        m.ready ? `${num(m.totalShares)} lembar${odd ? ` · ${num(odd)} lembar odd lot` : ''}` : ''
      ));
      if (m.ready) {
        const kept = m.ownershipKept;
        const safe = kept >= 0.9995;
        rows.push(ledgerRow('Porsi kepemilikan', safe ? 'Terjaga' : `Turun ${pct(1 - kept)}`, 'Dibanding sebelum right issue', '', safe ? 'up' : 'down'));
      }
      if (Number.isFinite(m.terp)) {
        rows.push(ledgerRow('Harga teoritis', rp2(m.terp), 'Perkiraan harga setelah ex-date'));
        rows.push(ledgerRow('Nilai 1 HMETD', rp2(m.rightValue), 'Harga teoritis − harga tebus'));
      }
      rows.push(ledgerRow('Dana tebus', m.ready ? rp(m.cost) : dash, m.ready ? `${num(m.exercised)} × ${rp2(v.price)}` : '', 'total'));
      r.ledger.innerHTML = rows.join('');
    }

    function renderScenarios(v, m) {
      if (!m.ready || !Number.isFinite(m.terp) || !m.rights) {
        r.scenTag.hidden = true;
        r.scenNote.textContent = '';
        const needMarket = m.ready && m.rights;
        r.scen.innerHTML = `<div class="empty"><p>${needMarket ? 'Isi harga saat cum' : 'Lengkapi data di atas'} untuk membandingkan hasil menebus, menjual HMETD, atau membiarkannya hangus.</p>${needMarket ? '<button type="button" class="btn-text" data-action="focus-market">Isi harga saat cum</button>' : ''}</div>`;
        return;
      }

      const base = v.shares * v.market;
      const hmetdCash = m.rights * m.rightValue;
      const items = [
        {
          title: 'Tebus semua HMETD',
          desc: `Bayar ${rp(m.rights * v.price)}, saham jadi ${lotText(v.shares + m.rights)}. Porsi kepemilikan terjaga.`,
          stock: (v.shares + m.rights) * m.terp,
          cash: -m.rights * v.price,
        },
        {
          title: 'Jual HMETD',
          desc: m.rightValue > 0
            ? `Dapat sekitar ${rp(hmetdCash)} dari ${num(m.rights)} HMETD. Porsi kepemilikan turun ${pct(m.dilution)}.`
            : `HMETD secara teori tidak bernilai. Porsi kepemilikan turun ${pct(m.dilution)}.`,
          stock: v.shares * m.terp,
          cash: hmetdCash,
        },
        {
          title: 'Biarkan hangus',
          desc: `Tidak bayar apa-apa. Porsi kepemilikan turun ${pct(m.dilution)}.`,
          stock: v.shares * m.terp,
          cash: 0,
        },
      ];

      r.scen.innerHTML = items.map((it) => {
        const change = it.stock + it.cash - base;
        const flat = Math.abs(change) < 1;
        const cls = flat ? '' : change > 0 ? 'up' : 'down';
        const cashText = Math.abs(it.cash) >= 1 ? ` · kas ${it.cash > 0 ? '+' : ''}${rp(it.cash)}` : '';
        return `<article class="sc">
          <div class="sc-main">
            <h3>${it.title}</h3>
            <p>${it.desc}</p>
            <p class="sc-cap">Nilai saham ${rp(it.stock)}${cashText}</p>
          </div>
          <div class="sc-pl ${cls}">${flat ? 'Rp0' : `${change > 0 ? '+' : ''}${rp(change)}`}<small>${flat ? 'nilai tetap' : `${change > 0 ? '+' : '−'}${pct(change / base)}`}</small></div>
        </article>`;
      }).join('');

      r.scenTag.hidden = false;
      r.scenTag.textContent = `Harga teoritis ${rp2(m.terp)}`;
      r.scenNote.textContent = m.rightValue > 0
        ? `Perubahan dihitung dari nilai sahammu saat cum (${rp(base)}) ke nilai pada harga teoritis setelah ex-date. Menebus atau menjual HMETD menjaga nilaimu; membiarkannya hangus berarti kehilangan sekitar ${rp(hmetdCash)}.`
        : `Harga tebus ${rp2(v.price)} tidak lebih murah dari harga teoritis ${rp2(m.terp)}, jadi HMETD secara teori tidak bernilai.`;
    }

    function summary() {
      const { v, m } = last;
      const lines = [`Simulasi right issue${v.code ? ' ' + v.code : ''} (rasio ${nf2.format(v.ra)}:${nf2.format(v.rb)})`];
      lines.push(`• Saham dimiliki: ${lotText(v.shares)} (${num(v.shares)} lembar)`);
      lines.push(`• HMETD diterima: ${num(m.rights)}`);
      lines.push(`• Ditebus: ${num(m.exercised)} × ${rp2(v.price)} = ${rp(m.cost)}`);
      lines.push(`• Total saham: ${lotText(m.totalShares)} (${num(m.totalShares)} lembar)`);
      if (Number.isFinite(m.terp)) {
        lines.push(`• Harga teoritis setelah ex-date: ${rp2(m.terp)}`);
        lines.push(`• Nilai teoritis 1 HMETD: ${rp2(m.rightValue)}`);
      }
      lines.push('Simulasi, bukan rekomendasi. Belum termasuk biaya broker.');
      return lines.join('\n');
    }

    function dock() {
      const m = last && last.m;
      return {
        ready: !!(m && m.ready),
        items: [
          ['Dana tebus', m && m.ready ? rp(m.cost) : '—'],
          ['Saham jadi', m && m.ready ? lotText(m.totalShares) : '—'],
        ],
      };
    }

    function setUnit(next) {
      if (next === unit) return;
      const val = parseNum(f.qty.value);
      if (Number.isFinite(val)) {
        f.qty.value = toField(next === 'lembar' ? Math.floor(val) * LOT_SIZE : Math.floor(val / LOT_SIZE));
      }
      unit = next;
      syncUnitButtons(root, unit);
    }

    function applySample() {
      FIELDS.forEach((k) => { f[k].value = SAMPLE[k]; });
      unit = 'lot';
      share = 1;
      syncUnitButtons(root, unit);
      isSample = true;
    }

    function clear() {
      FIELDS.forEach((k) => { f[k].value = ''; });
      share = 1;
      isSample = false;
      f.qty.focus();
    }

    function onInput(el) {
      if (el.matches('[data-code]')) el.value = sanitizeCode(el.value);
      if (el === range) {
        const rights = Number(range.max);
        share = rights ? Number(range.value) / rights : 1;
      }
      isSample = false;
    }

    function onAction(action, btn) {
      if (action === 'unit') setUnit(btn.dataset.unit);
      else if (action === 'share') share = Number(btn.dataset.share);
      else if (action === 'clear') clear();
      else if (action === 'sample') applySample();
      else if (action === 'focus-market') { f.market.focus(); return; }
      else if (action === 'to-avg') { handOff(); return; }
      else return;
      if (action !== 'sample') isSample = false;
      render();
    }

    function handOff() {
      if (!last || !last.m.ready) return;
      const { v, m } = last;
      const needAvg = avgMode.receive({ code: v.code, shares: v.shares, exercised: m.exercised, price: v.price });
      setMode('avg', true);
      if (needAvg) {
        avgMode.focusField.focus();
        toast('Isi harga rata-rata kamu untuk melihat avg setelah tebus');
      } else {
        toast('Data right issue dipindahkan ke Hitung Avg');
      }
    }

    function serialize() {
      const values = {};
      FIELDS.forEach((k) => { values[k] = f[k].value; });
      return { values, share, unit, sample: isSample };
    }

    function restore(s) {
      if (!s || !s.values) return applySample();
      FIELDS.forEach((k) => {
        const val = s.values[k] ?? '';
        f[k].value = k === 'code' ? sanitizeCode(val) : formatDigits(val, false);
      });
      share = Number.isFinite(s.share) ? Math.min(1, Math.max(0, s.share)) : 1;
      unit = s.unit === 'lembar' ? 'lembar' : 'lot';
      syncUnitButtons(root, unit);
      isSample = !!s.sample;
    }

    return {
      key: 'ri', root, ticket: $('ri-ticket'),
      render, summary, dock, onInput, onAction, serialize, restore,
      relayout: () => layoutLabels(r),
      isReady: () => !!(last && last.m.ready),
    };
  })();

  // =====================================================================
  // Pengendali halaman
  // =====================================================================
  const modes = { avg: avgMode, ri: riMode };
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const HASH = { avg: 'avg', ri: 'right-issue' };
  let active = 'avg';

  function setMode(key, focusTab = false) {
    if (!modes[key]) return;
    active = key;
    tabs.forEach((tab) => {
      const on = tab.dataset.mode === key;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus({ preventScroll: true });
    });
    Object.values(modes).forEach((m) => { m.root.hidden = m.key !== key; });
    modes[key].render();
    modes[key].relayout();
    try { history.replaceState(null, '', `#${HASH[key]}`); } catch (e) { /* abaikan */ }
    updateDock();
    save();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      setMode(next.dataset.mode, true);
    });
  });

  const modeOf = (el) => {
    const panel = el.closest('[data-panel]');
    return panel ? modes[panel.dataset.panel] : null;
  };

  document.addEventListener('input', (e) => {
    const el = e.target;
    const mode = modeOf(el);
    if (!mode) return;
    if (el.matches('[data-num]')) onNumericInput(el);
    mode.onInput(el);
    mode.render();
    updateDock();
    save();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const mode = modeOf(btn);
    if (!mode) return;
    if (btn.dataset.action === 'copy') {
      if (mode.isReady()) copyText(mode.summary());
      return;
    }
    mode.onAction(btn.dataset.action, btn);
    updateDock();
    save();
  });

  document.querySelectorAll('form').forEach((form) => form.addEventListener('submit', (e) => e.preventDefault()));

  // ---------- Dock ringkasan di ponsel ----------
  const narrow = window.matchMedia('(max-width: 959px)');
  const visible = new Map();
  const dockEl = $('dock');

  function updateDock() {
    const mode = modes[active];
    const info = mode.dock();
    info.items.forEach(([label, value], i) => {
      $(`d-label-${i + 1}`).textContent = label;
      $(`d-val-${i + 1}`).textContent = value;
    });
    const show = narrow.matches && info.ready && visible.get(mode.ticket) === false;
    dockEl.hidden = !show;
    document.body.classList.toggle('has-dock', show);
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => visible.set(en.target, en.isIntersecting));
      updateDock();
    }, { threshold: 0.2 });
    Object.values(modes).forEach((m) => io.observe(m.ticket));
  }
  if (narrow.addEventListener) narrow.addEventListener('change', updateDock);

  $('dock-btn').addEventListener('click', () => {
    modes[active].ticket.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  // ---------- Salin & toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? 'Ringkasan disalin' : 'Gagal menyalin. Salin manual dari bagian Rincian.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Ringkasan disalin'), fallback);
    } else {
      fallback();
    }
  }

  // ---------- Simpan di browser ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode: active, avg: avgMode.serialize(), ri: riMode.serialize() }));
    } catch (e) { /* penyimpanan tidak tersedia */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
      const old = localStorage.getItem(OLD_STORE_KEY);
      if (old) {
        const o = JSON.parse(old);
        const v = o.values || {};
        return {
          mode: 'ri',
          ri: {
            values: { code: v.code, qty: v.lot, ra: v.ra, rb: v.rb, price: v.price, market: v.market },
            share: o.share, unit: o.unit, sample: o.sample,
          },
        };
      }
    } catch (e) { /* abaikan */ }
    return null;
  }

  // Label peta harga perlu diukur ulang saat ukuran berubah atau font selesai dimuat.
  const relayoutActive = () => modes[active].relayout();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(relayoutActive);
    document.querySelectorAll('.pmap').forEach((el) => ro.observe(el));
  } else {
    window.addEventListener('resize', relayoutActive);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayoutActive);

  // ---------- Mulai ----------
  const saved = load() || {};
  avgMode.restore(saved.avg);
  riMode.restore(saved.ri);
  avgMode.render();
  riMode.render();
  const fromHash = { '#avg': 'avg', '#right-issue': 'ri' }[location.hash];
  setMode(fromHash || (modes[saved.mode] ? saved.mode : 'avg'));
})();
