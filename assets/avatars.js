/* avatars.js — 対戦相手（CPU）の顔つき（インラインSVGのアバター）
 *
 * ■ 課題
 *   CPUに顔が無く、「誰と戦っているのか」が画面から伝わらない。
 *   ダイジェスト（cpu_digest.js）の列見出しと順位表に顔を出して、
 *   相手を「人格のある3人」として認識できるようにする。
 *
 * ■ 権利について
 *   narrator.js（ノヴァ）と同じく、完全オリジナルの手描きSVG。実在の人物・
 *   既存キャラクターの意匠（髪型・髪色・衣装・配色・小物）は一切参照していない。
 *   外部画像・外部フォント・CDN・fetch を使わないので、静的公開版でもそのまま動く。
 *
 * ■ 作風
 *   src/render.py のミッション絵札／narrator.js に合わせたフラットな塗り。
 *   配色は board.css のトークン（--acc #f2c14e / --ok #4caf82 / --ng #e05d5d /
 *   ロケット #e0685f / 衛星 #5b9bd5 / panel #161d31 / line #2a3355）に揃える。
 *   26px 前後でも判別できるよう、シルエット（帽子の形・はみ出す小物）で差をつけた。
 *
 * ■ キャラクター（席と policy から決定論的に決まる。同じ相手はいつも同じ顔）
 *   回転型 → ラチェット : 黄の作業ヘルメット＋額に上げたゴーグル。橙のつなぎ。
 *                          手数で回す、現場叩き上げの実直な技術者。
 *   狙撃型 → レティクル : 顔幅より広い青のHUDバイザー＋右に跳ねたポニーテール。
 *                          照準に十字。狙って撃つ、口数の少ない観測手。
 *   狙撃型 → パララクス : 緑のニット帽（先にポンポン）＋丸眼鏡＋大きなマフラー。
 *                          同じ狙撃型でも、こちらは机上で計算するタイプ。
 *   あなた → チーフ     : 白×金の管制ジャケット＋マイクアームつきヘッドセット。
 *   既定   → オービット : 全面バイザーの与圧ヘルメット（席や policy が不明なとき）。
 *
 * ■ API
 *   window.SDG.avatar = {
 *     svg(player, opts)  // {i,name,policy,score,money} → SVG文字列
 *     name(player)       // 表示用コールサイン（"ラチェット" など）
 *     key(player)        // 内部のキャラクターID（テスト用）
 *     desc(player)       // 一行の人物紹介（title 属性などに使える）
 *   }
 *   opts: {mood:'up'|'down'|null, cls:'追加クラス', label:'aria-label（省略時は装飾扱い）'}
 *   player は null／未知でも落ちない（既定の顔「オプス」を返す）。
 *
 *   standings の要素は {name, score, money} しか持たないため、i / policy が
 *   無いときは name（"CPU2（狙撃型）" / "あなた"）から復元する。
 */
