# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import json
from typing import Any, Dict, List

ROUND_SECONDS = 30
ROUND_COUNT = 10
SPEED_BONUS_SECONDS = 10
SHAPES = ["triangle", "circle", "square", "cross", "star"]
CARD_IDS = ["card-1", "card-2", "card-3", "card-4", "card-5"]


class FlipIt(gl.Contract):
    rooms_json: str

    def __init__(self) -> None:
        self.rooms_json = "{}"

    def _load_rooms(self) -> Dict[str, Dict[str, Any]]:
        raw = json.loads(self.rooms_json or "{}")
        return raw if isinstance(raw, dict) else {}

    def _save_rooms(self, rooms: Dict[str, Dict[str, Any]]) -> None:
        self.rooms_json = json.dumps(rooms, separators=(",", ":"))

    def _normalize_room_code(self, value: Any) -> str:
        room_code = str(value or "").strip().upper()
        if len(room_code) >= 2 and room_code[0] == room_code[-1] and room_code[0] in ("'", '"'):
            room_code = room_code[1:-1].strip()
        return room_code

    def _normalize_address(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _normalize_username(self, value: Any) -> str:
        return str(value or "").strip()

    def _normalize_shape(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _default_result_summary(self) -> Dict[str, List[str]]:
        return {
            "correct_usernames": [],
            "wrong_usernames": [],
            "removed_usernames": [],
        }

    def _empty_round_state(self) -> Dict[str, Any]:
        return {
            "round_number": 0,
            "target_shape_key": "",
            "mapping": {},
            "started_at": 0,
            "ends_at": 0,
            "phase": "idle",
            "revealed": False,
            "leaderboard_started_at": 0,
            "result_summary": self._default_result_summary(),
        }

    def _room_exists(self, room_code: str) -> bool:
        return self._normalize_room_code(room_code) in self._load_rooms()

    def _require_room(self, room_code: str) -> Dict[str, Any]:
        normalized_room_code = self._normalize_room_code(room_code)
        rooms = self._load_rooms()
        assert normalized_room_code in rooms, "Room not found"
        room = rooms[normalized_room_code]
        assert isinstance(room, dict), "Room data is corrupted"
        return room

    def _save_room(self, room: Dict[str, Any]) -> None:
        rooms = self._load_rooms()
        rooms[room["room_code"]] = room
        self._save_rooms(rooms)

    def _assert_signer(self, wallet_address: str) -> None:
        caller = self._normalize_address(gl.message.sender_address)
        assert caller == self._normalize_address(wallet_address), "Wallet address must match the signing wallet"

    def _assert_host(self, room: Dict[str, Any]) -> None:
        caller = self._normalize_address(gl.message.sender_address)
        assert caller == self._normalize_address(room.get("host_address", "")), "Host wallet required"

    def _validate_room_code(self, room_code: str) -> None:
        assert len(room_code) == 6 and room_code.isalnum(), "Room code must be exactly 6 letters or numbers"

    def _validate_round_sequence(self, round_sequence_json: str) -> List[str]:
        raw = json.loads(str(round_sequence_json or "[]"))
        assert isinstance(raw, list), "Round sequence must be a JSON array"
        sequence = [self._normalize_shape(item) for item in raw]
        assert len(sequence) == ROUND_COUNT, "Round sequence must have 10 entries"

        counts: Dict[str, int] = {}
        previous = ""
        for shape in sequence:
            assert shape in SHAPES, "Invalid shape in round sequence"
            assert shape != previous, "Round sequence cannot repeat adjacent shapes"
            counts[shape] = counts.get(shape, 0) + 1
            previous = shape

        for shape in SHAPES:
            assert counts.get(shape, 0) == 2, "Each shape must appear exactly twice"

        return sequence

    def _validate_mapping(self, mapping_json: str) -> Dict[str, str]:
        raw = json.loads(str(mapping_json or "{}"))
        assert isinstance(raw, dict), "Initial mapping must be a JSON object"

        mapping: Dict[str, str] = {}
        seen_shapes: Dict[str, bool] = {}

        for card_id in CARD_IDS:
            shape = self._normalize_shape(raw.get(card_id, ""))
            assert shape in SHAPES, "Invalid initial card mapping"
            assert shape not in seen_shapes, "Initial mapping must use each shape exactly once"
            mapping[card_id] = shape
            seen_shapes[shape] = True

        return mapping

    def _validate_guess_timestamp(self, guess_timestamp: Any) -> int:
        value = int(guess_timestamp)
        assert value > 0, "Timestamp is required"
        return value

    def _find_player_index(self, players: List[Dict[str, Any]], wallet_address: str) -> int:
        normalized_wallet = self._normalize_address(wallet_address)
        for index, player in enumerate(players):
            if self._normalize_address(player.get("wallet_address", "")) == normalized_wallet:
                return index
        return -1

    def _find_player_by_username(self, players: List[Dict[str, Any]], username: str) -> int:
        normalized_username = self._normalize_username(username).lower()
        for index, player in enumerate(players):
            if self._normalize_username(player.get("username", "")).lower() == normalized_username:
                return index
        return -1

    def _find_leaderboard_entry(self, room: Dict[str, Any], wallet_address: str) -> Dict[str, Any]:
        normalized_wallet = self._normalize_address(wallet_address)
        for entry in room.get("leaderboard", []):
            if self._normalize_address(entry.get("wallet_address", "")) == normalized_wallet:
                return entry
        return {
            "points": 0,
            "current_streak": 0,
            "status": "active",
        }

    def _create_player(self, username: str, wallet_address: str, is_host: bool) -> Dict[str, Any]:
        return {
            "username": self._normalize_username(username),
            "wallet_address": self._normalize_address(wallet_address),
            "is_host": bool(is_host),
            "joined_at": 0,
        }

    def _create_leaderboard_entry(self, username: str, wallet_address: str) -> Dict[str, Any]:
        return {
            "username": self._normalize_username(username),
            "wallet_address": self._normalize_address(wallet_address),
            "points": 0,
            "current_streak": 0,
            "status": "active",
        }

    def _set_round(self, room: Dict[str, Any], round_number: int, started_at: int) -> None:
        room["status"] = "active"
        room["current_round"] = int(round_number)
        room["round_state"] = {
            "round_number": int(round_number),
            "target_shape_key": room["round_sequence"][round_number - 1],
            "mapping": dict(room.get("initial_mapping", {})),
            "started_at": started_at,
            "ends_at": started_at + ROUND_SECONDS * 1000,
            "phase": "playing",
            "revealed": False,
            "leaderboard_started_at": 0,
            "result_summary": self._default_result_summary(),
        }

        history = [entry for entry in room.get("round_history", []) if int(entry.get("round_number", 0)) != int(round_number)]
        history.append(
            {
                "round_number": int(round_number),
                "started_at": started_at,
                "ended_at": started_at + ROUND_SECONDS * 1000,
                "target_shape_key": room["round_sequence"][round_number - 1],
            }
        )
        history.sort(key=lambda entry: int(entry.get("round_number", 0)))
        room["round_history"] = history

    def _sorted_leaderboard(self, room: Dict[str, Any]) -> List[Dict[str, Any]]:
        return sorted(
            room.get("leaderboard", []),
            key=lambda entry: (
                1 if str(entry.get("status", "active")).lower() == "removed" else 0,
                -int(entry.get("points", 0)),
                -int(entry.get("current_streak", 0)),
                str(entry.get("username", "")).lower(),
            ),
        )

    def _room_state_payload(self, room: Dict[str, Any]) -> Dict[str, Any]:
        players_payload = []
        for player in room.get("players", []):
            score_entry = self._find_leaderboard_entry(room, player.get("wallet_address", ""))
            status = str(score_entry.get("status", "active")).lower()
            players_payload.append(
                {
                    "username": player.get("username", ""),
                    "walletAddress": player.get("wallet_address", ""),
                    "points": int(score_entry.get("points", 0)),
                    "streak": int(score_entry.get("current_streak", 0)),
                    "status": status,
                    "removed": status == "removed",
                    "suspicious": status == "suspicious",
                    "isHost": bool(player.get("is_host", False)),
                }
            )

        return {
            "roomCode": room["room_code"],
            "hostUsername": room.get("host_username", ""),
            "status": room.get("status", "waiting"),
            "roundNumber": int(room.get("current_round", 0)),
            "players": players_payload,
        }

    def _round_info_payload(self, room: Dict[str, Any]) -> Dict[str, Any]:
        round_state = room.get("round_state", self._empty_round_state())
        target_shape = self._normalize_shape(round_state.get("target_shape_key", ""))
        revealed = bool(round_state.get("revealed", False))
        cards = []

        for card_id in CARD_IDS:
            shape_key = self._normalize_shape(round_state.get("mapping", {}).get(card_id, ""))
            is_correct = bool(shape_key and shape_key == target_shape)
            cards.append(
                {
                    "id": card_id,
                    "shapeKey": shape_key if revealed else "",
                    "revealedShapeKey": shape_key if revealed else None,
                    "isCorrect": is_correct if revealed else False,
                }
            )

        return {
            "roomCode": room["room_code"],
            "roundIndex": max(int(round_state.get("round_number", 0)) - 1, 0),
            "roundNumber": int(round_state.get("round_number", 0)),
            "phase": round_state.get("phase", "idle"),
            "startedAt": int(round_state.get("started_at", 0)),
            "endsAt": int(round_state.get("ends_at", 0)),
            "revealed": revealed,
            "targetShapeKey": target_shape,
            "cards": cards,
            "resultSummary": round_state.get("result_summary", self._default_result_summary()),
        }

    def _leaderboard_payload(self, room: Dict[str, Any]) -> Dict[str, Any]:
        entries = []
        for index, entry in enumerate(self._sorted_leaderboard(room)):
            entries.append(
                {
                    "rank": index + 1,
                    "username": entry.get("username", ""),
                    "wallet_address": entry.get("wallet_address", ""),
                    "points": int(entry.get("points", 0)),
                    "streak": int(entry.get("current_streak", 0)),
                    "status": entry.get("status", "active"),
                }
            )

        return {
            "roomCode": room["room_code"],
            "entries": entries,
        }

    def _snapshot(self, room: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "roomState": self._room_state_payload(room),
            "roundInfo": self._round_info_payload(room),
            "leaderboard": self._leaderboard_payload(room),
        }

    def _json_result(self, payload: Any) -> str:
        return json.dumps(payload, separators=(",", ":"))

    def _latest_guesses_for_round(self, room: Dict[str, Any], round_number: int) -> Dict[str, Dict[str, Any]]:
        latest: Dict[str, Dict[str, Any]] = {}
        for guess in room.get("guesses", []):
            if int(guess.get("round_number", 0)) != int(round_number):
                continue
            latest[self._normalize_address(guess.get("wallet_address", ""))] = guess
        return latest

    def _response_times_for_wallet(self, room: Dict[str, Any], wallet_address: str) -> List[float]:
        normalized_wallet = self._normalize_address(wallet_address)
        start_by_round = {
            int(entry.get("round_number", 0)): int(entry.get("started_at", 0))
            for entry in room.get("round_history", [])
        }
        values = []

        for guess in room.get("guesses", []):
            if self._normalize_address(guess.get("wallet_address", "")) != normalized_wallet:
                continue
            round_number = int(guess.get("round_number", 0))
            started_at = int(start_by_round.get(round_number, 0))
            if started_at <= 0:
                continue
            values.append(max(0.0, (int(guess.get("guess_timestamp", 0)) - started_at) / 1000.0))

        values.sort()
        return values

    def _validate_cheater_response(self, result: Any) -> bool:
        if not isinstance(result, gl.vm.Return):
            return False
        payload = result.calldata
        if not isinstance(payload, dict):
            return False
        verdict = str(payload.get("verdict", "")).strip().lower()
        return verdict in ("clean", "suspicious", "cheater")

    def _check_cheater(self, username: str, wallet_address: str, streak: int, response_times: List[float]) -> Dict[str, str]:
        prompt = f"""
You are the anti-cheat judge for FlipIt, a five-card guessing game.
Each round, all five shapes are fully reshuffled under new mascots, so prior knowledge gives no advantage.

Player:
- Username: {username}
- Wallet: {wallet_address}
- Current streak: {streak}
- Response times in seconds: {[round(value, 3) for value in response_times]}

Rules:
- streak 0-2 => clean unless response pattern is extreme
- streak 3 => suspicious
- streak 4 or more => cheater unless there is a very strong reason not to
- repeated near-instant correct responses can justify cheater

Return only valid JSON:
{{
  "verdict": "clean" | "suspicious" | "cheater",
  "reason": "one sentence"
}}
""".strip()

        def run_prompt():
            return gl.nondet.exec_prompt(prompt, response_format="json")

        result = gl.vm.run_nondet_unsafe(run_prompt, self._validate_cheater_response)
        payload = result.calldata if isinstance(result, gl.vm.Return) else result

        if not isinstance(payload, dict):
            return {"verdict": "clean", "reason": "No AI verdict returned."}

        verdict = str(payload.get("verdict", "clean")).strip().lower()
        if verdict not in ("clean", "suspicious", "cheater"):
            verdict = "clean"

        return {
            "verdict": verdict,
            "reason": str(payload.get("reason", "")).strip(),
        }

    @gl.public.write
    def create_room(self, room_code: str, host_address: str, host_username: str, round_sequence_json: str, initial_mapping_json: str) -> str:
        normalized_room_code = self._normalize_room_code(room_code)
        normalized_host_address = self._normalize_address(host_address)
        normalized_host_username = self._normalize_username(host_username)
        self._validate_room_code(normalized_room_code)
        self._assert_signer(normalized_host_address)
        assert not self._room_exists(normalized_room_code), "Room already exists"
        assert len(normalized_host_username) > 0, "Username is required"

        room = {
            "room_code": normalized_room_code,
            "host_address": normalized_host_address,
            "host_username": normalized_host_username,
            "status": "waiting",
            "current_round": 0,
            "round_sequence": self._validate_round_sequence(round_sequence_json),
            "initial_mapping": self._validate_mapping(initial_mapping_json),
            "players": [self._create_player(normalized_host_username, normalized_host_address, True)],
            "leaderboard": [self._create_leaderboard_entry(normalized_host_username, normalized_host_address)],
            "guesses": [],
            "round_history": [],
            "round_state": self._empty_round_state(),
        }
        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def join_room(self, room_code: str, username: str, wallet_address: str) -> str:
        room = self._require_room(room_code)
        normalized_username = self._normalize_username(username)
        normalized_wallet = self._normalize_address(wallet_address)
        self._assert_signer(normalized_wallet)

        assert room.get("status", "waiting") == "waiting", "Game already started"
        assert len(normalized_username) > 0, "Username is required"
        assert self._find_player_index(room.get("players", []), normalized_wallet) == -1, "Wallet already joined"
        assert self._find_player_by_username(room.get("players", []), normalized_username) == -1, "That username is already taken in this room."

        is_host = len(room.get("players", [])) == 0 and normalized_wallet == self._normalize_address(room.get("host_address", ""))
        room["players"].append(self._create_player(normalized_username, normalized_wallet, is_host))
        room["leaderboard"].append(self._create_leaderboard_entry(normalized_username, normalized_wallet))
        if is_host:
            room["host_username"] = normalized_username

        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def start_game(self, room_code: str, started_at: int) -> str:
        room = self._require_room(room_code)
        self._assert_host(room)
        assert room.get("status", "waiting") == "waiting", "Game already started"
        assert len(room.get("players", [])) >= 2, "At least 2 players are required to start the game."

        self._set_round(room, 1, self._validate_guess_timestamp(started_at))
        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def submit_guess(self, room_code: str, username: str, guessed_shape: str, timestamp: int) -> str:
        room = self._require_room(room_code)
        round_state = room.get("round_state", self._empty_round_state())
        normalized_wallet = self._normalize_address(gl.message.sender_address)
        normalized_username = self._normalize_username(username)
        normalized_shape = self._normalize_shape(guessed_shape)

        assert room.get("status", "") == "active", "This round is not accepting guesses right now."
        assert round_state.get("phase", "idle") == "playing", "This round is not accepting guesses right now."
        assert self._find_player_index(room.get("players", []), normalized_wallet) >= 0, "Join the room before submitting a guess."
        assert self._find_player_by_username(room.get("players", []), normalized_username) >= 0, "Username not found in room."
        if normalized_shape in CARD_IDS:
            normalized_shape = self._normalize_shape(round_state.get("mapping", {}).get(normalized_shape, ""))
        assert normalized_shape in SHAPES, "Invalid shape selected."

        guess_record = {
            "round_number": int(round_state.get("round_number", 0)),
            "username": normalized_username,
            "wallet_address": normalized_wallet,
            "guessed_shape": normalized_shape,
            "guess_timestamp": self._validate_guess_timestamp(timestamp),
            "submitted_at": 0,
        }

        guesses = []
        for guess in room.get("guesses", []):
            if (
                int(guess.get("round_number", 0)) == int(round_state.get("round_number", 0))
                and self._normalize_address(guess.get("wallet_address", "")) == normalized_wallet
            ):
                continue
            guesses.append(guess)

        guesses.append(guess_record)
        room["guesses"] = guesses
        self._save_room(room)
        return self._json_result({"ok": True})

    @gl.public.write
    def reveal_round(self, room_code: str) -> str:
        room = self._require_room(room_code)
        self._assert_host(room)
        round_state = room.get("round_state", self._empty_round_state())

        assert room.get("status", "") == "active", "No active game."
        assert round_state.get("phase", "idle") == "playing", "Round is not in revealable state."

        round_number = int(round_state.get("round_number", 0))
        target_shape = self._normalize_shape(round_state.get("target_shape_key", ""))
        latest_guesses = self._latest_guesses_for_round(room, round_number)
        correct_usernames: List[str] = []
        wrong_usernames: List[str] = []
        removed_usernames: List[str] = []

        for entry in room.get("leaderboard", []):
            wallet = self._normalize_address(entry.get("wallet_address", ""))
            guess = latest_guesses.get(wallet)
            current_status = str(entry.get("status", "active")).lower()

            if current_status == "removed":
                continue

            if guess and self._normalize_shape(guess.get("guessed_shape", "")) == target_shape:
                response_time_seconds = max(0.0, (int(guess.get("guess_timestamp", 0)) - int(round_state.get("started_at", 0))) / 1000.0)
                bonus = 5 if response_time_seconds <= SPEED_BONUS_SECONDS else 0
                entry["points"] = int(entry.get("points", 0)) + 10 + bonus
                entry["current_streak"] = int(entry.get("current_streak", 0)) + 1
                correct_usernames.append(entry.get("username", ""))
            else:
                entry["current_streak"] = 0
                if guess:
                    wrong_usernames.append(entry.get("username", ""))

            streak = int(entry.get("current_streak", 0))
            if streak >= 4:
                verdict = self._check_cheater(
                    entry.get("username", ""),
                    entry.get("wallet_address", ""),
                    streak,
                    self._response_times_for_wallet(room, entry.get("wallet_address", "")),
                )
                if verdict["verdict"] == "cheater":
                    entry["status"] = "removed"
                    removed_usernames.append(entry.get("username", ""))
                elif verdict["verdict"] == "suspicious":
                    entry["status"] = "suspicious"
                else:
                    entry["status"] = "active"
            elif streak == 3:
                entry["status"] = "suspicious"
            else:
                entry["status"] = "active"

        round_state["phase"] = "leaderboard"
        round_state["revealed"] = True
        round_state["leaderboard_started_at"] = 0
        round_state["result_summary"] = {
            "correct_usernames": correct_usernames,
            "wrong_usernames": wrong_usernames,
            "removed_usernames": removed_usernames,
        }
        room["round_state"] = round_state

        if int(round_state.get("round_number", 0)) >= ROUND_COUNT:
            room["round_state"]["phase"] = "leaderboard"

        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def advance_round(self, room_code: str, mapping_json: str, started_at: int) -> str:
        room = self._require_room(room_code)
        self._assert_host(room)
        round_state = room.get("round_state", self._empty_round_state())

        assert room.get("status", "") == "active", "No active game."
        assert round_state.get("phase", "idle") == "leaderboard", "Reveal the current round before advancing."
        assert int(round_state.get("round_number", 0)) < ROUND_COUNT, "Game is already at the final round."

        room["initial_mapping"] = self._validate_mapping(mapping_json)
        self._set_round(room, int(round_state.get("round_number", 0)) + 1, self._validate_guess_timestamp(started_at))
        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def end_game(self, room_code: str) -> str:
        room = self._require_room(room_code)
        self._assert_host(room)
        round_state = room.get("round_state", self._empty_round_state())

        assert room.get("status", "") == "active", "No active game."
        assert int(round_state.get("round_number", 0)) >= ROUND_COUNT, "Final round has not completed."
        assert round_state.get("phase", "idle") == "leaderboard", "Reveal the final round before ending the game."

        room["status"] = "finished"
        room["round_state"]["phase"] = "finished"
        room["round_state"]["revealed"] = True
        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.write
    def play_again(self, room_code: str, round_sequence_json: str, initial_mapping_json: str) -> str:
        room = self._require_room(room_code)
        self._assert_host(room)

        room["status"] = "waiting"
        room["current_round"] = 0
        room["round_sequence"] = self._validate_round_sequence(round_sequence_json)
        room["initial_mapping"] = self._validate_mapping(initial_mapping_json)
        room["round_state"] = self._empty_round_state()
        room["guesses"] = []
        room["round_history"] = []

        for entry in room.get("leaderboard", []):
            entry["points"] = 0
            entry["current_streak"] = 0
            entry["status"] = "active"

        self._save_room(room)
        return self._json_result(self._snapshot(room))

    @gl.public.view
    def get_room_state(self, room_code: str) -> str:
        room = self._require_room(room_code)
        return self._json_result(self._room_state_payload(room))

    @gl.public.view
    def get_round_info(self, room_code: str) -> str:
        room = self._require_room(room_code)
        return self._json_result(self._round_info_payload(room))

    @gl.public.view
    def get_leaderboard(self, room_code: str) -> str:
        room = self._require_room(room_code)
        return self._json_result(self._leaderboard_payload(room))
