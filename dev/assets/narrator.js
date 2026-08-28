/* narrator.js — ナレーターキャラ「ノヴァ（Nova）」
 *
 * ■ 権利について
 *   完全オリジナルの手描きSVG。実在人物・既存キャラクターのデザイン（髪型・髪色・
 *   衣装・配色など）は一切参照していない。音声は VOICEVOX を規約に沿って利用するが、
 *   絵は本リポジトリの自作物であり、音声キャラクターの意匠とは無関係。
 *
 * ■ キャラ設定
 *   宇宙開発レース管制室の若手ナビゲーター。ヘッドセット＋赤いスカーフ＋
 *   ティールのボブという、118px でも判別できる強いシルエット。
 *
 * ■ 実装方針
 *   体は共通、表情は「眉・目・口（＋感情マーク）」だけを差し替える。
 *   口パクは .n2-mouth の scaleY を CSS で2値切り替え（旧実装の手法を踏襲）。
 *
 * ■ API（既存コードが呼ぶ）
 *   window.SDG.narrator = { show(bool), talk(bool), face(name) }
 *   face: 'normal' | 'happy' | 'surprised' | 'thinking'
 *
 *   本ファイルは mission_fx.js より後に読み込まれ、window.SDG.narrator を上書きする。
 */
(() => {
  window.SDG = window.SDG || {};

  /* 旧ナレーター（宇宙服の管制官）の要素と、自分自身の二重生成を除去 */
  document.querySelectorAll('.sdg-narrator, .sdg-nar2').forEach(e => e.remove());

  /* ---------------- 表情差分（眉・目・口・感情マーク） ---------------- */
  const EYE_L = 47, EYE_R = 73, EYE_Y = 66;

  /* 開いた目（瞳の向きを dx/dy でずらせる） */
  const openEye = (cx, dx = 0, dy = 0, ry = 8.4) => `
    <ellipse cx="${cx}" cy="${EYE_Y}" rx="6.9" ry="${ry}" fill="#fdfdff"/>
    <ellipse cx="${cx + dx}" cy="${EYE_Y + dy + .6}" rx="5.5" ry="${ry - 1.1}" fill="url(#n2-iris)"/>
    <circle cx="${cx + dx}" cy="${EYE_Y + dy + 1}" r="2.5" fill="#0a1120"/>
    <circle cx="${cx + dx - 2.1}" cy="${EYE_Y + dy - 2.8}" r="2.2" fill="#fff"/>
    <circle cx="${cx + dx + 2.3}" cy="${EYE_Y + dy + 3}" r="1.2" fill="#fff" opacity=".65"/>
    <path d="M${cx - 7.4} ${EYE_Y - 5.6} q7.4 -6.4 14.8 0" stroke="#152238"
          stroke-width="2.8" fill="none" stroke-linecap="round"/>`;

  const brow = (x, y, d) => `<path d="M${x} ${y} ${d}" stroke="#1f5f73" stroke-width="2.7"
                                   fill="none" stroke-linecap="round"/>`;

  const blush = (o = .42) => `
    <ellipse cx="36" cy="75" rx="5.4" ry="2.9" fill="#ef8a78" opacity="${o}"/>
    <ellipse cx="84" cy="75" rx="5.4" ry="2.9" fill="#ef8a78" opacity="${o}"/>`;

  const star = (x, y, r) => `<path class="n2-mark" d="M${x} ${y - r} L${x + r * .32} ${y - r * .32}
    L${x + r} ${y} L${x + r * .32} ${y + r * .32} L${x} ${y + r} L${x - r * .32} ${y + r * .32}
    L${x - r} ${y} L${x - r * .32} ${y - r * .32} Z" fill="#f2c14e"/>`;

  const FACES = {
    /* 通常：説明中。おだやかな笑顔 */
    normal: () => `
      ${brow(39, 53, 'q7.5 -4 15 -1.2')}${brow(66, 51.8, 'q7.5 -2.8 15 1.2')}
      <g class="n2-eyes">${openEye(EYE_L)}${openEye(EYE_R)}</g>
      ${blush()}
      <path class="n2-mouth" d="M53.5 80 q6.5 7.5 13 0 q-6.5 3.4 -13 0 Z" fill="#8d3040"/>`,

    /* 喜び：打上成功・得点・勝利。閉じ目＋大きく開いた口＋きらめき */
    happy: () => `
      ${brow(38.5, 50, 'q7.5 -4.5 15 -1')}${brow(66, 49, 'q7.5 -3.5 15 1')}
      <g class="n2-eyes n2-noblink">
        <path d="M40 67.5 q7 -10 14 0" stroke="#152238" stroke-width="3.1" fill="none" stroke-linecap="round"/>
        <path d="M66 67.5 q7 -10 14 0" stroke="#152238" stroke-width="3.1" fill="none" stroke-linecap="round"/>
      </g>
      ${blush(.62)}
      <g class="n2-mouth">
        <path d="M50.5 77 q9.5 14 19 0 q-9.5 4.5 -19 0 Z" fill="#8d3040"/>
        <path d="M54 82.5 q6 6 12 0 q-6 1.5 -12 0 Z" fill="#ef8a78"/>
      </g>
      ${star(105, 20, 5.6)}${star(113, 33, 3.6)}${star(98, 33, 2.8)}`,

    /* 驚き：打上失敗・クリティカル。目を見開き、口は「お」 */
    surprised: () => `
      ${brow(38, 49, 'q7.5 -5.5 15 -1.5')}${brow(66, 47.8, 'q7.5 -4.5 15 1.5')}
      <g class="n2-eyes">
        <ellipse cx="${EYE_L}" cy="${EYE_Y}" rx="7.2" ry="9.6" fill="#fdfdff"/>
        <ellipse cx="${EYE_L}" cy="${EYE_Y + 1}" rx="4.5" ry="5.4" fill="url(#n2-iris)"/>
        <circle cx="${EYE_L}" cy="${EYE_Y + 1}" r="2.4" fill="#0a1120"/>
        <circle cx="${EYE_L - 1.8}" cy="${EYE_Y - 2}" r="1.8" fill="#fff"/>
        <ellipse cx="${EYE_R}" cy="${EYE_Y}" rx="7.2" ry="9.6" fill="#fdfdff"/>
        <ellipse cx="${EYE_R}" cy="${EYE_Y + 1}" rx="4.5" ry="5.4" fill="url(#n2-iris)"/>
        <circle cx="${EYE_R}" cy="${EYE_Y + 1}" r="2.4" fill="#0a1120"/>
        <circle cx="${EYE_R - 1.8}" cy="${EYE_Y - 2}" r="1.8" fill="#fff"/>
      </g>
      <ellipse class="n2-mouth" cx="60" cy="82.5" rx="5" ry="6.4" fill="#8d3040"/>
      <path class="n2-mark" d="M103 14 v13" stroke="#e0685f" stroke-width="3.2" stroke-linecap="round"/>
      <path class="n2-mark" d="M112 18 v10" stroke="#e0685f" stroke-width="2.6" stroke-linecap="round" opacity=".8"/>`,

    /* 考え中：課題の提示。視線を上げ、片眉を上げる */
    thinking: () => `
      ${brow(39, 53.5, 'q7.5 0 15 -2.5')}${brow(66, 48, 'q7.5 -3 15 1.5')}
      <g class="n2-eyes">${openEye(EYE_L, 1.8, -2.6)}${openEye(EYE_R, 2, -2.8)}</g>
      ${blush(.34)}
      <path class="n2-mouth" d="M54 81.5 q7 -4 12.5 1.5 q-6.5 3.2 -12.5 -1.5 Z" fill="#8d3040"/>
      <circle class="n2-mark" cx="99" cy="34" r="2" fill="#f2c14e"/>
      <circle class="n2-mark" cx="106" cy="27" r="2.6" fill="#f2c14e"/>
      <circle class="n2-mark" cx="114" cy="18" r="3.4" fill="#f2c14e"/>`,
  };

  /* ---------------- 体（全表情共通） ---------------- */
  const nar = document.createElement('div');
  nar.className = 'sdg-nar2';
  nar.setAttribute('aria-hidden', 'true');
  nar.innerHTML = `
<svg viewBox="0 0 120 152" role="img">
  <defs>
    <linearGradient id="n2-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a9fb4"/><stop offset="1" stop-color="#1f4f63"/></linearGradient>
    <linearGradient id="n2-coat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0f4ff"/><stop offset="1" stop-color="#c2cde6"/></linearGradient>
    <radialGradient id="n2-iris" cx=".4" cy=".3">
      <stop offset="0" stop-color="#79c7e6"/><stop offset="1" stop-color="#1c5f86"/></radialGradient>
  </defs>

  <ellipse cx="60" cy="149" rx="36" ry="4.5" fill="#000" opacity=".38"/>

  <g class="n2-body">
    <!-- 後ろ髪（ボブ）：暗い背景でもシルエットが出るようティール系 -->
    <path d="M60 7 C25 7 15 33 15 64 C15 87 18 102 20 112 L41 108
             C37 92 35 78 35 63 C35 41 44 29 60 29 C76 29 85 41 85 63
             C85 78 83 92 79 108 L100 112 C102 102 105 87 105 64 C105 33 95 7 60 7 Z"
          fill="url(#n2-hair)"/>

    <!-- 首・襟・スカーフ・上着 -->
    <path d="M52 84 h16 v16 q-8 5 -16 0 z" fill="#e0b494"/>
    <path d="M14 152 v-21 c0-13 8-23 20-27 l13-4 h26 l13 4 c12 4 20 14 20 27 v21 z" fill="url(#n2-coat)"/>
    <path d="M14 152 v-21 c0-13 8-23 20-27 l6-2 c-9 9 -13 19 -13 29 v21 z" fill="#2c3b60"/>
    <path d="M106 152 v-21 c0-13 -8-23 -20-27 l-6-2 c9 9 13 19 13 29 v21 z" fill="#2c3b60"/>
    <path d="M45 100 l15 15 15-15 -6-3 q-9 6 -18 0 z" fill="#243357"/>
    <path d="M43 98 q17 12 34 0 l4.5 7 q-21 14 -43 0 z" fill="#e0685f"/>
    <path d="M79 104 l9 15 -7 3.5 -6.5-14 z" fill="#c9524a"/>
    <path d="M60 115 V152" stroke="#f2c14e" stroke-width="2" opacity=".85"/>
    <circle cx="35" cy="128" r="6.4" fill="#243357" stroke="#f2c14e" stroke-width="1.8"/>
    <circle cx="35" cy="128" r="2.2" fill="#5b9bd5"/>

    <!-- 顔 -->
    <ellipse cx="60" cy="56" rx="33" ry="34" fill="#f7d9bd"/>
    <path d="M27 60 q4 12 10 16 q-9 -2 -10 -16 z" fill="#e8bd9c" opacity=".55"/>

    <!-- 前髪：房を3つに割ったアシンメトリーな流し前髪 -->
    <path d="M26 57 C25 26 40 12 60 12 C81 12 95 26 94 55
             C92.5 45 88.5 39 83.5 36 C83 42 79.5 46 74.5 47
             C75.5 41 72.5 37.5 69 36 C61 42 52.5 43.5 46 40.5
             C47.5 43.5 44 46 40 46.5 C40.5 42 38.5 39 36.5 37.5
             C31.5 41.5 28 48 26 57 Z" fill="url(#n2-hair)"/>
    <path d="M26 56 C27 41 31 32 36 28.5 C33 37 31.5 45 32 56 Z" fill="#1c4657"/>
    <path d="M52 19 C63 15 75 19 82 27" stroke="#8fdcef" stroke-width="2.4"
          fill="none" opacity=".4" stroke-linecap="round"/>
    <!-- アホ毛：小さくてもシルエットで分かる目印 -->
    <path d="M58 10 q3 -12 13 -11 q-8 3 -8 11" fill="#3d8ea4"/>
    <!-- 髪留め（金・ゲームのアクセント色） -->
    <path d="M34 31 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 z" fill="#f2c14e"/>

    <!-- ヘッドセット -->
    <path d="M24 58 C22 31 39 18 60 18 C81 18 98 31 96 58"
          stroke="#16233d" stroke-width="7.4" fill="none" stroke-linecap="round"/>
    <path d="M24 58 C22 31 39 18 60 18 C81 18 98 31 96 58"
          stroke="#e6ecfb" stroke-width="4.6" fill="none" stroke-linecap="round"/>
    <circle cx="23" cy="60" r="8.6" fill="#243357" stroke="#f2c14e" stroke-width="1.8"/>
    <circle cx="23" cy="60" r="3.2" fill="#5b9bd5"/>
    <circle cx="97" cy="60" r="8.6" fill="#243357" stroke="#f2c14e" stroke-width="1.8"/>
    <circle cx="97" cy="60" r="3.2" fill="#5b9bd5"/>
    <path d="M95 68 C92 79 86 84 79 84" stroke="#e6ecfb" stroke-width="3"
          fill="none" stroke-linecap="round"/>
    <circle cx="78" cy="84" r="3.2" fill="#f2c14e"/>

    <!-- 表情（ここだけ差し替える） -->
    <g class="n2-face">${FACES.normal()}</g>
  </g>
</svg>`;
  document.body.appendChild(nar);

  const faceG = nar.querySelector('.n2-face');
  let current = 'normal';

  function face(name) {
    const f = FACES[name] ? name : 'normal';
    if (f === current) return;
    current = f;
    faceG.innerHTML = FACES[f]();
  }

  window.SDG.narrator = {
    show: on => { nar.classList.toggle('on', !!on); if (!on) nar.classList.remove('talk'); },
    talk: on => { nar.classList.add('on'); nar.classList.toggle('talk', !!on); },
    face,
    get current() { return current; },
    el: nar,
  };

  /* ---- 音声IDから表情を自動で選ぶ（既存ファイルを触らずに表情を活かすため） ----
     narrate() を一度だけラップする。失敗しても本来の再生には影響させない。 */
  if (window.SDG.narrate && !window.SDG.narrate.__n2wrapped) {
    const orig = window.SDG.narrate;
    const pick = id => {
      const s = String(id || '');
      if (/^mission_/.test(s)) return 'thinking';
      if (/^(op_ready|win|clear|success)/.test(s)) return 'happy';
      if (/(fail|abort|lost)/.test(s)) return 'surprised';
      return 'normal';
    };
    const wrapped = function (id) {
      try { face(pick(id)); } catch (_) { /* 表情は演出。失敗しても再生は続ける */ }
      return orig.apply(this, arguments);
    };
    wrapped.__n2wrapped = true;
    window.SDG.narrate = wrapped;
  }
})();