(() => {
  'use strict';
  const SDG = (window.SDG = window.SDG || {});

  /* ------------------------------------------------ プレイヤーの正規化 */

  const RE_NAME = /^CPU\s*(\d+)\s*[（(]\s*([^）)]+)\s*[）)]/;

  /** {i, policy} が欠けていても name から復元する */
  function norm(p) {
    const o = {i: null, policy: '', name: '', score: 0, money: 0};
    if (!p || typeof p !== 'object') return o;
    o.name = String(p.name == null ? '' : p.name);
    o.score = Number(p.score) || 0;
    o.money = Number(p.money) || 0;
    if (typeof p.i === 'number' && isFinite(p.i)) o.i = p.i;
    if (p.policy) o.policy = String(p.policy);
    if (o.i == null || !o.policy) {
      const m = o.name.match(RE_NAME);
      if (m) {
        if (o.i == null) o.i = Number(m[1]);      // "CPU2（…）" の 2 = 席index 2
        if (!o.policy) o.policy = m[2];
      } else if (/^あなた/.test(o.name)) {
        if (o.i == null) o.i = 0;
        if (!o.policy) o.policy = 'あなた';
      }
    }
    return o;
  }

  /** 席index と policy から、決定論的にキャラクターを選ぶ */
  function key(p) {
    const o = norm(p);
    if (o.i === 0 || o.policy === 'あなた' || /^あなた/.test(o.name)) return 'chief';
    if (o.policy === '回転型') return 'ratchet';
    if (o.policy === '狙撃型') {
      // 狙撃型は複数いる。席で振り分けて、2人が別人に見えるようにする。
      // 名前 CPU{n} は席index n そのもの（serve.py / engine.js の name()）。
      // 4人戦なら CPU2=レティクル / CPU3=パララクス、1対1（CPU1が狙撃型）は
      // パララクスになる。人数が変わっても席で一意に決まる。
      if (o.i == null) return 'reticle';
      return (o.i % 2 === 0) ? 'reticle' : 'parallax';
    }
    if (o.i == null) return 'ops';
    const ORDER = ['chief', 'ratchet', 'reticle', 'parallax'];
    return ORDER[o.i % ORDER.length] || 'ops';
  }

  /* ------------------------------------------------------ 共通パーツ */

  const SKIN = '#f0cfae', SHADE = '#d9ae89', LINE = '#152238';

  /** 顔（輪郭＋耳＋頬の影）。すべてのキャラで同じ位置に置く */
  const FACE = `
    <ellipse cx="19.9" cy="30.4" rx="2.3" ry="3.1" fill="${SHADE}"/>
    <ellipse cx="44.1" cy="30.4" rx="2.3" ry="3.1" fill="${SHADE}"/>
    <ellipse cx="32" cy="29" rx="12.6" ry="13.4" fill="${SKIN}"/>
    <path d="M19.8 30 q1.4 8.4 6.2 11 q-6.4 -1.4 -6.2 -11 z" fill="${SHADE}" opacity=".45"/>`;

  /** 目。負けているときだけ少し伏せる */
  function eyes(mood, col) {
    const c = col || LINE, dy = mood === 'down' ? .8 : 0;
    return `
      <ellipse cx="26.4" cy="${29 + dy}" rx="2" ry="${mood === 'down' ? 1.7 : 2.3}" fill="${c}"/>
      <ellipse cx="37.6" cy="${29 + dy}" rx="2" ry="${mood === 'down' ? 1.7 : 2.3}" fill="${c}"/>
      <circle cx="25.6" cy="${28.1 + dy}" r=".75" fill="#fff" opacity=".92"/>
      <circle cx="36.8" cy="${28.1 + dy}" r=".75" fill="#fff" opacity=".92"/>`;
  }

  /** 眉。勝っていれば片眉を上げた自信、負けていれば八の字 */
  function brows(mood, col, y) {
    const c = col || '#3b3026', Y = y == null ? 23.2 : y;
    const st = `stroke="${c}" stroke-width="2.1" fill="none" stroke-linecap="round"`;
    if (mood === 'up') {
      return `<path d="M22.4 ${Y + .8} q3.7 -2.3 7.4 -1.5" ${st}/>
              <path d="M34.2 ${Y - .8} q3.7 -1 7.4 1.5" ${st}/>`;
    }
    if (mood === 'down') {
      return `<path d="M22.4 ${Y + 1.2} q3.7 -1.4 7.4 -2.2" ${st}/>
              <path d="M34.2 ${Y - 1} q3.7 .8 7.4 2.2" ${st}/>`;
    }
    return `<path d="M22.4 ${Y + .2} q3.7 -1.5 7.4 -.3" ${st}/>
            <path d="M34.2 ${Y - .1} q3.7 -1.2 7.4 .3" ${st}/>`;
  }

  /** 口。勝ち＝ゆるむ、負け＝への字 */
  function mouth(mood, y) {
    const Y = y == null ? 36 : y;
    const st = 'stroke="#9a4149" stroke-width="1.9" fill="none" stroke-linecap="round"';
    if (mood === 'up') return `<path d="M28 ${Y - .6} q4 3.6 8 0" ${st}/>`;
    if (mood === 'down') return `<path d="M28.4 ${Y + 1.4} q3.6 -2.6 7.2 0" ${st}/>`;
    return `<path d="M28.8 ${Y} q3.2 1.2 6.4 0" ${st}/>`;
  }

  /* ------------------------------------------------ キャラクター定義 */
  /* 描画順は「肩 → 首 → 顔 → 髪／帽子 → 表情 → 小物」。
     64x64 の円に収め、頭は cx32 cy29 rx12.6 ry13.4 で固定して差分を作る。 */

  const CHARS = {

    /* ── ラチェット（回転型）:黄ヘルメット＋額のゴーグル＋橙のつなぎ ── */
    ratchet: {
      call: 'ラチェット',
      ring: '#f2c14e',
      bg: '#221b17',
      desc: '現場叩き上げ。安く組んで、とにかく回す',
      draw(mood) {
        return `
        <path d="M4 64 v-6 c0-7.4 5.6-11.6 12.8-13.6 l7.2-2 h16 l7.2 2
                 c7.2 2 12.8 6.2 12.8 13.6 v6 z" fill="#e0685f"/>
        <path d="M9.6 57.4 q22.4 6 44.8 0" stroke="#f4e2d6" stroke-width="2"
              fill="none" opacity=".5"/>
        <rect x="12.4" y="49.6" width="7.6" height="5.6" rx="1.4" fill="#c2544d"/>
        <rect x="15.4" y="48" width="1.8" height="4.4" rx=".9" fill="#f2c14e"/>
        <path d="M27.2 38.4 h9.6 v7.2 h-9.6 z" fill="${SHADE}"/>
        <path d="M23.6 43.2 l8.4 9 8.4-9 -3.2-1.4 q-5.2 3.2 -10.4 0 z" fill="#c2544d"/>
        ${FACE}
        <path d="M21.6 35.6 q10.4 6.6 20.8 0 q-1.6 6.6 -10.4 7.2 q-8.8 -.6 -10.4 -7.2 z"
              fill="#4a3a2f" opacity=".26"/>
        <path d="M19.6 24 q.6 -6 2.2 -8.6 l1.6 9 z" fill="#5b4632"/>
        <path d="M44.4 24 q-.6 -6 -2.2 -8.6 l-1.6 9 z" fill="#5b4632"/>
        <path d="M17 19 C17 8.2 23.6 3 32 3 C40.4 3 47 8.2 47 19 Z" fill="#f2c14e"/>
        <path d="M21 18.4 C21 10.6 25.2 6 30.4 5.2 C25.6 7.6 23.4 12.4 23.4 18.4 Z"
              fill="#fce6ad" opacity=".85"/>
        <path d="M31 3.4 h2 v15.6 h-2 z" fill="#d99a2c" opacity=".8"/>
        <path d="M12.4 17.4 h39.2 q1.4 2.6 -.6 4 H13 q-2 -1.4 -.6 -4 z" fill="#d99a2c"/>
        <path d="M16.6 12.4 h30.8" stroke="#243357" stroke-width="4.2" stroke-linecap="round"/>
        <rect x="18.2" y="8.6" width="10.6" height="6.6" rx="3.2" fill="#7fd0e8"
              stroke="#243357" stroke-width="1.5"/>
        <rect x="35.2" y="8.6" width="10.6" height="6.6" rx="3.2" fill="#7fd0e8"
              stroke="#243357" stroke-width="1.5"/>
        <path d="M19.6 10.4 q3.2 -1.4 6.4 -.6" stroke="#fff" stroke-width="1.2"
              fill="none" opacity=".7"/>
        ${brows(mood, '#4a3a2f', 24)}
        ${eyes(mood)}
        ${mouth(mood, 36.4)}`;
      }
    },

    /* ── レティクル（狙撃型A）:横に張り出す青のHUDバイザー＋ポニーテール ── */
    reticle: {
      call: 'レティクル',
      ring: '#5b9bd5',
      bg: '#131c2e',
      desc: '場を読む観測手。狙える課題だけを撃つ',
      draw(mood) {
        const aim = mood === 'down' ? '#96a0c0' : '#f2c14e';
        return `
        <path d="M43.6 19.6 C55 22 58.4 32.4 53.6 41.6 C51.4 46 47.2 47.2 45.2 45.6
                 C50.4 38.8 50.6 28.6 42.8 24.4 Z" fill="#2b4f74"/>
        <path d="M47.6 26 C52 30 52.4 36.4 50 41" stroke="#4b7fae" stroke-width="1.6"
              fill="none" opacity=".8"/>
        <path d="M5 64 v-5.4 c0-7.4 5.6-11.6 12.8-13.6 l7.2-2.2 h14 l7.2 2.2
                 c7.2 2 12.8 6.2 12.8 13.6 v5.4 z" fill="#243357"/>
        <path d="M22.6 43 q9.4 6.4 18.8 0 l2.4 4.6 q-11.8 7.4 -23.6 0 z" fill="#1a2540"/>
        <path d="M21.6 50.6 l10.4 6.4 10.4 -6.4" stroke="#5b9bd5" stroke-width="1.9"
              fill="none"/>
        <path d="M27.4 38.4 h9.2 v7 h-9.2 z" fill="${SHADE}"/>
        ${FACE}
        <path d="M18.6 26.4 C18.6 12.8 25.2 8 32 8 C39.4 8 45.6 13 45.4 26.4
                 C43.8 20.2 41 17.2 37.8 16.2 C32.6 20.4 26 21.6 21.6 19.8
                 C20.2 21.4 19.2 23.6 18.6 26.4 Z" fill="#2b4f74"/>
        <path d="M41.4 21.4 h5.4 v4.6 h-5.4 z" fill="#5b9bd5" opacity=".9"/>
        ${mouth(mood, 38.2)}
        <rect x="12.4" y="26.6" width="4.4" height="7" rx="2.2" fill="#5b9bd5"/>
        <rect x="14.6" y="24.6" width="35" height="9.6" rx="4.8" fill="#101c33"
              stroke="#5b9bd5" stroke-width="1.4"/>
        <path d="M17.6 29.6 h28.8" stroke="#5b9bd5" stroke-width=".9" opacity=".4"/>
        <ellipse cx="25.4" cy="29.4" rx="3" ry="1.6" fill="#8fd6f4" opacity=".8"/>
        <ellipse cx="37.4" cy="29.4" rx="3" ry="1.6" fill="#8fd6f4" opacity=".55"/>
        <circle cx="37.4" cy="29.4" r="3.8" fill="none" stroke="${aim}" stroke-width="1.2"/>
        <path d="M37.4 24.6 v2.2 M37.4 32 v2.2 M32.6 29.4 h2.2 M40 29.4 h2.2"
              stroke="${aim}" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M14.8 26.6 q6 -2.6 13 -2.2" stroke="#fff" stroke-width="1.4"
              fill="none" opacity=".16"/>`;
      }
    },

    /* ── パララクス（狙撃型B）:緑のニット帽＋丸眼鏡＋大きなマフラー ── */
    parallax: {
      call: 'パララクス',
      ring: '#4caf82',
      bg: '#152720',
      desc: '机上派の観測手。期待値を計算してから動く',
      draw(mood) {
        const glint = mood === 'up' ? '.34' : '.14';
        return `
        <path d="M5 64 v-5.4 c0-7.4 5.6-11.6 12.8-13.6 l6.4-1.8 h15.6 l6.4 1.8
                 c7.2 2 12.8 6.2 12.8 13.6 v5.4 z" fill="#24403a"/>
        <path d="M28 38.6 h8 v6.6 h-8 z" fill="${SHADE}"/>
        ${FACE}
        <path d="M17.6 18.6 C17.6 8 24 3.2 32 3.2 C40 3.2 46.4 8 46.4 18.6 Z"
              fill="#3f8f6a"/>
        <path d="M24.4 4.6 q-2.4 6.4 -2.2 14 M32 3.2 v15.4 M39.6 4.6 q2.4 6.4 2.2 14"
              stroke="#2f7355" stroke-width="1.3" fill="none" opacity=".75"/>
        <circle cx="32" cy="3.4" r="3.6" fill="#8ad9b4"/>
        <rect x="16" y="16.2" width="32" height="6" rx="3" fill="#4caf82"/>
        <path d="M18.6 16.4 v5.6 M23.6 16.4 v5.6 M28.6 16.4 v5.6 M33.6 16.4 v5.6
                 M38.6 16.4 v5.6 M43.6 16.4 v5.6" stroke="#3f8f6a" stroke-width="1.2"/>
        <path d="M19.4 22.6 q5 3.6 12.6 2.6 q7.6 1 12.6 -2.6 l0 1.4
                 q-5 4 -12.6 3 q-7.6 1 -12.6 -3 z" fill="#cfd8ea"/>
        <path d="M19.4 22.4 q-.6 6 .4 10 q-2 -5 -1.4 -10 z" fill="#cfd8ea"/>
        <path d="M44.6 22.4 q.6 6 -.4 10 q2 -5 1.4 -10 z" fill="#cfd8ea"/>
        ${brows(mood, '#8e9ab4', 26.2)}
        ${eyes(mood)}
        ${mouth(mood, 36.2)}
        <g fill="#8fd6f4" fill-opacity="${glint}" stroke="#e8ecf8" stroke-width="1.5">
          <circle cx="25.6" cy="29.4" r="5.2"/><circle cx="38.4" cy="29.4" r="5.2"/>
        </g>
        <path d="M30.8 29 h2.4 M20.4 28.4 l-3.4 -1 M43.6 28.4 l3.4 -1"
              stroke="#e8ecf8" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <path d="M22.6 26.6 q2.6 -1.6 5 -1.2" stroke="#fff" stroke-width="1.2"
              fill="none" opacity=".5"/>
        <path d="M16.4 43.6 q15.6 9.2 31.2 0 q2.6 3.6 2 7.4 q-17.6 10.4 -35.2 0
                 q-.6 -3.8 2 -7.4 z" fill="#4caf82"/>
        <path d="M39.8 49.6 q4.8 1.8 5.2 6.6 l-3.6 7.8 -5.6 -1.8 z" fill="#3f8f6a"/>
        <path d="M18.4 47.6 q13.6 6.6 27.2 0" stroke="#2f7355" stroke-width="1.2"
              fill="none" opacity=".7"/>`;
      }
    },

    /* ── チーフ（あなた）:白×金の管制ジャケット＋マイクアーム ── */
    chief: {
      call: 'チーフ',
      ring: '#f2c14e',
      bg: '#1b2036',
      desc: 'あなた。この管制卓の責任者',
      draw(mood) {
        return `
        <path d="M5 64 v-5.4 c0-7.4 5.6-11.6 12.8-13.6 l7.2-2 h14 l7.2 2
                 c7.2 2 12.8 6.2 12.8 13.6 v5.4 z" fill="#e3e9f8"/>
        <path d="M5 64 v-5.4 c0-7.4 5.6-11.6 12.8-13.6 l3.6-1
                 c-5.2 5 -7.4 10.6 -7.4 16.2 V64 z" fill="#2c3b60"/>
        <path d="M59 64 v-5.4 c0-7.4 -5.6-11.6 -12.8-13.6 l-3.6-1
                 c5.2 5 7.4 10.6 7.4 16.2 V64 z" fill="#2c3b60"/>
        <path d="M23.6 43.4 l8.4 9.2 8.4-9.2 -3.2-1.4 q-5.2 3.2 -10.4 0 z" fill="#243357"/>
        <path d="M32 52.6 V64" stroke="#f2c14e" stroke-width="2.2" opacity=".9"/>
        <rect x="8.6" y="54.6" width="9.6" height="3.4" rx="1.7" fill="#f2c14e"/>
        <rect x="45.8" y="54.6" width="9.6" height="3.4" rx="1.7" fill="#f2c14e"/>
        <path d="M27.4 38.4 h9.2 v7 h-9.2 z" fill="${SHADE}"/>
        ${FACE}
        <path d="M18.8 25.4 C18.8 12.6 25.2 7.8 32 7.8 C38.8 7.8 45.2 12.6 45.2 25.4
                 C43.6 18.8 40.4 15.8 36.4 15.2 C30.6 19 24.4 19.6 21.6 17.8
                 C20.2 19.4 19.2 22 18.8 25.4 Z" fill="#1f2b48"/>
        ${brows(mood, '#1f2b48', 23.6)}
        ${eyes(mood)}
        ${mouth(mood, 36.2)}
        <path d="M18.6 27.4 C17 13.8 24 8.4 32 8.4 C40 8.4 47 13.8 45.4 27.4"
              stroke="#16233d" stroke-width="5.6" fill="none" stroke-linecap="round"/>
        <path d="M18.6 27.4 C17 13.8 24 8.4 32 8.4 C40 8.4 47 13.8 45.4 27.4"
              stroke="#e6ecfb" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="17.4" cy="29.4" r="4.8" fill="#243357" stroke="#f2c14e" stroke-width="1.5"/>
        <circle cx="17.4" cy="29.4" r="1.8" fill="#5b9bd5"/>
        <circle cx="46.6" cy="29.4" r="4.8" fill="#243357" stroke="#f2c14e" stroke-width="1.5"/>
        <circle cx="46.6" cy="29.4" r="1.8" fill="#5b9bd5"/>
        <path d="M21.4 33.4 C16.4 36.8 17.4 41.8 22.4 42.8" stroke="#e6ecfb"
              stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="23.4" cy="42.8" r="2.3" fill="#f2c14e"/>`;
      }
    },

    /* ── オプス（既定）:全面バイザーの与圧ヘルメット。素性が分からない相手 ── */
    ops: {
      call: 'オービット',
      ring: '#96a0c0',
      bg: '#171d2e',
      desc: '素性の分からない相手（既定の顔）',
      draw(mood) {
        const vis = mood === 'up' ? '#5b9bd5' : (mood === 'down' ? '#5c6584' : '#96a0c0');
        return `
        <path d="M5 64 v-5.4 c0-7.4 5.6-11.6 12.8-13.6 l7.2-2 h14 l7.2 2
                 c7.2 2 12.8 6.2 12.8 13.6 v5.4 z" fill="#4a5878"/>
        <path d="M18.4 46.6 q13.6 7 27.2 0 l1.6 4 q-15 8.4 -30.4 0 z" fill="#c3cde3"/>
        <rect x="20.6" y="40.4" width="22.8" height="5" rx="2.5" fill="#c3cde3"/>
        <circle cx="32" cy="27.6" r="15.4" fill="#dfe6f4"/>
        <path d="M18.6 25.4 q13.4 -7.4 26.8 0 q1.4 9 -3.8 13.2 q-9.6 4.6 -19.2 0
                 q-5.2 -4.2 -3.8 -13.2 z" fill="#101c33" stroke="${vis}" stroke-width="1.4"/>
        <path d="M23 26.4 q5.6 -3 11 -1.6 l-8.6 12.4 q-3.4 -4.4 -2.4 -10.8 z"
              fill="#f2c14e" opacity=".3"/>
        <rect x="43.6" y="20.4" width="4" height="8.4" rx="2" fill="#96a0c0"/>
        <path d="M45.6 20.4 v-5" stroke="#96a0c0" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="45.6" cy="14" r="1.8" fill="#e05d5d"/>`;
      }
    },
  };

  /* ---------------------------------------------------------- 組み立て */

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const CHAR = p => CHARS[key(p)] || CHARS.ops;

  /**
   * アバターのSVG文字列を返す。
   * @param {object|null} player {i,name,policy,score,money}
   * @param {object} [opts] {mood:'up'|'down', cls, label}
   */
  let seq = 0;   // clipPath の id を1枚ごとに一意にする（同一ページに何枚も並ぶため）

  function svg(player, opts) {
    const o = opts || {};
    const c = CHAR(player);
    const mood = (o.mood === 'up' || o.mood === 'down') ? o.mood : null;
    const cls = 'sdg-av' + (mood ? ' is-' + mood : '') + (o.cls ? ' ' + o.cls : '');
    const a11y = o.label
      ? ` role="img" aria-label="${esc(o.label)}"` : ' role="presentation" aria-hidden="true"';
    const cid = 'sdgav' + (++seq);
    return `<svg class="${esc(cls)}" viewBox="0 0 64 64"${a11y}>
      <clipPath id="${cid}"><circle cx="32" cy="32" r="31"/></clipPath>
      <circle cx="32" cy="32" r="31" fill="${c.bg}"/>
      <g clip-path="url(#${cid})">${c.draw(mood)}</g>
      <circle cx="32" cy="32" r="30.2" fill="none" stroke="${c.ring}" stroke-width="1.8"
              opacity=".9"/>
    </svg>`;
  }

  /** 表示用コールサイン。同じ顔が複数席にいるときだけ末尾に席番号を足す */
  function callsign(player) {
    const c = CHAR(player);
    const o = norm(player);
    // 5人以上の変則卓で顔が重複したときの保険（通常の1〜4人戦では起きない）
    if (c === CHARS.ops && o.i != null && o.i > 0) return c.call + '-' + o.i;
    return c.call;
  }

  SDG.avatar = {
    svg,
    name: callsign,
    key,
    desc: p => CHAR(p).desc || '',
    chars: CHARS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDG.avatar;
  }
})();
