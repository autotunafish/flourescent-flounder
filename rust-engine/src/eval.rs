/// Evaluation function — material + piece-square tables
/// This is the placeholder evaluation that will be replaced by NNUE inference
/// once weights are trained.

use crate::board::*;

/// Piece values in centipawns
pub const PIECE_VALUES: [i32; 7] = [
    0,    // EMPTY
    100,  // PAWN
    320,  // KNIGHT
    330,  // BISHOP
    500,  // ROOK
    900,  // QUEEN
    20000, // KING
];

/// Piece-square tables — indexed [piece_type][square_index]
/// square_index = (7 - rank) * 8 + file for White, rank * 8 + file for Black
pub static PST_PAWN: [i32; 64] = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
];

pub static PST_KNIGHT: [i32; 64] = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
];

pub static PST_BISHOP: [i32; 64] = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
];

pub static PST_ROOK: [i32; 64] = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
];

pub static PST_QUEEN: [i32; 64] = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
];

pub static PST_KING_MG: [i32; 64] = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
];

pub static PST_KING_EG: [i32; 64] = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
];

fn pst_index(sq: u8, color: u8) -> usize {
    let file = Position::file_of(sq) as usize;
    let rank = Position::rank_of(sq) as usize;
    let row = if color == WHITE { 7 - rank } else { rank };
    row * 8 + file
}

fn get_pst(piece_type: u8) -> &'static [i32; 64] {
    match piece_type {
        PAWN => &PST_PAWN,
        KNIGHT => &PST_KNIGHT,
        BISHOP => &PST_BISHOP,
        ROOK => &PST_ROOK,
        QUEEN => &PST_QUEEN,
        _ => &PST_KING_MG,
    }
}

/// Evaluate position from the side to move's perspective (centipawns)
pub fn evaluate(pos: &Position) -> i32 {
    let mut score: i32 = 0;
    let mut total_material: i32 = 0;

    for sq in 0..128u8 {
        if sq & 0x88 != 0 { continue; }
        let piece = pos.board[sq as usize];
        if piece == EMPTY { continue; }

        let ptype = Position::piece_type(piece);
        let color = Position::piece_color(piece);
        let sign: i32 = if color == WHITE { 1 } else { -1 };
        let mat = PIECE_VALUES[ptype as usize];

        if ptype != KING { total_material += mat; }

        score += sign * mat;

        let idx = pst_index(sq, color);
        if ptype == KING {
            let phase = (total_material.min(6200) as f32) / 6200.0;
            let mg = PST_KING_MG[idx] as f32;
            let eg = PST_KING_EG[idx] as f32;
            score += sign * (mg * phase + eg * (1.0 - phase)) as i32;
        } else {
            score += sign * get_pst(ptype)[idx];
        }
    }

    if pos.turn == WHITE { score } else { -score }
}
