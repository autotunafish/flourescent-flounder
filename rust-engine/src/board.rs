/// Board representation and move generation using 0x88 board
///
/// The 0x88 trick: board is 16x8 = 128 squares. A square index is valid
/// if (index & 0x88) == 0. This eliminates bounds checking for move generation.

// Piece types
pub const EMPTY: u8 = 0;
pub const PAWN: u8 = 1;
pub const KNIGHT: u8 = 2;
pub const BISHOP: u8 = 3;
pub const ROOK: u8 = 4;
pub const QUEEN: u8 = 5;
pub const KING: u8 = 6;

// Colors
pub const WHITE: u8 = 8;
pub const BLACK: u8 = 16;

// Castling rights
pub const CASTLE_WK: u8 = 1;
pub const CASTLE_WQ: u8 = 2;
pub const CASTLE_BK: u8 = 4;
pub const CASTLE_BQ: u8 = 8;

// Move flags
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MoveFlag {
    Normal,
    DoublePush,
    EnPassant,
    CastleKing,
    CastleQueen,
    PromoteKnight,
    PromoteBishop,
    PromoteRook,
    PromoteQueen,
}

#[derive(Debug, Clone, Copy)]
pub struct Move {
    pub from: u8,
    pub to: u8,
    pub flag: MoveFlag,
}

#[derive(Debug, Clone, Copy)]
pub struct UndoInfo {
    pub from: u8,
    pub to: u8,
    pub flag: MoveFlag,
    pub captured: u8,
    pub castling: u8,
    pub en_passant: i8,
    pub halfmove_clock: u16,
}

#[derive(Clone)]
pub struct Position {
    pub board: [u8; 128],
    pub turn: u8,
    pub castling: u8,
    pub en_passant: i8, // -1 = none
    pub halfmove_clock: u16,
    pub fullmove_number: u16,
}

impl Position {
    pub fn new() -> Self {
        Position {
            board: [0; 128],
            turn: WHITE,
            castling: 0,
            en_passant: -1,
            halfmove_clock: 0,
            fullmove_number: 1,
        }
    }

    pub fn from_fen(fen: &str) -> Self {
        let mut pos = Position::new();
        let parts: Vec<&str> = fen.split(' ').collect();
        let rows: Vec<&str> = parts[0].split('/').collect();

        for (row_idx, row) in rows.iter().enumerate() {
            let rank = 7 - row_idx;
            let mut file = 0usize;
            for ch in row.chars() {
                if ch.is_ascii_digit() {
                    file += (ch as usize) - ('0' as usize);
                } else {
                    let color = if ch.is_uppercase() { WHITE } else { BLACK };
                    let piece_type = match ch.to_ascii_lowercase() {
                        'p' => PAWN,
                        'n' => KNIGHT,
                        'b' => BISHOP,
                        'r' => ROOK,
                        'q' => QUEEN,
                        'k' => KING,
                        _ => EMPTY,
                    };
                    pos.board[rank * 16 + file] = color | piece_type;
                    file += 1;
                }
            }
        }

        if parts.len() > 1 {
            pos.turn = if parts[1] == "b" { BLACK } else { WHITE };
        }

        if parts.len() > 2 && parts[2] != "-" {
            for ch in parts[2].chars() {
                match ch {
                    'K' => pos.castling |= CASTLE_WK,
                    'Q' => pos.castling |= CASTLE_WQ,
                    'k' => pos.castling |= CASTLE_BK,
                    'q' => pos.castling |= CASTLE_BQ,
                    _ => {}
                }
            }
        }

        if parts.len() > 3 && parts[3] != "-" {
            let bytes = parts[3].as_bytes();
            let file = (bytes[0] - b'a') as i8;
            let rank = (bytes[1] - b'1') as i8;
            pos.en_passant = rank * 16 + file;
        }

        if parts.len() > 4 {
            pos.halfmove_clock = parts[4].parse().unwrap_or(0);
        }
        if parts.len() > 5 {
            pos.fullmove_number = parts[5].parse().unwrap_or(1);
        }

        pos
    }

    pub fn start_position() -> Self {
        Self::from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    }

    #[inline]
    pub fn piece_color(p: u8) -> u8 { p & 24 }

    #[inline]
    pub fn piece_type(p: u8) -> u8 { p & 7 }

    #[inline]
    pub fn is_on_board(sq: i8) -> bool { (sq as u8 & 0x88) == 0 }

    #[inline]
    pub fn file_of(sq: u8) -> u8 { sq & 7 }

    #[inline]
    pub fn rank_of(sq: u8) -> u8 { sq >> 4 }

