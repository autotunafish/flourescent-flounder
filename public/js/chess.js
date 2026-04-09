// chess.js — Complete chess logic: board representation, move generation, rules
// Designed to be replaceable by Rust WASM engine later

const Chess = (() => {
  'use strict';

  // Piece constants
  const EMPTY = 0;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 8, BLACK = 16;

  const PIECE_CHARS = {
    [WHITE | PAWN]: '♙', [WHITE | KNIGHT]: '♘', [WHITE | BISHOP]: '♗',
    [WHITE | ROOK]: '♖', [WHITE | QUEEN]: '♕', [WHITE | KING]: '♔',
    [BLACK | PAWN]: '♟', [BLACK | KNIGHT]: '♞', [BLACK | BISHOP]: '♝',
    [BLACK | ROOK]: '♜', [BLACK | QUEEN]: '♛', [BLACK | KING]: '♚',
  };

  const PIECE_NAMES = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
  const PIECE_LETTERS = { [PAWN]: '', [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };

  const FILES = 'abcdefgh';
  const RANKS = '12345678';

  // 0x88 board representation — efficient off-board detection
  // Board is 128 squares, only indices where (index & 0x88) === 0 are valid
  function squareIndex(file, rank) { return rank * 16 + file; }
  function fileOf(sq) { return sq & 7; }
  function rankOf(sq) { return sq >> 4; }
  function isOnBoard(sq) { return (sq & 0x88) === 0; }
  function squareName(sq) { return FILES[fileOf(sq)] + RANKS[rankOf(sq)]; }
  function parseSquare(name) {
    const f = FILES.indexOf(name[0]);
    const r = RANKS.indexOf(name[1]);
    if (f < 0 || r < 0) return -1;
    return squareIndex(f, r);
  }

  function pieceColor(p) { return p & 24; }
  function pieceType(p) { return p & 7; }

  // Direction offsets for 0x88 board
  const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
  const BISHOP_OFFSETS = [-17, -15, 15, 17];
  const ROOK_OFFSETS = [-16, -1, 1, 16];
  const QUEEN_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
  const KING_OFFSETS = QUEEN_OFFSETS;

  // Move flags
  const FLAG_NORMAL = 0;
  const FLAG_DOUBLE_PUSH = 1;
  const FLAG_EN_PASSANT = 2;
  const FLAG_CASTLE_KING = 3;
  const FLAG_CASTLE_QUEEN = 4;
  const FLAG_PROMOTE_KNIGHT = 5;
  const FLAG_PROMOTE_BISHOP = 6;
  const FLAG_PROMOTE_ROOK = 7;
  const FLAG_PROMOTE_QUEEN = 8;

  function makeMove(from, to, flag = FLAG_NORMAL) {
    return { from, to, flag };
  }

  // Castling rights bitmask
  const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

  class Position {
    constructor() {
      this.board = new Uint8Array(128);
      this.turn = WHITE;
      this.castling = 0;
      this.enPassant = -1; // target square or -1
      this.halfmoveClock = 0;
      this.fullmoveNumber = 1;
      this.history = [];
    }

    clone() {
      const p = new Position();
      p.board.set(this.board);
      p.turn = this.turn;
      p.castling = this.castling;
      p.enPassant = this.enPassant;
      p.halfmoveClock = this.halfmoveClock;
      p.fullmoveNumber = this.fullmoveNumber;
      return p;
    }

    static fromFEN(fen) {
      const pos = new Position();
      const parts = fen.split(' ');
      const rows = parts[0].split('/');

      for (let rank = 7; rank >= 0; rank--) {
        let file = 0;
        for (const ch of rows[7 - rank]) {
          if (ch >= '1' && ch <= '8') {
            file += parseInt(ch);
          } else {
            let color = ch === ch.toUpperCase() ? WHITE : BLACK;
            let type;
            switch (ch.toLowerCase()) {
              case 'p': type = PAWN; break;
              case 'n': type = KNIGHT; break;
              case 'b': type = BISHOP; break;
              case 'r': type = ROOK; break;
              case 'q': type = QUEEN; break;
              case 'k': type = KING; break;
            }
            pos.board[squareIndex(file, rank)] = color | type;
            file++;
          }
        }
      }

      pos.turn = parts[1] === 'w' ? WHITE : BLACK;

      pos.castling = 0;
      if (parts[2] !== '-') {
        if (parts[2].includes('K')) pos.castling |= CASTLE_WK;
        if (parts[2].includes('Q')) pos.castling |= CASTLE_WQ;
        if (parts[2].includes('k')) pos.castling |= CASTLE_BK;
        if (parts[2].includes('q')) pos.castling |= CASTLE_BQ;
      }

      pos.enPassant = parts[3] === '-' ? -1 : parseSquare(parts[3]);
      pos.halfmoveClock = parseInt(parts[4]) || 0;
      pos.fullmoveNumber = parseInt(parts[5]) || 1;

      return pos;
    }

    toFEN() {
      let fen = '';
      for (let rank = 7; rank >= 0; rank--) {
        let empty = 0;
        for (let file = 0; file < 8; file++) {
          const piece = this.board[squareIndex(file, rank)];
          if (piece === EMPTY) {
            empty++;
          } else {
            if (empty > 0) { fen += empty; empty = 0; }
            const type = pieceType(piece);
            const letters = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q', [KING]: 'k' };
            let ch = letters[type];
            if (pieceColor(piece) === WHITE) ch = ch.toUpperCase();
            fen += ch;
          }
        }
        if (empty > 0) fen += empty;
        if (rank > 0) fen += '/';
      }

      fen += ' ' + (this.turn === WHITE ? 'w' : 'b');

      let castleStr = '';
      if (this.castling & CASTLE_WK) castleStr += 'K';
      if (this.castling & CASTLE_WQ) castleStr += 'Q';
      if (this.castling & CASTLE_BK) castleStr += 'k';
      if (this.castling & CASTLE_BQ) castleStr += 'q';
      fen += ' ' + (castleStr || '-');

      fen += ' ' + (this.enPassant >= 0 ? squareName(this.enPassant) : '-');
      fen += ' ' + this.halfmoveClock;
      fen += ' ' + this.fullmoveNumber;

      return fen;
    }

    get(sq) { return this.board[sq]; }
    set(sq, piece) { this.board[sq] = piece; }

    findKing(color) {
      for (let sq = 0; sq < 128; sq++) {
        if (!isOnBoard(sq)) continue;
        if (this.board[sq] === (color | KING)) return sq;
      }
      return -1;
    }

    isAttacked(sq, byColor) {
      // Check pawn attacks
      const pawnDir = byColor === WHITE ? -1 : 1;
      for (const fd of [-1, 1]) {
        const from = sq + pawnDir * 16 + fd;
        if (isOnBoard(from) && this.board[from] === (byColor | PAWN)) return true;
      }

      // Check knight attacks
      for (const offset of KNIGHT_OFFSETS) {
        const from = sq + offset;
        if (isOnBoard(from) && this.board[from] === (byColor | KNIGHT)) return true;
      }

      // Check king attacks
      for (const offset of KING_OFFSETS) {
        const from = sq + offset;
        if (isOnBoard(from) && this.board[from] === (byColor | KING)) return true;
      }

      // Check sliding pieces (bishop/queen diagonals, rook/queen straights)
      for (const offset of BISHOP_OFFSETS) {
        let s = sq + offset;
        while (isOnBoard(s)) {
          const p = this.board[s];
          if (p !== EMPTY) {
            if (pieceColor(p) === byColor && (pieceType(p) === BISHOP || pieceType(p) === QUEEN)) return true;
            break;
          }
          s += offset;
        }
      }
      for (const offset of ROOK_OFFSETS) {
        let s = sq + offset;
        while (isOnBoard(s)) {
          const p = this.board[s];
          if (p !== EMPTY) {
            if (pieceColor(p) === byColor && (pieceType(p) === ROOK || pieceType(p) === QUEEN)) return true;
            break;
          }
          s += offset;
        }
      }

      return false;
    }

    inCheck(color = this.turn) {
      const kingSq = this.findKing(color);
      return kingSq >= 0 && this.isAttacked(kingSq, color === WHITE ? BLACK : WHITE);
    }

    // Generate all pseudo-legal moves
    generatePseudoMoves() {
      const moves = [];
      const color = this.turn;
      const enemy = color === WHITE ? BLACK : WHITE;

      for (let sq = 0; sq < 128; sq++) {
        if (!isOnBoard(sq)) continue;
        const piece = this.board[sq];
        if (piece === EMPTY || pieceColor(piece) !== color) continue;
        const type = pieceType(piece);

        if (type === PAWN) {
          const dir = color === WHITE ? 16 : -16;
          const startRank = color === WHITE ? 1 : 6;
          const promoRank = color === WHITE ? 7 : 0;

          // Single push
          const one = sq + dir;
          if (isOnBoard(one) && this.board[one] === EMPTY) {
            if (rankOf(one) === promoRank) {
              moves.push(makeMove(sq, one, FLAG_PROMOTE_QUEEN));
              moves.push(makeMove(sq, one, FLAG_PROMOTE_ROOK));
              moves.push(makeMove(sq, one, FLAG_PROMOTE_BISHOP));
              moves.push(makeMove(sq, one, FLAG_PROMOTE_KNIGHT));
            } else {
              moves.push(makeMove(sq, one, FLAG_NORMAL));
            }

            // Double push
            if (rankOf(sq) === startRank) {
              const two = sq + dir * 2;
              if (this.board[two] === EMPTY) {
                moves.push(makeMove(sq, two, FLAG_DOUBLE_PUSH));
              }
            }
          }

          // Captures
          for (const fd of [-1, 1]) {
            const cap = sq + dir + fd;
            if (!isOnBoard(cap)) continue;
            if (this.board[cap] !== EMPTY && pieceColor(this.board[cap]) === enemy) {
              if (rankOf(cap) === promoRank) {
                moves.push(makeMove(sq, cap, FLAG_PROMOTE_QUEEN));
                moves.push(makeMove(sq, cap, FLAG_PROMOTE_ROOK));
                moves.push(makeMove(sq, cap, FLAG_PROMOTE_BISHOP));
                moves.push(makeMove(sq, cap, FLAG_PROMOTE_KNIGHT));
              } else {
                moves.push(makeMove(sq, cap, FLAG_NORMAL));
              }
            }
            // En passant
            if (cap === this.enPassant) {
              moves.push(makeMove(sq, cap, FLAG_EN_PASSANT));
            }
          }
        } else if (type === KNIGHT) {
          for (const offset of KNIGHT_OFFSETS) {
            const to = sq + offset;
            if (!isOnBoard(to)) continue;
            if (this.board[to] === EMPTY || pieceColor(this.board[to]) === enemy) {
              moves.push(makeMove(sq, to));
            }
          }
        } else if (type === KING) {
          for (const offset of KING_OFFSETS) {
            const to = sq + offset;
            if (!isOnBoard(to)) continue;
            if (this.board[to] === EMPTY || pieceColor(this.board[to]) === enemy) {
              moves.push(makeMove(sq, to));
            }
          }
          // Castling
          if (color === WHITE) {
            if ((this.castling & CASTLE_WK) && this.board[5] === EMPTY && this.board[6] === EMPTY &&
                !this.isAttacked(4, BLACK) && !this.isAttacked(5, BLACK) && !this.isAttacked(6, BLACK)) {
              moves.push(makeMove(sq, 6, FLAG_CASTLE_KING));
            }
            if ((this.castling & CASTLE_WQ) && this.board[3] === EMPTY && this.board[2] === EMPTY && this.board[1] === EMPTY &&
                !this.isAttacked(4, BLACK) && !this.isAttacked(3, BLACK) && !this.isAttacked(2, BLACK)) {
              moves.push(makeMove(sq, 2, FLAG_CASTLE_QUEEN));
            }
          } else {
            if ((this.castling & CASTLE_BK) && this.board[0x75] === EMPTY && this.board[0x76] === EMPTY &&
                !this.isAttacked(0x74, WHITE) && !this.isAttacked(0x75, WHITE) && !this.isAttacked(0x76, WHITE)) {
              moves.push(makeMove(sq, 0x76, FLAG_CASTLE_KING));
            }
            if ((this.castling & CASTLE_BQ) && this.board[0x73] === EMPTY && this.board[0x72] === EMPTY && this.board[0x71] === EMPTY &&
                !this.isAttacked(0x74, WHITE) && !this.isAttacked(0x73, WHITE) && !this.isAttacked(0x72, WHITE)) {
              moves.push(makeMove(sq, 0x72, FLAG_CASTLE_QUEEN));
            }
          }
        } else {
          // Sliding pieces
          let offsets;
          if (type === BISHOP) offsets = BISHOP_OFFSETS;
          else if (type === ROOK) offsets = ROOK_OFFSETS;
          else offsets = QUEEN_OFFSETS;

          for (const offset of offsets) {
            let to = sq + offset;
            while (isOnBoard(to)) {
              if (this.board[to] === EMPTY) {
                moves.push(makeMove(sq, to));
              } else {
                if (pieceColor(this.board[to]) === enemy) {
                  moves.push(makeMove(sq, to));
                }
                break;
              }
              to += offset;
            }
          }
        }
      }

      return moves;
    }

    // Generate legal moves only
    generateLegalMoves() {
      const pseudo = this.generatePseudoMoves();
      const legal = [];
      for (const move of pseudo) {
        const undo = this.makeMove(move);
        if (!this.inCheck(this.turn === WHITE ? BLACK : WHITE)) {
          legal.push(move);
        }
        this.undoMove(undo);
      }
      return legal;
    }

    makeMove(move) {
      const undo = {
        from: move.from,
        to: move.to,
        flag: move.flag,
        captured: this.board[move.to],
        castling: this.castling,
        enPassant: this.enPassant,
        halfmoveClock: this.halfmoveClock,
        fullmoveNumber: this.fullmoveNumber,
        epCapturedPawn: EMPTY,
      };

      const piece = this.board[move.from];
      const type = pieceType(piece);
      const color = pieceColor(piece);

      // Move the piece
      this.board[move.to] = piece;
      this.board[move.from] = EMPTY;

      // Handle en passant capture
      if (move.flag === FLAG_EN_PASSANT) {
        const capturedSq = move.to + (color === WHITE ? -16 : 16);
        undo.epCapturedPawn = this.board[capturedSq];
        this.board[capturedSq] = EMPTY;
      }

      // Handle double pawn push — set en passant target
      if (move.flag === FLAG_DOUBLE_PUSH) {
        this.enPassant = move.from + (color === WHITE ? 16 : -16);
      } else {
        this.enPassant = -1;
      }

      // Handle castling — move the rook
      if (move.flag === FLAG_CASTLE_KING) {
        if (color === WHITE) {
          this.board[5] = this.board[7]; this.board[7] = EMPTY;
        } else {
          this.board[0x75] = this.board[0x77]; this.board[0x77] = EMPTY;
        }
      }
      if (move.flag === FLAG_CASTLE_QUEEN) {
        if (color === WHITE) {
          this.board[3] = this.board[0]; this.board[0] = EMPTY;
        } else {
          this.board[0x73] = this.board[0x70]; this.board[0x70] = EMPTY;
        }
      }

      // Handle promotion
      if (move.flag >= FLAG_PROMOTE_KNIGHT && move.flag <= FLAG_PROMOTE_QUEEN) {
        const promoType = [0, 0, 0, 0, 0, KNIGHT, BISHOP, ROOK, QUEEN][move.flag];
        this.board[move.to] = color | promoType;
      }

      // Update castling rights
      if (type === KING) {
        if (color === WHITE) this.castling &= ~(CASTLE_WK | CASTLE_WQ);
        else this.castling &= ~(CASTLE_BK | CASTLE_BQ);
      }
      if (type === ROOK) {
        if (move.from === 0) this.castling &= ~CASTLE_WQ;
        if (move.from === 7) this.castling &= ~CASTLE_WK;
        if (move.from === 0x70) this.castling &= ~CASTLE_BQ;
        if (move.from === 0x77) this.castling &= ~CASTLE_BK;
      }
      // Rook captured
      if (move.to === 0) this.castling &= ~CASTLE_WQ;
      if (move.to === 7) this.castling &= ~CASTLE_WK;
      if (move.to === 0x70) this.castling &= ~CASTLE_BQ;
      if (move.to === 0x77) this.castling &= ~CASTLE_BK;

      // Update clocks
      if (type === PAWN || undo.captured !== EMPTY) {
        this.halfmoveClock = 0;
      } else {
        this.halfmoveClock++;
      }
      if (color === BLACK) this.fullmoveNumber++;

      // Switch turn
      this.turn = this.turn === WHITE ? BLACK : WHITE;

      this.history.push(undo);
      return undo;
    }

    undoMove(undo) {
      this.turn = this.turn === WHITE ? BLACK : WHITE;
      const color = this.turn;

      const piece = this.board[undo.to];

      // Undo promotion — restore pawn
      if (undo.flag >= FLAG_PROMOTE_KNIGHT && undo.flag <= FLAG_PROMOTE_QUEEN) {
        this.board[undo.from] = pieceColor(piece) | PAWN;
      } else {
        this.board[undo.from] = piece;
      }
      this.board[undo.to] = undo.captured;

      // Undo en passant
      if (undo.flag === FLAG_EN_PASSANT) {
        const capturedSq = undo.to + (color === WHITE ? -16 : 16);
        this.board[capturedSq] = undo.epCapturedPawn;
      }

      // Undo castling rook move
      if (undo.flag === FLAG_CASTLE_KING) {
        if (color === WHITE) {
          this.board[7] = this.board[5]; this.board[5] = EMPTY;
        } else {
          this.board[0x77] = this.board[0x75]; this.board[0x75] = EMPTY;
        }
      }
      if (undo.flag === FLAG_CASTLE_QUEEN) {
        if (color === WHITE) {
          this.board[0] = this.board[3]; this.board[3] = EMPTY;
        } else {
          this.board[0x70] = this.board[0x73]; this.board[0x73] = EMPTY;
        }
      }

      this.castling = undo.castling;
      this.enPassant = undo.enPassant;
      this.halfmoveClock = undo.halfmoveClock;
      this.fullmoveNumber = undo.fullmoveNumber;

      this.history.pop();
    }

    // Check for draw conditions
    isInsufficientMaterial() {
      let whitePieces = [], blackPieces = [];
      for (let sq = 0; sq < 128; sq++) {
        if (!isOnBoard(sq)) continue;
        const p = this.board[sq];
        if (p === EMPTY) continue;
        const t = pieceType(p);
        if (t === KING) continue;
        if (pieceColor(p) === WHITE) whitePieces.push(t);
        else blackPieces.push(t);
      }
      // K vs K
      if (whitePieces.length === 0 && blackPieces.length === 0) return true;
      // K vs KN or K vs KB
      if (whitePieces.length === 0 && blackPieces.length === 1 && (blackPieces[0] === KNIGHT || blackPieces[0] === BISHOP)) return true;
      if (blackPieces.length === 0 && whitePieces.length === 1 && (whitePieces[0] === KNIGHT || whitePieces[0] === BISHOP)) return true;
      // KB vs KB (same color bishops)
      if (whitePieces.length === 1 && blackPieces.length === 1 && whitePieces[0] === BISHOP && blackPieces[0] === BISHOP) {
        let wbSq = -1, bbSq = -1;
        for (let sq = 0; sq < 128; sq++) {
          if (!isOnBoard(sq)) continue;
          if (this.board[sq] === (WHITE | BISHOP)) wbSq = sq;
          if (this.board[sq] === (BLACK | BISHOP)) bbSq = sq;
        }
        if ((fileOf(wbSq) + rankOf(wbSq)) % 2 === (fileOf(bbSq) + rankOf(bbSq)) % 2) return true;
      }
      return false;
    }

    isThreefoldRepetition() {
      // Simplified: check if current FEN position part has occurred 3 times
      const currentFEN = this.toFEN().split(' ').slice(0, 4).join(' ');
      let count = 1;

      // Walk back through history, rebuilding positions
      const tempHistory = [...this.history];
      const undos = [];
      while (this.history.length > 0) {
        const undo = this.history[this.history.length - 1];
        this.undoMove(undo);
        undos.push(undo);
        const fen = this.toFEN().split(' ').slice(0, 4).join(' ');
        if (fen === currentFEN) count++;
        if (count >= 3) break;
      }

      // Restore
      while (undos.length > 0) {
        const undo = undos.pop();
        this.makeMove(undo);
      }

      return count >= 3;
    }

    getGameState() {
      const legalMoves = this.generateLegalMoves();
      const inCheck = this.inCheck();

      if (legalMoves.length === 0) {
        if (inCheck) return { over: true, result: this.turn === WHITE ? 'black' : 'white', reason: 'checkmate' };
        return { over: true, result: 'draw', reason: 'stalemate' };
      }
      if (this.halfmoveClock >= 100) return { over: true, result: 'draw', reason: 'fifty-move rule' };
      if (this.isInsufficientMaterial()) return { over: true, result: 'draw', reason: 'insufficient material' };
      if (this.isThreefoldRepetition()) return { over: true, result: 'draw', reason: 'threefold repetition' };

      return { over: false, inCheck, legalMoves };
    }

    // Convert move to algebraic notation
    moveToSAN(move) {
      const piece = this.board[move.from];
      const type = pieceType(piece);
      const isCapture = this.board[move.to] !== EMPTY || move.flag === FLAG_EN_PASSANT;

      // Castling
      if (move.flag === FLAG_CASTLE_KING) return 'O-O';
      if (move.flag === FLAG_CASTLE_QUEEN) return 'O-O-O';

      let san = '';

      if (type === PAWN) {
        if (isCapture) san += FILES[fileOf(move.from)];
      } else {
        san += PIECE_LETTERS[type];

        // Disambiguation
        const legalMoves = this.generatePseudoMoves().filter(m => {
          if (pieceType(this.board[m.from]) !== type) return false;
          if (m.to !== move.to) return false;
          if (m.from === move.from) return false;
          // Check legality
          const undo = this.makeMove(m);
          const legal = !this.inCheck(this.turn === WHITE ? BLACK : WHITE);
          this.undoMove(undo);
          return legal;
        });

        if (legalMoves.length > 0) {
          const sameFile = legalMoves.some(m => fileOf(m.from) === fileOf(move.from));
          const sameRank = legalMoves.some(m => rankOf(m.from) === rankOf(move.from));
          if (!sameFile) san += FILES[fileOf(move.from)];
          else if (!sameRank) san += RANKS[rankOf(move.from)];
          else san += squareName(move.from);
        }
      }

      if (isCapture) san += 'x';
      san += squareName(move.to);

      // Promotion
      if (move.flag >= FLAG_PROMOTE_KNIGHT && move.flag <= FLAG_PROMOTE_QUEEN) {
        const promoLetters = { [FLAG_PROMOTE_KNIGHT]: 'N', [FLAG_PROMOTE_BISHOP]: 'B', [FLAG_PROMOTE_ROOK]: 'R', [FLAG_PROMOTE_QUEEN]: 'Q' };
        san += '=' + promoLetters[move.flag];
      }

      // Check / checkmate
      const undo = this.makeMove(move);
      if (this.inCheck()) {
        const state = this.getGameState();
        san += state.over ? '#' : '+';
      }
      this.undoMove(undo);

      return san;
    }
  }

  // Starting position FEN
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  return {
    Position,
    START_FEN,
    EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    WHITE, BLACK,
    PIECE_CHARS, PIECE_NAMES, PIECE_LETTERS,
    FLAG_NORMAL, FLAG_DOUBLE_PUSH, FLAG_EN_PASSANT,
    FLAG_CASTLE_KING, FLAG_CASTLE_QUEEN,
    FLAG_PROMOTE_KNIGHT, FLAG_PROMOTE_BISHOP, FLAG_PROMOTE_ROOK, FLAG_PROMOTE_QUEEN,
    squareName, parseSquare, fileOf, rankOf, isOnBoard, squareIndex,
    pieceColor, pieceType,
  };
})();
