/// UCI protocol implementation for external GUI and Lichess bot integration
///
/// UCI (Universal Chess Interface) is the standard protocol for chess engines.
/// This allows the engine to work with:
/// - Chess GUIs (Arena, CuteChess, etc.)
/// - Lichess bot framework (lichess-bot)

use std::io::{self, BufRead, Write};
use crate::board::Position;
use crate::search::SearchEngine;

pub fn uci_loop() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut pos = Position::start_position();
    let mut engine = SearchEngine::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.is_empty() { continue; }

        match tokens[0] {
            "uci" => {
                writeln!(stdout, "id name CaveChess 0.1.0").unwrap();
                writeln!(stdout, "id author CaveChess").unwrap();
                writeln!(stdout, "option name Depth type spin default 4 min 1 max 10").unwrap();
                writeln!(stdout, "uciok").unwrap();
                stdout.flush().unwrap();
            }
            "isready" => {
                writeln!(stdout, "readyok").unwrap();
                stdout.flush().unwrap();
            }
            "ucinewgame" => {
                pos = Position::start_position();
            }
            "position" => {
                parse_position(&tokens, &mut pos);
            }
            "go" => {
                let depth = parse_go_depth(&tokens).unwrap_or(4);
                let result = engine.search(&mut pos, depth);
                if let Some(m) = result.best_move {
                    let from = square_name(m.from);
                    let to = square_name(m.to);
                    let promo = match m.flag {
                        crate::board::MoveFlag::PromoteQueen => "q",
                        crate::board::MoveFlag::PromoteRook => "r",
                        crate::board::MoveFlag::PromoteBishop => "b",
                        crate::board::MoveFlag::PromoteKnight => "n",
                        _ => "",
                    };
                    writeln!(stdout, "info depth {} score cp {} nodes {}",
                             result.depth, result.score, result.nodes).unwrap();
                    writeln!(stdout, "bestmove {}{}{}", from, to, promo).unwrap();
                } else {
                    writeln!(stdout, "bestmove 0000").unwrap();
                }
                stdout.flush().unwrap();
            }
            "quit" => break,
            _ => {}
        }
    }
}

fn square_name(sq: u8) -> String {
    let file = (b'a' + (sq & 7)) as char;
    let rank = (b'1' + (sq >> 4)) as char;
    format!("{}{}", file, rank)
}

fn parse_square(s: &str) -> u8 {
    let bytes = s.as_bytes();
    let file = bytes[0] - b'a';
    let rank = bytes[1] - b'1';
    rank * 16 + file
}

fn parse_position(tokens: &[&str], pos: &mut Position) {
    let mut idx = 1;
    if idx < tokens.len() && tokens[idx] == "startpos" {
        *pos = Position::start_position();
        idx += 1;
    } else if idx < tokens.len() && tokens[idx] == "fen" {
        idx += 1;
        let fen_parts: Vec<&str> = tokens[idx..].iter().take_while(|&&t| t != "moves").copied().collect();
        let fen = fen_parts.join(" ");
        *pos = Position::from_fen(&fen);
        idx += fen_parts.len();
    }

    if idx < tokens.len() && tokens[idx] == "moves" {
        idx += 1;
        while idx < tokens.len() {
            let move_str = tokens[idx];
            let from = parse_square(&move_str[0..2]);
            let to = parse_square(&move_str[2..4]);
            let promo = if move_str.len() > 4 { Some(move_str.as_bytes()[4]) } else { None };

            let legal = pos.generate_legal_moves();
            for m in legal {
                if m.from == from && m.to == to {
                    let flag_matches = match promo {
                        Some(b'q') => m.flag == crate::board::MoveFlag::PromoteQueen,
                        Some(b'r') => m.flag == crate::board::MoveFlag::PromoteRook,
                        Some(b'b') => m.flag == crate::board::MoveFlag::PromoteBishop,
                        Some(b'n') => m.flag == crate::board::MoveFlag::PromoteKnight,
                        None => !matches!(m.flag,
                            crate::board::MoveFlag::PromoteQueen |
                            crate::board::MoveFlag::PromoteRook |
                            crate::board::MoveFlag::PromoteBishop |
                            crate::board::MoveFlag::PromoteKnight
                        ),
                        _ => false,
                    };
                    if flag_matches {
                        pos.make_move(m);
                        break;
                    }
                }
            }
            idx += 1;
        }
    }
}

fn parse_go_depth(tokens: &[&str]) -> Option<u8> {
    for i in 0..tokens.len() - 1 {
        if tokens[i] == "depth" {
            return tokens[i + 1].parse().ok();
        }
    }
    None
}