    pub fn find_king(&self, color: u8) -> i8 {
        for sq in 0..128i8 {
            if !Self::is_on_board(sq) { continue; }
            if self.board[sq as usize] == (color | KING) {
                return sq;
            }
        }
        -1
    }

    pub fn is_attacked(&self, sq: i8, by_color: u8) -> bool {
        // Pawn attacks
        let pawn_dir: i8 = if by_color == WHITE { -1 } else { 1 };
        for &fd in &[-1i8, 1] {
            let from = sq + pawn_dir * 16 + fd;
            if Self::is_on_board(from) && self.board[from as usize] == (by_color | PAWN) {
                return true;
            }
        }

        // Knight attacks
        for &offset in &[-33i8, -31, -18, -14, 14, 18, 31, 33] {
            let from = sq + offset;
            if Self::is_on_board(from) && self.board[from as usize] == (by_color | KNIGHT) {
                return true;
            }
        }

        // King attacks
        for &offset in &[-17i8, -16, -15, -1, 1, 15, 16, 17] {
            let from = sq + offset;
            if Self::is_on_board(from) && self.board[from as usize] == (by_color | KING) {
                return true;
            }
        }

        // Bishop/Queen diagonals
        for &offset in &[-17i8, -15, 15, 17] {
            let mut s = sq + offset;
            while Self::is_on_board(s) {
                let p = self.board[s as usize];
                if p != EMPTY {
                    if Self::piece_color(p) == by_color {
                        let t = Self::piece_type(p);
                        if t == BISHOP || t == QUEEN { return true; }
                    }
                    break;
                }
                s += offset;
            }
        }

        // Rook/Queen straights
        for &offset in &[-16i8, -1, 1, 16] {
            let mut s = sq + offset;
            while Self::is_on_board(s) {
                let p = self.board[s as usize];
                if p != EMPTY {
                    if Self::piece_color(p) == by_color {
                        let t = Self::piece_type(p);
                        if t == ROOK || t == QUEEN { return true; }
                    }
                    break;
                }
                s += offset;
            }
        }

        false
    }

    pub fn in_check(&self) -> bool {
        let king_sq = self.find_king(self.turn);
        if king_sq < 0 { return false; }
        let enemy = if self.turn == WHITE { BLACK } else { WHITE };
        self.is_attacked(king_sq, enemy)
    }

    pub fn generate_pseudo_moves(&self) -> Vec<Move> {
        let mut moves = Vec::with_capacity(64);
        let color = self.turn;
        let enemy = if color == WHITE { BLACK } else { WHITE };

        for sq in 0..128u8 {
            if sq & 0x88 != 0 { continue; }
            let piece = self.board[sq as usize];
            if piece == EMPTY || Self::piece_color(piece) != color { continue; }
            let ptype = Self::piece_type(piece);

            match ptype {
                PAWN => self.gen_pawn_moves(sq, color, enemy, &mut moves),
                KNIGHT => self.gen_knight_moves(sq, enemy, &mut moves),
                KING => self.gen_king_moves(sq, color, enemy, &mut moves),
                BISHOP => self.gen_sliding_moves(sq, enemy, &[-17i8, -15, 15, 17], &mut moves),
                ROOK => self.gen_sliding_moves(sq, enemy, &[-16i8, -1, 1, 16], &mut moves),
                QUEEN => self.gen_sliding_moves(sq, enemy, &[-17i8, -16, -15, -1, 1, 15, 16, 17], &mut moves),
                _ => {}
            }
        }
        moves
    }

    fn gen_pawn_moves(&self, sq: u8, color: u8, enemy: u8, moves: &mut Vec<Move>) {
        let dir: i8 = if color == WHITE { 16 } else { -16 };
        let start_rank: u8 = if color == WHITE { 1 } else { 6 };
        let promo_rank: u8 = if color == WHITE { 7 } else { 0 };

        let one = (sq as i8) + dir;
        if Self::is_on_board(one) && self.board[one as usize] == EMPTY {
            if Self::rank_of(one as u8) == promo_rank {
                for flag in &[MoveFlag::PromoteQueen, MoveFlag::PromoteRook, MoveFlag::PromoteBishop, MoveFlag::PromoteKnight] {
                    moves.push(Move { from: sq, to: one as u8, flag: *flag });
                }
            } else {
                moves.push(Move { from: sq, to: one as u8, flag: MoveFlag::Normal });
                if Self::rank_of(sq) == start_rank {
                    let two = (sq as i8) + dir * 2;
                    if self.board[two as usize] == EMPTY {
                        moves.push(Move { from: sq, to: two as u8, flag: MoveFlag::DoublePush });
                    }
                }
            }
        }

        for &fd in &[-1i8, 1] {
            let cap = (sq as i8) + dir + fd;
            if !Self::is_on_board(cap) { continue; }
            let target = self.board[cap as usize];
            if target != EMPTY && Self::piece_color(target) == enemy {
                if Self::rank_of(cap as u8) == promo_rank {
                    for flag in &[MoveFlag::PromoteQueen, MoveFlag::PromoteRook, MoveFlag::PromoteBishop, MoveFlag::PromoteKnight] {
                        moves.push(Move { from: sq, to: cap as u8, flag: *flag });
                    }
                } else {
                    moves.push(Move { from: sq, to: cap as u8, flag: MoveFlag::Normal });
                }
            }
            if cap == self.en_passant as i8 {
                moves.push(Move { from: sq, to: cap as u8, flag: MoveFlag::EnPassant });
            }
        }
    }

