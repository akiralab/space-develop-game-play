/* launch_fx.js — 打ち上げ成功の祝福演出
   ============================================================================
   このゲームで一番大きな成功体験は「打ち上げ成功」。それまでは #cine のロケットが
   飛んで終わりで、得点は盤面のカウンタが静かに増えるだけだった。ここで
   「点火 → ダイス → 判定確定 → Congrats! → 獲得ポイント」を一続きの1カットにする。

   設計方針
   - 判定は一切やらない。成功/失敗/2機同時/ダイス/得点は、すでに
     serve.py の push_event()（= engine.js の同名関数）が返しているものを使う。
       ev = {kind:'launch', dice:[a,b], success:bool, dual:bool, score:int, money:int, ...}
   - 既存のシネマ（index.html の launchCine）は作り直さない。ロケットとダイスは
     そのまま流用し、この演出は「判定が確定した瞬間から後」だけを足す。
     そのため window.launchCine を包む（index.html は他の作業者が持っているので触らない）。
     index.html 側が SDG フックを生やせるなら window.SDG.scene.launch.play(ev) を
     呼ぶだけでよい（下部で公開している）。
   - 全体で 3 秒。時間はすべてタイマーで進める。音が鳴らない環境
     （Chrome の autoplay 拒否・音声デバイスなし・ミュート）でも、
     再生の成否を1ミリ秒も待たないのでタイミングは崩れない。
   - クリック（と Esc）でいつでもスキップできる。発表デモでテンポを落とさない。
   - 失敗は短く控えめに。成功との落差そのものが、成功を大きく見せる。

   タイムライン（launchCine の実装に合わせてある。index.html を変えたらここも見直す）
       0ms  点火。既存 SE 'launch' を鳴らす（#cine のロケットが震え、ダイスが回る）
    1000ms  ダイスが止まる（launchCine の while ループが 1000ms）→ 'ui' で着地音
    1720ms  判定確定（launchCine の csleep(700) 明け。成功なら文字が緑になり上昇開始）
            → ここから祝福：ファンファーレ＋Congrats!＋得点カウントアップ＋ボイス
    2900ms  祝福を畳み始める（フェード 280ms）
   ========================================================================== */
