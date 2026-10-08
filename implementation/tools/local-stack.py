#!/usr/bin/env python3
"""Run the isolated fresh development stack; never seed product/demo records."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / ".toolchain" / "local-run"
PID_FILE = RUN / "pids.json"
CONFIG_FILE = RUN / "runtime.json"
NAMES = ["api", "worker"]
PORTS = dict(zip([n for n in NAMES if n != "worker"],
                 [4100, 3100, 3101, 3102, 8081, 8082, 8083]))


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def pids():
    return json.loads(PID_FILE.read_text()) if PID_FILE.exists() else {}


def owns(name, pid):
    if pid <= 0 or os.getpgid(pid) != pid:
        return False
    expected = ROOT / ("services" if name in ("api", "worker") else "apps") / name
    result = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
                            capture_output=True, text=True)
    details = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                             capture_output=True, text=True).stdout
    if name in ("api", "worker"):
        return "n" + str(expected) in result.stdout.splitlines() and "dist/main.js" in details
    if name.endswith("-mobile"):
        return "n" + str(expected) in result.stdout.splitlines() and str(expected) in details
    # pnpm starts in workspace root; also require the exact package and session leader.
    return ("n" + str(ROOT) in result.stdout.splitlines()
            and "@fairbite/" + name in details)


def stop(names):
    recorded = pids()
    for name in names:
        pid = recorded.get(name)
        if not pid:
            continue
        try:
            if not owns(name, pid):
                raise RuntimeError("Recorded process ownership changed: " + name)
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        recorded.pop(name, None)
    PID_FILE.write_text(json.dumps(recorded, indent=2) + "\n")
    time.sleep(1)


def infrastructure():
    postgres = "fairbite-fresh-local-postgres"
    redis = "fairbite-fresh-local-redis"
    found = subprocess.run(["docker", "inspect", postgres], capture_output=True, text=True)
    if found.returncode:
        password = secrets.token_urlsafe(32)
        command("docker", "run", "-d", "--name", postgres, "--platform", "linux/amd64",
                "-p", "127.0.0.1:55433:5432", "-e", "POSTGRES_USER=fairbite_local",
                "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=fairbite_fresh",
                "postgis/postgis:17-3.5")
    else:
        info = json.loads(found.stdout)[0]
        password = next(v.split("=", 1)[1] for v in info["Config"]["Env"]
                        if v.startswith("POSTGRES_PASSWORD="))
        if not info["State"]["Running"]:
            command("docker", "start", postgres)
    found = subprocess.run(["docker", "inspect", redis], capture_output=True, text=True)
    if found.returncode:
        command("docker", "run", "-d", "--name", redis,
                "-p", "127.0.0.1:56380:6379", "redis:7-alpine")
    elif not json.loads(found.stdout)[0]["State"]["Running"]:
        command("docker", "start", redis)
    for _ in range(60):
        status = subprocess.run(["docker", "exec", postgres, "pg_isready", "-U", "fairbite_local"],
                                capture_output=True)
        if status.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Local PostgreSQL did not become ready")
    if CONFIG_FILE.exists():
        os.chmod(CONFIG_FILE, 0o600)
        config = json.loads(CONFIG_FILE.read_text())
        if "PUBLIC_ACCESS_SECRET" not in config:
            config["PUBLIC_ACCESS_SECRET"] = secrets.token_urlsafe(32)
            CONFIG_FILE.write_text(json.dumps(config))
            os.chmod(CONFIG_FILE, 0o600)
    else:
        config = {"ACCESS_TOKEN_SECRET": secrets.token_urlsafe(32),
                  "REFRESH_TOKEN_PEPPER": secrets.token_urlsafe(32),
                  "PUBLIC_ACCESS_SECRET": secrets.token_urlsafe(32)}
        fd = os.open(CONFIG_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(config, stream)
    return {**os.environ, **config, "APP_ENV": "development", "PORT": "4100",
            "HOST": "127.0.0.1", "PUBLIC_BASE_URL": "http://localhost:4100",
            "GRAPHQL_BODY_LIMIT": "1mb", "PUBLIC_ACCESS_ENFORCED": "true",
            "PASSWORD_AUTH_ENABLED": "true",
            "DATABASE_URL": f"postgresql://fairbite_local:{password}@127.0.0.1:55433/fairbite_fresh",
            "REDIS_URL": "redis://127.0.0.1:56380/0",
            "CORS_ORIGINS": ",".join(f"http://localhost:{p}" for p in (8081, 8082, 8083))}


def start(names, restart):
    policy = json.loads((ROOT / "docs/IMPLEMENTATION_STATUS.json").read_text())
    if (policy.get("frontend_launch_policy") == "BLOCK_REPLACEMENT_UI_UNTIL_ORIGINAL_ENATEGA_MIGRATION_VERIFIED"
            and any(name not in ("api", "worker") for name in names)):
        print("Original Enatega frontend migration is pending; replacement UI launch is prohibited. Start only api worker.")
        raise RuntimeError("Original UI restoration required")
    RUN.mkdir(parents=True, exist_ok=True)
    if restart:
        stop(names)
    env = infrastructure()
    node = shutil.which("node")
    if not node or not command(node, "--version").startswith("v24."):
        raise RuntimeError("Node.js 24 is required")
    with (RUN / "migration.log").open("w") as log:
        for attempt in range(10):
            applied = subprocess.run([node, str(ROOT / "services/api/node_modules/prisma/build/index.js"),
                                      "migrate", "deploy"], cwd=ROOT / "services/api", env=env,
                                     stdout=log, stderr=subprocess.STDOUT)
            if applied.returncode == 0:
                break
            if attempt == 9:
                raise RuntimeError("Migration failed; inspect local migration log")
            time.sleep(1)
    recorded = pids()
    for name in names:
        if name in recorded:
            try:
                if owns(name, recorded[name]):
                    continue
                raise RuntimeError("Recorded process ownership changed: " + name)
            except ProcessLookupError:
                pass
        cwd = ROOT
        runtime = os.environ.copy()
        for key in ("DATABASE_URL", "REDIS_URL", "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_PEPPER",
                    "PUBLIC_ACCESS_SECRET", "PUBLIC_ACCESS_ENFORCED", "PUBLIC_BASE_URL",
                    "GRAPHQL_BODY_LIMIT", "HOST", "PASSWORD_AUTH_ENABLED", "CORS_ORIGINS", "PORT"):
            runtime.pop(key, None)
        if name in ("api", "worker"):
            cwd = ROOT / "services" / name
            argv = [node, "dist/main.js"]
            if name == "api":
                runtime = env.copy()
            else:
                runtime.update({key: env[key] for key in ("APP_ENV", "DATABASE_URL", "REDIS_URL")})
        elif name.endswith("-web"):
            argv = [str(ROOT / "tools/pnpm.sh"), "--filter", "@fairbite/" + name,
                    "dev", "--hostname", "127.0.0.1"]
            runtime.update(FAIRBITE_API_URL="http://127.0.0.1:4100/graphql",
                           FAIRBITE_WEB_ORIGIN=f"http://localhost:{PORTS[name]}")
        else:
            cwd = ROOT / "apps" / name
            argv = [node, str(cwd / "node_modules/expo/bin/cli"), "start", "--localhost",
                    "--port", str(PORTS[name]), "--web"]
            runtime.update(EXPO_PUBLIC_FAIRBITE_API_URL="http://localhost:4100/graphql",
                           EXPO_OFFLINE="1", CI="1")
        with (RUN / (name + ".log")).open("w") as log:
            child = subprocess.Popen(argv, cwd=cwd, env=runtime, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        recorded[name] = child.pid
        PID_FILE.write_text(json.dumps(recorded, indent=2) + "\n")
        print("Started " + name)


def status():
    def check(item):
        name, port = item
        url = f"http://localhost:{port}" + ("/health/ready" if name == "api" else "/")
        try:
            with urllib.request.urlopen(url, timeout=8) as response:
                return {"name": name, "url": url, "status": response.status}
        except Exception:
            return {"name": name, "url": url, "status": "unavailable"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        records = list(pool.map(check, PORTS.items()))
    try:
        alive = owns("worker", pids().get("worker", 0))
    except (ProcessLookupError, PermissionError):
        alive = False
    records.append({"name": "worker", "status": "running" if alive else "unavailable"})
    print(json.dumps(records, indent=2))
    return all(r["status"] in (200, "running") for r in records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop", "status"))
    parser.add_argument("--only", nargs="+", choices=NAMES, default=NAMES)
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "start":
            start(args.only, args.restart)
        elif args.command == "stop":
            stop(args.only)
        else:
            raise SystemExit(0 if status() else 1)
    except (OSError, RuntimeError, subprocess.SubprocessError, KeyError, StopIteration, ValueError):
        # Configuration and process environments must never be printed on failure.
        print("Local stack command failed. Inspect redacted local logs and process ownership.")
        raise SystemExit(1)