    fn gen_knight_moves(&self, sq: u8, enemy: u8, moves: &mut Vec<Move>) {
        for &offset in &[-33i8, -31, -18, -14, 14, 18, 31, 33] {
            let to = (sq as i8) + offset;
            if !Self::is_on_board(to) { continue; }
            let target = self.board[to as usize];
            if target == EMPTY || Self::piece_color(target) == enemy {
                moves.push(Move { from: sq, to: to as u8, flag: MoveFlag::Normal });
            }
        }
    }

    fn gen_king_moves(&self, sq: u8, color: u8, enemy: u8, moves: &mut Vec<Move>) {
        for &offset in &[-17i8, -16, -15, -1, 1, 15, 16, 17] {
            let to = (sq as i8) + offset;
            if !Self::is_on_board(to) { continue; }
            let target = self.board[to as usize];
            if target == EMPTY || Self::piece_color(target) == enemy {
                moves.push(Move { from: sq, to: to as u8, flag: MoveFlag::Normal });
            }
        }

        // Castling
        if color == WHITE {
            if self.castling & CASTLE_WK != 0
                && self.board[5] == EMPTY && self.board[6] == EMPTY
                && !self.is_attacked(4, BLACK) && !self.is_attacked(5, BLACK) && !self.is_attacked(6, BLACK)
            {
                moves.push(Move { from: sq, to: 6, flag: MoveFlag::CastleKing });
            }
            if self.castling & CASTLE_WQ != 0
                && self.board[3] == EMPTY && self.board[2] == EMPTY && self.board[1] == EMPTY
                && !self.is_attacked(4, BLACK) && !self.is_attacked(3, BLACK) && !self.is_attacked(2, BLACK)
            {
                moves.push(Move { from: sq, to: 2, flag: MoveFlag::CastleQueen });
            }
        } else {
            if self.castling & CASTLE_BK != 0
                && self.board[0x75] == EMPTY && self.board[0x76] == EMPTY
                && !self.is_attacked(0x74, WHITE) && !self.is_attacked(0x75, WHITE) && !self.is_attacked(0x76, WHITE)
            {
                moves.push(Move { from: sq, to: 0x76, flag: MoveFlag::CastleKing });
            }
            if self.castling & CASTLE_BQ != 0
                && self.board[0x73] == EMPTY && self.board[0x72] == EMPTY && self.board[0x71] == EMPTY
                && !self.is_attacked(0x74, WHITE) && !self.is_attacked(0x73, WHITE) && !self.is_attacked(0x72, WHITE)
            {
                moves.push(Move { from: sq, to: 0x72, flag: MoveFlag::CastleQueen });
            }
        }
    }

    fn gen_sliding_moves(&self, sq: u8, enemy: u8, offsets: &[i8], moves: &mut Vec<Move>) {
        for &offset in offsets {
            let mut to = (sq as i8) + offset;
            while Self::is_on_board(to) {
                let target = self.board[to as usize];
                if target == EMPTY {
                    moves.push(Move { from: sq, to: to as u8, flag: MoveFlag::Normal });
                } else {
                    if Self::piece_color(target) == enemy {
                        moves.push(Move { from: sq, to: to as u8, flag: MoveFlag::Normal });
                    }
                    break;
                }
                to += offset;
            }
        }
    }

    pub fn generate_legal_moves(&mut self) -> Vec<Move> {
        let pseudo = self.generate_pseudo_moves();
        let color = self.turn;
        let enemy = if color == WHITE { BLACK } else { WHITE };
        let mut legal = Vec::with_capacity(pseudo.len());

        for m in pseudo {
            let undo = self.make_move(m);
            if !self.is_attacked(self.find_king(color), enemy) {
                legal.push(m);
            }
            self.undo_move(undo);
        }
        legal
    }

