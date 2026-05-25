# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
import typing
from typing import Any, Dict, List


SHAPES = ["TRIANGLE", "CIRCLE", "SQUARE", "CROSS", "STAR"]
MAX_PLAYERS = 500
TOTAL_ROUNDS = 10
CORRECT_POINTS = 10
SPEED_BONUS_POINTS = 5
SPEED_BONUS_WINDOW = 10
SUSPICIOUS_STREAK = 3
CHEAT_STREAK = 4
ROUND_DURATION_MS = 30_000
INTERMISSION_MS = 5_000


@dataclass
class Player:
    username: str
    points: int = 0
    current_streak: int = 0
    is_removed: bool = False
    is_suspicious: bool = False


@dataclass
class Guess:
    guessed_shape: str
    guess_timestamp: int


@dataclass
class Room:
    room_code: str
    host: str
    players: List[Player] = field(default_factory=list)
    game_status: str = "waiting"
    current_round: int = 0
    round_sequence: List[str] = field(default_factory=list)
    current_cat_map: Dict[str, str] = field(default_factory=dict)
    round_start_time: int = 0
    player_guesses: Dict[str, Guess] = field(default_factory=dict)
    response_times: Dict[str, List[float]] = field(default_factory=dict)
    round_phase: str = "idle"
    round_revealed: bool = False
    last_reveal_at: int = 0
    pending_round_number: int = 0
    pending_cat_map: Dict[str, str] = field(default_factory=dict)
    pending_round_start_time: int = 0
    podium: List[str] = field(default_factory=list)


