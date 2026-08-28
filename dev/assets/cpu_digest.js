/* cpu_digest.js — 「あなたの手番のあいだに、CPUが何をしたか」を1画面で見せる
 *
 * 課題（初見プレイヤーの声）:
 *   ・自分の手番は分かるが、CPU3体が何をしたのか一瞬で流れて分からない
 *   ・ミッションカードが突然配られて理由が分からない
 * 盤面は正しく変化しているのに、変化の「因果」が画面に出ていなかった。
 *
 * このモジュールは手番のUI・操作フローには一切触らない。
 * end_turn の応答に入っている events の {kind:'cpu'} を拾って、
 *   1) CPUごとの行動を1行ずつ
 *   2) 得点・資金の増減（before → after ▲差分）
 *   3) 打上の成否とダイス目
 *   4) 「『◯◯』が解決されたので、新しい課題『△△』が公開されました」という因果の文章
 *   5) 現在の順位（standings）
 * をオーバーレイ1枚にまとめて出す。クリック（またはEsc）で閉じる。
 *
 * 連携は window.SDG フック経由のみ（index.html 本体のコードは書き換えない）:
 *   ・window.SDG.onDraw       … render() のたびに state が渡る。ここで cpu イベントを拾う
 *   ・window.SDG.syncMissionSeen / revealMission … 課題公開の演出（mission_fx.js）の順番制御。
 *     ダイジェストで「なぜ公開されたか」を説明してから、あの券面フリップを出したいので、
 *     いったん mission_fx の監視を同期して黙らせ、閉じたあとで自分から reveal する。
 *   ・window.SDG.sfx('ui')    … クリック音（無ければ鳴らさない）
 *
 * 依存データ（sim/serve.py と sim/web/assets/engine.js の end_turn が同じ形で返す）:
 *   {kind:'cpu', lines:[...], before:[{i,name,policy,score,money}], after:[...],
 *    from_year, to_year}
 */
