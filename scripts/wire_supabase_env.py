#!/usr/bin/env python3
"""Wire RuleCloud Supabase keys into local .env files, Railway, and Vercel.

Requires: logged-in Supabase CLI (`npx supabase login`), Railway CLI, Vercel CLI.
Does not print secret values.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
RAILWAY = ROOT / ".tools" / "railway"


def run(cmd: list[str], *, check: bool = True) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"{' '.join(cmd)}\n{msg}")
    return proc.stdout


def pick_project(projects: list[dict]) -> dict:
    by_name = next(
        (p for p in projects if (p.get("name") or "").lower() == "rulecloud"),
        None,
    )
    if by_name:
        return by_name

    for project in projects:
        ref = project["ref"]
        keys = json.loads(
            run(
                [
                    "npx",
                    "supabase@latest",
                    "projects",
                    "api-keys",
                    "--remote",
                    ref,
                    "--reveal",
                    "-o",
                    "json",
                ]
            )
        )
        service = next(
            (k["api_key"] for k in keys if k.get("name") == "service_role"),
            None,
        )
        if not service:
            continue
        req = urllib.request.Request(
            f"https://{ref}.supabase.co/rest/v1/scan_jobs?select=id&limit=1",
            headers={
                "apikey": service,
                "Authorization": f"Bearer {service}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status == 200:
                    return project
        except urllib.error.HTTPError:
            continue
    raise SystemExit(
        "No Supabase project named rulecloud and no project with public.scan_jobs."
    )


def access_token() -> str:
    token_path = pathlib.Path.home().joinpath(".supabase", "access-token")
    if token_path.is_file():
        return token_path.read_text().strip()
    env = (os.getenv("SUPABASE_ACCESS_TOKEN") or "").strip()
    if env:
        return env
    proc = subprocess.run(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0 and proc.stdout.strip():
        return proc.stdout.strip()
    raise SystemExit(
        "No Supabase access token. Run `npx supabase login` or set SUPABASE_ACCESS_TOKEN."
    )


def jwt_secret(ref: str) -> str:
    token = access_token()
    for path in (f"projects/{ref}/postgrest", f"projects/{ref}/config/auth"):
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError:
            continue
        secret = data.get("jwt_secret")
        if secret:
            return secret
    raise SystemExit("Could not load JWT secret from Supabase Management API.")


def ensure_github_token_enc_key(env_path: pathlib.Path) -> None:
    """Keep GITHUB_TOKEN_ENC_KEY on Railway and in local .env (generate once if missing)."""
    if not RAILWAY.exists():
        return
    existing: str | None = None
    try:
        data = json.loads(run([str(RAILWAY), "variables", "--json"]))
        existing = (data.get("GITHUB_TOKEN_ENC_KEY") or "").strip() or None
    except Exception:
        pass
    text = env_path.read_text()
    local_val: str | None = None
    for line in text.splitlines():
        if line.startswith("GITHUB_TOKEN_ENC_KEY="):
            local_val = line.split("=", 1)[1].strip() or None
            break
    key = existing or local_val
    if not key:
        import secrets

        key = secrets.token_urlsafe(32)
        railway_set("GITHUB_TOKEN_ENC_KEY", key)
    elif not existing and local_val:
        railway_set("GITHUB_TOKEN_ENC_KEY", local_val)
    elif existing and existing != local_val:
        railway_set("GITHUB_TOKEN_ENC_KEY", key)
    lines: list[str] = []
    replaced = False
    for line in text.splitlines():
        if line.startswith("GITHUB_TOKEN_ENC_KEY="):
            lines.append(f"GITHUB_TOKEN_ENC_KEY={key}")
            replaced = True
        else:
            lines.append(line)
    if not replaced:
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(f"GITHUB_TOKEN_ENC_KEY={key}")
    env_path.write_text("\n".join(lines) + "\n")


def merge_github_webhook_secret(env_path: pathlib.Path) -> None:
    if not RAILWAY.exists():
        return
    try:
        raw = run([str(RAILWAY), "variables", "--json"])
        data = json.loads(raw)
        secret = data.get("GITHUB_WEBHOOK_SECRET")
        if secret:
            text = env_path.read_text()
            lines = []
            for line in text.splitlines():
                if line.startswith("GITHUB_WEBHOOK_SECRET="):
                    lines.append(f"GITHUB_WEBHOOK_SECRET={secret}")
                else:
                    lines.append(line)
            env_path.write_text("\n".join(lines) + "\n")
    except Exception:
        pass


def railway_set(key: str, value: str) -> None:
    if not RAILWAY.exists():
        print("skip railway (no .tools/railway)")
        return
    run([str(RAILWAY), "variables", "set", f"{key}={value}", "--skip-deploys"])


def vercel_cmd(env: dict[str, str]) -> list[str]:
    npx = shutil.which("npx", path=env.get("PATH"))
    if shutil.which("vercel", path=env.get("PATH")):
        return ["vercel"]
    if npx:
        return [npx, "vercel"]
    raise SystemExit("Vercel CLI not found. Install with `npm i -g vercel`.")


def vercel_set(key: str, value: str) -> None:
    nvm = pathlib.Path.home().joinpath(".nvm/versions/node/v24.11.1/bin")
    path = os.environ.get("PATH", "")
    if nvm.is_dir():
        path = f"{nvm}:{path}"
    env = {**os.environ, "PATH": path}
    cmd = vercel_cmd(env)

    for target in ("production", "preview", "development"):
        for rm_argv in (
            cmd + ["env", "rm", key, target, "--yes"],
            cmd + ["env", "remove", key, "--environment", target, "--yes"],
        ):
            subprocess.run(rm_argv, cwd=WEB, env=env, capture_output=True, text=True)
        add_args = [
            "env",
            "add",
            key,
            "--environment",
            target,
            "--yes",
            "--force",
            "--value",
            value,
        ]
        if key.startswith("NEXT_PUBLIC_"):
            add_args.append("--no-sensitive")
        proc = subprocess.run(
            cmd + add_args,
            cwd=WEB,
            env=env,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 and "already been added" not in (proc.stderr or proc.stdout):
            raise RuntimeError(
                f"vercel env add {key} {target}: {proc.stderr or proc.stdout}"
            )


def main() -> None:
    projects = json.loads(run(["npx", "supabase@latest", "projects", "list", "-o", "json"]))
    project = pick_project(projects)
    ref = project["ref"]
    url = f"https://{ref}.supabase.co"

    keys = json.loads(
        run(
            [
                "npx",
                "supabase@latest",
                "projects",
                "api-keys",
                "--remote",
                ref,
                "--reveal",
                "-o",
                "json",
            ]
        )
    )
    anon = next(k["api_key"] for k in keys if k.get("name") == "anon")
    service = next(k["api_key"] for k in keys if k.get("name") == "service_role")
    secret = jwt_secret(ref)

    root_env = ROOT / ".env"
    web_env = WEB / ".env.local"

    root_env.write_text(
        "\n".join(
            [
                "PORT=8000",
                "LOG_LEVEL=INFO",
                "FRONTEND_URL=https://rulecloud.vercel.app",
                "BACKEND_URL=https://rulecloud-production.up.railway.app",
                "GITHUB_WEBHOOK_SECRET=",
                "GITHUB_TOKEN_ENC_KEY=",
                "GUARDRAIL_BIN=guardrail",
                "GUARDRAIL_TIMEOUT_SEC=60",
                "GIT_CLONE_TIMEOUT_SEC=30",
                f"SUPABASE_URL={url}",
                f"SUPABASE_SERVICE_ROLE_KEY={service}",
                f"SUPABASE_JWT_SECRET={secret}",
                "",
            ]
        )
    )
    merge_github_webhook_secret(root_env)
    ensure_github_token_enc_key(root_env)

    web_env.write_text(
        "\n".join(
            [
                "NEXT_PUBLIC_API_URL=https://rulecloud-production.up.railway.app",
                f"NEXT_PUBLIC_SUPABASE_URL={url}",
                f"NEXT_PUBLIC_SUPABASE_ANON_KEY={anon}",
                "",
            ]
        )
    )

    root_text = root_env.read_text()
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET"):
        railway_set(key, root_text.split(f"{key}=")[1].split("\n")[0])

    railway_set("BACKEND_URL", "https://rulecloud-production.up.railway.app")
    railway_set("FRONTEND_URL", "https://rulecloud.vercel.app")
    # Sync encryption key from Railway → local .env and back if needed
    ensure_github_token_enc_key(root_env)

    for line in web_env.read_text().splitlines():
        if line.startswith("NEXT_PUBLIC_") and "=" in line:
            k, v = line.split("=", 1)
            vercel_set(k, v)

    if RAILWAY.exists():
        run([str(RAILWAY), "redeploy", "-y"], check=False)

    nvm_bin = pathlib.Path.home().joinpath(".nvm/versions/node/v24.11.1/bin")
    path = os.environ.get("PATH", "")
    if nvm_bin.is_dir():
        path = f"{nvm_bin}:{path}"
    env = {**os.environ, "PATH": path}
    subprocess.run(vercel_cmd(env) + ["--prod", "--yes"], cwd=WEB, env=env, check=False)
    print(f"OK project={project.get('name')} ref={ref}")
    print(f"Wrote {root_env} and {web_env}")
    print("Railway + Vercel updated (redeploy triggered).")


if __name__ == "__main__":
    main()