class FlipIt(gl.Contract):
    rooms: TreeMap[str, str]
    relayer_address: Address
    entropy_nonce: bigint

    def __init__(self):
        # Bind the authorized relayer to the actual deployer address seen by GenVM.
        self.relayer_address = gl.message.sender_address
        self.entropy_nonce = 0

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _normalize_address(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _normalize_room_code(self, value: str) -> str:
        room_code = str(value or "").strip().upper()
        if len(room_code) >= 2 and room_code[0] == room_code[-1] and room_code[0] in ("'", '"'):
            room_code = room_code[1:-1].strip()
        return room_code

    def _normalize_username(self, value: str) -> str:
        return str(value or "").strip()

    def _player_key(self, username: str) -> str:
        return self._normalize_username(username).lower()

    def _require_relayer(self) -> None:
        caller = self._normalize_address(gl.message.sender_address)
        origin = self._normalize_address(getattr(gl.message, "origin_address", ""))
        expected = self._normalize_address(self.relayer_address)
        assert caller == expected or origin == expected, "Relayer only"

    def _serialize_room(self, room: Room) -> str:
        return json.dumps(asdict(room), separators=(",", ":"))

    def _deserialize_room(self, raw: str) -> Room:
        payload = json.loads(raw)
        players = [Player(**player) for player in payload.get("players", [])]
        guesses = {
            key: Guess(**guess)
            for key, guess in payload.get("player_guesses", {}).items()
        }
        return Room(
            room_code=payload.get("room_code", ""),
            host=payload.get("host", ""),
            players=players,
            game_status=payload.get("game_status", "waiting"),
            current_round=int(payload.get("current_round", 0)),
            round_sequence=list(payload.get("round_sequence", [])),
            current_cat_map=dict(payload.get("current_cat_map", {})),
            round_start_time=int(payload.get("round_start_time", 0)),
            player_guesses=guesses,
            response_times={
                key: [float(item) for item in values]
                for key, values in payload.get("response_times", {}).items()
            },
            round_phase=payload.get("round_phase", "idle"),
            round_revealed=bool(payload.get("round_revealed", False)),
            last_reveal_at=int(payload.get("last_reveal_at", 0)),
            pending_round_number=int(payload.get("pending_round_number", 0)),
            pending_cat_map=dict(payload.get("pending_cat_map", {})),
            pending_round_start_time=int(payload.get("pending_round_start_time", 0)),
            podium=list(payload.get("podium", [])),
        )

    def _save_room(self, room: Room) -> None:
        self.rooms[room.room_code] = self._serialize_room(room)

    def _get_room(self, room_code: str) -> Room:
        normalized = self._normalize_room_code(room_code)
        assert normalized in self.rooms, "Room not found"
        return self._deserialize_room(self.rooms[normalized])

    def _find_player(self, room: Room, username: str) -> Player:
        key = self._player_key(username)
        for player in room.players:
            if self._player_key(player.username) == key:
                return player
        raise gl.vm.UserError("Player not found")

    def _player_exists(self, room: Room, username: str) -> bool:
        key = self._player_key(username)
        return any(self._player_key(player.username) == key for player in room.players)

    def _round_target_shape(self, room: Room, round_number: int) -> str:
        if round_number <= 0 or round_number > len(room.round_sequence):
            return ""
        return room.round_sequence[round_number - 1]

    def _cards_from_map(self, cat_map: Dict[str, str], target_shape: str) -> List[dict]:
        cards = []
        for card_id in sorted(cat_map.keys()):
            shape = cat_map[card_id]
            cards.append(
                {
                    "card_id": card_id,
                    "shape_key": shape.lower(),
                    "shape": shape.lower(),
                    "is_correct": shape == target_shape,
                }
            )
        return cards

    def _round_is_open(self, room: Room, now_ms: int) -> bool:
        return (
            room.game_status == "active"
            and room.round_phase == "playing"
            and room.round_start_time > 0
            and now_ms <= room.round_start_time + ROUND_DURATION_MS
        )

    def _materialize_pending_round_if_due(self, room: Room, now_ms: int) -> bool:
        if (
            room.game_status == "active"
            and room.pending_round_number > 0
            and room.pending_round_start_time > 0
            and now_ms >= room.pending_round_start_time
        ):
            room.current_round = room.pending_round_number
            room.current_cat_map = dict(room.pending_cat_map)
            room.round_start_time = room.pending_round_start_time
            room.player_guesses = {}
            room.round_phase = "playing"
            room.round_revealed = False
            room.last_reveal_at = 0
            room.pending_round_number = 0
            room.pending_cat_map = {}
            room.pending_round_start_time = 0
            return True
        return False

    def _current_seed_value(self, room_code: str, salt: str) -> int:
        candidates = [
            getattr(gl.message, "random_seed", None),
            getattr(gl.message, "randomSeed", None),
            getattr(gl.message, "transaction_hash", None),
            getattr(gl.message, "tx_hash", None),
            getattr(gl.message, "txHash", None),
            getattr(gl.message, "created_timestamp", None),
            getattr(gl.message, "createdTimestamp", None),
        ]
        seed_material = "|".join(str(value) for value in candidates if value not in (None, ""))
        if not seed_material:
            seed_material = str(self._now_ms())
        payload = f"{room_code}|{salt}|{self.entropy_nonce}|{seed_material}"
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        self.entropy_nonce += 1
        return int(digest, 16)

    def _random_index(self, room_code: str, salt: str, modulo: int) -> int:
        if modulo <= 0:
            return 0
        return self._current_seed_value(room_code, salt) % modulo

    def _shuffle_values(self, room_code: str, salt: str, values: List[str]) -> List[str]:
        pool = list(values)
        result: List[str] = []
        step = 0
        while len(pool) > 0:
            index = self._random_index(room_code, f"{salt}:{step}", len(pool))
            result.append(pool.pop(index))
            step += 1
        return result

    def _generate_round_sequence(self, room_code: str) -> List[str]:
        counts = {shape: 2 for shape in SHAPES}
        sequence: List[str] = []
        previous = ""
        guard = 0

        while len(sequence) < TOTAL_ROUNDS:
            options = [
                shape
                for shape in SHAPES
                if counts[shape] > 0 and shape != previous
            ]
            if len(options) == 0:
                counts = {shape: 2 for shape in SHAPES}
                sequence = []
                previous = ""
                guard += 1
                assert guard < 50, "Unable to generate round sequence"
                continue
            choice = options[self._random_index(room_code, f"sequence:{len(sequence)}:{guard}", len(options))]
            sequence.append(choice)
            counts[choice] -= 1
            previous = choice
        return sequence

    def _generate_cat_map(self, room_code: str, round_number: int) -> Dict[str, str]:
        shuffled_shapes = self._shuffle_values(room_code, f"cat-map:{round_number}", list(SHAPES))
        return {
            f"card-{index + 1}": shuffled_shapes[index]
            for index in range(len(shuffled_shapes))
        }

    def _status_label(self, player: Player) -> str:
        if player.is_removed:
            return "removed"
        if player.is_suspicious:
            return "suspicious"
        return "active"

    def _player_payload(self, player: Player, room: Room) -> dict:
        return {
            "username": player.username,
            "points": player.points,
            "streak": player.current_streak,
            "status": self._status_label(player),
            "is_removed": player.is_removed,
            "is_suspicious": player.is_suspicious,
            "is_host": self._player_key(player.username) == self._player_key(room.host),
        }

    def _room_state_payload(self, room: Room, now_ms: int) -> dict:
        round_number = room.current_round
        phase = room.round_phase
        if (
            room.game_status == "active"
            and room.pending_round_number > 0
            and room.pending_round_start_time > 0
            and now_ms >= room.pending_round_start_time
        ):
            round_number = room.pending_round_number
            phase = "playing"
        return {
            "room_code": room.room_code,
            "host_username": room.host,
            "status": room.game_status,
            "game_status": room.game_status,
            "room_status": room.game_status,
            "current_round": round_number,
            "round_number": round_number,
            "round_phase": phase,
            "player_count": len(room.players),
            "round_sequence": [shape.lower() for shape in room.round_sequence],
            "players": [self._player_payload(player, room) for player in room.players],
        }

    def _round_info_payload(self, room: Room, now_ms: int) -> dict:
        round_number = room.current_round
        cat_map = dict(room.current_cat_map)
        started_at = room.round_start_time
        phase = room.round_phase
        revealed = room.round_revealed or room.game_status == "finished"

        if (
            room.game_status == "active"
            and room.pending_round_number > 0
            and room.pending_round_start_time > 0
            and now_ms >= room.pending_round_start_time
        ):
            round_number = room.pending_round_number
            cat_map = dict(room.pending_cat_map)
            started_at = room.pending_round_start_time
            phase = "playing"
            revealed = False

        target_shape = self._round_target_shape(room, round_number)
        return {
            "room_code": room.room_code,
            "round_number": round_number,
            "current_round": round_number,
            "round": round_number,
            "round_index": max(round_number - 1, 0),
            "phase": "finished" if room.game_status == "finished" else phase,
            "revealed": revealed,
            "target_shape": target_shape.lower() if target_shape else "",
            "called_shape": target_shape.lower() if target_shape else "",
            "round_start_timestamp": started_at,
            "round_end_timestamp": started_at + ROUND_DURATION_MS if started_at > 0 else 0,
            "cat_to_shape_mapping": {
                card_id: shape.lower() for card_id, shape in cat_map.items()
            },
            "cards": self._cards_from_map(cat_map, target_shape),
        }

    def _leaderboard_payload(self, room: Room) -> dict:
        ranked = sorted(
            list(room.players),
            key=lambda player: (
                1 if player.is_removed else 0,
                -player.points,
                -player.current_streak,
                player.username.lower(),
            ),
        )
        entries = []
        for index, player in enumerate(ranked):
            entries.append(
                {
                    "rank": index + 1,
                    "username": player.username,
                    "points": player.points,
                    "streak": player.current_streak,
                    "status": self._status_label(player),
                }
            )
        return {
            "room_code": room.room_code,
            "entries": entries,
        }

    def _validate_cheat_response(self, result: Any) -> bool:
        if not isinstance(result, gl.vm.Return):
            return False
        data = result.calldata
        if not isinstance(data, dict):
            return False
        verdict = str(data.get("verdict", "")).strip().lower()
        reason = data.get("reason", "")
        return verdict in ("clean", "suspicious", "cheater") and isinstance(reason, str)

    def _anti_cheat_verdict(self, player: Player, response_times: List[float]) -> dict:
        seconds = [round(value, 3) for value in response_times]
        prompt = f"""
You are the anti-cheat judge for FlipIt, a card guessing game. There are 5 cards face down. Each round
the cat-to-shape mapping reshuffles completely making it impossible to learn patterns. Pure chance probability
is 20% per round.

Player data:
- Username: {player.username}
- Current correct streak: {player.current_streak}
- Response times this session: {seconds}

Rules:
- Streak of 3 = SUSPICIOUS
- Streak of 4+ = CHEATER
- Consistently guessing under 3 seconds every round = also CHEATER

Respond ONLY with valid JSON:
{{
  "verdict": "clean" | "suspicious" | "cheater",
  "reason": "one sentence explanation"
}}
""".strip()

        def leader_fn():
            return gl.nondet.exec_prompt(prompt, response_format="json")

        result = gl.vm.run_nondet_unsafe(leader_fn, self._validate_cheat_response)
        verdict = result.calldata if isinstance(result, gl.vm.Return) else result
        if not isinstance(verdict, dict):
            return {"verdict": "clean", "reason": "No verdict returned."}
        return {
            "verdict": str(verdict.get("verdict", "clean")).strip().lower(),
            "reason": str(verdict.get("reason", "")).strip(),
        }

    def _apply_cheat_verdict(self, player: Player, verdict: dict) -> None:
        label = verdict.get("verdict", "clean")
        if label == "cheater":
            player.is_removed = True
            player.is_suspicious = False
        elif label == "suspicious":
            player.is_suspicious = True

    def _run_anti_cheat(self, room: Room) -> None:
        for player in room.players:
            if player.is_removed:
                continue
            response_times = room.response_times.get(self._player_key(player.username), [])

            # Keep the obvious rule checks aligned with the prompt even if the model is unavailable or conservative.
            if player.current_streak >= CHEAT_STREAK:
                self._apply_cheat_verdict(player, {"verdict": "cheater"})
                continue
            if len(response_times) >= 3 and all(value < 3 for value in response_times[-3:]):
                self._apply_cheat_verdict(player, {"verdict": "cheater"})
                continue

            verdict = self._anti_cheat_verdict(player, response_times)
            self._apply_cheat_verdict(player, verdict)

    def _finalize_game(self, room: Room) -> None:
        room.game_status = "finished"
        room.round_phase = "finished"
        room.round_revealed = True
        room.pending_round_number = 0
        room.pending_cat_map = {}
        room.pending_round_start_time = 0

        ranked = sorted(
            [player for player in room.players if not player.is_removed],
            key=lambda player: (-player.points, -player.current_streak, player.username.lower()),
        )
        room.podium = [player.username for player in ranked[:3]]

    def _schedule_next_round(self, room: Room, now_ms: int) -> None:
        next_round = room.current_round + 1
        room.pending_round_number = next_round
        room.pending_cat_map = self._generate_cat_map(room.room_code, next_round)
        room.pending_round_start_time = now_ms + INTERMISSION_MS

    def _start_round(self, room: Room, round_number: int, start_time_ms: int) -> None:
        room.current_round = round_number
        room.current_cat_map = self._generate_cat_map(room.room_code, round_number)
        room.round_start_time = start_time_ms
        room.player_guesses = {}
        room.round_phase = "playing"
        room.round_revealed = False
        room.last_reveal_at = 0
        room.pending_round_number = 0
        room.pending_cat_map = {}
        room.pending_round_start_time = 0

    @gl.public.write
    def create_room(self, room_code: str, host_username: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        normalized_room_code = self._normalize_room_code(room_code)
        username = self._normalize_username(host_username)
        assert len(normalized_room_code) == 6 and normalized_room_code.isalnum(), "Room code must be exactly 6 letters or numbers"
        assert len(username) > 0, "Username is required"
        assert normalized_room_code not in self.rooms, "Room already exists"

        room = Room(
            room_code=normalized_room_code,
            host=username,
            players=[Player(username=username)],
            game_status="waiting",
            round_phase="idle",
        )
        self._save_room(room)
        return self._room_state_payload(room, self._now_ms())

    @gl.public.write
    def join_room(self, room_code: str, username: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        self._materialize_pending_round_if_due(room, now_ms)

        normalized_username = self._normalize_username(username)
        assert len(normalized_username) > 0, "Username is required"
        assert room.game_status == "waiting", "Game already started"
        assert len(room.players) < MAX_PLAYERS, "Room is full"
        assert not self._player_exists(room, normalized_username), "Duplicate username"

        room.players.append(Player(username=normalized_username))
        self._save_room(room)
        return self._room_state_payload(room, now_ms)

    @gl.public.write
    def start_game(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        assert room.game_status == "waiting", "Game already active"
        assert len(room.players) >= 2, "At least 2 players are required"

        room.round_sequence = self._generate_round_sequence(room.room_code)
        room.game_status = "active"
        self._start_round(room, 1, now_ms)
        self._save_room(room)
        return self._round_info_payload(room, now_ms)

    @gl.public.write
    def start_round(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        assert room.game_status == "active", "Game not active"

        next_round = room.current_round if room.current_round > 0 else 1
        if room.pending_round_number > 0:
            next_round = room.pending_round_number
        self._start_round(room, next_round, now_ms)
        self._save_room(room)
        return self._round_info_payload(room, now_ms)

    @gl.public.write
    def submit_guess(
        self,
        room_code: str,
        username: str,
        guessed_shape: str,
        guess_timestamp: int,
    ) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        self._materialize_pending_round_if_due(room, now_ms)

        assert room.game_status == "active", "Game is not active"
        assert room.round_phase == "playing", "Round is not open"
        player = self._find_player(room, username)
        assert not player.is_removed, "Removed players cannot guess"

        normalized_shape = str(guessed_shape or "").strip().upper()
        assert normalized_shape in SHAPES, "Invalid shape"
        effective_guess_time = int(guess_timestamp)
        assert effective_guess_time >= room.round_start_time, "Guess is before round start"
        assert effective_guess_time <= room.round_start_time + ROUND_DURATION_MS, "Guess too late"

        room.player_guesses[self._player_key(player.username)] = Guess(
            guessed_shape=normalized_shape,
            guess_timestamp=effective_guess_time,
        )
        self._save_room(room)
        return {
            "ok": True,
            "room_code": room.room_code,
            "round_number": room.current_round,
            "username": player.username,
        }

    @gl.public.write
    def reveal_round(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        self._materialize_pending_round_if_due(room, now_ms)

        assert room.game_status == "active", "Game is not active"
        assert room.round_phase == "playing", "Round cannot be revealed"
        assert room.current_round > 0, "No round to reveal"

        target_shape = self._round_target_shape(room, room.current_round)
        for player in room.players:
            if player.is_removed:
                continue

            guess = room.player_guesses.get(self._player_key(player.username))
            if guess is None:
                player.current_streak = 0
                continue

            response_time_seconds = max(
                0.0,
                (int(guess.guess_timestamp) - room.round_start_time) / 1000.0,
            )
            key = self._player_key(player.username)
            existing_times = list(room.response_times.get(key, []))
            existing_times.append(response_time_seconds)
            room.response_times[key] = existing_times

            if guess.guessed_shape == target_shape:
                player.points += CORRECT_POINTS
                if response_time_seconds <= SPEED_BONUS_WINDOW:
                    player.points += SPEED_BONUS_POINTS
                player.current_streak += 1
            else:
                player.current_streak = 0

        self._run_anti_cheat(room)
        room.round_phase = "leaderboard"
        room.round_revealed = True
        room.last_reveal_at = now_ms
        room.player_guesses = {}

        if room.current_round >= TOTAL_ROUNDS:
            self._finalize_game(room)
        else:
            self._schedule_next_round(room, now_ms)

        self._save_room(room)
        return self._round_info_payload(room, now_ms)

    @gl.public.write
    def end_game(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        if room.game_status != "finished":
            self._finalize_game(room)
            self._save_room(room)
        return self._leaderboard_payload(room)

    @gl.public.write
    def play_again(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        reset_players = [
            Player(username=player.username)
            for player in room.players
        ]
        room.players = reset_players
        room.game_status = "waiting"
        room.current_round = 0
        room.round_sequence = []
        room.current_cat_map = {}
        room.round_start_time = 0
        room.player_guesses = {}
        room.response_times = {}
        room.round_phase = "idle"
        room.round_revealed = False
        room.last_reveal_at = 0
        room.pending_round_number = 0
        room.pending_cat_map = {}
        room.pending_round_start_time = 0
        room.podium = []
        self._save_room(room)
        return self._room_state_payload(room, self._now_ms())

    @gl.public.write
    def leave_room(self, room_code: str, username: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        key = self._player_key(username)
        room.players = [
            player for player in room.players
            if self._player_key(player.username) != key
        ]
        if len(room.players) == 0:
            del self.rooms[room.room_code]
            return {"ok": True, "room_code": room.room_code, "deleted": True}

        if self._player_key(room.host) == key:
            room.host = room.players[0].username

        if key in room.player_guesses:
            del room.player_guesses[key]
        if key in room.response_times:
            del room.response_times[key]

        self._save_room(room)
        return {"ok": True, "room_code": room.room_code}

    @gl.public.view
    def get_round_mapping(self, room_code: str) -> TreeMap[str, typing.Any]:
        self._require_relayer()
        room = self._get_room(room_code)
        now_ms = self._now_ms()
        round_info = self._round_info_payload(room, now_ms)
        return {
            "room_code": room.room_code,
            "round_number": round_info["round_number"],
            "cat_to_shape_mapping": round_info["cat_to_shape_mapping"],
        }

    @gl.public.view
    def get_room_state(self, room_code: str) -> TreeMap[str, typing.Any]:
        room = self._get_room(room_code)
        return self._room_state_payload(room, self._now_ms())

    @gl.public.view
    def get_relayer_address(self) -> str:
        return str(self.relayer_address)

    @gl.public.view
    def get_round_info(self, room_code: str) -> TreeMap[str, typing.Any]:
        room = self._get_room(room_code)
        return self._round_info_payload(room, self._now_ms())

    @gl.public.view
    def get_leaderboard(self, room_code: str) -> TreeMap[str, typing.Any]:
        room = self._get_room(room_code)
        return self._leaderboard_payload(room)
