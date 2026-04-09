# Lichess Bot Configuration for Cave Chess Engine
#
# Prerequisites:
# 1. Create a Lichess bot account: https://lichess.org/api#tag/Bot
# 2. Generate a personal API token with bot:play scope
# 3. Set LICHESS_TOKEN environment variable
# 4. Build the engine: cd rust-engine && cargo build --release
#
# Usage:
#   pip install berserk
#   python lichess_bot.py

"""
Lichess Bot — connects Cave Chess engine to Lichess Bot API

The bot:
- Accepts challenges (configurable filters)
- Plays games using the native Rust engine binary
- Manages time control (allocates search time based on remaining time)
- Handles all game lifecycle events (challenge, move, end)

Runs on home server — needs persistent connection.
"""

import os
import sys
import subprocess
import threading
import time

try:
    import berserk
except ImportError:
    print("Install berserk: pip install berserk")
    sys.exit(1)


# --- Configuration ---

ENGINE_PATH = os.environ.get("CAVE_CHESS_ENGINE", "../rust-engine/target/release/cave-chess")
LICHESS_TOKEN = os.environ.get("LICHESS_TOKEN", "")

# Challenge acceptance filters
ACCEPT_VARIANTS = {"standard"}
ACCEPT_TIME_CONTROLS = {"bullet", "blitz", "rapid", "classical", "correspondence"}
MAX_CONCURRENT_GAMES = 1


class UCIEngine:
    """Communicates with the Rust engine via UCI protocol."""

    def __init__(self, path):
        self.process = subprocess.Popen(
            [path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self._send("uci")
        self._wait_for("uciok")
        self._send("isready")
        self._wait_for("readyok")

    def _send(self, cmd):
        self.process.stdin.write(cmd + "\n")
        self.process.stdin.flush()

    def _wait_for(self, token):
        while True:
            line = self.process.stdout.readline().strip()
            if token in line:
                return line
        return ""

    def new_game(self):
        self._send("ucinewgame")
        self._send("isready")
        self._wait_for("readyok")

    def search(self, fen=None, moves=None, depth=None, movetime=None):
        if fen:
            cmd = f"position fen {fen}"
        else:
            cmd = "position startpos"
        if moves:
            cmd += f" moves {' '.join(moves)}"
        self._send(cmd)

        go_cmd = "go"
        if depth:
            go_cmd += f" depth {depth}"
        elif movetime:
            go_cmd += f" movetime {movetime}"
        else:
            go_cmd += " depth 4"
        self._send(go_cmd)

        result = self._wait_for("bestmove")
        return result.split()[1]  # "bestmove e2e4" -> "e2e4"

    def quit(self):
        self._send("quit")
        self.process.wait()


class LichessBot:
    """Main bot controller."""

    def __init__(self):
        if not LICHESS_TOKEN:
            print("Error: Set LICHESS_TOKEN environment variable")
            sys.exit(1)

        session = berserk.TokenSession(LICHESS_TOKEN)
        self.client = berserk.Client(session)
        self.active_games = {}

    def run(self):
        print("Cave Chess Lichess Bot starting...")
        account = self.client.account.get()
        print(f"Logged in as: {account['username']}")

        # Event stream — listens for challenges and game starts
        for event in self.client.bots.stream_incoming_events():
            event_type = event.get("type")

            if event_type == "challenge":
                self.handle_challenge(event["challenge"])
            elif event_type == "gameStart":
                game_id = event["game"]["gameId"]
                if len(self.active_games) < MAX_CONCURRENT_GAMES:
                    t = threading.Thread(target=self.play_game, args=(game_id,), daemon=True)
                    t.start()
                    self.active_games[game_id] = t

    def handle_challenge(self, challenge):
        variant = challenge.get("variant", {}).get("key", "")
        speed = challenge.get("speed", "")

        if variant not in ACCEPT_VARIANTS or speed not in ACCEPT_TIME_CONTROLS:
            self.client.bots.decline_challenge(challenge["id"])
            print(f"Declined challenge {challenge['id']} ({variant}, {speed})")
            return

        if len(self.active_games) >= MAX_CONCURRENT_GAMES:
            self.client.bots.decline_challenge(challenge["id"])
            print(f"Declined challenge {challenge['id']} (max games reached)")
            return

        self.client.bots.accept_challenge(challenge["id"])
        print(f"Accepted challenge {challenge['id']}")

    def play_game(self, game_id):
        print(f"Game {game_id} starting...")
        engine = UCIEngine(ENGINE_PATH)
        engine.new_game()
        moves = []

        try:
            for event in self.client.bots.stream_game_state(game_id):
                event_type = event.get("type")

                if event_type == "gameFull":
                    # Initial game state
                    my_color = "white" if event.get("white", {}).get("id") == self.client.account.get()["id"].lower() else "black"
                    state = event.get("state", {})
                    moves_str = state.get("moves", "")
                    moves = moves_str.split() if moves_str else []

                    # Check if it's our turn
                    is_white_turn = len(moves) % 2 == 0
                    is_my_turn = (is_white_turn and my_color == "white") or (not is_white_turn and my_color == "black")

                    if is_my_turn:
                        wtime = state.get("wtime", 60000)
                        btime = state.get("btime", 60000)
                        my_time = wtime if my_color == "white" else btime
                        move_time = self.calculate_move_time(my_time, len(moves))
                        best_move = engine.search(moves=moves if moves else None, movetime=move_time)
                        self.client.bots.make_move(game_id, best_move)

                elif event_type == "gameState":
                    moves_str = event.get("moves", "")
                    moves = moves_str.split() if moves_str else []
                    status = event.get("status", "")

                    if status != "started":
                        print(f"Game {game_id} ended: {status}")
                        break

                    is_white_turn = len(moves) % 2 == 0
                    is_my_turn = (is_white_turn and my_color == "white") or (not is_white_turn and my_color == "black")

                    if is_my_turn:
                        wtime = event.get("wtime", 60000)
                        btime = event.get("btime", 60000)
                        my_time = wtime if my_color == "white" else btime
                        move_time = self.calculate_move_time(my_time, len(moves))
                        best_move = engine.search(moves=moves, movetime=move_time)
                        self.client.bots.make_move(game_id, best_move)

        except Exception as e:
            print(f"Game {game_id} error: {e}")
        finally:
            engine.quit()
            self.active_games.pop(game_id, None)
            print(f"Game {game_id} finished")

    def calculate_move_time(self, remaining_ms, move_count):
        """Simple time management — allocate fraction of remaining time."""
        moves_left = max(20, 40 - move_count // 2)
        return max(500, remaining_ms // moves_left)


if __name__ == "__main__":
    bot = LichessBot()
    bot.run()
