/* card_fx.js — カード拡大時のスペック解説（issue #5）
   「なぜSAR衛星は大きくて高いのか」をひと目で伝える。全24枚を軽量CSSで賄い、
   動画は使わない（24本は容量・レンダリング時間ともに現実的でないため）。
   数値は data/*.csv 由来の specs.json。 */
(() => {
  let SPEC = {};
  fetch('assets/specs.json').then(r => r.json()).then(s => SPEC = s).catch(() => {});

  // 実機の諸元と来歴（data/*.csv → tools/build_carddoc.py が生成）。
  // 無くても比較バーだけで成立するよう、読めなければ黙って諦める。
  let DOC = {};
  fetch('assets/carddoc.json').then(r => r.json()).then(d => DOC = d).catch(() => {});

  const esc = t => String(t).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));

  function docHtml(slug) {
    const d = DOC[slug];
    if (!d) return '';
    let h = '';
    if (d.specs && d.specs.length) {
      h += '<div class="dochead">実機の諸元</div><table class="docspec">' +
           d.specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') +
           '</table>';
    }
    if (d.news) h += `<div class="docnews">${esc(d.news)}</div>`;
    return h;
  }

  // 全カード中の最大値（比較バーの正規化用）
  const maxOf = (t, k) => Math.max(...Object.values(SPEC)
    .filter(v => v.t === t && v[k] != null).map(v => v[k]), 1);

  const BAND = {
    OPT: ['可視・近赤外', '#5b9bd5'], SAR: ['マイクロ波', '#e0685f'],
    TIR: ['熱赤外', '#e8964a'], HYP: ['ハイパースペクトル', '#9b7fd4'],
  };

  function row(label, valText, pct, color) {
    return `<div class="row">
      <div class="lb"><span>${label}</span><b>${valText}</b></div>
      <div class="track"><div class="fill" data-w="${Math.max(2, Math.min(100, pct))}"
           style="background:linear-gradient(90deg,${color},${color}bb)"></div></div>
    </div>`;
  }

  function build(slug) {
    const s = SPEC[slug];
    if (!s) return '';
    let html = '<div class="specbars">';
    if (s.t === 'rocket') {
      html += row('打上能力（LEO）', `${s.payload} t`, s.payload / maxOf('rocket', 'payload') * 100, '#e0685f');
      if (s.rate != null) html += row('打上成功率（実績）', `${s.rate}%`, s.rate, '#4caf82');
      html += row('開発コスト', `${s.cost} 億`, s.cost / maxOf('rocket', 'cost') * 100, '#f2c14e');
      html += `<div class="lb" style="margin-top:8px"><span>クラス</span><b>${s.klass}級 / 第${s.gen}世代</b></div>`;
    } else {
      if (s.res != null) {
        // 分解能は「小さいほど高性能」＝バーは反転して伸ばす
        const best = Math.min(...Object.values(SPEC).filter(v => v.t === 'sensor' && v.res != null)
          .map(v => v.res));
        html += row('分解能（細かいほど高性能）', `${s.res} m`, (best / s.res) * 100, '#5b9bd5');
      }
      const b = BAND[s.band] || ['—', '#96a0c0'];
      html += row('観測波長', b[0], 100, b[1]);
      html += row('開発コスト', `${s.cost} 億`, s.cost / maxOf('sensor', 'cost') * 100, '#f2c14e');
      if (s.life) html += `<div class="lb" style="margin-top:8px"><span>設計寿命</span><b>${s.life} 年</b></div>`;
    }
    html += '</div>';
    return html;
  }

  window.SDG.onCardClick.push((kind, slug, meta) => {
    const info = document.getElementById('minfo');
    if (!info || info.style.display === 'none') return;
    const bars = build(slug);
    if (bars) {
      const spec = info.querySelector('.spec');
      if (spec) spec.insertAdjacentHTML('afterend', bars);
      else info.querySelector('h3').insertAdjacentHTML('afterend', bars);

      // 次フレームで幅を入れてバーを伸ばす
      requestAnimationFrame(() => info.querySelectorAll('.fill')
        .forEach(f => f.style.width = f.dataset.w + '%'));
    }
    // 諸元表とニュースは、比較バーと来歴（.lore）のあいだに挟む。
    // 比較バーが出せなくても（specs.json が読めない等）諸元だけは見せる。
    const doc = docHtml(slug);
    if (doc) {
      const anchor = info.querySelector('.specbars') || info.querySelector('.spec')
                     || info.querySelector('h3');
      if (anchor) anchor.insertAdjacentHTML('afterend', doc);
    }
    // 音声解説ボタン（自動再生はしない＝テンポ優先）
    const vid = (kind === 'rocket' ? 'rkt_' : kind === 'sensor' ? 'sat_' : 'mission_') + slug;
    const mf = window.SDG._manifest || {};
    if (mf[vid] && window.SDG.narrate) {
      const b = document.createElement('button');
      b.className = 'narrbtn';
      b.textContent = '🔊 解説を聞く';
      b.onclick = () => {
        window.SDG.narrator && window.SDG.narrator.talk(true);
        window.SDG.narrate(vid).then(() => window.SDG.narrator && window.SDG.narrator.talk(false));
      };
      info.appendChild(b);
    }
  });
})();
