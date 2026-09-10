"use strict";

/* =========================================================
   設定（ここを編集してカスタマイズできます）
   ========================================================= */
const CONFIG = {
  // プレゼント（番号）の総数。20個以外にしたい場合はここを変更します。
  totalCount: 20,

  // 各ランクの「出やすさ」の重み。
  // 実際の確率 = その値 ÷ 合計値 になります（合計は100でなくてOK）。
  // 例: green:60, red:30, gold:10 → GREEN60% / RED30% / GOLD10%
  // ランクの種類を増減したい場合は、この中に行を足したり消したりできます
  // （例えば "silver" を追加する場合は、silver_close.png / silver_open.png も
  // images フォルダに用意し、CONFIG.images にもパスを追記してください）。
  rankWeights: {
    green: 60,
    red: 30,
    gold: 10,
  },

  // 特定の番号だけランクを固定したい場合はここに追加します。
  // ここに書いた番号は必ず指定したランクで出ます（確率抽選の対象外）。
  // 書いていない番号は、上の rankWeights の確率で抽選されます。
  // 例:「7番は必ずGOLDにしたい」→ 7: "gold",
  numberRankOverrides: {
    // 7: "gold",
  },

  images: {
    gacha: "images/gacha.png",
    green_close: "images/green_close.png",
    green_open: "images/green_open.png",
    red_close: "images/red_close.png",
    red_open: "images/red_open.png",
    gold_close: "images/gold_close.png",
    gold_open: "images/gold_open.png",
    last_prize: "images/last_prize.png",
  },

  sounds: {
    gacha: "sounds/gacha.mp3",
    capsule: "sounds/capsule.mp3",
    open: "sounds/open.mp3",
    lastPrize: "sounds/last-prize.mp3",
  },

  // 表示テキスト（後から変更しやすいようにここにまとめています）
  text: {
    completeMessage: "21歳の誕生日おめでとう。",
  },

  // 演出タイミング(ms) — 必要に応じて微調整可
  timing: {
    shake: 700,
    dispenseDrop: 900,
    capsuleAppearPause: 650,
    openFadeOut: 480,
    openFadeIn: 620,
    numberRevealDelay: 500,
    numberPopDuration: 900,
    afterNumberDelay: 1500,
    unlockStep1: 1700,
    unlockStep2: 1500,
  },

  storageKey: "birthdayGachaState_v1",
};

/* =========================================================
   状態管理
   ========================================================= */
function defaultState(){
  return {
    drawnOrder: [],          // [{number, rank}], 引いた順
    lastPrizeUnlocked: false,
    lastPrizeReceived: false,
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(CONFIG.storageKey);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.drawnOrder)) return defaultState();
    return {
      drawnOrder: parsed.drawnOrder,
      lastPrizeUnlocked: !!parsed.lastPrizeUnlocked,
      lastPrizeReceived: !!parsed.lastPrizeReceived,
    };
  }catch(e){
    console.warn("状態の読み込みに失敗しました。初期状態で開始します。", e);
    return defaultState();
  }
}

function saveState(){
  try{
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
  }catch(e){
    console.warn("状態の保存に失敗しました。", e);
  }
}

let state = loadState();

function drawnNumbersSet(){
  return new Set(state.drawnOrder.map(d => d.number));
}

function remainingNumbers(){
  const drawn = drawnNumbersSet();
  const all = [];
  for(let i = 1; i <= CONFIG.totalCount; i++){
    if(!drawn.has(i)) all.push(i);
  }
  return all;
}

// 番号ごとのランクを決定します。
// numberRankOverrides に指定があればそれを優先し、無ければ確率抽選します。
function rankForNumber(number){
  const fixed = CONFIG.numberRankOverrides[number];
  if(fixed) return fixed;
  return pickRank();
}

// CONFIG.rankWeights にもとづいて、重み付きランダムでランクを1つ選びます。
function pickRank(){
  const entries = Object.entries(CONFIG.rankWeights).filter(([, w]) => w > 0);

  if(entries.length === 0){
    console.warn("rankWeights が空です。green を返します。");
    return "green";
  }

  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;

  for(const [rank, w] of entries){
    if(r < w) return rank;
    r -= w;
  }
  return entries[entries.length - 1][0]; // 端数対策のフォールバック
}

/* =========================================================
   DOM参照
   ========================================================= */
const $ = (id) => document.getElementById(id);

const screens = {
  gacha: $("screen-gacha"),
  capsule: $("screen-capsule"),
  result: $("screen-result"),
  lastPrizeUnlock: $("screen-lastprize-unlock"),
  lastPrize: $("screen-lastprize"),
  complete: $("screen-complete"),
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo(0, 0);
}

/* =========================================================
   サウンド（ファイルが無くてもエラーにならない）
   ========================================================= */
