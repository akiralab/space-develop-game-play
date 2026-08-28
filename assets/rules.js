/* rules.js — ルール説明画面（issue #3）
   manim動画があるシーンは動画、無いシーンはインラインSVGで描く。
   音声（/assets/voice/rule_N.mp3）＋字幕を必ず併用する。 */
(() => {
  /* 1シーン = 音声1本（rule_1〜rule_8）。
     複数行を順に読む方式にしていた時期があるが、声が混ざる・重なる不具合が出たため戻した。
     台本は tools/narrate.py の build_script()。 */
  const SCENES = [
    // 順番は「目的 → 手番の全体像 → 実際に払うお金（開発/搭載・打上/収支）→ 得点 → 実データ」
    { id: 'rule_1', title: '勝利条件', video: 'rule_1.webm' },
    { id: 'rule_2', title: '手番でできること', video: 'rule_2.webm' },
    { id: 'rule_6', title: '① 開発を宣言する', video: 'rule_6.webm' },
    { id: 'rule_7', title: '② 搭載して打ち上げる', video: 'rule_7.webm' },
    { id: 'rule_3', title: '打ち上げ判定', video: 'rule_3.webm' },
    { id: 'rule_4', title: 'ミッションと得点', video: 'rule_4.webm' },
    { id: 'rule_8', title: '③ かかるお金と、戻るお金', video: 'rule_8.webm' },
    { id: 'rule_5', title: '実データで遊ぶ', video: 'rule_5.webm' },
  ];

  const SVG = {
    // 2アクション: 5種の行動アイコンが順に光る（v2.5で「進化」を廃止）
    actions: `<svg viewBox="0 0 800 400">
      <defs><style>
        .k{fill:#161d31;stroke:#2a3355;stroke-width:2;rx:12}
        .t{font:600 17px "Hiragino Sans";fill:#e8ecf8;text-anchor:middle}
        .e{font:30px sans-serif;text-anchor:middle}
        .h{font:800 26px "Hiragino Sans";fill:#f2c14e;text-anchor:middle;letter-spacing:.1em}
        .n{font:13px "Hiragino Sans";fill:#96a0c0;text-anchor:middle}
        @keyframes pop{0%,100%{opacity:.35;transform:translateY(0)}
                       12%,26%{opacity:1;transform:translateY(-9px)}}
        .g{transform-box:fill-box;transform-origin:center;animation:pop 4.2s ease-in-out infinite}
      </style></defs>
      <text class="h" x="400" y="52">1年に打てる手は 2つ</text>
      <text class="n" x="400" y="80">同じ種類の行動は1年に1回まで</text>
      ${[['🔧','開発宣言'],['🔗','搭載'],['🚀','打上'],['🔄','交換'],['💰','資金調達']]
        .map(([e, t], i) => {
          const x = 87 + i * 130, y = 150;
          return `<g class="g" style="animation-delay:${(i * .55).toFixed(2)}s">
            <rect class="k" x="${x}" y="${y}" width="106" height="106" rx="12"/>
            <text class="e" x="${x + 53}" y="${y + 58}">${e}</text>
            <text class="t" x="${x + 53}" y="${y + 88}">${t}</text></g>`;
        }).join('')}
      <text class="n" x="400" y="330">選んで、組んで、宇宙へ送り出す</text>
    </svg>`,
    // 実データ: 分解能の比較
    data: `<svg viewBox="0 0 800 400">
      <defs><style>
        .h{font:800 25px "Hiragino Sans";fill:#f2c14e;text-anchor:middle;letter-spacing:.08em}
        .l{font:600 15px "Hiragino Sans";fill:#e8ecf8}
        .s{font:12px "Hiragino Sans";fill:#96a0c0}
        @keyframes gw{from{width:0}}
        .b{animation:gw 1.4s cubic-bezier(.2,.8,.2,1) both}
      </style></defs>
      <text class="h" x="400" y="48">券面の数値は、すべて実データ</text>
      ${[['Landsat 1 (MSS)','80 m',150,'#5b9bd5',.35],
         ['Landsat 8 (OLI)','30 m',330,'#5b9bd5',.75],
         ['Sentinel-2 (MSI)','10 m',430,'#5b9bd5',.9],
         ['だいち2号 (PALSAR-2)','3 m',480,'#e0685f',1.05]]
        .map(([n, v, w, c, d], i) => {
          const y = 100 + i * 68;
          return `<text class="l" x="40" y="${y + 4}">${n}</text>
            <text class="s" x="760" y="${y + 4}" text-anchor="end">分解能 ${v}</text>
            <rect x="40" y="${y + 16}" width="720" height="12" rx="6" fill="#1d2540"/>
            <rect class="b" x="40" y="${y + 16}" width="${w}" height="12" rx="6" fill="${c}"
                  style="animation-delay:${d}s"/>`;
        }).join('')}
      <text class="s" x="400" y="378" text-anchor="middle">
        遊ぶうちに「どの課題に、どの衛星が効くか」が身につく</text>
    </svg>`,
  };

  let root = null, idx = 0, playing = false;

  function build() {
    root = document.createElement('div');
    root.id = 'sdg-rules';
    root.innerHTML = `
      <h3></h3>
      <div class="stage"></div>
      <div class="cap"></div>
      <div class="nav">
        <button class="prev">← 前へ</button>
        <div class="dots">${SCENES.map(() => '<i></i>').join('')}</div>
        <button class="next go">次へ →</button>
        <button class="skip">スキップしてゲームへ</button>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('.prev').onclick = () => go(idx - 1);
    root.querySelector('.next').onclick = () => go(idx + 1);
    root.querySelector('.skip').onclick = hide;
  }

  function go(i) {
    if (i < 0) return;
    if (i >= SCENES.length) return hide();
    idx = i;
    const sc = SCENES[i];
    root.querySelector('h3').textContent = `${i + 1} / ${SCENES.length}　${sc.title}`;
    const stage = root.querySelector('.stage');
    if (sc.video) {
      // webm(VP9) を優先し、再生できない環境（iOS Safari 17.4 未満など）は mp4(H.264) に落とす
      const base = 'assets/rules/' + sc.video.replace(/\.webm$/, '');
      stage.innerHTML = `<video autoplay muted playsinline loop>
        <source src="${base}.webm" type="video/webm">
        <source src="${base}.mp4" type="video/mp4"></video>`;
      const v = stage.querySelector('video');
      // 動画が再生できない環境ではSVG/文字にフォールバックして空白を作らない。
      // <source> 方式では error が video ではなく最後の <source> に飛ぶので、両方に張る。
      const fail = () => stage.innerHTML = `<div style="padding:40px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#f2c14e">${sc.title}</div></div>`;
      v.onerror = fail;
      const last = stage.querySelector('source:last-of-type');
      if (last) last.onerror = fail;
      v.play().catch(() => {});
    } else {
      stage.innerHTML = SVG[sc.svg];
    }
    root.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    root.querySelector('.next').textContent = i === SCENES.length - 1 ? '▶ ゲームを始める' : '次へ →';

    say(sc);
  }

  /* シーンのナレーションを頭から順に読む。字幕はこのパネルにも常時出す（音が出せない会場対策）。
     seq は「今どのシーンを読んでいるか」の世代番号。前へ/次へ/閉じるで進むと世代がずれ、
     読みかけの残りの行は捨てる（前のシーンの続きが被さらないようにするため）。 */
  let seq = 0;
  async function say(sc) {
    const my = ++seq;
    const cap = root.querySelector('.cap');
    const ids = sc.voice || [sc.id];
    cap.textContent = '';
    await MFREADY;                      // 1行目の字幕が空のまま流れるのを防ぐ
    if (my !== seq) return;
    const mf = window.SDG._manifest || {};
    for (const id of ids) {
      cap.textContent = (mf[id] && mf[id].text) || '';
      if (!window.SDG.narrate) return;
      talk(true);
      await window.SDG.narrate(id);
      if (my !== seq) return;           // 別のシーンに移っていたら、ここで打ち切る
    }
    talk(false);
  }

  function talk(on) {
    const n = window.SDG.narrator;
    if (n) n.talk(on);
  }

  let onDone = null;
  function show(done, at) {
    onDone = done || null;
    if (!root) build();
    root.classList.add('on');
    playing = true;
    if (window.SDG.narrator) window.SDG.narrator.show(true);
    go(Math.min(Math.max(at | 0, 0), SCENES.length - 1));
  }
  function hide() {
    if (!root) return;
    seq++;                               // 読みかけの行を打ち切る
    root.classList.remove('on');
    playing = false;
    talk(false);
    if (window.SDG.stopNarration) window.SDG.stopNarration();
    if (window.SDG.narrator) window.SDG.narrator.show(false);
    const d = onDone; onDone = null;
    if (d) d();                      // タイトル経由なら、続けてゲームを開始する
  }

  // 字幕テキスト参照用に manifest を共有（読み込み前に go() が来ても待てるよう Promise を持つ）
  const MFREADY = fetch('assets/voice/manifest.json').then(r => r.json())
    .then(m => window.SDG._manifest = m).catch(() => window.SDG._manifest = {});

  addEventListener('keydown', e => {
    if (!playing) return;
    if (e.key === 'Escape') hide();
    if (e.key === 'ArrowRight') go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  });

  window.SDG.showRules = show;
  window.SDG.hideRules = hide;

  // ?rules=1 で直接開く（発表リハと動作確認用）。?rules=4 のように番号を渡すとそのシーンから。
  const _q = new URLSearchParams(location.search);
  if (_q.has('rules')) {
    const at = (parseInt(_q.get('rules'), 10) || 1) - 1;
    addEventListener('load', () => setTimeout(() => show(null, at), 300));
  }
})();
