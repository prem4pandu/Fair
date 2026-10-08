"""Static audit evidence; does not execute upstream code or claim action parity."""
import argparse
import hashlib
import json
import pathlib
import re

parser = argparse.ArgumentParser()
parser.add_argument("source", type=pathlib.Path)
parser.add_argument("output", type=pathlib.Path)
args = parser.parse_args()
mapping = {
    "enatega-multivendor-web": ["customer-web"],
    "enatega-multivendor-admin": ["merchant-web", "admin-web"],
    "enatega-singlevendor-admin": ["merchant-web", "admin-web"],
    "enatega-multivendor-app": ["customer-mobile"],
    "enatega-multivendor-store": ["merchant-mobile"],
    "enatega-multivendor-rider": ["rider-mobile"],
}
apps = []
for directory, targets in mapping.items():
    base = args.source / directory
    package = json.loads((base / "package.json").read_text())
    candidates = []
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.suffix not in {".js", ".jsx", ".ts", ".tsx", ".gql", ".graphql"}:
            continue
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        rel = str(path.relative_to(args.source))
        signals = [{"line": index, "kinds": [s for s in ("onClick", "onPress", "onSubmit", "useQuery", "useMutation", "useSubscription", "gql`") if s in line]} for index, line in enumerate(text.splitlines(), 1)]
        signals = [s for s in signals if s["kinds"]]
        operations = [{"kind": match.group(1), "name": match.group(2)} for match in re.finditer(r"\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z_0-9]*)\s*[({]", text)]
        candidates.append({"path": rel, "sha256": hashlib.sha256(raw).hexdigest(), "route_or_screen_candidate": path.name in {"page.tsx", "page.jsx", "page.js", "layout.tsx"} or "screens" in path.parts, "signals": signals, "operation_name_candidates": operations})
    apps.append({"directory": directory, "targets": targets, "dependencies": package.get("dependencies", {}), "files": candidates})
report = {"commit": "d9eb29e8b32b6ec11ee038f94d43caa0eba54bab", "source": "https://github.com/enatega/food-delivery-multivendor", "limitations": ["Lexical signals and operation names require human source/runtime reconciliation", "Counts are not accepted features, reachable actions, tests or completed UI parity", "Asset-specific licensing and full cloud catalog reconciliation remain pending"], "apps": apps}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"files": sum(len(a["files"]) for a in apps), "signal_lines": sum(len(f["signals"]) for a in apps for f in a["files"]), "route_or_screen_candidates": sum(f["route_or_screen_candidate"] for a in apps for f in a["files"])}))
