# Cave Chess

A local-first chess engine with a browser-based UI, a Rust engine core (compilable to native binary and WebAssembly), an NNUE training pipeline, and a Lichess bot integration.

## Project Structure

```
public/             Web UI (static site, deployed on Netlify)
  index.html        Main page
  css/style.css     Dark-themed responsive styles
  js/chess.js       Chess logic (0x88 board, full rules, FEN, SAN)
  js/engine.js      AI engine (alpha-beta, iterative deepening, PST eval)
  js/app.js         UI controller (board rendering, move interaction, settings)

rust-engine/        Rust chess engine (native + WASM target)
  src/board.rs      Board representation and move generation
  src/eval.rs       Material + piece-square table evaluation
  src/search.rs     Alpha-beta search with quiescence
  src/uci.rs        UCI protocol for GUI/bot interop
  src/main.rs       CLI entry point
  src/lib.rs        Library entry point (WASM target)

training/           NNUE weight training pipeline (Python + PyTorch)
  train.py          Training script (HalfKP features, 256->32 hidden layers)
  requirements.txt  Python dependencies

lichess-bot/        Lichess Bot API client
  lichess_bot.py    Bot runner (UCI engine subprocess, challenge handling)
  requirements.txt  Python dependencies
```

## Web UI

The browser UI is a fully playable chess application that deploys as a static site on Netlify.

### Features

- Complete chess rules: castling, en passant, pawn promotion, check/checkmate/stalemate, draw by repetition, fifty-move rule, insufficient material
- Five difficulty levels: Beginner (~800 ELO), Easy (~1000), Medium (~1200), Hard (~1400), Expert (~1600)
- Play as White or Black
- Move history panel and captured pieces display
- Legal move indicators and last-move/check highlighting
- Undo moves, flip board, start new game
- Keyboard shortcuts: `Ctrl+Z` (undo), `F` (flip board), `N` (new game)
- Responsive layout for desktop and mobile

### Deploy to Netlify

The site deploys directly from the `public/` directory. The included `netlify.toml` handles publish configuration and WASM content-type headers.

To deploy, connect this repository to a Netlify site. No build step is required — the static files in `public/` are served as-is.

## Rust Engine

The Rust engine mirrors the JavaScript implementation and can be compiled to both a native binary and WebAssembly.

### Prerequisites

- [Rust toolchain](https://rustup.rs/) (rustup + cargo)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (for WASM compilation)

### Build (native)

```bash
cd rust-engine
cargo build --release
```

The binary is output to `rust-engine/target/release/cave-chess`. It speaks the UCI protocol and can be used with any UCI-compatible chess GUI.

### Build (WebAssembly)

```bash
cd rust-engine
wasm-pack build --target web --release
```

The resulting WASM package can replace the JavaScript engine in the browser UI for better performance.

### UCI Usage

```bash
./target/release/cave-chess
```

Standard UCI commands are supported: `uci`, `isready`, `position`, `go`, `ucinewgame`, `quit`.

## NNUE Training Pipeline

Train custom NNUE evaluation weights using self-play data. The target architecture uses HalfKP input features with two hidden layers (256 and 32 neurons).

### Prerequisites

- Python 3.10+
- PyTorch 2.0+

### Setup

```bash
cd training
pip install -r requirements.txt
```

### Training Workflow

1. **Generate self-play data** using the native Rust engine:
   ```bash
   ./rust-engine/target/release/cave-chess selfplay --games 50000 --depth 8 --output training_data.bin
   ```

2. **Train weights** from the generated data:
   ```bash
   cd training
   python train.py --data training_data.bin --output weights.nnue
   ```

3. **Evaluate improvement** by playing new weights against old ones:
   ```bash
   ./rust-engine/target/release/cave-chess evaluate --new-weights weights.nnue --games 500
   ```

Repeat until the desired ELO target is reached. For a ~1200 ELO target, 3-5 training cycles are typically sufficient. Each cycle takes a few hours of unattended compute on a modern multi-core CPU. A GPU is optional but speeds up the weight optimization step.

## Lichess Bot

Run the engine as a bot on Lichess from a home server.

### Prerequisites

- Python 3.10+
- A [Lichess bot account](https://lichess.org/api#tag/Bot) and API token
- The native Rust engine binary (see build instructions above)

### Setup

```bash
cd lichess-bot
pip install -r requirements.txt
```

### Run

Set the `LICHESS_API_TOKEN` environment variable and start the bot:

```bash
export LICHESS_API_TOKEN=your_token_here
python lichess_bot.py --engine ../rust-engine/target/release/cave-chess
```

The bot accepts challenges, manages games, and handles time control automatically.

## License

CC0 1.0 Universal — see [LICENSE](LICENSE) for details.
