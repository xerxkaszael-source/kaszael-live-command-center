"""Agents adapter — reads /sdcard/Kaszael/lab/experts/registry.yaml.

128 experts. Mapped to roles/skills. Combined with telemetry role frequency
to produce live 'active agents' list.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
from pathlib import Path

from event_bus import BUS, Event, make_event_id


class AgentsAdapter:
    """One-time load of registry.yaml (slow-changing)."""

    def __init__(self, registry_path: str = "/sdcard/Kaszael/lab/experts/registry.yaml",
                 role_test_path: str = "/sdcard/Kaszael/lab/scripts/role-router-test.sh"):
        self.registry_path = Path(registry_path)
        self.role_test_path = Path(role_test_path)
        self.experts: list[dict] = []
        self.domains: dict[str, int] = {}
        self.roles_unique: list[str] = []
        self.domain_role_map: dict[str, str] = {}
        self.last_load_ts: float | None = None
        self._loaded = False

    def load(self) -> None:
        """Synchronous load — registry is slow-changing."""
        if not self.registry_path.exists():
            print(f"[agents] registry not found: {self.registry_path}", flush=True)
            return
        try:
            content = self.registry_path.read_text()
        except Exception as e:
            print(f"[agents] read err: {e}", flush=True)
            return
        experts = self._parse_yaml(content)
        # Parse role-router-test.sh for domain→role map (DOMAIN_ROLE + DOMAIN_SKILL blocks)
        if self.role_test_path.exists():
            try:
                rt_content = self.role_test_path.read_text()
                for m in re.finditer(r'\[[\w-]+\]\s*=\s*"([\w-]+)"', rt_content):
                    role = m.group(1)
                    if role not in self.domain_role_map.values():
                        self.domain_role_map[f"slot-{len(self.domain_role_map)}"] = role
                self.roles_unique = sorted(set(self.domain_role_map.values()))
            except Exception as e:
                print(f"[agents] parse role test err: {e}", flush=True)
        self.experts = experts
        from collections import Counter
        self.domains = dict(Counter(e["domain"] for e in experts))
        self.last_load_ts = time.time()
        self._loaded = True
        print(f"[agents] loaded {len(experts)} experts, {len(self.domain_role_map)} domain→role mappings", flush=True)

    def _parse_yaml(self, content: str) -> list[dict]:
        """Lightweight regex parser for the registry.yaml schema."""
        experts = []
        # Split on top-level list items ('- id:')
        blocks = re.split(r'\n- id:', '\n' + content)
        for block in blocks[1:]:
            # Strip leading whitespace from first line (id)
            block = block.lstrip()
            id_match = re.match(r'^(\S+)', block)
            if not id_match:
                continue
            exp = {"id": id_match.group(1)}
            # Extract fields
            for key in ["domain", "title", "status"]:
                m = re.search(rf'\n\s+{key}:\s*(.+)', block)
                if m:
                    exp[key] = m.group(1).strip()
            # skills list
            skills_m = re.search(r'\n\s+skills:\n((?:\s+-\s+\S+\n?)+)', block)
            if skills_m:
                exp["skills"] = re.findall(r'-\s+(\S+)', skills_m.group(1))
            # triggers list
            trig_m = re.search(r'\n\s+triggers:\n((?:\s+-\s+.+\n?)+)', block)
            if trig_m:
                exp["triggers"] = re.findall(r'-\s+(.+)', trig_m.group(1))
            experts.append(exp)
        return experts

    async def start(self):
        await asyncio.get_event_loop().run_in_executor(None, self.load)

    async def stop(self):
        pass

    def snapshot(self) -> dict:
        return {
            "experts": self.experts,
            "domains": self.domains,
            "roles_unique": self.roles_unique,
            "domain_role_map": self.domain_role_map,
            "last_load_ts": self.last_load_ts,
        }

    def active_from_telemetry(self, telemetry_counts: dict, limit: int = 20) -> list[dict]:
        """Derive currently-active agents from telemetry role counts."""
        active = []
        for role, count in sorted(telemetry_counts.items(), key=lambda kv: -kv[1]):
            if role in ("unknown", "?") or count == 0:
                continue
            # Find expert whose skills include this role
            matched = []
            for exp in self.experts:
                if role in exp.get("skills", []) or role == exp["id"]:
                    matched.append(exp["id"])
            active.append({
                "role": role,
                "count": count,
                "matched_experts": matched[:5],
                "state": "ACTIVE" if count > 5 else "RECENT",
            })
            if len(active) >= limit:
                break
        return active