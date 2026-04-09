// engine.js — Chess AI: Alpha-beta search with iterative deepening
// Evaluation: material + piece-square tables (placeholder for future NNUE)
// Target: ~1200 ELO at default depth

const Engine = (() => {
  'use strict';

  const {
    EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    WHITE, BLACK, pieceType, pieceColor, fileOf, rankOf,
    FLAG_PROMOTE_QUEEN, FLAG_EN_PASSANT, FLAG_CASTLE_KING, FLAG_CASTLE_QUEEN,
  } = Chess;

  // Material values (centipawns)
  const PIECE_VALUES = {
    [PAWN]: 100,
    [KNIGHT]: 320,
    [BISHOP]: 330,
    [ROOK]: 500,
    [QUEEN]: 900,
    [KING]: 20000,
  };

  // Piece-square tables (from White's perspective, rank 0 = row closest to White)
  // Values in centipawns — encourages good piece placement
  const PST = {
    [PAWN]: [
       0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0,
    ],
    [KNIGHT]: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    [BISHOP]: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    [ROOK]: [
       0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0,
    ],
    [QUEEN]: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    [KING]: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20,
    ],
  };

  // King endgame table — king should be active in endgame
  const KING_ENDGAME = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ];

  function pstIndex(sq, color) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    // PST is stored from White's perspective (rank 7 at top = index 0)
    const row = color === WHITE ? 7 - r : r;
    return row * 8 + f;
  }

  // Static evaluation from current side's perspective
  function evaluate(pos) {
    let mgScore = 0; // Middlegame
    let totalMaterial = 0;

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const piece = pos.board[sq];
      if (piece === EMPTY) continue;

      const type = pieceType(piece);
      const color = pieceColor(piece);
      const sign = color === WHITE ? 1 : -1;
      const matVal = PIECE_VALUES[type];

      if (type !== KING) totalMaterial += matVal;

      // Material
      mgScore += sign * matVal;

      // Piece-square table
      const idx = pstIndex(sq, color);
      if (type === KING) {
        // Blend between middlegame and endgame king table based on material
        const mgKing = PST[KING][idx];
        const egKing = KING_ENDGAME[idx];
        // Phase: 0 = endgame, 1 = opening
        const phase = Math.min(totalMaterial, 6200) / 6200;
        mgScore += sign * Math.round(mgKing * phase + egKing * (1 - phase));
      } else {
        mgScore += sign * PST[type][idx];
      }
    }

    // Bonus for bishop pair
    let whiteBishops = 0, blackBishops = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = pos.board[sq];
      if (pieceType(p) === BISHOP) {
        if (pieceColor(p) === WHITE) whiteBishops++;
        else blackBishops++;
      }
    }
    if (whiteBishops >= 2) mgScore += 30;
    if (blackBishops >= 2) mgScore -= 30;

    // Return relative to side to move
    return pos.turn === WHITE ? mgScore : -mgScore;
  }

  // Move ordering heuristic — better ordering = more pruning
  function scoreMoveForOrdering(pos, move) {
    let score = 0;
    const captured = pos.board[move.to];

    // MVV-LVA: Most Valuable Victim - Least Valuable Attacker
    if (captured !== EMPTY) {
      score += 10 * PIECE_VALUES[pieceType(captured)] - PIECE_VALUES[pieceType(pos.board[move.from])];
    }

    // Promotions
    if (move.flag >= Chess.FLAG_PROMOTE_KNIGHT) {
      score += move.flag === FLAG_PROMOTE_QUEEN ? 900 : 300;
    }

    // En passant
    if (move.flag === FLAG_EN_PASSANT) score += 100;

    return score;
  }

  function orderMoves(pos, moves) {
    return moves
      .map(m => ({ move: m, score: scoreMoveForOrdering(pos, m) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.move);
  }

  const INF = 999999;

  class SearchEngine {
    constructor() {
      this.nodes = 0;
      this.maxDepth = 4; // Default depth — ~1200 ELO
      this.aborted = false;
      this.startTime = 0;
      this.timeLimit = 0; // ms, 0 = no limit
      this.bestMove = null;
      this.onInfo = null; // callback for search info
    }

    // Alpha-beta with quiescence search
    alphaBeta(pos, depth, alpha, beta, isRoot = false) {
      this.nodes++;

      // Time check every 4096 nodes
      if (this.timeLimit && (this.nodes & 4095) === 0) {
        if (performance.now() - this.startTime >= this.timeLimit) {
          this.aborted = true;
          return 0;
        }
      }
      if (this.aborted) return 0;

      // At leaf, do quiescence search
      if (depth <= 0) return this.quiescence(pos, alpha, beta);

      const state = pos.getGameState();
      if (state.over) {
        if (state.result === 'draw') return 0;
        // Checkmate — prefer faster mates
        return -INF + (this.maxDepth - depth);
      }

      const moves = orderMoves(pos, state.legalMoves);
      let bestMove = moves[0];

      for (const move of moves) {
        const undo = pos.makeMove(move);
        const score = -this.alphaBeta(pos, depth - 1, -beta, -alpha);
        pos.undoMove(undo);

        if (this.aborted) return 0;

        if (score > alpha) {
          alpha = score;
          bestMove = move;
          if (alpha >= beta) break; // Beta cutoff
        }
      }

      if (isRoot) this.bestMove = bestMove;
      return alpha;
    }

    // Quiescence search — only look at captures to avoid horizon effect
    quiescence(pos, alpha, beta) {
      this.nodes++;

      const standPat = evaluate(pos);
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;

      // Generate only capture moves
      const moves = pos.generateLegalMoves().filter(m =>
        pos.board[m.to] !== EMPTY ||
        m.flag === FLAG_EN_PASSANT ||
        m.flag >= Chess.FLAG_PROMOTE_KNIGHT
      );

      const ordered = orderMoves(pos, moves);

      for (const move of ordered) {
        const undo = pos.makeMove(move);
        const score = -this.quiescence(pos, -beta, -alpha);
        pos.undoMove(undo);

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }

      return alpha;
    }

    // Iterative deepening search
    search(pos, options = {}) {
      const maxDepth = options.depth || this.maxDepth;
      this.timeLimit = options.timeLimit || 0;
      this.startTime = performance.now();
      this.aborted = false;
      this.nodes = 0;
      this.bestMove = null;

      let bestScore = 0;
      let bestMoveOverall = null;

      for (let depth = 1; depth <= maxDepth; depth++) {
        this.maxDepth = depth;
        const score = this.alphaBeta(pos, depth, -INF, INF, true);

        if (this.aborted) break;

        bestScore = score;
        bestMoveOverall = this.bestMove;

        const elapsed = performance.now() - this.startTime;
        if (this.onInfo) {
          this.onInfo({
            depth,
            score: bestScore,
            nodes: this.nodes,
            time: Math.round(elapsed),
            pv: bestMoveOverall ? Chess.squareName(bestMoveOverall.from) + Chess.squareName(bestMoveOverall.to) : '',
          });
        }

        // If we found a mate, no need to search deeper
        if (Math.abs(bestScore) > INF - 100) break;
      }

      this.bestMove = bestMoveOverall;
      return {
        move: bestMoveOverall,
        score: bestScore,
        nodes: this.nodes,
        time: Math.round(performance.now() - this.startTime),
      };
    }

    // Set difficulty (search depth)
    setDepth(depth) {
      this.maxDepth = Math.max(1, Math.min(8, depth));
    }
  }

  // Difficulty presets
  const DIFFICULTY = {
    beginner: { depth: 2, name: 'Beginner', elo: '~800' },
    easy: { depth: 3, name: 'Easy', elo: '~1000' },
    medium: { depth: 4, name: 'Medium', elo: '~1200' },
    hard: { depth: 5, name: 'Hard', elo: '~1400' },
    expert: { depth: 6, name: 'Expert', elo: '~1600' },
  };

  return { SearchEngine, evaluate, DIFFICULTY, PIECE_VALUES };
})();