(() => {
  'use strict';
  const SDG = (window.SDG = window.SDG || {});

  const Q = new URLSearchParams(location.search);
  const HOLD = Q.has('hold');          // 静止画モード（スクリーンショット用）: 最終フレームで止める

  /* ---- タイムライン（ms）。合計 = T_VERDICT + CONGRATS_MS + フェード ≒ 3.2s ---- */
  const T_DICE_LOCK = 1000;   // 既存シネマのダイスが止まる時刻
  const T_VERDICT   = 1720;   // 成功/失敗が確定する時刻
  const CONGRATS_MS = 1180;   // 祝福カードの表示時間
  const COUNT_MS    = 620;    // 得点のカウントアップ
  const NG_CUT_MS   = 300;    // 失敗はこれだけ見せて既存シネマの余韻を畳む
  const NG_HOLD_MS  = 420;    // 失敗の帯を残す時間
  const FADE_MS     = 280;
  const VOICE_DELAY = 200;    // 判定確定から祝福ボイスまで（ファンファーレの頭を避ける）

  const reduced = () => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  };

  /* ======================================================== 効果音（追加分） */
  /* sfx.js の BANK は編集できないので、追加音は自前で持つ。作法は sfx.js と同じ:
     鳴らない環境でも例外を出さず黙って進む／ミュートは localStorage を尊重する。 */
  const DIR = 'assets/sfx/';
  const BANK = {
    fanfare: 0.42,   // 祝福のファンファーレ（1.7s）
    sparkle: 0.24,   // 2機同時のときだけ重ねる上行ベル（0.95s）
    fizzle:  0.22,   // 失敗（0.8s・意図的に地味）
  };
  const proto = {};
  for (const name of Object.keys(BANK)) {
    try { const a = new Audio(DIR + name + '.mp3'); a.preload = 'auto'; proto[name] = a; }
    catch (_) { /* Audio が無い環境でも落とさない */ }
  }
  const muted = () => {
    try {
      if (typeof SDG.isMuted === 'function') return SDG.isMuted();
      return localStorage.getItem('sdg_mute') === '1';
    } catch (_) { return false; }
  };
  function play(name, opts) {
    opts = opts || {};
    if (!proto[name] || muted()) return null;
    let a;
    try { a = proto[name].cloneNode(true); } catch (_) { return null; }
    a.volume = Math.max(0, Math.min(1, opts.vol != null ? opts.vol : BANK[name]));
    const go = () => { try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} };
    if (opts.delay > 0) setTimeout(go, opts.delay); else go();
    return a;
  }
  /* 既存 SE（launch / ui）は sfx.js の BANK 経由で借りる。無ければ黙る。 */
  const bank = (name, opts) => {
    try { return (typeof SDG.sfx === 'function') ? SDG.sfx(name, opts) : null; } catch (_) { return null; }
  };
  /* 自動再生ロックの解錠。sfx.js は自分の4音しか解錠しないので、追加分は自前で。 */
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    for (const name of Object.keys(proto)) {
      try {
        const a = proto[name].cloneNode(true);
        a.volume = 0;
        const p = a.play();
        if (p && p.then) p.then(() => { try { a.pause(); a.currentTime = 0; } catch (_) {} }).catch(() => {});
      } catch (_) {}
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    addEventListener(ev, unlock, { once: true, capture: true, passive: true }));

  /* ============================================================ DOM の土台 */
  const root = document.createElement('div');
  root.id = 'sdg-lfx';
  const ng = document.createElement('div');
  ng.id = 'sdg-lfx-ng';
  const attach = () => { document.body.appendChild(root); document.body.appendChild(ng); };
  if (document.body) attach();
  else addEventListener('DOMContentLoaded', attach, { once: true });

  /* ======================================================== スキップの受付 */
  let running = false;    // 演出中か（この間だけクリックをスキップとして拾う）
  let skipped = false;
  const markSkip = () => { if (running) skipped = true; };
  addEventListener('pointerdown', markSkip, true);
  addEventListener('keydown', e => {
    if (running && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) skipped = true;
  }, true);

  /* wait(ms) — 経過時間だけで進む待ち。音声の再生完了は絶対に待たない。
     スキップされたら即座に解決する。 */
  function wait(ms) {
    if (HOLD) return Promise.resolve();
    return new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(to); clearInterval(iv); res(); } };
      const to = setTimeout(fin, Math.max(0, ms));
      const iv = setInterval(() => { if (skipped) fin(); }, 40);
    });
  }

  /* 開幕・タイトル・終局の演出中は出さない（画面が二重になる） */
  function suppressed() {
    if (SDG.openingActive) return true;
    const op = document.getElementById('sdg-open');
    if (op && op.classList.contains('on')) return true;
    if (document.getElementById('sdg-title')) return true;
    if (document.getElementById('sdg-end')) return true;
    return false;
  }

  /* ============================================================ 祝福カード */
  const COLORS = ['#f2c14e', '#ffe6a8', '#5b9bd5', '#e0685f', '#4caf82'];

  function confetti(dual) {
    const box = root.querySelector('.lfx-confetti');
    if (!box || reduced()) return;
    const n = dual ? 54 : 32;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = (dual ? 190 : 150) + Math.random() * (dual ? 330 : 250);
      html += `<i class="${i % 3 === 0 ? 'dot' : ''}" style="` +
        `--dx:${(Math.cos(a) * d).toFixed(1)}px;` +
        `--dy:${(Math.sin(a) * d - 40).toFixed(1)}px;` +
        `--rot:${(Math.random() * 900 - 450).toFixed(0)}deg;` +
        `--d:${(Math.random() * 0.14).toFixed(3)}s;` +
        `--dur:${(0.85 + Math.random() * 0.5).toFixed(2)}s;` +
        `--c:${COLORS[i % COLORS.length]}"></i>`;
    }
    box.innerHTML = html;
  }

  function build(pts, dual) {
    // innerHTML を入れ直すことで CSS アニメーションが毎回頭から走る
    root.className = '';
    root.innerHTML =
      '<div class="lfx-glow"></div>' +
      '<div class="lfx-rays"></div>' +
      '<div class="lfx-ring"></div>' +
      (dual ? '<div class="lfx-ring d2"></div>' : '') +
      '<div class="lfx-card">' +
        `<div class="lfx-kicker">${dual ? 'dual launch success' : 'launch success'}</div>` +
        '<div class="lfx-title">Congrats!</div>' +
        `<div class="lfx-sub">${dual ? '2機同時 打ち上げ成功' : '打ち上げ成功'}</div>` +
        '<div class="lfx-badge">🛰 ×2 同時投入</div>' +
        '<div class="lfx-pts"><span class="plus">＋</span>' +
          `<span class="n">${pts > 0 ? '0' : '衛星、軌道へ'}</span><span class="u">点</span></div>` +
        `<div class="lfx-note">${pts > 0 ? '獲得した貢献度' : '応札すれば得点になります'}</div>` +
      '</div>' +
      '<div class="lfx-confetti"></div>';
    if (pts <= 0) root.classList.add('nopts');
    if (dual) root.classList.add('dual');
    confetti(dual);
  }

  /* 得点のカウントアップ。0 点（場の課題に合う衛星がなかった成功）のときは数えない。 */
  function countUp(pts) {
    const el = root.querySelector('.lfx-pts .n');
    if (!el || pts <= 0) return;
    if (reduced() || skipped) { el.textContent = String(pts); return; }
    const t0 = performance.now();
    let last = -1;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / COUNT_MS);
      const v = Math.round((1 - Math.pow(1 - k, 3)) * pts);   // easeOutCubic
      if (v !== last) {
        last = v;
        el.textContent = String(v);
        el.classList.add('tick');
        setTimeout(() => el.classList.remove('tick'), 110);
      }
      if (k < 1 && !skipped) requestAnimationFrame(step);
      else el.textContent = String(pts);
    };
    requestAnimationFrame(step);
  }

  /* 祝福ボイス。narrate() は世代トークンで前の再生を必ず止めるので音は重ならない。
     台詞は 1 秒未満（tools/narrate.py の lx_* 参照）。得点が入った打ち上げの直後には
     課題の補充 → mission_fx.js の課題公開ナレーションが始まるので、長い台詞にすると
     必ず途中で切られる。祝福カードが消える前に必ず言い終わる長さにしてある。
     ファンファーレの立ち上がりとぶつからないよう VOICE_DELAY だけ後ろにずらす。 */
  let altVoice = false;
  function speak(dual) {
    if (typeof SDG.narrate !== 'function') return;
    const id = dual ? 'lx_dual' : ((altVoice = !altVoice) ? 'lx_ok' : 'lx_ok2');
    setTimeout(() => {
      try {
        if (SDG.narrator) SDG.narrator.talk(true);
        /* 読み終わったら口パクを止め、少し置いてから引っ込める。
           この 400ms のあいだに別の演出（課題公開）がナレーターを使い始めていたら
           引っ込めない＝他モジュールのキャラを横から消さないための保険。 */
        const off = () => {
          if (!SDG.narrator) return;
          SDG.narrator.talk(false);
          setTimeout(() => {
            const n = document.querySelector('.sdg-narrator');
            if (n && !n.classList.contains('talk')) SDG.narrator.show(false);
          }, 400);
        };
        const p = SDG.narrate(id);
        if (p && p.then) p.then(off, off); else off();
        setTimeout(off, 2600);          // 追い越されて Promise が解決しない場合の保険
      } catch (_) {}
    }, VOICE_DELAY);
  }

  function reset() {
    root.className = ''; root.innerHTML = '';
    ng.classList.remove('on');
    document.body.classList.remove('sdg-lfx-on');
  }
  function fadeOut() {
    if (HOLD) return;
    root.classList.add('out');
    setTimeout(reset, FADE_MS);
  }

  async function congrats(ev) {
    const pts = Math.max(0, ev.score | 0);
    const dual = !!ev.dual;
    build(pts, dual);
    root.classList.add('on');
    // 祝福カードと同じことを言っている #cine の判定テキストを伏せる（透けて汚れる）
    document.body.classList.add('sdg-lfx-on');
    play('fanfare');
    if (dual) play('sparkle', { delay: 140 });
    speak(dual);
    countUp(pts);
    await wait(skipped ? 380 : CONGRATS_MS);
    fadeOut();
  }

  /* 既存シネマの長い余韻（csleep(1300)）を畳む。index.html の cine.onclick が
     cineSkipped を立てるので、クリックを1発送るだけでよい。 */
  function cutCine() {
    if (HOLD) return;
    const c = document.getElementById('cine');
    if (c && c.style.display !== 'none') { try { c.click(); } catch (_) {} }
  }

  async function failure() {
    play('fizzle');
    ng.innerHTML = '<b>FAILURE</b>投資した100億は戻りません';
    ng.classList.add('on');
    // 音声は鳴らさない（成功との落差を作る）。字幕だけで理由を伝える。
    try { if (SDG.caption) SDG.caption('打ち上げ失敗。2個のサイコロの合計が7＝6回に1回は落ちます。', 2200); }
    catch (_) {}
    await wait(NG_CUT_MS);
    cutCine();
    await wait(NG_HOLD_MS);
    if (!HOLD) ng.classList.remove('on');
  }

  /* ============================================================ 本体 */
  let busy = false;
  let forceOnce = false;      // デモ用。開幕/タイトルの抑止を1回だけ外す

  async function run(ev, orig) {
    const force = forceOnce;
    forceOnce = false;
    const call = () => {
      try { return typeof orig === 'function' ? orig(ev) : null; }
      catch (e) { console.warn('[launch_fx] cine', e); return null; }
    };
    if (!ev || busy || (!force && suppressed())) return call();

    busy = true; running = true; skipped = false;
    try {
      reset();
      bank('launch', { vol: 0.30 });                 // 点火（既存の音源を流用）
      const cine = Promise.resolve(call()).catch(() => {});
      const lock = setTimeout(() => { if (!skipped) bank('ui', { vol: 0.26 }); }, T_DICE_LOCK);
      await wait(T_VERDICT);
      clearTimeout(lock);
      if (ev.success) await congrats(ev);
      else await failure();
      await cine;                                    // #cine が確実に畳まれてから返す
    } catch (e) {
      console.warn('[launch_fx]', e);
      reset();
    } finally {
      busy = false; running = false;
    }
  }

  /* ---- 既存の launchCine を包む（index.html は編集しない） ---- */
  const orig = window.launchCine;
  if (typeof orig === 'function') {
    window.launchCine = ev => run(ev, orig);
  } else {
    console.warn('[launch_fx] launchCine が見つかりません。SDG.scene.launch.play(ev) で呼んでください。');
  }

  /* ---- 公開フック。index.html 側から直接呼びたくなったらこちらを使う ---- */
  SDG.scene = SDG.scene || {};
  SDG.scene.launch = {
    play: ev => run(ev, orig),
    skip: () => { skipped = true; },
    isRunning: () => busy,
  };

  /* ================================================================ デモ */
  /* 単体確認用。index.html の ?fx= デモはこのファイルより前に走ってしまうので、
     いったん畳んでから、包んだ版で流し直す。
       ?fx=launch / ?fx=dual / ?fx=fail        （既存デモの流し直し）
       ?lfx=ok / ?lfx=dual / ?lfx=ng / ?lfx=nopts
       &hold  … 最終フレームで止める（スクリーンショット用） */
  const DEMO = {
    launch: { kind: 'launch', dice: [6, 2], success: true,  dual: false, score: 3, money: -40 },
    ok:     { kind: 'launch', dice: [6, 2], success: true,  dual: false, score: 3, money: -40 },
    dual:   { kind: 'launch', dice: [5, 3], success: true,  dual: true,  score: 6, money: 20 },
    fail:   { kind: 'launch', dice: [3, 4], success: false, dual: false, score: 0, money: -100 },
    ng:     { kind: 'launch', dice: [3, 4], success: false, dual: false, score: 0, money: -100 },
    nopts:  { kind: 'launch', dice: [6, 4], success: true,  dual: false, score: 0, money: -100 },
  };
  const key = Q.get('lfx') || (DEMO[Q.get('fx')] ? Q.get('fx') : null);
  if (key && DEMO[key]) {
    const start = () => {
      // 単体デモなので、上に乗っている画面は畳んでから流す。
      // ?fx= のときは title.js / opening.js が自分で出さないので、これは ?lfx= 用。
      ['sdg-title', 'sdg-open'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      SDG.openingActive = false;
      if (Q.get('fx')) cutCine();          // 先に走り出した既存デモを畳む
      setTimeout(() => {
        forceOnce = true;                    // 本番と同じ window.launchCine を通す
        try { window.launchCine(DEMO[key]); } catch (e) { console.warn(e); }
      }, 320);
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
