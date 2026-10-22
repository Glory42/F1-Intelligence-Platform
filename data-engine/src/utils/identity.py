"""Who is the same person, and which team rows are the same outfit, across season-scoped rows.
Mirrors apps/api/src/common/identity.ts (golden cases: docs/identity-cases.json): change both together.
Driver codes are labels, not keys: VER is Vergne and Verstappen, MSC is Michael and Mick Schumacher."""
import unicodedata
from typing import Iterable

# Each outfit's team keys in order, its current one last.
LINEAGES: tuple[tuple[str, ...], ...] = (
    ("minardi", "toro_rosso", "alphatauri", "alpha_tauri", "rb", "racing_bulls"),
    ("stewart", "jaguar", "red_bull", "red_bull_racing"),
    ("jordan", "midland", "mf1", "spyker", "force_india", "racing_point", "aston_martin"),
    ("sauber", "bmw_sauber", "alfa_romeo_racing", "alfa_romeo", "kick_sauber", "audi"),
    ("toleman", "benetton", "renault", "lotus_f1", "alpine"),
    ("bar", "honda", "brawn", "mercedes"),
    ("virgin", "marussia", "manor_marussia", "manor"),
    ("haas", "haas_f1_team"),
)
_CONSTRUCTOR_KEY = {k: keys[-1] for keys in LINEAGES for k in keys}


def _ascii_words(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return " ".join(ascii_name.lower().split())


def person_key(first_name: str, last_name: str) -> str:
    """One person per first + last name (ADR-0009). Keeps "Jr.", so Piquet Sr. and Jr. stay two people."""
    return _ascii_words(f"{first_name} {last_name}")


def is_same_person(a: tuple[str, str, str], b: tuple[str, str, str]) -> bool:
    """(code, first, last) pairs. FastF1's names vary by season ("Andrea Kimi Antonelli" in 2025 only):
    a matching code lets one name extend the other."""
    ka, kb = person_key(a[1], a[2]), person_key(b[1], b[2])
    if ka == kb:
        return True
    return a[0] == b[0] and (ka.endswith(f" {kb}") or kb.endswith(f" {ka}"))


def constructor_key(team_key: str) -> str:
    """One outfit across its rebrands (Toro Rosso -> AlphaTauri -> RB), kept apart from its sister team."""
    return _CONSTRUCTOR_KEY.get(team_key, team_key)


def person_ids(drivers: Iterable[dict]) -> dict[int, str]:
    """driver row id → one key per person across seasons, for rows with id, code, first_name, last_name."""
    rows = list(drivers)
    key_of = {r["id"]: person_key(r["first_name"], r["last_name"]) for r in rows}
    parent: dict[str, str] = {k: k for k in key_of.values()}

    def root(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    by_code: dict[str, set[str]] = {}
    for r in rows:
        by_code.setdefault(r["code"], set()).add(key_of[r["id"]])
    for keys in by_code.values():
        for ka in keys:
            for kb in keys:
                if ka != kb and ka.endswith(f" {kb}"):
                    ra, rb = root(ka), root(kb)
                    if ra != rb:
                        parent[max(ra, rb)] = min(ra, rb)
    return {driver_id: root(k) for driver_id, k in key_of.items()}
