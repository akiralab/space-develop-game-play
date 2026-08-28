/* ending.js — 終局画面「10年間の宇宙開発の総括」
   本体（index.html）には触らず、window.SDG.onDraw のフック経由でのみ動く。

   構成:
     Act1 幕開け   「10年間の宇宙開発が、終わりました」
     Act2 順位発表  4位→1位を下から迫り上げ、貢献度を0からカウントアップ
     Act3 10年の記録 打上成功/失敗・解決した課題・軌道上の衛星・資金調達 ＋ 得点推移グラフ
                    ＋ 解決した課題の券面
     Act4 結び      勝敗で分岐した見出し ＋「もう一度遊ぶ」

   演出は全体で約9秒。クリック・Esc・左下ボタンでいつでもスキップできる。
   prefers-reduced-motion のときは最初から完成形を出す（アニメーションを一切走らせない）。
   音が出せない会場を前提に、ナレーションは字幕テキストを明示して呼ぶ。 */
(() => {
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PARAMS = new URLSearchParams(location.search);
  const FORCE = PARAMS.get('fx') === 'end';        // ?fx=end でリハーサル表示

  const RANK_COLOR = ['#f2c14e', '#b9c6e4', '#cd8f52', '#6f80a6'];
  const MEDAL = ['🥇', '🥈', '🥉', '🎖'];
  const LINE_COLOR = ['#f2c14e', '#5b9bd5', '#e0685f', '#9b7fd4'];

  const NARR = {
    open: '10年間の宇宙開発が終わりました。最終結果を発表します。',
    win:  'おめでとうございます。あなたが最も多くの貢献度を積み上げました。',
    lose: '今回は届きませんでした。次はどの課題に、どの衛星を当てますか。',
  };

  /* 課題名 → slug（券面を出すため）。無くても文字だけで成立する。 */
  let MI = {}, NAME2MISSION = {};
  const READY = fetch('assets/missions.json').then(r => r.json()).catch(() => ({}))
    .then(mi => {
      MI = mi || {};
      for (const [slug, m] of Object.entries(MI)) if (m && m.name) NAME2MISSION[m.name] = slug;
    });

  const esc = t => String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------------- ログの解析 ---------------- */
  /* プレイヤー名 → 席番号。ログ側の接頭辞は P{席+1}。 */
  function seatOf(name) {
    if (name === 'あなた') return 0;
    const m = String(name).match(/CPU(\d+)/);
    return m ? Number(m[1]) : -1;
  }

  function analyze(s) {
    const stats = {};
    for (const r of s.standings) {
      stats[seatOf(r.name)] = {ok: 0, ng: 0, dual: 0, solves: [],
                               fund: 0, fundN: 0, expired: 0, declare: 0, best: null};
    }
    const at = i => stats[i];
    const series = [];                      // 年ごとの [{name, score}]

    for (const raw of (s.log || [])) {
      const l = String(raw);
      const t = l.trim();
      let m;
      if (t[0] === '[') {                   // 年末のスコア表 [あなた: 5点/100億] …
        const row = [];
        const re = /\[([^\[\]:]+):\s*(-?\d+)点\/(-?\d+)億\]/g;
        let g;
        while ((g = re.exec(l))) row.push({name: g[1].trim(), score: +g[2], money: +g[3]});
        if (row.length) series.push(row);
        continue;
      }
      if ((m = l.match(/^\s*P(\d+)\s+🚀打上(（2機同時）)?:/))) {
        const p = at(+m[1] - 1); if (!p) continue;
        if (/失敗/.test(l)) p.ng++; else { p.ok++; if (m[2]) p.dual++; }
        continue;
      }
      if ((m = l.match(/^\s*P(\d+)\s+(?:🎯即達成|📡応札):\s*(.+?)×(.+?)\s*→\s*「(.+?)」\s*\*\*(\d+)点\*\*/))) {
        const p = at(+m[1] - 1); if (!p) continue;
        const rec = {rocket: m[2].trim(), sensor: m[3].trim(), mission: m[4], pts: +m[5]};
        p.solves.push(rec);
        if (!p.best || rec.pts > p.best.pts) p.best = rec;
        continue;
      }
      if ((m = l.match(/^\s*P(\d+)\s+💰資金調達:.*?\+(\d+)億/))) {
        const p = at(+m[1] - 1); if (!p) continue;
        p.fund += +m[2]; p.fundN++;
        continue;
      }
      if ((m = l.match(/^\s*P(\d+)\s+⌛設計寿命:/)))  { const p = at(+m[1] - 1); if (p) p.expired++; continue; }
      if ((m = l.match(/^\s*P(\d+)\s+🔧開発宣言:/)))  { const p = at(+m[1] - 1); if (p) p.declare++; continue; }
    }
    return {stats, series};
  }

  /* ---------------- 小道具 ---------------- */
  let skipped = false;
  const waiters = [];
  function wait(ms) {
    if (skipped || REDUCE) return Promise.resolve();
    return new Promise(res => {
      const fin = () => { clearTimeout(t); const k = waiters.indexOf(fin);
                          if (k >= 0) waiters.splice(k, 1); res(); };
      const t = setTimeout(fin, ms);
      waiters.push(fin);
    });
  }
  /* 0 → to のカウントアップ。時計は performance.now() に統一し、進捗は必ず 0〜1 に
     丸める（rAFの引数と混ぜると環境によって負の進捗になり、桁の壊れた数字が出る）。 */
  function countUp(el, to, ms) {
    if (skipped || REDUCE || !ms) { el.textContent = to; return; }
    const t0 = performance.now();
    const tick = () => {
      const k = Math.max(0, Math.min(1, (performance.now() - t0) / ms));
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && !skipped) requestAnimationFrame(tick); else el.textContent = to;
    };
    requestAnimationFrame(tick);
    setTimeout(() => { el.textContent = to; }, ms + 80);   // rAFが止まる環境でも必ず着地させる
  }
  /* ナレーションは直列に流す。以前は build() の中の say('win'/'lose') と
     直後の say('open') が同じミリ秒に発火し、勝敗のセリフが即上書きされていた。 */
  let sayChain = Promise.resolve();
  function say(key) {
    if (skipped || !window.SDG.narrate) return;
    const id = 'end_' + key;
    sayChain = sayChain
      .then(() => (skipped ? null : window.SDG.narrate(id, {text: NARR[key]})))
      .catch(() => {});
  }

  /* ---------------- 画面の組み立て ---------------- */
  let root = null, built = false;

  function starfield() {
    const sh = [];
    for (let i = 0; i < 110; i++) {
      const r = Math.random() < .18 ? 1 : 0;
      sh.push(`${(Math.random() * 100).toFixed(2)}vw ${(Math.random() * 92).toFixed(2)}vh 0 ${r}px ` +
              `rgba(255,255,255,${(.18 + Math.random() * .6).toFixed(2)})`);
    }
    return sh.join(',');
  }

  function chartSVG(series, standings) {
    const years = series.length;
    if (years < 2) return '';
    const W = 620, H = 138, L = 30, R = 12, T = 12, B = 22;
    const max = Math.max(4, ...series.flatMap(r => r.map(v => v.score)));
    const x = i => L + (W - L - R) * (years === 1 ? 0 : i / (years - 1));
    const y = v => T + (H - T - B) * (1 - v / max);
    const order = standings.map(r => r.name);
    const lines = order.map((nm, k) => {
      const pts = series.map((row, i) => {
        const e = row.find(v => v.name === nm);
        return `${x(i).toFixed(1)},${y(e ? e.score : 0).toFixed(1)}`;
      });
      const you = nm === 'あなた';
      const col = you ? '#f2c14e' : LINE_COLOR[(k % (LINE_COLOR.length - 1)) + 1];
      // 折れ線の長さ（stroke-dasharray用）をおおよそで見積もる
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1].split(',').map(Number);
        const [bx, by] = pts[i].split(',').map(Number);
        len += Math.hypot(bx - ax, by - ay);
      }
      const last = pts[pts.length - 1].split(',');
      return `<polyline class="ln" points="${pts.join(' ')}" stroke="${col}"
                 stroke-width="${you ? 3 : 1.6}" opacity="${you ? 1 : .72}"
                 style="--len:${Math.ceil(len) + 2}; transition-delay:${(k * .1).toFixed(2)}s"/>
              <circle cx="${last[0]}" cy="${last[1]}" r="${you ? 4 : 2.6}" fill="${col}"/>`;
    }).join('');
    const gl = [0, max].map(v =>
      `<line class="gl" x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}"/>
       <text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
    const ax = [1, Math.ceil(years / 2), years].map(n =>
      `<text class="ax" x="${x(n - 1)}" y="${H - 6}" text-anchor="middle">${n}年</text>`).join('');
    const leg = standings.map((r, k) => {
      const col = r.name === 'あなた' ? '#f2c14e' : LINE_COLOR[(k % (LINE_COLOR.length - 1)) + 1];
      return `<span><i style="background:${col}"></i>${esc(r.name.replace(/（.+）/, ''))}</span>`;
    }).join('');
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
              ${gl}${ax}${lines}</svg></div><div class="leg">${leg}</div>`;
  }

  function tile(label, value, unit, sub, color) {
    return `<div class="tile" style="--c:${color || '#e8ecf8'}">
      <div class="tl">${label}</div>
      <div class="tv"><b class="num" data-to="${value}">0</b>${unit ? `<small>${unit}</small>` : ''}</div>
      <div class="ts" title="${esc(sub)}">${esc(sub)}</div></div>`;
  }

  function build(s) {
    const {stats, series} = analyze(s);
    const st = s.standings || [];
    const meIdx = Math.max(0, st.findIndex(r => r.name === 'あなた'));
    const me = st[meIdx] || {name: 'あなた', score: 0, money: 0, launch_ok: 0};
    const mine = stats[0] || {ok: 0, ng: 0, dual: 0, solves: [],
                              fund: 0, fundN: 0, expired: 0, declare: 0, best: null};
    const top = st[0] || me;
    const maxScore = Math.max(1, ...st.map(r => r.score));
    const won = meIdx === 0;

    /* 表彰台の行 */
    const rows = st.map((r, i) => {
      const seat = seatOf(r.name);
      const ss = stats[seat] || {};
      const you = seat === 0;
      const pol = (r.name.match(/（(.+)）/) || [])[1] || '';
      return `<div class="prow ${you ? 'you' : ''} ${i === 0 ? 'win' : ''}"
                   style="--c:${RANK_COLOR[Math.min(i, 3)]}; --w:${Math.round(r.score / maxScore * 100)}%">
        <div class="pbar"></div>
        <div class="pk">${i + 1}</div>
        <div class="pmed">${MEDAL[Math.min(i, 3)]}</div>
        <div class="pname">${esc(r.name.replace(/（.+）/, ''))}${pol ? `<span class="pol">${esc(pol)}</span>` : ''}${you ? '<span class="pyou">YOU</span>' : ''}</div>
        <div class="pright">
          <div class="psc"><b class="num" data-to="${r.score}">0</b><small>点</small></div>
          <div class="pmeta">🚀成功 ${r.launch_ok}${ss.ng ? `／失敗 ${ss.ng}` : ''}　💰${r.money}億</div>
        </div></div>`;
    }).join('');

    /* 勝敗の見出し */
    const gap = top.score - me.score;
    let vico = '🏆', vtx = 'あなたの勝利！', vc = '#f2c14e', vsub = '';
    if (won) {
      const second = st[1];
      vsub = `10年で <b>${me.score}点</b> を積み上げ、` +
             (second ? `2位の${esc(second.name.replace(/（.+）/, ''))}に <b>${me.score - second.score}点差</b>をつけて` : '') +
             `宇宙開発レースを制しました。`;
      say('win');
    } else if (meIdx === 1) {
      vico = '🥈'; vtx = '惜しくも 2位'; vc = '#b9c6e4';
      vsub = `首位まであと <b>${gap}点</b>。あの打ち上げが1回成功していれば、結果は違いました。`;
      say('lose');
    } else {
      vico = MEDAL[Math.min(meIdx, 3)]; vtx = `${meIdx + 1}位`; vc = '#b9c6e4';
      vsub = `首位は ${esc(top.name.replace(/（.+）/, ''))}（<b>${top.score}点</b>）。` +
             `課題に刺さる系統の衛星を選べたかが、そのまま差になりました。`;
      say('lose');
    }
    if (me.score === 0) vsub += ' まずは1機、軌道に届けるところから。';

    /* 10年の記録タイル */
    const solvePts = mine.solves.reduce((a, b) => a + b.pts, 0);
    const rate = (mine.ok + mine.ng) ? Math.round(mine.ok / (mine.ok + mine.ng) * 100) : 0;
    const orbit = (s.you && s.you.orbit) || [];
    const pending = ((s.you && s.you.table) || []).length + ((s.you && s.you.sats) || []).length;
    const tiles = [
      tile('🚀 打ち上げ成功', mine.ok, '回',
           mine.ok + mine.ng ? `${mine.ok + mine.ng}回中・成功率 ${rate}%` : '打ち上げに至らず', '#e0685f'),
      tile('🎯 解決した課題', mine.solves.length, '件',
           mine.solves.length ? `貢献度 合計 ${solvePts}点` : '課題は解けなかった', '#4caf82'),
      tile('⭐ 最大の一手', mine.best ? mine.best.pts : 0, '点',
           mine.best ? `${mine.best.sensor}／${mine.best.mission}` : '—', '#f2c14e'),
      tile('🛰 軌道上の衛星', orbit.length, '機',
           orbit.length ? orbit.map(o => o.name).join('・') : (pending ? `開発中 ${pending}枚` : '—'), '#5b9bd5'),
      tile('💰 調達した資金', mine.fund, '億', `${mine.fundN}回の資金調達`, '#e8ecf8'),
      tile('🔧 開発した機体', mine.declare, '枚',
           [mine.dual ? `2機同時 ${mine.dual}回` : '',
            mine.expired ? `⌛設計寿命で退役 ${mine.expired}機` : ''
           ].filter(Boolean).join('・') || '宣言したロケットと衛星の合計', '#9b7fd4'),
    ].join('');

    /* 解決した課題の券面（無ければ軌道に残った衛星、それも無ければ一言） */
    let cardTitle = '解決した課題', cards = '';
    if (mine.solves.length) {
      const show = mine.solves.slice(0, 5);
      cards = show.map(v => {
        const slug = NAME2MISSION[v.mission];
        return `<div class="ecd"><div class="fr">
          ${slug ? `<iframe src="cards/mission/${slug}.html" tabindex="-1"></iframe>` : ''}
          <div class="pt">${v.pts}点</div></div>
          <div class="nm" title="${esc(v.mission)}">${esc(v.mission)}</div></div>`;
      }).join('') + (mine.solves.length > 5
        ? `<div class="ecd"><div class="fr" style="display:flex;align-items:center;justify-content:center;
             font-size:15px;font-weight:800;color:#96a0c0">＋${mine.solves.length - 5}</div>
           <div class="nm">ほかにも解決</div></div>` : '');
    } else if (orbit.length) {
      cardTitle = '軌道に残った衛星';
      cards = orbit.slice(0, 5).map(o => `<div class="ecd"><div class="fr">
          <iframe src="cards/${o.kind}/${o.slug}.html" tabindex="-1"></iframe></div>
          <div class="nm" title="${esc(o.name)}">${esc(o.name)}</div></div>`).join('');
    } else {
      cards = `<div class="enone">この10年で軌道に届いた衛星はありませんでした。<br>
        課題の系統（光学・SAR・熱赤外・ハイパー）に合う衛星を先に宣言するのが近道です。</div>`;
    }

    root = document.createElement('div');
    root.id = 'sdg-end';
    root.className = REDUCE ? 'nofx' : '';
    root.innerHTML = `
      <div class="erim"></div>
      <div class="estars" style="box-shadow:${starfield()}"></div>
      <div class="eflash"></div>
      <div class="eopen">
        <div class="ok1">MISSION COMPLETE</div>
        <div class="ot">10年間の宇宙開発が、終わりました</div>
        <div class="oline"></div>
        <div class="os">最終結果を発表します</div>
      </div>
      <div class="emain">
        <div class="ebody">
          <div class="ecol eleft">
            <div class="kick">FINAL STANDINGS ｜ 10 YEARS</div>
            <div class="everdict" style="--vc:${vc}">
              <span class="vico">${vico}</span><span class="vtx">${vtx}</span></div>
            <div class="vsub">${vsub}</div>
            <div class="rows">${rows}</div>
            <div class="efoot">
              <button class="eb go" data-act="again">🔄 もう一度遊ぶ</button>
              <button class="eb" data-act="close">📋 詳細な結果を見る</button>
            </div>
          </div>
          <div class="ecol eright">
            <div class="lbl">あなたの10年間</div>
            <div class="tiles">${tiles}</div>
            <div class="lbl mt">貢献度の推移（1年目 → 10年目）</div>
            ${chartSVG(series, st) || '<div class="enone">記録が足りず、推移を描けませんでした。</div>'}
            <div class="lbl mt">${cardTitle}</div>
            <div class="ecards">${cards}</div>
          </div>
        </div>
      </div>
      <button class="eskip">⏭ 演出をスキップ</button>
      <div class="ehint">クリック / Esc でスキップ</div>`;
    document.body.appendChild(root);
    built = true;

    /* 操作 */
    root.querySelector('.eskip').onclick = e => { e.stopPropagation(); skipAll(); };
    root.addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (b) { e.stopPropagation(); return b.dataset.act === 'again' ? again() : close(); }
      if (e.target.closest('.eb')) return;
      skipAll();
    });
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return {won, series};
  }

  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { if (skipped) close(); else skipAll(); }
    if (e.key === 'Enter' && skipped) again();
  }

  /* 演出を最後まで飛ばす */
  function skipAll() {
    if (!root || skipped) return;
    skipped = true;
    root.classList.add('nofx', 'p-main', 'p-verdict', 'p-wide', 'p-done');
    root.querySelectorAll('.prow').forEach(r => r.classList.add('on'));
    root.querySelectorAll('.num').forEach(n => n.textContent = n.dataset.to);
    root.querySelectorAll('.chart .ln').forEach(l => l.style.strokeDashoffset = '0');
    root.querySelectorAll('.ecfi').forEach(c => c.remove());
    waiters.splice(0).forEach(f => f());
    if (window.SDG.stopNarration) window.SDG.stopNarration();
    if (window.SDG.narrator) { window.SDG.narrator.talk(false); window.SDG.narrator.show(false); }
  }

  function close() {
    if (!root) return;
    removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    root.remove(); root = null;
    if (window.SDG.stopNarration) window.SDG.stopNarration();
    if (window.SDG.narrator) { window.SDG.narrator.talk(false); window.SDG.narrator.show(false); }
  }

  async function again() {
    const b = root && root.querySelector('[data-act="again"]');
    if (b) { b.disabled = true; b.textContent = '準備中…'; }
    try {
      await fetch('/new_game', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                body: '{}'});
    } catch (e) { /* 失敗してもリロードで拾う */ }
    location.reload();          // タイトル → 開幕シーケンスから通しで遊び直せる
  }

  function confetti() {
    if (REDUCE || skipped) return;
    const cols = ['#f2c14e', '#5b9bd5', '#e0685f', '#4caf82', '#ffffff'];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('i');
      c.className = 'ecfi';
      c.style.left = (Math.random() * 100).toFixed(2) + 'vw';
      c.style.background = cols[i % cols.length];
      c.style.animationDuration = (2.2 + Math.random() * 1.6).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * .7).toFixed(2) + 's';
      c.style.transform = `rotate(${Math.random() * 180}deg)`;
      root.appendChild(c);
      setTimeout(() => c.remove(), 4600);
    }
  }

  /* ---------------- 進行 ---------------- */
  async function run(s) {
    await READY;                        // 課題名→slug が揃ってから組む（券面を出すため）
    // 「10年間が終わりました」を先に積む。build() の中で勝敗のセリフが積まれるので、
    // 先に積んでおかないと直列キューの順序が逆になり、勝敗が冒頭でネタバレする。
    say('open');
    const info = build(s);

    if (REDUCE) {                       // 動きを望まない環境では完成形をそのまま出す
      skipAll();
      return;
    }

    if (window.SDG.narrator) { window.SDG.narrator.show(true); window.SDG.narrator.talk(true); }
    await wait(2300);
    if (window.SDG.narrator) { window.SDG.narrator.talk(false); window.SDG.narrator.show(false); }
    if (skipped) return;

    root.classList.add('p-main');
    await wait(420);

    /* 下位から1位へ迫り上げる */
    const rows = [...root.querySelectorAll('.prow')].reverse();
    for (let i = 0; i < rows.length; i++) {
      if (skipped) return;
      const r = rows[i];
      const last = i === rows.length - 1;
      if (last) { await wait(430); root.querySelector('.eflash').classList.add('on'); }
      r.classList.add('on');
      countUp(r.querySelector('.num'), Number(r.querySelector('.num').dataset.to), last ? 900 : 620);
      await wait(last ? 780 : 460);
    }
    if (skipped) return;

    root.classList.add('p-verdict');
    if (info.won) confetti();
    await wait(900);
    if (skipped) return;

    /* 記録パネルを開く */
    root.classList.add('p-wide');
    root.querySelectorAll('.eright .num').forEach((n, i) =>
      setTimeout(() => countUp(n, Number(n.dataset.to), 700), 120 + i * 70));
    await wait(1150);
    if (skipped) return;
    root.classList.add('p-done');
  }

  /* ---------------- 起動 ---------------- */
  let fired = false;
  window.SDG.onDraw.push(s => {
    const over = s && (s.phase === 'over' || FORCE);
    if (!over) { fired = false; if (root) close(); return; }   // 新規ゲームで畳む
    if (fired) return;
    fired = true;
    skipped = false;
    // 開幕演出やタイトルが残っていれば、それが消えてから
    const kick = () => {
      const op = document.getElementById('sdg-open');
      const ru = document.getElementById('sdg-rules');
      // ルール解説中に被さると、下のルール画面が操作不能になる（クリックを吸ってしまう）
      if (document.getElementById('sdg-title')
          || (op && op.classList.contains('on'))
          || (ru && ru.classList.contains('on'))) {
        return setTimeout(kick, 200);
      }
      run(s).catch(e => { console.warn('ending:', e); if (root) skipAll(); });
    };
    kick();
  });

  window.SDG.showEnding = st => { if (root) close(); fired = true; skipped = false; run(st); };
})();