(() => {
  'use strict';
  if (!window.SDG || !window.SDG.onDraw) return;

  const REDUCE = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  })();

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /** 長い連結名（「A・B・C」など）を詰める。1画面に収めるため */
  const clip = (s, n) => {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  /* ------------------------------------------------------------------ 解析 */
  /* g.log の1行を、表示用の項目に変換する。ログ文字列の書式は prototype.py
     （say(...) の呼び出し）が正本。engine.js も同じ文字列を出す。 */

  const RE_P = /^P(\d+)\s+([\s\S]*)$/;

  function parseAction(rest) {
    let m;
    if ((m = rest.match(/^🔧開発宣言:\s*(.+?)\s*\(-(\d+)億/))) {
      return {ic: '🔧', head: '開発宣言', body: m[1], tail: '-' + m[2] + '億', tone: 'cost'};
    }
    if ((m = rest.match(/^🔄交換:\s*(.+?)\s*を山札へ戻し(\d+)枚引く/))) {
      return {ic: '🔄', head: '手札交換', body: clip(m[1], 24), tail: m[2] + '枚', tone: ''};
    }
    if ((m = rest.match(/^💰資金調達:\s*🎲(\d)\+(\d)\s*(✨[^+]*)?\+(\d+)億/))) {
      return {ic: '💰', head: '資金調達', tone: 'gain',
              body: '🎲' + m[1] + '＋' + m[2] + (m[3] ? ' ' + m[3].trim() : ''),
              tail: '+' + m[4] + '億'};
    }
    if ((m = rest.match(/^🔗搭載\(無料\):\s*(.+?)\s*に\s*(.+?)\s*を(追加搭載（デュアルローンチ準備）|搭載)/))) {
      return {ic: '🔗', head: '搭載', body: clip(m[1], 16) + ' ← ' + clip(m[2], 16),
              tail: m[3][0] === '追' ? 'デュアル準備' : '', tone: ''};
    }
    if ((m = rest.match(/^🚀打上(（2機同時）)?:\s*(.+?)\s*\(-\d+億\)\s*🎲(\d)\+(\d)\s*([\s\S]*)$/))) {
      const ok = m[5].indexOf('成功') >= 0;
      return {ic: '🚀', head: '打ち上げ' + (m[1] ? '（2機同時）' : ''),
              body: clip(m[2], 26),
              tail: '🎲' + m[3] + '＋' + m[4] + ' = ' + (Number(m[3]) + Number(m[4])) +
                    '　' + (ok ? '成功' : '失敗'),
              tone: ok ? 'ok' : 'ng', big: true};
    }
    if ((m = rest.match(/^(🎯即達成|📡応札):\s*(.+?)\s*→「(.+?)」\s*\*\*(\d+)点\*\*\s*\(\+(\d+)億\)/))) {
      return {ic: '🎯', head: m[1] === '📡応札' ? '軌道上の衛星で達成' : '打上と同時に達成',
              body: '「' + m[3] + '」', tail: m[4] + '点 ＋' + m[5] + '億',
              tone: 'ok', big: true, solved: m[3]};
    }
    if ((m = rest.match(/^⬆️進化:\s*(.+?)\s*→\s*(.+?)\s*\(-(\d+)億/))) {
      // v2.5 で廃止されたアクション。過去ログを流し込んだときのための保険
      return {ic: '⬆️', head: '進化', body: clip(m[1], 14) + ' → ' + clip(m[2], 14),
              tail: '-' + m[3] + '億', tone: 'cost'};
    }
    if ((m = rest.match(/^⌛設計寿命:\s*(.+?)\s*退場/))) {
      return {ic: '⌛', head: '設計寿命で退役', body: clip(m[1], 26), tail: '', tone: 'dim'};
    }
    // 未知の書式でも黙って落とさず、そのまま出す（ルール追加時の保険）
    return {ic: '・', head: '', body: clip(rest, 40), tail: '', tone: 'dim'};
  }

  /**
   * lines を「CPUごとの行動」と「課題の公開（因果つき）」に振り分ける。
   * @returns {{acts: Object<number, Array>, story: Array, years: Array<number>}}
   */
  function parseLines(lines, fromYear) {
    const acts = {};        // プレイヤー index -> 項目の配列
    const story = [];       // 課題の公開・回収の出来事
    const years = [];
    let lastSolve = null;   // 直前の「達成」。次に来る 🌏 の理由になる
    // 手番順がローテーションするため、1回のダイジェストは「その年の残り」と
    // 「次の年のはじめ」にまたがる。年を持たせないと、CPUが1年に2回開発したように
    // 見えてしまう（実際はルールどおり1年2アクション・同一種類1回まで）。
    let curYear = fromYear || null;

    for (const raw of lines || []) {
      const l = String(raw).replace(/^\n+/, '').trim();
      if (!l) continue;
      if (l.indexOf('**T') === 0) {            // 年の見出し
        const y = l.match(/^\*\*T(\d+)年目\*\*/);
        if (y) { years.push(Number(y[1])); curYear = Number(y[1]); }
        lastSolve = null;
        continue;
      }
      if (l[0] === '[') continue;              // 年末の集計行（before/after があるので不要）
      if (l.indexOf('**ゲーム終了**') >= 0 || l.indexOf('全ログを') >= 0) continue;

      let m;
      if ((m = l.match(/^🌏\s*次の課題を公開:\s*「(.+?)」/))) {
        story.push({kind: 'reveal', opened: m[1],
                    solved: lastSolve ? lastSolve.mission : null,
                    by: lastSolve ? lastSolve.by : null});
        lastSolve = null;
        continue;
      }
      if ((m = l.match(/^⏰\s*(\d+)年間解決されず/))) {
        story.push({kind: 'grace', years: Number(m[1])});
        continue;
      }
      if ((m = l.match(/^♻️\s*解決済みの課題(\d+)件/))) {
        story.push({kind: 'recycle', n: Number(m[1])});
        continue;
      }

      const pm = l.match(RE_P);
      if (!pm) continue;
      const pi = Number(pm[1]) - 1;            // ログは P1 = 席1（あなた）
      const item = parseAction(pm[2]);
      item.year = curYear;
      if (item.solved) lastSolve = {mission: item.solved, by: pi};
      else if (item.ic === '🚀' || item.ic === '🔧') lastSolve = null;
      (acts[pi] || (acts[pi] = [])).push(item);
    }
    // 直前が「達成」でない ⏰ の直後の公開は、理由を「安全弁」に付け替える
    for (let i = 1; i < story.length; i++) {
      if (story[i].kind === 'reveal' && !story[i].solved && story[i - 1].kind === 'grace') {
        story[i].reason = 'grace';
        story[i].graceYears = story[i - 1].years;
      }
    }
    return {acts, story, years};
  }

  /* -------------------------------------------------------------- DOM 生成 */

  const root = document.createElement('div');
  root.id = 'sdg-digest';
  if (REDUCE) root.classList.add('nofx');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'CPUの行動ダイジェスト');
  document.body.appendChild(root);

  let open = false;        // 表示中か
  let settled = false;     // 入場アニメが終わったか（クリック1回目でスキップできる）
  let settleTimer = 0;
  let pending = null;      // 閉じたあとに再生する課題公開演出 [{slug}]
  let lastEv = null;       // 同じ state で render が複数回来ても二重に出さない

  const shortName = n => String(n || '').replace(/（.*/, '');
  const policyOf = p => (p && p.policy && p.policy !== 'あなた') ? p.policy : '';

  /* ---- アバター（avatars.js）。未読込みでも従来どおり動くよう、必ず素通りできる形にする ---- */
  const AV = () => (window.SDG && window.SDG.avatar) || null;

  /** 顔。wrapCls は置き場所のサイズを持つ枠（.cdg-avw / .cdg-rav） */
  function avHTML(p, wrapCls, mood) {
    const a = AV();
    if (!a) return '';
    let s = '';
    try { s = a.svg(p, {mood: mood}); } catch (_) { return ''; }
    return s ? `<span class="${wrapCls}">${s}</span>` : '';
  }

  /** 表示用コールサイン（engine 側の name は変えない。あくまで表示の添え物） */
  function callHTML(p) {
    const a = AV();
    if (!a) return '';
    let c = '';
    try { c = a.name(p); } catch (_) { return ''; }
    return c ? `<span class="cdg-call">${esc(c)}</span>` : '';
  }

  /** あなたとの点差で表情の気配を決める（勝っていれば強気、負けていれば渋い顔） */
  function moodOf(p, me) {
    if (!p || !me || p === me) return null;
    if (p.score === me.score) return null;
    return p.score > me.score ? 'up' : 'down';
  }

  function deltaHTML(label, from, to, unit) {
    const d = to - from;
    const cls = d > 0 ? 'up' : (d < 0 ? 'dn' : 'flat');
    const mark = d > 0 ? '▲+' : (d < 0 ? '▼' : '±');
    return `<div class="cdg-d ${cls}">
      <span class="cdg-dl">${esc(label)}</span>
      <span class="cdg-dv">${from}<i>→</i>${to}${esc(unit)}</span>
      <b class="cdg-dd">${mark}${d === 0 ? '0' : (d > 0 ? d : -d)}</b></div>`;
  }

  const MAX_ACTS = 7;      // 1画面に収めるための上限（超過は「ほかN件」）

  function colHTML(p, from, items, mood) {
    const list = items || [];
    const shown = list.slice(0, MAX_ACTS);
    const rest = list.length - shown.length;
    let prevYear = null;
    const rows = shown.map(it => {
      // 年をまたいだら仕切りを入れる（「1年に2回開発した」ように見えるのを防ぐ）
      let sep = '';
      if (it.year != null && prevYear != null && it.year !== prevYear) {
        sep = `<li class="cdg-yr"><span>${it.year}年目</span></li>`;
      }
      if (it.year != null) prevYear = it.year;
      return sep + `
      <li class="cdg-a${it.tone ? ' t-' + it.tone : ''}${it.big ? ' big' : ''}">
        <span class="cdg-ic">${it.ic}</span>
        <span class="cdg-tx">${it.head ? `<b>${esc(it.head)}</b>` : ''}${
          it.body ? `<span class="cdg-bd">${esc(it.body)}</span>` : ''}</span>
        ${it.tail ? `<span class="cdg-tl">${esc(it.tail)}</span>` : ''}
      </li>`;
    }).join('');
    const more = rest > 0 ? `<li class="cdg-a t-dim"><span class="cdg-ic">…</span>
        <span class="cdg-tx"><span class="cdg-bd">ほか ${rest} 件</span></span></li>` : '';
    const empty = list.length ? '' :
      `<li class="cdg-a t-dim"><span class="cdg-ic">–</span>
       <span class="cdg-tx"><span class="cdg-bd">動きなし（手札も資金も動かさず）</span></span></li>`;
    return `<div class="cdg-col">
      <div class="cdg-hd">
        ${avHTML(p, 'cdg-avw', mood)}
        <span class="cdg-id">
          <span class="cdg-nm">${esc(shortName(p.name))}</span>
          ${callHTML(p)}
        </span>
        ${policyOf(p) ? `<span class="cdg-pol">${esc(p.policy)}</span>` : ''}
      </div>
      <ul class="cdg-acts">${rows || empty}${more}</ul>
      <div class="cdg-deltas">
        ${deltaHTML('得点', from.score, p.score, '点')}
        ${deltaHTML('資金', from.money, p.money, '億')}
      </div>
    </div>`;
  }

  const MAX_STORY = 5;     // 因果の文章も1画面に収める（超過は「ほかN件」）

  function storyHTML(all) {
    const out = [];
    const story = (all || []).slice(0, MAX_STORY);
    const overflow = (all || []).length - story.length;
    for (const s of story) {
      if (s.kind === 'reveal' && s.solved) {
        out.push(`<div class="cdg-s">
          <span class="cdg-sic">🌏</span>
          <span>${s.by != null && s.by > 0 ? `<b class="cdg-who">${esc('CPU' + s.by)}</b>が` : ''}「<b class="cdg-m done">${esc(s.solved)}</b>」を解決したので、
          新しい課題「<b class="cdg-m new">${esc(s.opened)}</b>」が公開されました</span></div>`);
      } else if (s.kind === 'reveal') {
        out.push(`<div class="cdg-s"><span class="cdg-sic">🌏</span>
          <span>${s.reason === 'grace'
            ? `${s.graceYears}年だれも解決できなかったので、追加の課題`
            : '新しい課題'}「<b class="cdg-m new">${esc(s.opened)}</b>」が公開されました</span></div>`);
      } else if (s.kind === 'recycle') {
        out.push(`<div class="cdg-s"><span class="cdg-sic">♻️</span>
          <span>解決済みの課題 ${s.n} 件がシャッフルされ、山札に戻りました</span></div>`);
      }
    }
    if (overflow > 0) {
      out.push(`<div class="cdg-s quiet"><span class="cdg-sic">…</span>
        <span>ほか ${overflow} 件の公開がありました</span></div>`);
    }
    if (!out.length) {
      out.push(`<div class="cdg-s quiet"><span class="cdg-sic">🌏</span>
        <span>場の課題に動きはありません（誰も解決していないので、補充も起きていません）</span></div>`);
    }
    return out.join('');
  }

  function rankHTML(standings) {
    // standings は {name, score, money} しか持たないが、avatars.js が name から
    // 席と policy を復元するので、そのまま渡してよい
    const me = (standings || []).find(q => shortName(q.name) === 'あなた') || null;
    return (standings || []).map((q, i) => `
      <div class="cdg-r${shortName(q.name) === 'あなた' ? ' me' : ''}">
        <span class="cdg-rk">${i + 1}</span>
        ${avHTML(q, 'cdg-rav', moodOf(q, me))}
        <span class="cdg-rn">${esc(shortName(q.name))}</span>
        <span class="cdg-rs">${q.score}<i>点</i></span>
        <span class="cdg-rm">${q.money}<i>億</i></span>
      </div>`).join('');
  }

  /* ------------------------------------------------------------ 開閉の制御 */

  function blocked() {
    if (window.SDG.openingActive) return true;
    const op = document.getElementById('sdg-open');
    if (op && op.classList.contains('on')) return true;
    if (document.getElementById('sdg-title')) return true;
    if (document.getElementById('sdg-end')) return true;
    const ru = document.getElementById('sdg-rules');
    if (ru && ru.classList.contains('on')) return true;
    const md = document.getElementById('modal');
    if (md && md.style.display === 'flex') return true;
    return false;
  }

  function settle() {
    if (settled) return;
    settled = true;
    root.classList.add('cdg-done');     // 残りの入場アニメを一気に終わらせる
  }

  function close() {
    if (!open) return;
    open = false;
    settled = false;
    clearTimeout(settleTimer);
    root.classList.remove('on', 'cdg-done');
    document.removeEventListener('keydown', onKey, true);
    // ダイジェストで「なぜ公開されたか」を説明したあとに、券面のフリップを見せる
    const q = pending; pending = null;
    if (q && q.length && window.SDG.revealMission && !document.getElementById('sdg-end')) {
      setTimeout(() => { try { window.SDG.revealMission(q[0]); } catch (_) {} }, 90);
    }
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); step(); }
  }

  function step() {
    try { if (window.SDG.sfx) window.SDG.sfx('ui', {vol: .16}); } catch (_) {}
    if (!settled) settle();
    else close();
  }

  root.addEventListener('click', e => {
    e.stopPropagation();
    step();
  });

  /* ------------------------------------------------------------------ 表示 */

  function show(ev, state) {
    const before = ev.before || [];
    const after = ev.after || [];
    if (!after.length) return;
    const {acts, story} = parseLines(ev.lines, ev.from_year);
    const fromOf = i => before.find(b => b.i === i) || {score: 0, money: 0};

    const meNow = after.find(p => p.i === 0) || null;
    const cols = after.filter(p => p.i !== 0)
                      .map(p => colHTML(p, fromOf(p.i), acts[p.i], moodOf(p, meNow)))
                      .join('');
    // 見出しは from_year/to_year ではなく「実際にCPUが動いた年」で決める。
    // 年の見出しはCPUが動かなくてもログに出るため、それを根拠にすると
    // 中身が1年分しかないのに「2年分」と書いてしまう。
    // アクションを消費するものだけを数える。搭載・即達成・設計寿命は無料処理で、
    // 特に設計寿命は年明けに処理されるため、これを入れると常に「2年分」になってしまう。
    const COSTS = {'🔧': 1, '🚀': 1, '🔄': 1, '💰': 1};
    const yrs = [], allYrs = [];
    for (const k of Object.keys(acts)) {
      for (const it of acts[k]) {
        if (it.year == null) continue;
        if (allYrs.indexOf(it.year) < 0) allYrs.push(it.year);
        if (COSTS[it.ic] && yrs.indexOf(it.year) < 0) yrs.push(it.year);
      }
    }
    yrs.sort((a, b) => a - b);
    allYrs.sort((a, b) => a - b);
    const y0 = yrs.length ? yrs[0] : (allYrs[0] || ev.from_year);
    const y1 = yrs.length ? yrs[yrs.length - 1] : (allYrs[allYrs.length - 1] || ev.to_year);
    const crossed = yrs.length > 1;
    const span = crossed ? `T${y0}年目のつづき → T${y1}年目のはじめ` : `T${y0 || ''}年目`;

    root.innerHTML = `
      <div class="cdg-panel" style="--cdg-n:${Math.max(1, after.length - 1)}">
        <div class="cdg-head">
          <div class="cdg-kick">CPU TURNS</div>
          <div class="cdg-ttl">あなたの手番のあと、CPUはこう動きました</div>
          <div class="cdg-year">${esc(span)}</div>
          ${crossed ? `<div class="cdg-note">手番順はローテーションするため、この画面には
            ${y0}年目の残りと ${y1}年目のはじめが並びます。1年にできるのは2アクションまで
            （同じ種類は1回まで）で、CPUも同じ条件です。</div>` : ''}
          <div class="cdg-hint">クリックで進む ／ Esc で閉じる</div>
        </div>
        <div class="cdg-cols">${cols}</div>
        <div class="cdg-bottom">
          <div class="cdg-story">
            <div class="cdg-lb">場の課題に起きたこと</div>
            ${storyHTML(story)}
          </div>
          <div class="cdg-rank">
            <div class="cdg-lb">いまの順位</div>
            <div class="cdg-rows">${rankHTML(state.standings)}</div>
          </div>
        </div>
      </div>`;

    // 公開された課題は、閉じたあとに mission_fx の券面フリップで見せる。
    // ここで seen を同期して、ダイジェストの上に被さらないようにする。
    pending = [];
    const opened = story.filter(s => s.kind === 'reveal').map(s => s.opened);
    if (opened.length) {
      const bySlug = {};
      for (const m of (state.board || [])) bySlug[m.name] = m.slug;
      for (const n of opened) if (bySlug[n]) pending.push(bySlug[n]);
    }
    if (window.SDG.syncMissionSeen) {
      try { window.SDG.syncMissionSeen(state.board); } catch (_) {}
    }

    open = true;
    settled = false;
    root.classList.add('on');
    document.addEventListener('keydown', onKey, true);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, REDUCE ? 0 : 950);
  }

  /* onDraw の先頭に割り込む。mission_fx.js より先に走らせて、課題公開の演出を
     ダイジェストのあとに回すため（読み込み順では mission_fx.js のほうが先）。 */
  window.SDG.onDraw.unshift(s => {
    if (!s || s.phase === 'over') { lastEv = null; if (open) close(); return; }
    const ev = (s.events || []).find(e => e && e.kind === 'cpu');
    if (!ev || ev === lastEv) return;
    lastEv = ev;
    if (blocked()) return;
    if (open) close();
    show(ev, s);
  });

  /* 手動で確認したいとき用: window.SDG.showCpuDigest(ev, state) */
  window.SDG.showCpuDigest = show;
  window.SDG.closeCpuDigest = close;
  window.SDG.parseCpuLines = parseLines;   // テスト用（node からも読める）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {parseLines, parseAction};
  }
})();
