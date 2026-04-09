/// Cave Chess Engine — Rust core
///
/// Architecture:
/// - 0x88 board representation (matches the JS engine for consistency)
/// - Alpha-beta search with iterative deepening
/// - NNUE evaluation (placeholder — uses material + PST until weights are trained)
/// - Compiles to both native binary and WebAssembly
///
/// Modules:
/// - board: Board representation, move generation
/// - search: Alpha-beta search, quiescence, move ordering
/// - eval: Evaluation function (material + PST, future NNUE)
/// - nnue: NNUE network inference (incremental updates)
/// - uci: UCI protocol for external GUIs and Lichess bot

pub mod board;
pub mod eval;
pub mod search;
pub mod uci;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