function playSound(id){
  const el = $(id);
  if(!el) return;
  try{
    el.currentTime = 0;
    const p = el.play();
    if(p && p.catch) p.catch(() => {/* 音声ファイル未設置 or 自動再生ブロック: 無視 */});
  }catch(e){ /* ignore */ }
}

/* =========================================================
   進捗表示・番号グリッドの更新
   ========================================================= */
function updateProgressUI(){
  const count = state.drawnOrder.length;
  const total = CONFIG.totalCount;

  $("progressCount").textContent = count;
  $("progressTotal").textContent = total;
  $("resultProgressCount").textContent = count;
  $("resultProgressTotal").textContent = total;
  $("progressFill").style.width = `${(count / total) * 100}%`;

  renderNumberGrid();
}

function renderNumberGrid(){
  const grid = $("numberGrid");
  grid.innerHTML = "";
  const drawn = drawnNumbersSet();
  for(let i = 1; i <= CONFIG.totalCount; i++){
    const dot = document.createElement("div");
    dot.className = "number-dot" + (drawn.has(i) ? " drawn" : "");
    dot.textContent = i;
    grid.appendChild(dot);
  }
}

$("dotsToggle").addEventListener("click", () => {
  const grid = $("numberGrid");
  const willShow = grid.hidden;
  grid.hidden = !willShow;
  $("dotsToggle").setAttribute("aria-expanded", String(willShow));
  $("dotsToggle").textContent = willShow ? "番号をとじる" : "引いた番号を見る";
});

/* =========================================================
   ガチャを回すフロー
   ========================================================= */
let currentDraw = null; // { number, rank }

$("drawBtn").addEventListener("click", onDrawTapped);

function onDrawTapped(){
  const remaining = remainingNumbers();
  if(remaining.length === 0) return;

  const drawBtn = $("drawBtn");
  drawBtn.disabled = true;

  const number = remaining[Math.floor(Math.random() * remaining.length)];
  const rank = rankForNumber(number);
  currentDraw = { number, rank };

  playSound("sndGacha");

  const stand = $("gachaStand");
  stand.classList.add("shaking");

  setTimeout(() => {
    stand.classList.remove("shaking");
    dispenseCapsuleVisual(rank, () => {
      // 抽選結果を確定・保存（リロードしても消えない）
      commitDraw(currentDraw);
      drawBtn.disabled = false;
      enterCapsuleScreen(currentDraw);
    });
  }, CONFIG.timing.shake);
}

function dispenseCapsuleVisual(rank, onDone){
  const layer = $("dispenseLayer");
  layer.innerHTML = `<img src="${CONFIG.images[rank + "_close"]}" alt="">`;
  layer.classList.remove("dropping");
  // force reflow to restart animation
  void layer.offsetWidth;
  layer.classList.add("dropping");
  playSound("sndCapsule");

  setTimeout(() => {
    layer.classList.remove("dropping");
    layer.innerHTML = "";
    onDone();
  }, CONFIG.timing.dispenseDrop);
}

function commitDraw(draw){
  state.drawnOrder.push({ number: draw.number, rank: draw.rank });
  saveState();
  updateProgressUI();
}

/* =========================================================
   カプセル画面（表示 → OPEN → 番号表示）
   ========================================================= */
function enterCapsuleScreen(draw){
  const closeImg = $("capsuleCloseImg");
  const openImg = $("capsuleOpenImg");
  const reveal = $("numberReveal");
  const openBtn = $("openBtn");

  closeImg.src = CONFIG.images[draw.rank + "_close"];
  openImg.src = CONFIG.images[draw.rank + "_open"];

  closeImg.hidden = false;
  closeImg.classList.remove("opening", "floating");
  void closeImg.offsetWidth;
  closeImg.classList.add("capsule-close");

  openImg.hidden = true;
  openImg.classList.remove("showing");

  reveal.hidden = true;
  reveal.classList.remove("pop");

  openBtn.hidden = true;
  openBtn.classList.remove("showing");

  $("capsuleCaption").textContent = "カプセルが出てきました";

  showScreen("capsule");

  setTimeout(() => {
    closeImg.classList.add("floating");
    openBtn.hidden = false;
    void openBtn.offsetWidth;
    openBtn.classList.add("showing");
    $("capsuleCaption").textContent = "タップして開けてください";
  }, CONFIG.timing.capsuleAppearPause);
}

