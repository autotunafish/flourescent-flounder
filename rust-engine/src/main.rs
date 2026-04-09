/// Main binary entry point — runs the UCI protocol loop
/// Build with: cargo build --release
/// Run with: ./target/release/cave-chess

mod board;
mod eval;
mod search;
mod uci;

fn main() {
    uci::uci_loop();
}
