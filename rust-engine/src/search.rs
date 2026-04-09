/// Alpha-beta search with iterative deepening and quiescence

use crate::board::*;
use crate::eval::{evaluate, PIECE_VALUES};

const INF: i32 = 999_999;

pub struct SearchResult {
    pub best_move: Option<Move>,
    pub score: i32,
    pub nodes: u64,
    pub depth: u8,
}

pub struct SearchEngine {
    pub nodes: u64,
    pub max_depth: u8,
    aborted: bool,
    best_move: Option<Move>,
}

impl SearchEngine {
    pub fn new() -> Self {
        SearchEngine {
            nodes: 0,
            max_depth: 4,
            aborted: false,
            best_move: None,
        }
    }

    pub fn search(&mut self, pos: &mut Position, max_depth: u8) -> SearchResult {
        self.nodes = 0;
        self.aborted = false;
        self.best_move = None;

        let mut best_score = 0;
        let mut best_move_overall = None;

        for depth in 1..=max_depth {
            self.max_depth = depth;
            let score = self.alpha_beta(pos, depth as i32, -INF, INF, true);

            if self.aborted { break; }

            best_score = score;
            best_move_overall = self.best_move;

            if best_score.abs() > INF - 100 { break; }
        }

        SearchResult {
            best_move: best_move_overall,
            score: best_score,
            nodes: self.nodes,
            depth: max_depth,
        }
    }

    fn alpha_beta(&mut self, pos: &mut Position, depth: i32, mut alpha: i32, beta: i32, is_root: bool) -> i32 {
        self.nodes += 1;

        if depth <= 0 {
            return self.quiescence(pos, alpha, beta);
        }

        let mut moves = pos.generate_legal_moves();
        if moves.is_empty() {
            if pos.in_check() {
                return -INF + (self.max_depth as i32 - depth);
            }
            return 0; // Stalemate
        }

        // Move ordering: captures first (MVV-LVA)
        moves.sort_by(|a, b| {
            let score_b = self.move_score(pos, *b);
            let score_a = self.move_score(pos, *a);
            score_b.cmp(&score_a)
        });

        let mut best_move = moves[0];

        for m in &moves {
            let undo = pos.make_move(*m);
            let score = -self.alpha_beta(pos, depth - 1, -beta, -alpha, false);
            pos.undo_move(undo);

            if score > alpha {
                alpha = score;
                best_move = *m;
                if alpha >= beta { break; }
            }
        }

        if is_root {
            self.best_move = Some(best_move);
        }
        alpha
    }

    fn quiescence(&mut self, pos: &mut Position, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;

        let stand_pat = evaluate(pos);
        if stand_pat >= beta { return beta; }
        if stand_pat > alpha { alpha = stand_pat; }

        let moves = pos.generate_legal_moves();
        let captures: Vec<Move> = moves.into_iter().filter(|m| {
            pos.board[m.to as usize] != EMPTY
                || m.flag == MoveFlag::EnPassant
                || matches!(m.flag, MoveFlag::PromoteQueen | MoveFlag::PromoteRook | MoveFlag::PromoteBishop | MoveFlag::PromoteKnight)
        }).collect();

        for m in &captures {
            let undo = pos.make_move(*m);
            let score = -self.quiescence(pos, -beta, -alpha);
            pos.undo_move(undo);

            if score >= beta { return beta; }
            if score > alpha { alpha = score; }
        }

        alpha
    }

    fn move_score(&self, pos: &Position, m: Move) -> i32 {
        let captured = pos.board[m.to as usize];
        if captured != EMPTY {
            let victim = PIECE_VALUES[Position::piece_type(captured) as usize];
            let attacker = PIECE_VALUES[Position::piece_type(pos.board[m.from as usize]) as usize];
            return 10 * victim - attacker;
        }
        match m.flag {
            MoveFlag::PromoteQueen => 900,
            MoveFlag::EnPassant => 100,
            _ => 0,
        }
    }
}
