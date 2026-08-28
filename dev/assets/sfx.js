/* sfx.js — 効果音（issue: タイトル画面のSE）
   音源は tools/make_sfx.py が numpy で「合成」したもの。外部素材は一切使っていない。

   設計方針
   - title.js / title.css には一切手を入れない。#sdg-title の出現を監視して、
     CSS の animation-delay と同じタイミングに setTimeout を並べるだけで同期させる。
   - 音が鳴らなくても画面は絶対に止めない。自動再生ポリシー（NotAllowedError）も
     音声デバイス無しも、すべて握りつぶして黙って進む。発表本番で必ず起きる。
   - ミュートは narrate.js の window.SDG.isMuted() を尊重する（実体は localStorage の sdg_mute）。 */
(() => {
  'use strict';
  const SDG = (window.SDG = window.SDG || {});
  const DIR = 'assets/sfx/';

  /* name -> 既定音量。壇上のスピーカーは大きいので全体に控えめ。 */
  const BANK = {
    earth:  { vol: 0.28 },   // 地球のせり上がり（5.0s のドローン）
    launch: { vol: 0.34 },   // 点火〜上昇（2.4s）
    chr:    { vol: 0.14 },   // タイトル文字の着地（7回鳴るので特に控えめ）
    ui:     { vol: 0.30 },   // ボタンの確定音
  };

  const muted = () => {
    try {
      if (typeof SDG.isMuted === 'function') return SDG.isMuted();
      return localStorage.getItem('sdg_mute') === '1';
    } catch (_) { return false; }
  };

  /* --- 事前ロード。cloneNode で使い回すので同じ音を重ねて鳴らせる（文字の着地用） --- */
  const proto = {};
  for (const name of Object.keys(BANK)) {
    try {
      const a = new Audio(DIR + name + '.mp3');
      a.preload = 'auto';
      proto[name] = a;
    } catch (_) { /* Audio が無い環境（テスト等）でも落とさない */ }
  }

  const live = new Set();   // 再生中のもの。画面遷移でまとめて止める用

  /* sfx(name, opts) — opts: {vol, rate, delay(ms), loop}
     戻り値は Audio か null。呼び出し側は戻り値を気にしなくてよい。 */
  function sfx(name, opts) {
    opts = opts || {};
    const def = BANK[name];
    if (!def || !proto[name] || muted()) return null;
    let a;
    try {
      a = proto[name].cloneNode(true);       // 実体はブラウザキャッシュから。再ダウンロードしない
    } catch (_) { return null; }
    a.volume = Math.max(0, Math.min(1, opts.vol != null ? opts.vol : def.vol));
    if (opts.rate) a.playbackRate = opts.rate;
    if (opts.loop) a.loop = true;
    a.onended = () => live.delete(a);
    live.add(a);
    const go = () => { try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} };
    if (opts.delay > 0) setTimeout(go, opts.delay); else go();
    return a;
  }

  /* 途中で消すときは必ずフェード。いきなり pause するとプチッと鳴る。 */
  function fadeOut(a, ms) {
    if (!a) return;
    const step = 40, n = Math.max(1, Math.round((ms || 400) / step)), v0 = a.volume;
    let i = 0;
    const t = setInterval(() => {
      i++;
      try { a.volume = Math.max(0, v0 * (1 - i / n)); } catch (_) {}
      if (i >= n) { clearInterval(t); try { a.pause(); } catch (_) {} live.delete(a); }
    }, step);
  }
  function stopAll(ms) { for (const a of Array.from(live)) fadeOut(a, ms || 300); }

  /* iOS/Chrome の自動再生ロック外し。最初のユーザー操作で無音を1回鳴らして解錠しておくと、
     以降の確定音などがちゃんと鳴る。解錠できなくても何も起きないだけ。 */
  let unlocked = false;
  function unlock() {
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
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    addEventListener(ev, unlock, { once: true, capture: true, passive: true }));

  /* ================= タイトル画面への後付け ================= */
  /* title.css のタイムライン（ここを変えたら title.css も見直すこと）
       .earth / .atmo  earthRise 2.4s   delay 0
       .trail / .spark trailUp  1.5s    delay 0.55s
       h1 span         chDrop   0.8s    delay 0.55 + i*0.1  （7文字）
     文字は cubic-bezier(.2,.9,.25,1) で頭が速いので、着地音は +0.15s の位置に置く。 */
  const CHAR_LAND = 0.15;
  const CHARS = 7;

  let hooked = false;
  function hookTitle(el) {
    if (hooked || !el) return;
    hooked = true;

    /* reduced-motion のときは CSS 側で delay が 0 になる（title.css の @media）。
       タイムラインが崩れるので、その場合は文字の連打をやめてドローンだけにする。 */
    let reduce = false;
    try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

    /* sfx.js が title.js より後に読まれた場合に備え、実際の経過時間を
       Web Animations API から取り、その分だけタイマーを前倒しする。 */
    let elapsed = 0;
    try {
      const earthEl = el.querySelector('.earth');
      const an = earthEl && earthEl.getAnimations && earthEl.getAnimations()[0];
      if (an && typeof an.currentTime === 'number') elapsed = an.currentTime / 1000;
    } catch (_) {}
    /* 出番を過ぎた音は鳴らさない（読み込みが遅れたときに一斉に鳴るのを防ぐ）。 */
    const cue = (name, s, opts) => {
      const d = (s - elapsed) * 1000;
      if (d < -250) return null;
      return sfx(name, Object.assign({ delay: Math.max(0, d) }, opts));
    };

    const drone = cue('earth', 0.0);

    if (!reduce) {
      cue('launch', 0.55);
      for (let i = 0; i < CHARS; i++) {
        // 半音 1.25 ずつ上げていく。上がるほど音が細くなるので音量も少し落とす。
        const rate = Math.pow(2, (i * 1.25) / 12);
        cue('chr', 0.55 + i * 0.1 + CHAR_LAND, { rate, vol: BANK.chr.vol * (1 - 0.04 * i) });
      }
    }

    /* ボタン・本体クリックの確定音。title.js は onclick を使っているので
       addEventListener なら上書きせずに共存できる。 */
    const click = () => { sfx('ui'); fadeOut(drone, 600); };
    const go = el.querySelector('.go'), rules = el.querySelector('.rules');
    if (go) go.addEventListener('click', click);
    if (rules) rules.addEventListener('click', click);
    el.addEventListener('click', e => { if (e.target === go || e.target === rules) return; click(); });
    // Esc でのスキップ。once だと別のキーで消費されてしまうので、Esc のときだけ自分を外す。
    const esc = e => { if (e.key === 'Escape') { removeEventListener('keydown', esc); click(); } };
    addEventListener('keydown', esc);

    /* タイトルが消えたらドローンも確実に畳む（クリック以外の経路で閉じた場合の保険）。 */
    const watch = setInterval(() => {
      if (!document.body.contains(el) || el.classList.contains('out')) {
        clearInterval(watch);
        removeEventListener('keydown', esc);
        fadeOut(drone, 600);
      }
    }, 200);
  }

  /* #sdg-title を待つ。sfx.js の読み込み順に依存しないよう、
     「今ある」「これから出る」「取りこぼし」の3経路すべてを張っておく。 */
  const find = () => document.getElementById('sdg-title');
  function watchForTitle() {
    const now = find();
    if (now) { hookTitle(now); return; }
    let mo = null, iv = null;
    const done = () => { if (mo) mo.disconnect(); if (iv) clearInterval(iv); };
    try {
      mo = new MutationObserver(() => { const el = find(); if (el) { done(); hookTitle(el); } });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    let n = 0;
    iv = setInterval(() => { const el = find(); if (el) { done(); hookTitle(el); } else if (++n > 100) done(); }, 100);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watchForTitle, { once: true });
  else watchForTitle();

  SDG.sfx = sfx;
  SDG.sfx.stopAll = stopAll;
  SDG.sfx.fadeOut = fadeOut;
  SDG.sfx.names = Object.keys(BANK);
  SDG.sfx.unlock = unlock;     // title.js のゲート（タップして開始）から同じ操作内で呼ぶ

  /* ?gate=1 用: ゲートを閉じてタイトル演出を流し直すとき、SEも張り直す。
     ゲート表示中に自動再生が拒否されてキューを使い切ってしまうため。 */
  window.SDG.replaySfx = () => {
    try { hooked = false; } catch (_) {}
    // hookTitle(el) は el が無いと即 return するので、要素を必ず渡す
    try { hookTitle(document.getElementById('sdg-title')); } catch (_) {}
  };
})();
