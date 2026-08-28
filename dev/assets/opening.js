/* opening.js — ゲーム開始からのクッション（モード選択 → 課題3枚 → 手札7枚）
   盤面をいきなり見せず、1枚ずつ意味を説明しながら積み上げる。
   本体の render() は SDG.gate で表示枚数を絞られている。 */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('fx') && !params.has('opening')) return;   // 演出単体デモでは走らせない

  const BAND = {
    OPT: ['光学', '#5b9bd5', '可視・近赤外で「見た目どおり」を撮る。雲の下は見えない'],
    SAR: ['SAR', '#e0685f', 'マイクロ波で雲も夜も貫通する。地形の変化に強い'],
    TIR: ['熱赤外', '#e8964a', '温度そのものを測る。都市の熱や噴火の監視に効く'],
    HYP: ['ハイパー', '#9b7fd4', '波長を細かく刻んで「成分」を見分ける'],
  };
  const MARK = {3: ['◎', '#4caf82', '3点'], 2: ['○', '#5b9bd5', '2点'],
                1: ['△', '#96a0c0', '1点'], 0: ['—', '#4a5578', '0点']};

  let MI = {}, SP = {};
  const ready = Promise.all([
    fetch('assets/missions.json').then(r => r.json()).then(m => MI = m).catch(() => {}),
    fetch('assets/specs.json').then(r => r.json()).then(s => SP = s).catch(() => {}),
  ]);

  const el = document.createElement('div');
  el.id = 'sdg-open';
  document.body.appendChild(el);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let skipAll = false;
  let waiter = null;                       // クリックで «次へ» を解決する

  /* 「音声が終わるまで、ただし上限つき」で待つ。クリックで即座に進める。 */
  /* waitClick=true のときは自動で進まない。ナレーションは流しつつ、
     クリック（または→/Space）があるまでそのカードを見せ続ける。
     発表者が自分のペースで説明できるようにするため。 */
  function beat(narrId, maxMs, minMs = 2600, waitClick = false) {
    return new Promise(resolve => {
      let done = false;
      const t0 = Date.now();
      const fin = () => { if (!done) { done = true; waiter = null; resolve(); } };
      const finSoft = () => {
        const rest = Math.max(0, minMs - (Date.now() - t0));
        if (rest) setTimeout(fin, rest); else fin();
      };
      waiter = fin;                        // クリック / キーで即座に進める
      const p = (window.SDG.narrate && narrId) ? window.SDG.narrate(narrId) : sleep(minMs);
      if (waitClick) {
        p.then(() => { if (!done) el.classList.add('awaiting'); });   // 「クリックで次へ」を強調
        if (skipAll) fin();
        return;                            // タイマーで進めない
      }
      const t = setTimeout(fin, maxMs);
      p.then(() => { clearTimeout(t); setTimeout(finSoft, 260); });
      if (skipAll) fin();
    });
  }

  /* → / Space / Enter でも進める（壇上でクリックしづらいとき用） */
  addEventListener('keydown', e => {
    if (!waiter) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (window.SDG.stopNarration) window.SDG.stopNarration();
      waiter();
    }
  });
  el.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    if (waiter) { el.classList.remove('awaiting');
                  if (window.SDG.stopNarration) window.SDG.stopNarration(); waiter(); }
  });

  const shell = (cls, inner) => { el.className = 'on ' + cls; el.innerHTML = inner; };

  /* ---------- 1. モード選択 ---------- */
  function modeSelect() {
    return new Promise(resolve => {
      shell('mode', `
        <div class="ob">
          <div class="kicker">MISSION SETUP</div>
          <h2>対戦相手を選ぶ</h2>
          <div class="modes">
            <button class="m sel" data-m="cpu">
              <div class="ico">🤖</div>
              <div class="t">CPUと対戦</div>
              <div class="d">回転型1・狙撃型2の計3体と競う。<br>狙撃型は場の課題を読んで衛星を選ぶ</div>
              <div class="tag ok">選択できます</div>
            </button>
            <button class="m off" data-m="pvp" disabled>
              <div class="ico">👥</div>
              <div class="t">友人と対戦</div>
              <div class="d">同じ部屋に集まって4人まで。<br>オンライン対戦は開発中（M2〜M4）</div>
              <div class="tag">このデモでは選べません</div>
            </button>
          </div>
          <button class="go">この設定で始める →</button>
        </div>`);
      if (window.SDG.narrator) window.SDG.narrator.show(true);
      if (window.SDG.narrate) {
        window.SDG.narrator && window.SDG.narrator.talk(true);
        window.SDG.narrate('op_mode').then(() => window.SDG.narrator && window.SDG.narrator.talk(false));
      }
      el.querySelector('.go').onclick = () => { if (window.SDG.stopNarration) window.SDG.stopNarration();
                                                resolve(); };
    });
  }

  /* ---------- 2. 課題カード3枚 ---------- */
  function aptStrip(apt, crit) {
    const best = Math.max(...Object.values(apt));
    return `<div class="apt">${Object.entries(apt).map(([b, v]) => {
      const [mk, col] = MARK[v] || MARK[0];
      const [nm, bcol, note] = BAND[b];
      return `<div class="a ${v === best && v > 0 ? 'best' : ''}" style="--c:${bcol}">
        <div class="bn">${nm}</div>
        <div class="mk" style="color:${col}">${mk}</div>
        <div class="pt">${(MARK[v] || MARK[0])[2]}</div>
        <div class="nt">${note}</div></div>`;
    }).join('')}</div>
    ${crit ? `<div class="crit">⭐ クリティカル担当: <b>${(SP[crit.slug] || {}).name || crit.slug}</b>
              — ${crit.note}</div>` : ''}`;
  }

  async function revealMissions(board) {
    for (let i = 0; i < board.length; i++) {
      const m = board[i];
      const info = MI[m.slug] || {apt: {OPT: 0, SAR: 0, TIR: 0, HYP: 0}};
      const bestBand = Object.entries(info.apt).sort((a, b) => b[1] - a[1])[0];
      shell('draw', `
        <div class="ob wide">
          <div class="kicker">今年の課題　${i + 1} / ${board.length}</div>
          <div class="split">
            <div class="cardslot"><div class="card3d"><iframe src="cards/mission/${m.slug}.html"></iframe></div></div>
            <div class="side">
              <h3>${info.name || m.name}</h3>
              <p class="flavor">${info.flavor || ''}</p>
              <div class="lead2">この課題に効く衛星は？</div>
              ${aptStrip(info.apt, info.crit ? {slug: info.crit, note: info.crit_note} : null)}
              <div class="verdict" style="--c:${BAND[bestBand[0]][1]}">
                → <b>${BAND[bestBand[0]][0]}</b>系統の衛星を積めば <b>${bestBand[1]}点</b></div>
            </div>
          </div>
          <div class="hint">クリックで次へ</div>
        </div>`);
      window.SDG.gate.board = i + 1;
      el.classList.remove('awaiting');
      if (window.SDG.narrator) { window.SDG.narrator.show(true); window.SDG.narrator.talk(true); }
      await beat(`mission_${m.slug}`, 0, 0, true);   // クリックするまで進まない
      if (window.SDG.narrator) window.SDG.narrator.talk(false);
    }
  }

  /* ---------- 3. 手札7枚 ---------- */
  function fitToBoard(slug, board) {
    /* この衛星が、いま場に出ている課題で何点取れるか */
    const s = SP[slug];
    if (!s || s.t !== 'sensor' || !s.band) return null;
    const hits = board.map(m => {
      const info = MI[m.slug];
      if (!info) return null;
      return {name: info.name, pt: info.apt[s.band] || 0, crit: info.crit === slug};
    }).filter(Boolean).sort((a, b) => b.pt - a.pt);
    return hits;
  }

  function cardSide(c, board) {
    const s = SP[c.slug] || {};
    if (c.kind === 'rocket') {
      return `<h3>${s.name || c.name}</h3>
        <p class="flavor">${s.flavor || ''}</p>
        <div class="lead2">ロケットのスペック</div>
        <div class="kv"><span>打上能力（LEO）</span><b>${s.payload != null ? s.payload + ' t' : '—'}</b></div>
        <div class="kv"><span>実績成功率</span><b>${s.rate != null ? s.rate + '%' : '—'}</b></div>
        <div class="kv"><span>クラス</span><b>${s.klass}級 — ${s.klass}級までの衛星を積める</b></div>
        <div class="kv"><span>開発コスト</span><b>${s.cost} 億</b></div>
        <div class="verdict" style="--c:#e0685f">→ 衛星を載せて打ち上げる「運び手」。クラスが合わないと搭載できない</div>`;
    }
    const [bn, bc, bnote] = BAND[s.band] || ['—', '#96a0c0', ''];
    const hits = fitToBoard(c.slug, board) || [];
    const best = hits[0];
    return `<h3>${s.name || c.name}<span class="sub2">${s.sensorName || ''}</span></h3>
      <p class="flavor">${s.flavor || ''}</p>
      <div class="lead2">この衛星の特徴</div>
      <div class="kv"><span>系統</span><b style="color:${bc}">${bn}</b></div>
      <div class="kv"><span>分解能</span><b>${s.res != null ? s.res + ' m' : '—'}</b></div>
      <div class="kv"><span>設計寿命</span><b>${s.life || '—'} 年</b></div>
      <div class="kv"><span>開発コスト</span><b>${s.cost} 億</b></div>
      <p class="bandnote">${bnote}</p>
      <div class="lead2">いま場に出ている課題との相性</div>
      <div class="fits">${hits.map(h => {
        const [mk, col] = MARK[h.pt] || MARK[0];
        return `<div class="f ${h.pt >= 2 ? 'good' : ''}">
          <span class="mk" style="color:${col}">${mk}</span>
          <span class="n">${h.name}</span>
          <span class="p">${h.pt}点${h.crit ? ' ＋⭐' : ''}</span></div>`;
      }).join('') || '<div class="f">（判定できません）</div>'}</div>
      ${best && best.pt >= 2
        ? `<div class="verdict" style="--c:#4caf82">→ 「${best.name}」に刺さる。今すぐ狙える1枚</div>`
        : `<div class="verdict" style="--c:#96a0c0">→ いまの課題には効きにくい。交換に回すのも手</div>`}`;
  }

  async function revealHand(hand, board) {
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      shell('draw', `
        <div class="ob wide">
          <div class="kicker">あなたの手札　${i + 1} / ${hand.length}</div>
          <div class="split">
            <div class="cardslot"><div class="card3d"><iframe src="cards/${c.kind}/${c.slug}.html"></iframe></div></div>
            <div class="side">${cardSide(c, board)}</div>
          </div>
          <div class="hint">クリックで次へ</div>
        </div>`);
      window.SDG.gate.hand = i + 1;
      if (window.SDG.narrator) { window.SDG.narrator.show(true); window.SDG.narrator.talk(true); }
      await beat(`s_${c.slug}`, 9000, 3600);
      if (window.SDG.narrator) window.SDG.narrator.talk(false);
    }
  }

  /* ---------- 進行 ---------- */
  let lastState = null;
  async function run(state) {
    lastState = state;
    window.SDG.openingActive = true;
    await ready;
    window.SDG.gate.board = 0;
    window.SDG.gate.hand = 0;
    if (window.SDG.rerender) window.SDG.rerender();

    // ?ostep=mission / hand で途中から確認できる（リハーサル・動作確認用）
    const step = params.get('ostep');
    if (step === 'mission') { await revealMissions(state.board.slice(0, 3)); return finish(); }
    if (step === 'hand') {
      window.SDG.gate.board = null;
      await revealHand(state.you.hand.slice(0, 7), state.board.slice(0, 3));
      return finish();
    }

    await modeSelect();

    shell('title2', `<div class="ob"><div class="kicker">STEP 1</div>
      <h2>地球が抱える課題が、3枚めくられます</h2>
      <p class="p2">どの系統の衛星が効くのかを見極めるのが、このゲームの核心です。</p></div>`);
    await beat('op_mission', 9000, 3400);
    await revealMissions(state.board.slice(0, 3));

    shell('title2', `<div class="ob"><div class="kicker">STEP 2</div>
      <h2>あなたの手札を7枚配ります</h2>
      <p class="p2">ロケットと衛星を組み合わせて打ち上げます。<br>
        課題に刺さる衛星が引けているか、確かめてください。</p></div>`);
    await beat('op_hand', 9000, 3400);
    await revealHand(state.you.hand.slice(0, 7), state.board.slice(0, 3));

    shell('title2', `<div class="ob"><div class="kicker">READY</div>
      <h2>準備完了</h2>
      <p class="p2">10年間で、地球への貢献度を最も多く稼いだ人の勝ちです。</p>
      <button class="go">▶ 1年目を始める</button></div>`);
    if (window.SDG.narrate) window.SDG.narrate('op_ready');
    await new Promise(res => { el.querySelector('.go').onclick = res; });

    finish();
  }

  function finish() {
    window.SDG.openingActive = false;
    // 開幕で見せた3枚を「公開済み」として登録し、直後に演出が再発火しないようにする
    if (window.SDG.syncMissionSeen && lastState) {
      window.SDG.syncMissionSeen(lastState.board);
    }
    if (window.SDG.stopNarration) window.SDG.stopNarration();
    if (window.SDG.narrator) { window.SDG.narrator.talk(false); window.SDG.narrator.show(false); }
    window.SDG.gate.board = null;
    window.SDG.gate.hand = null;
    el.className = '';
    el.innerHTML = '';
    if (window.SDG.rerender) window.SDG.rerender();
  }

  /* スキップ（発表で時間が押したとき用） */
  const skip = document.createElement('button');
  skip.id = 'sdg-open-skip';
  skip.textContent = '⏭ 説明を飛ばす';
  skip.onclick = () => { skipAll = true; if (waiter) waiter(); finish(); skip.remove(); };

  /* カーテンだけ先に上げる。タイトルのフェード中に盤面が覗くのを防ぐため、
     新規ゲームのPOSTを待たずに即座に画面を覆う。 */
  function raiseCurtain() {
    shell('title2', `<div class="ob"><div class="kicker">MISSION SETUP</div>
      <h2>準備しています…</h2></div>`);
  }

  /* タイトルから呼ばれる入口。**必ずゲームを初期化してから**開幕演出を流す。
     （前のゲームが終局のまま残っていると結果発表画面に飛んでしまうため） */
  let running = false;
  async function beginGame() {
    if (running || started) return;    // 自動開幕が走っていたら二重に始めない
    running = true;
    started = true;
    window.SDG.openingActive = true;   // この間ミッション公開演出を抑止する
    raiseCurtain();
    let state;
    try {
      state = await (await fetch('/new_game', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
      })).json();
    } catch (e) {
      console.warn('new_game failed, falling back to /state', e);
      try { state = await (await fetch('/state')).json(); } catch (e2) { running = false; return; }
    }
    if (window.SDG.rerender && window.SDG.applyState) window.SDG.applyState(state);
    document.body.appendChild(skip);
    try { await run(state); } finally { skip.remove(); running = false; }
  }

  /* タイトルが無い場合（?fx=none&opening=1 など）だけ、初回stateで自動的に開幕する。
     タイトルがある場合は「ゲームを始める」が beginGame() を呼ぶので、ここでは何もしない。
     ※ 以前は params.has('title') で判定していたが、既定の "/" にはクエリが無いため
        素通りしてしまい、自動開幕と beginGame の**両方が走って**ナレーションが二重に鳴っていた。
        title.js は自身の要素を同期的に body へ入れるので、ここでの存在確認が確実。 */
  let started = false;
  window.SDG.onDraw.push(s => {
    if (started || running || s.phase === 'over' || s.turn !== 1) return;
    if (document.getElementById('sdg-title')) return;   // タイトル経由 → beginGame に任せる
    started = true;
    document.body.appendChild(skip);
    run(s).then(() => skip.remove());
  });

  window.SDG.runOpening = run;
  window.SDG.beginGame = beginGame;
  window.SDG.raiseCurtain = raiseCurtain;
})();
