// app.js — Main application: UI rendering, game management, user interaction
(() => {
  'use strict';

  const {
    Position, START_FEN,
    EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    WHITE, BLACK, PIECE_CHARS,
    pieceColor, pieceType, fileOf, rankOf, squareIndex, squareName,
    FLAG_PROMOTE_KNIGHT, FLAG_PROMOTE_BISHOP, FLAG_PROMOTE_ROOK, FLAG_PROMOTE_QUEEN,
  } = Chess;

  const { SearchEngine, DIFFICULTY } = Engine;

  // DOM elements
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const engineInfoEl = document.getElementById('engine-info');
  const moveHistoryEl = document.getElementById('move-history');
  const capturedWhiteEl = document.getElementById('captured-white');
  const capturedBlackEl = document.getElementById('captured-black');
  const rankLabelsEl = document.getElementById('rank-labels');
  const fileLabelsEl = document.getElementById('file-labels');
  const promoModal = document.getElementById('promo-modal');
  const promoOptions = document.getElementById('promo-options');
  const gameResultEl = document.getElementById('game-result');
  const resultTextEl = document.getElementById('result-text');
  const difficultyEl = document.getElementById('difficulty');
  const playAsEl = document.getElementById('play-as');
  const gameModeEl = document.getElementById('game-mode');
  const timerModeEl = document.getElementById('timer-mode');
  const timerSectionEl = document.getElementById('timer-section');
  const timerWhiteEl = document.getElementById('timer-white');
  const timerBlackEl = document.getElementById('timer-black');
  const timerWhiteTimeEl = document.getElementById('timer-white-time');
  const timerBlackTimeEl = document.getElementById('timer-black-time');
  const animateToggle = document.getElementById('animate-toggle');

  // Game state
  let pos = null;
  let engine = null;
  let playerColor = WHITE;
  let boardFlipped = false;
  let selectedSquare = -1;
  let legalMovesForSelected = [];
  let lastMoveFrom = -1;
  let lastMoveTo = -1;
  let moveList = [];
  let capturedByWhite = [];
  let capturedByBlack = [];
  let engineThinking = false;
  let pendingPromotion = null;
  let gameMode = 'pvai'; // pvai, pvp, aivai

  // Drag state
  let dragging = false;
  let dragPieceSq = -1;
  let dragGhost = null;
  let dragOverSq = -1;
  let dragMoveExecuted = false;

  // Timer state
  let timerWhite = 0; // milliseconds remaining
  let timerBlack = 0;
  let timerIncrement = 0; // seconds
  let timerInterval = null;
  let timerEnabled = false;
  let timerStarted = false;
  let timerLastTick = 0; // wall-clock timestamp of last tick

  // AI vs AI state
  let aiVsAiStopped = false;

  // Animation
  let animationEnabled = true;

  function init() {
    engine = new SearchEngine();
    engine.onInfo = onEngineInfo;
    applyDifficulty();
    newGame();
    bindEvents();
  }

  function newGame() {
    pos = Position.fromFEN(START_FEN);
    selectedSquare = -1;
    legalMovesForSelected = [];
    lastMoveFrom = -1;
    lastMoveTo = -1;
    moveList = [];
    capturedByWhite = [];
    capturedByBlack = [];
    engineThinking = false;
    pendingPromotion = null;
    dragging = false;
    dragPieceSq = -1;

    gameMode = gameModeEl.value;
    playerColor = playAsEl.value === 'white' ? WHITE : BLACK;
    boardFlipped = playerColor === BLACK;
    animationEnabled = animateToggle.checked;
    aiVsAiStopped = false;
    updateActionButtons();

    // Update UI visibility based on mode
    playAsEl.closest('.control-group').style.display = gameMode === 'pvp' || gameMode === 'aivai' ? 'none' : '';
    difficultyEl.closest('.control-group').style.display = gameMode === 'pvp' ? 'none' : '';

    // Timer setup
    stopTimer();
    setupTimer();

    gameResultEl.style.display = 'none';
    engineInfoEl.textContent = '';
    promoModal.style.display = 'none';

    renderBoard();
    renderLabels();
    renderMoveHistory();
    renderCaptured();
    updateStatus();

    // Auto-start for AI modes
    if (gameMode === 'pvai' && playerColor === BLACK) {
      setTimeout(() => engineMove(), 100);
    } else if (gameMode === 'aivai') {
      setTimeout(() => aiVsAiStep(), 300);
    }
  }

  function setupTimer() {
    const mode = timerModeEl.value;
    if (mode === 'none') {
      timerEnabled = false;
      timerSectionEl.style.display = 'none';
      return;
    }

    timerEnabled = true;
    timerStarted = false;
    timerSectionEl.style.display = 'flex';

    const [minutes, inc] = mode.split('+').map(Number);
    timerWhite = minutes * 60 * 1000;
    timerBlack = minutes * 60 * 1000;
    timerIncrement = inc || 0;

    renderTimers();
  }

  function startTimer() {
    if (!timerEnabled || timerStarted) return;
    timerStarted = true;
    timerLastTick = Date.now();
    timerInterval = setInterval(tickTimer, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerStarted = false;
  }

  function tickTimer() {
    if (!timerEnabled || !timerStarted) return;
    if (pos.getGameState().over) {
      stopTimer();
      return;
    }

    const now = Date.now();
    const elapsed = now - timerLastTick;
    timerLastTick = now;

    if (pos.turn === WHITE) {
      timerWhite = Math.max(0, timerWhite - elapsed);
      if (timerWhite <= 0) {
        timerWhite = 0;
        handleTimeOut(WHITE);
      }
    } else {
      timerBlack = Math.max(0, timerBlack - elapsed);
      if (timerBlack <= 0) {
        timerBlack = 0;
        handleTimeOut(BLACK);
      }
    }
    renderTimers();
  }

  function handleTimeOut(color) {
    stopTimer();
    const winner = color === WHITE ? 'Black' : 'White';
    const loser = color === WHITE ? 'White' : 'Black';
    const text = `${winner} wins — ${loser} ran out of time!`;
    statusEl.textContent = text;
    statusEl.classList.remove('thinking');
    resultTextEl.textContent = text;
    gameResultEl.style.display = 'block';
    engineThinking = false;
  }

  function addIncrement(color) {
    if (!timerEnabled || timerIncrement <= 0) return;
    if (color === WHITE) timerWhite += timerIncrement * 1000;
    else timerBlack += timerIncrement * 1000;
  }

  function renderTimers() {
    timerWhiteTimeEl.textContent = formatTime(timerWhite);
    timerBlackTimeEl.textContent = formatTime(timerBlack);

    timerWhiteEl.classList.toggle('active', pos.turn === WHITE && timerStarted);
    timerBlackEl.classList.toggle('active', pos.turn === BLACK && timerStarted);
    timerWhiteEl.classList.toggle('low-time', timerWhite > 0 && timerWhite < 30000);
    timerBlackEl.classList.toggle('low-time', timerBlack > 0 && timerBlack < 30000);
  }

  function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  function applyDifficulty() {
    const preset = DIFFICULTY[difficultyEl.value] || DIFFICULTY.medium;
    engine.setDepth(preset.depth);
  }

  // --- Rendering ---

  function getSquareEl(sq) {
    return boardEl.querySelector(`[data-sq="${sq}"]`);
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const rank = boardFlipped ? row : 7 - row;
        const file = boardFlipped ? 7 - col : col;
        const sq = squareIndex(file, rank);

        const div = document.createElement('div');
        div.className = 'square ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
        div.dataset.sq = sq;

        // Highlights
        if (sq === selectedSquare) div.classList.add('selected');
        if (sq === lastMoveFrom || sq === lastMoveTo) div.classList.add('last-move');

        // Check highlight
        const piece = pos.get(sq);
        if (piece !== EMPTY && pieceType(piece) === KING && pieceColor(piece) === pos.turn && pos.inCheck()) {
          div.classList.add('in-check');
        }

        // Legal move dots
        if (selectedSquare >= 0) {
          const isLegal = legalMovesForSelected.some(m => m.to === sq);
          if (isLegal) {
            if (pos.get(sq) !== EMPTY) {
              div.classList.add('legal-capture');
            } else {
              div.classList.add('legal-target');
            }
          }
        }

        // Piece
        if (piece !== EMPTY) {
          const span = document.createElement('span');
          span.className = 'piece';
          const color = pieceColor(piece);
          span.classList.add(color === WHITE ? 'piece-white' : 'piece-black');
          span.textContent = PIECE_CHARS[piece];
          div.appendChild(span);
        }

        boardEl.appendChild(div);
      }
    }
  }

  function renderLabels() {
    rankLabelsEl.innerHTML = '';
    fileLabelsEl.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const rankSpan = document.createElement('span');
      rankSpan.textContent = boardFlipped ? (i + 1) : (8 - i);
      rankLabelsEl.appendChild(rankSpan);

      const fileSpan = document.createElement('span');
      fileSpan.textContent = 'abcdefgh'[boardFlipped ? 7 - i : i];
      fileLabelsEl.appendChild(fileSpan);
    }
  }

  function renderMoveHistory() {
    moveHistoryEl.innerHTML = '';
    for (const entry of moveList) {
      const row = document.createElement('div');
      row.className = 'move-row';
      row.innerHTML = `
        <span class="move-num">${entry.num}.</span>
        <span class="move-white">${entry.white || ''}</span>
        <span class="move-black">${entry.black || ''}</span>
      `;
      moveHistoryEl.appendChild(row);
    }
    moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
  }

  function renderCaptured() {
    capturedWhiteEl.innerHTML = '';
    capturedBlackEl.innerHTML = '';

    const sortOrder = [QUEEN, ROOK, BISHOP, KNIGHT, PAWN];
    const sort = arr => [...arr].sort((a, b) => sortOrder.indexOf(a) - sortOrder.indexOf(b));

    for (const type of sort(capturedByWhite)) {
      const span = document.createElement('span');
      span.className = 'piece piece-black';
      span.textContent = PIECE_CHARS[BLACK | type];
      capturedBlackEl.appendChild(span);
    }
    for (const type of sort(capturedByBlack)) {
      const span = document.createElement('span');
      span.className = 'piece piece-white';
      span.textContent = PIECE_CHARS[WHITE | type];
      capturedWhiteEl.appendChild(span);
    }
  }

  function updateStatus() {
    const state = pos.getGameState();

    if (state.over) {
      stopTimer();
      let text;
      if (state.result === 'draw') {
        text = `Draw — ${state.reason}`;
      } else {
        const winner = state.result === 'white' ? 'White' : 'Black';
        text = `${winner} wins by ${state.reason}!`;
      }
      statusEl.textContent = text;
      statusEl.classList.remove('thinking');
      resultTextEl.textContent = text;
      gameResultEl.style.display = 'block';
      updateActionButtons();
      return;
    }

    if (engineThinking) {
      statusEl.textContent = 'Engine thinking...';
      statusEl.classList.add('thinking');
    } else {
      const turn = pos.turn === WHITE ? 'White' : 'Black';
      const check = state.inCheck ? ' (check)' : '';
      let modeLabel = '';
      if (gameMode === 'pvp') modeLabel = ' [PvP]';
      else if (gameMode === 'aivai') modeLabel = ' [AI vs AI]';
      statusEl.textContent = `${turn} to move${check}${modeLabel}`;
      statusEl.classList.remove('thinking');
    }

    if (timerEnabled) renderTimers();
  }

  function onEngineInfo(info) {
    const scoreStr = Math.abs(info.score) > 900000
      ? `M${Math.ceil((999999 - Math.abs(info.score)) / 2)}`
      : (info.score / 100).toFixed(2);
    engineInfoEl.textContent = `depth ${info.depth} | eval ${scoreStr} | ${info.nodes.toLocaleString()} nodes | ${info.time}ms`;
  }

  // --- Animation ---

  function animateMove(fromSq, toSq, callback) {
    if (!animationEnabled) {
      callback();
      return;
    }

    const fromEl = getSquareEl(fromSq);
    const toEl = getSquareEl(toSq);
    if (!fromEl || !toEl) {
      callback();
      return;
    }

    const pieceEl = fromEl.querySelector('.piece');
    if (!pieceEl) {
      callback();
      return;
    }

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    pieceEl.classList.add('animating');
    pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;

    let animDone = false;
    const onEnd = () => {
      if (animDone) return;
      animDone = true;
      pieceEl.removeEventListener('transitionend', onEnd);
      callback();
    };
    pieceEl.addEventListener('transitionend', onEnd);

    // Fallback in case transitionend doesn't fire
    setTimeout(onEnd, 250);
  }

  // --- Drag and drop ---

  function canPlayerInteract() {
    if (engineThinking) return false;
    if (pos.getGameState().over) return false;
    if (gameMode === 'aivai') return false;
    if (gameMode === 'pvai' && pos.turn !== playerColor) return false;
    return true;
  }

  function onPointerDown(e) {
    if (!canPlayerInteract()) return;
    const sqEl = e.target.closest('.square');
    if (!sqEl) return;
    const sq = parseInt(sqEl.dataset.sq);
    const piece = pos.get(sq);

    if (piece === EMPTY || pieceColor(piece) !== pos.turn) return;

    // Select the piece
    selectSquare(sq);

    // Start drag
    dragging = true;
    dragPieceSq = sq;

    const pieceSpan = sqEl.querySelector('.piece');
    if (pieceSpan) pieceSpan.classList.add('dragging');

    // Create ghost
    dragGhost = document.createElement('span');
    dragGhost.className = 'drag-ghost piece ' + (pieceColor(piece) === WHITE ? 'piece-white' : 'piece-black');
    dragGhost.textContent = PIECE_CHARS[piece];
    document.body.appendChild(dragGhost);
    updateGhostPosition(e);

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    updateGhostPosition(e);

    // Highlight drop target
    const sqEl = getSquareFromPoint(e);
    const newOverSq = sqEl ? parseInt(sqEl.dataset.sq) : -1;
    if (newOverSq !== dragOverSq) {
      if (dragOverSq >= 0) {
        const oldEl = getSquareEl(dragOverSq);
        if (oldEl) oldEl.classList.remove('drag-over');
      }
      dragOverSq = newOverSq;
      if (dragOverSq >= 0 && legalMovesForSelected.some(m => m.to === dragOverSq)) {
        const el = getSquareEl(dragOverSq);
        if (el) el.classList.add('drag-over');
      }
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!dragging) return;

    // Clean up ghost
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }

    // Clean up drag-over
    if (dragOverSq >= 0) {
      const el = getSquareEl(dragOverSq);
      if (el) el.classList.remove('drag-over');
    }

    // Clean up dragging class
    const srcEl = getSquareEl(dragPieceSq);
    if (srcEl) {
      const p = srcEl.querySelector('.piece');
      if (p) p.classList.remove('dragging');
    }

    const sqEl = getSquareFromPoint(e);
    const dropSq = sqEl ? parseInt(sqEl.dataset.sq) : -1;

    dragging = false;
    dragPieceSq = -1;
    dragOverSq = -1;

    if (dropSq >= 0 && dropSq !== selectedSquare) {
      // Try to complete the move
      const movesToSq = legalMovesForSelected.filter(m => m.to === dropSq);
      if (movesToSq.length > 0) {
        dragMoveExecuted = true;
        if (movesToSq.length > 1 && movesToSq.some(m => m.flag >= FLAG_PROMOTE_KNIGHT)) {
          showPromotionDialog(selectedSquare, dropSq);
          return;
        }
        executePlayerMove(movesToSq[0]);
        return;
      }
    }
    // If dropped on same square or invalid, leave selected
    renderBoard();
  }

  function updateGhostPosition(e) {
    if (!dragGhost) return;
    const x = e.clientX || (e.touches && e.touches[0].clientX);
    const y = e.clientY || (e.touches && e.touches[0].clientY);
    dragGhost.style.left = x + 'px';
    dragGhost.style.top = y + 'px';
  }

  function getSquareFromPoint(e) {
    const x = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
    const y = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);
    // Hide ghost temporarily to get element under it
    if (dragGhost) dragGhost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (dragGhost) dragGhost.style.display = '';
    if (!el) return null;
    return el.closest('.square');
  }

  // --- User interaction ---

  function onSquareClick(sq) {
    if (!canPlayerInteract()) return;

    const piece = pos.get(sq);

    // If a piece is selected, try to move to this square
    if (selectedSquare >= 0) {
      const movesToSq = legalMovesForSelected.filter(m => m.to === sq);

      if (movesToSq.length > 0) {
        if (movesToSq.length > 1 && movesToSq.some(m => m.flag >= FLAG_PROMOTE_KNIGHT)) {
          showPromotionDialog(selectedSquare, sq);
          return;
        }
        executePlayerMove(movesToSq[0]);
        return;
      }

      // Select a different piece
      if (piece !== EMPTY && pieceColor(piece) === pos.turn) {
        selectSquare(sq);
        return;
      }

      // Deselect
      deselectSquare();
      return;
    }

    // Select a piece
    if (piece !== EMPTY && pieceColor(piece) === pos.turn) {
      selectSquare(sq);
    }
  }

  function selectSquare(sq) {
    selectedSquare = sq;
    const allLegal = pos.generateLegalMoves();
    legalMovesForSelected = allLegal.filter(m => m.from === sq);
    renderBoard();
  }

  function deselectSquare() {
    selectedSquare = -1;
    legalMovesForSelected = [];
    renderBoard();
  }

  function showPromotionDialog(from, to) {
    pendingPromotion = { from, to };
    promoOptions.innerHTML = '';
    const color = pos.turn;
    const pieces = [
      { flag: FLAG_PROMOTE_QUEEN, type: QUEEN },
      { flag: FLAG_PROMOTE_ROOK, type: ROOK },
      { flag: FLAG_PROMOTE_BISHOP, type: BISHOP },
      { flag: FLAG_PROMOTE_KNIGHT, type: KNIGHT },
    ];
    for (const { flag, type } of pieces) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.textContent = PIECE_CHARS[color | type];
      btn.addEventListener('click', () => {
        promoModal.style.display = 'none';
        const move = legalMovesForSelected.find(m => m.to === to && m.flag === flag);
        if (move) executePlayerMove(move);
      });
      promoOptions.appendChild(btn);
    }
    promoModal.style.display = 'flex';
  }

  function executePlayerMove(move) {
    if (timerEnabled && !timerStarted) startTimer();

    const fromSq = move.from;
    const toSq = move.to;

    animateMove(fromSq, toSq, () => {
      doMove(move);
      addIncrement(pos.turn === WHITE ? BLACK : WHITE); // add to the side that just moved
      deselectSquare();

      // Next turn
      const state = pos.getGameState();
      if (!state.over && gameMode === 'pvai') {
        setTimeout(() => engineMove(), 50);
      }
    });
  }

  function doMove(move) {
    const san = pos.moveToSAN(move);
    const captured = pos.get(move.to);
    const movingPiece = pos.get(move.from);
    const color = pieceColor(movingPiece);

    // Track captures
    if (captured !== EMPTY) {
      if (color === WHITE) capturedByWhite.push(pieceType(captured));
      else capturedByBlack.push(pieceType(captured));
    }
    // En passant capture
    if (move.flag === Chess.FLAG_EN_PASSANT) {
      if (color === WHITE) capturedByWhite.push(PAWN);
      else capturedByBlack.push(PAWN);
    }

    pos.makeMove(move);
    lastMoveFrom = move.from;
    lastMoveTo = move.to;

    // Record in move list
    if (color === WHITE) {
      moveList.push({ num: pos.fullmoveNumber - (pos.turn === WHITE ? 1 : 0), white: san, black: '' });
    } else {
      if (moveList.length === 0) {
        moveList.push({ num: pos.fullmoveNumber, white: '...', black: san });
      } else {
        moveList[moveList.length - 1].black = san;
      }
    }

    renderBoard();
    renderMoveHistory();
    renderCaptured();
    updateStatus();
  }

  function engineMove() {
    if (pos.getGameState().over) return;
    if (timerEnabled && (timerWhite <= 0 || timerBlack <= 0)) return;

    engineThinking = true;
    updateStatus();

    if (timerEnabled && !timerStarted) startTimer();

    setTimeout(() => {
      const result = engine.search(pos, { timeLimit: 10000 });
      engineThinking = false;

      if (result.move) {
        const fromSq = result.move.from;
        const toSq = result.move.to;
        animateMove(fromSq, toSq, () => {
          doMove(result.move);
          addIncrement(pos.turn === WHITE ? BLACK : WHITE);
        });
      }
    }, 10);
  }

  function aiVsAiStep() {
    if (pos.getGameState().over) return;
    if (aiVsAiStopped) return;
    if (timerEnabled && (timerWhite <= 0 || timerBlack <= 0)) return;

    engineThinking = true;
    updateStatus();

    if (timerEnabled && !timerStarted) startTimer();

    setTimeout(() => {
      if (aiVsAiStopped) {
        engineThinking = false;
        updateStatus();
        return;
      }
      const result = engine.search(pos, { timeLimit: 5000 });
      engineThinking = false;

      if (result.move) {
        const fromSq = result.move.from;
        const toSq = result.move.to;
        animateMove(fromSq, toSq, () => {
          doMove(result.move);
          addIncrement(pos.turn === WHITE ? BLACK : WHITE);

          if (!pos.getGameState().over && !aiVsAiStopped) {
            setTimeout(() => aiVsAiStep(), 300);
          }
        });
      }
    }, 10);
  }

  function resign() {
    if (pos.getGameState().over) return;
    if (gameMode === 'aivai') return;
    const loserColor = pos.turn;
    const winner = loserColor === WHITE ? 'Black' : 'White';
    const loser = loserColor === WHITE ? 'White' : 'Black';
    const text = `${winner} wins — ${loser} resigned!`;
    stopTimer();
    engineThinking = false;
    statusEl.textContent = text;
    statusEl.classList.remove('thinking');
    resultTextEl.textContent = text;
    gameResultEl.style.display = 'block';
  }

  function stopAiVsAi() {
    aiVsAiStopped = true;
    stopTimer();
    engineThinking = false;
    updateStatus();
    updateActionButtons();
  }

  function updateActionButtons() {
    const resignBtn = document.getElementById('btn-resign');
    const stopBtn = document.getElementById('btn-stop');
    if (resignBtn) resignBtn.style.display = (gameMode !== 'aivai' && !pos.getGameState().over) ? '' : 'none';
    if (stopBtn) stopBtn.style.display = (gameMode === 'aivai') ? '' : 'none';
  }

  function undoMoves() {
    if (engineThinking) return;
    if (pos.history.length === 0) return;

    // In PvP undo one move, in PvAI undo two (engine + player)
    const movesToUndo = gameMode === 'pvp' ? 1 : (pos.turn === playerColor ? 2 : 1);
    for (let i = 0; i < movesToUndo && pos.history.length > 0; i++) {
      const undo = pos.history[pos.history.length - 1];

      const captured = undo.captured;
      if (captured !== EMPTY || undo.flag === Chess.FLAG_EN_PASSANT) {
        const arr = pieceColor(pos.board[undo.to] || pos.board[undo.from]) === WHITE ? capturedByBlack : capturedByWhite;
        arr.pop();
      }

      pos.undoMove(undo);
    }

    rebuildMoveList();

    lastMoveFrom = -1;
    lastMoveTo = -1;
    if (pos.history.length > 0) {
      const last = pos.history[pos.history.length - 1];
      lastMoveFrom = last.from;
      lastMoveTo = last.to;
    }

    selectedSquare = -1;
    legalMovesForSelected = [];
    gameResultEl.style.display = 'none';

    renderBoard();
    renderMoveHistory();
    renderCaptured();
    updateStatus();
  }

  function rebuildMoveList() {
    const undos = [];
    while (pos.history.length > 0) {
      undos.push(pos.history[pos.history.length - 1]);
      pos.undoMove(undos[undos.length - 1]);
    }
    undos.reverse();

    moveList = [];
    capturedByWhite = [];
    capturedByBlack = [];

    for (const undo of undos) {
      const movingPiece = pos.board[undo.from];
      const color = pieceColor(movingPiece);
      const san = pos.moveToSAN(undo);
      const captured = pos.board[undo.to];

      if (captured !== EMPTY) {
        if (color === WHITE) capturedByWhite.push(pieceType(captured));
        else capturedByBlack.push(pieceType(captured));
      }
      if (undo.flag === Chess.FLAG_EN_PASSANT) {
        if (color === WHITE) capturedByWhite.push(PAWN);
        else capturedByBlack.push(PAWN);
      }

      pos.makeMove(undo);

      if (color === WHITE) {
        moveList.push({ num: pos.fullmoveNumber - (pos.turn === WHITE ? 1 : 0), white: san, black: '' });
      } else {
        if (moveList.length === 0) {
          moveList.push({ num: pos.fullmoveNumber, white: '...', black: san });
        } else {
          moveList[moveList.length - 1].black = san;
        }
      }
    }
  }

  function flipBoard() {
    boardFlipped = !boardFlipped;
    renderBoard();
    renderLabels();
  }

  // --- Event binding ---

  function bindEvents() {
    document.getElementById('btn-new').addEventListener('click', newGame);
    document.getElementById('btn-new-after').addEventListener('click', newGame);
    document.getElementById('btn-undo').addEventListener('click', undoMoves);
    document.getElementById('btn-flip').addEventListener('click', flipBoard);
    document.getElementById('btn-resign').addEventListener('click', resign);
    document.getElementById('btn-stop').addEventListener('click', stopAiVsAi);
    difficultyEl.addEventListener('change', () => { applyDifficulty(); });
    playAsEl.addEventListener('change', newGame);
    gameModeEl.addEventListener('change', newGame);
    timerModeEl.addEventListener('change', newGame);
    animateToggle.addEventListener('change', () => { animationEnabled = animateToggle.checked; });

    const boardThemeEl = document.getElementById('board-theme');
    boardThemeEl.addEventListener('change', () => { applyBoardTheme(boardThemeEl.value); });

    // Drag events on the board
    boardEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    // Touch events to prevent scrolling while dragging
    boardEl.addEventListener('touchstart', (e) => {
      const sqEl = e.target.closest('.square');
      if (sqEl && canPlayerInteract()) {
        const sq = parseInt(sqEl.dataset.sq);
        const piece = pos.get(sq);
        if (piece !== EMPTY && pieceColor(piece) === pos.turn) {
          e.preventDefault();
        }
      }
    }, { passive: false });

    boardEl.addEventListener('touchmove', (e) => {
      if (dragging) e.preventDefault();
    }, { passive: false });

    // Click fallback (for taps that don't drag)
    boardEl.addEventListener('click', (e) => {
      if (dragMoveExecuted) {
        dragMoveExecuted = false;
        return;
      }
      if (dragging) return;
      const sqEl = e.target.closest('.square');
      if (sqEl) onSquareClick(parseInt(sqEl.dataset.sq));
    });

    // Close promotion modal on overlay click
    promoModal.addEventListener('click', (e) => {
      if (e.target === promoModal) {
        promoModal.style.display = 'none';
        pendingPromotion = null;
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undoMoves();
      }
      if (e.key === 'f') flipBoard();
      if (e.key === 'n') newGame();
    });
  }

  // --- Board themes ---
  const BOARD_THEMES = {
    classic: { light: '#f0d9b5', dark: '#b58863' },
    green: { light: '#eeeed2', dark: '#769656' },
    blue: { light: '#dee3e6', dark: '#8ca2ad' },
    purple: { light: '#e8dff0', dark: '#9070a0' },
    coral: { light: '#f5e6ca', dark: '#c67a52' },
    ice: { light: '#e0eef6', dark: '#7ba7c4' },
    wood: { light: '#e6c89c', dark: '#a67b50' },
  };

  function applyBoardTheme(themeName) {
    const theme = BOARD_THEMES[themeName] || BOARD_THEMES.classic;
    document.documentElement.style.setProperty('--board-light', theme.light);
    document.documentElement.style.setProperty('--board-dark', theme.dark);
  }

  // Boot
  init();
})();