    pub fn make_move(&mut self, m: Move) -> UndoInfo {
        let undo = UndoInfo {
            from: m.from,
            to: m.to,
            flag: m.flag,
            captured: self.board[m.to as usize],
            castling: self.castling,
            en_passant: self.en_passant,
            halfmove_clock: self.halfmove_clock,
        };

        let piece = self.board[m.from as usize];
        let color = Self::piece_color(piece);
        let ptype = Self::piece_type(piece);

        self.board[m.to as usize] = piece;
        self.board[m.from as usize] = EMPTY;

        match m.flag {
            MoveFlag::EnPassant => {
                let cap_sq = if color == WHITE {
                    (m.to as i8 - 16) as usize
                } else {
                    (m.to as i8 + 16) as usize
                };
                self.board[cap_sq] = EMPTY;
            }
            MoveFlag::DoublePush => {
                self.en_passant = if color == WHITE {
                    m.from as i8 + 16
                } else {
                    m.from as i8 - 16
                };
            }
            MoveFlag::CastleKing => {
                if color == WHITE {
                    self.board[5] = self.board[7]; self.board[7] = EMPTY;
                } else {
                    self.board[0x75] = self.board[0x77]; self.board[0x77] = EMPTY;
                }
            }
            MoveFlag::CastleQueen => {
                if color == WHITE {
                    self.board[3] = self.board[0]; self.board[0] = EMPTY;
                } else {
                    self.board[0x73] = self.board[0x70]; self.board[0x70] = EMPTY;
                }
            }
            MoveFlag::PromoteQueen => { self.board[m.to as usize] = color | QUEEN; }
            MoveFlag::PromoteRook => { self.board[m.to as usize] = color | ROOK; }
            MoveFlag::PromoteBishop => { self.board[m.to as usize] = color | BISHOP; }
            MoveFlag::PromoteKnight => { self.board[m.to as usize] = color | KNIGHT; }
            _ => {}
        }

        if m.flag != MoveFlag::DoublePush {
            self.en_passant = -1;
        }

        // Update castling rights
        if ptype == KING {
            if color == WHITE { self.castling &= !(CASTLE_WK | CASTLE_WQ); }
            else { self.castling &= !(CASTLE_BK | CASTLE_BQ); }
        }
        if ptype == ROOK {
            match m.from {
                0 => self.castling &= !CASTLE_WQ,
                7 => self.castling &= !CASTLE_WK,
                0x70 => self.castling &= !CASTLE_BQ,
                0x77 => self.castling &= !CASTLE_BK,
                _ => {}
            }
        }
        match m.to {
            0 => self.castling &= !CASTLE_WQ,
            7 => self.castling &= !CASTLE_WK,
            0x70 => self.castling &= !CASTLE_BQ,
            0x77 => self.castling &= !CASTLE_BK,
            _ => {}
        }

        if ptype == PAWN || undo.captured != EMPTY {
            self.halfmove_clock = 0;
        } else {
            self.halfmove_clock += 1;
        }
        if color == BLACK { self.fullmove_number += 1; }

        self.turn = if self.turn == WHITE { BLACK } else { WHITE };
        undo
    }

    pub fn undo_move(&mut self, undo: UndoInfo) {
        self.turn = if self.turn == WHITE { BLACK } else { WHITE };
        let color = self.turn;

        let piece = self.board[undo.to as usize];

        // Undo promotion
        match undo.flag {
            MoveFlag::PromoteQueen | MoveFlag::PromoteRook | MoveFlag::PromoteBishop | MoveFlag::PromoteKnight => {
                self.board[undo.from as usize] = Self::piece_color(piece) | PAWN;
            }
            _ => {
                self.board[undo.from as usize] = piece;
            }
        }
        self.board[undo.to as usize] = undo.captured;

        if undo.flag == MoveFlag::EnPassant {
            let cap_sq = if color == WHITE {
                (undo.to as i8 - 16) as usize
            } else {
                (undo.to as i8 + 16) as usize
            };
            let enemy = if color == WHITE { BLACK } else { WHITE };
            self.board[cap_sq] = enemy | PAWN;
        }

        match undo.flag {
            MoveFlag::CastleKing => {
                if color == WHITE {
                    self.board[7] = self.board[5]; self.board[5] = EMPTY;
                } else {
                    self.board[0x77] = self.board[0x75]; self.board[0x75] = EMPTY;
                }
            }
            MoveFlag::CastleQueen => {
                if color == WHITE {
                    self.board[0] = self.board[3]; self.board[3] = EMPTY;
                } else {
                    self.board[0x70] = self.board[0x73]; self.board[0x73] = EMPTY;
                }
            }
            _ => {}
        }

        self.castling = undo.castling;
        self.en_passant = undo.en_passant;
        self.halfmove_clock = undo.halfmove_clock;
        if color == BLACK { self.fullmove_number -= 1; }
    }
}