$("openBtn").addEventListener("click", () => {
  const openBtn = $("openBtn");
  openBtn.classList.remove("showing");
  openBtn.hidden = true;
  $("capsuleCaption").textContent = "";

  playSound("sndOpen");

  const closeImg = $("capsuleCloseImg");
  const openImg = $("capsuleOpenImg");
  const reveal = $("numberReveal");

  closeImg.classList.add("opening");

  setTimeout(() => {
    closeImg.hidden = true;
    openImg.hidden = false;
    openImg.classList.add("showing");

    setTimeout(() => {
      $("numberRevealValue").textContent = currentDraw.number;
      reveal.hidden = false;
      void reveal.offsetWidth;
      reveal.classList.add("pop");

      const totalWait = CONFIG.timing.numberPopDuration + CONFIG.timing.afterNumberDelay;
      setTimeout(afterNumberRevealed, totalWait);
    }, CONFIG.timing.numberRevealDelay);

  }, CONFIG.timing.openFadeOut);
});

function afterNumberRevealed(){
  const isLast = state.drawnOrder.length >= CONFIG.totalCount;
  if(isLast){
    enterLastPrizeUnlockSequence();
  }else{
    enterResultScreen(currentDraw);
  }
}

/* =========================================================
   結果画面
   ========================================================= */
function enterResultScreen(draw){
  $("resultNumber").textContent = draw.number;
  $("resultNumberText").textContent = draw.number;
  showScreen("result");
}

$("backToGachaBtn").addEventListener("click", () => {
  showScreen("gacha");
});

/* =========================================================
   ラスト賞 解放演出
   ========================================================= */
function enterLastPrizeUnlockSequence(skipAnimation){
  const step1 = $("unlockStep1");
  const step2 = $("unlockStep2");
  const step3 = $("unlockStep3");
  const stage = screens.lastPrizeUnlock;

  step1.hidden = true;
  step2.hidden = true;
  step3.hidden = true;
  stage.classList.remove("dark-stage");

  showScreen("lastPrizeUnlock");

  if(skipAnimation || state.lastPrizeUnlocked){
    step3.hidden = false;
    stage.classList.add("dark-stage");
    state.lastPrizeUnlocked = true;
    saveState();
    return;
  }

  step1.hidden = false;

  setTimeout(() => {
    step1.hidden = true;
    step2.hidden = false;

    setTimeout(() => {
      step2.hidden = true;
      stage.classList.add("dark-stage");
      step3.hidden = false;
      playSound("sndLastPrize");
      state.lastPrizeUnlocked = true;
      saveState();
    }, CONFIG.timing.unlockStep2);

  }, CONFIG.timing.unlockStep1);
}

$("receiveLastPrizeBtn").addEventListener("click", () => {
  enterLastPrizeScreen();
});

/* =========================================================
   ラスト賞画面
   ========================================================= */
function enterLastPrizeScreen(){
  const img = $("lastPrizeImg");
  const fallback = $("lastPrizeFallback");

  img.hidden = true;
  fallback.hidden = false;

  const testImg = new Image();
  testImg.onload = () => {
    img.hidden = false;
    fallback.hidden = true;
  };
  testImg.onerror = () => {
    img.hidden = true;
    fallback.hidden = false;
  };
  testImg.src = CONFIG.images.last_prize + "?t=" + Date.now();

  showScreen("lastPrize");
}

$("toCompleteBtn").addEventListener("click", () => {
  state.lastPrizeReceived = true;
  saveState();
  enterCompleteScreen();
});

/* =========================================================
   コンプリート画面
   ========================================================= */
function enterCompleteScreen(){
  $("completeMessage").textContent = CONFIG.text.completeMessage;
  showScreen("complete");
}

/* =========================================================
   リセット
   ========================================================= */
function openResetModal(){
  $("resetModal").hidden = false;
}
function closeResetModal(){
  $("resetModal").hidden = true;
}

$("openResetBtn").addEventListener("click", openResetModal);
$("openResetBtn2").addEventListener("click", openResetModal);
$("resetCancelBtn").addEventListener("click", closeResetModal);

$("resetConfirmBtn").addEventListener("click", () => {
  try{ localStorage.removeItem(CONFIG.storageKey); }catch(e){ /* ignore */ }
  state = defaultState();
  closeResetModal();
  updateProgressUI();
  showScreen("gacha");
});

$("resetModal").addEventListener("click", (e) => {
  if(e.target === $("resetModal")) closeResetModal();
});

/* =========================================================
   起動時の復元
   ========================================================= */
function init(){
  updateProgressUI();

  if(state.lastPrizeReceived){
    enterCompleteScreen();
    return;
  }

  if(state.drawnOrder.length >= CONFIG.totalCount){
    // 20個引き終わっている: リロード後はアニメーションを省略して
    // ラスト賞受け取りへ進めるようにする
    if(state.lastPrizeUnlocked){
      enterLastPrizeUnlockSequence(true);
    }else{
      enterLastPrizeUnlockSequence(false);
    }
    return;
  }

  showScreen("gacha");
}

init();
