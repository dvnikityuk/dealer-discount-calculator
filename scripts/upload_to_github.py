#!/usr/bin/env python3
"""
Upload all project files to GitHub via Git Database API.
Single commit with all 143 files — uses tree API for efficiency.
"""
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
import urllib.request

TOKEN = "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"
OWNER = "dvnikityuk"
REPO = "dealer-discount-calculator"
PROJECT_ROOT = Path("/home/z/my-project")

# Files that must be EXCLUDED from upload (security / size / noise)
EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", "data", "db", "upload",
    "download", "scripts/__pycache__", "skills", "agent-ctx",
}
EXCLUDE_FILES = {
    ".env", "tsconfig.tsbuildinfo", "bun.lock",  # bun.lock too big and not needed
}
EXCLUDE_PATTERNS = (".pyc", ".log", ".db", ".sqlite", ".db-journal")

API_BASE = "https://api.github.com"


def gh(method, path, body=None, expect=200):
    """Make a GitHub API request."""
    url = f"{API_BASE}/repos/{OWNER}/{REPO}/{path}" if not path.startswith("git/") else f"{API_BASE}/repos/{OWNER}/{REPO}/{path}"
    if path.startswith("git/"):
        url = f"{API_BASE}/repos/{OWNER}/{REPO}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            status = r.status
            content = r.read().decode()
    except urllib.error.HTTPError as e:
        status = e.code
        content = e.read().decode()
    if status != expect:
        print(f"  ERROR {method} {path} -> {status}", file=sys.stderr)
        print(f"  Response: {content[:500]}", file=sys.stderr)
        sys.exit(1)
    return json.loads(content) if content else {}


def list_files():
    """Walk project tree and yield (relative_path, abs_path) for files to upload."""
    for root, dirs, files in os.walk(PROJECT_ROOT):
        # filter dirs in-place
        rel_root = Path(root).relative_to(PROJECT_ROOT)
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            if any(f.endswith(p) for p in EXCLUDE_PATTERNS):
                continue
            abs_path = Path(root) / f
            rel_path = rel_root / f if str(rel_root) != "." else Path(f)
            # skip if too large (>1MB)
            try:
                size = abs_path.stat().st_size
            except OSError:
                continue
            if size > 1_000_000:
                print(f"  SKIP large: {rel_path} ({size} bytes)", file=sys.stderr)
                continue
            yield str(rel_path).replace("\\", "/"), abs_path


def create_blob(abs_path):
    """Create a blob and return its SHA."""
    data = abs_path.read_bytes()
    # Detect if binary — for source code, always text; use base64 for safety
    try:
        data.decode("utf-8")
        content = data.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content = base64.b64encode(data).decode()
        encoding = "base64"
    body = {"content": content, "encoding": encoding}
    resp = gh("POST", "git/blobs", body, expect=201)
    return resp["sha"]


def init_repo_with_readme():
    """GitHub requires the repo to be non-empty before using git/blobs API.
    Push a tiny README first via Contents API."""
    print("Initializing repo with placeholder README via Contents API...")
    body = {
        "message": "init",
        "content": base64.b64encode(b"# placeholder\n").decode(),
    }
    req = urllib.request.Request(
        f"{API_BASE}/repos/{OWNER}/{REPO}/contents/__init__.md",
        data=json.dumps(body).encode(),
        method="PUT",
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            r.read()
    except urllib.error.HTTPError as e:
        # 422 "already exists" is fine if retrying
        if e.code != 422:
            print(f"  WARN init: {e.code} {e.read().decode()[:200]}")
    print("  Repo initialized")


def main():
    print("Collecting files...")
    files = list(list_files())
    print(f"  Found {len(files)} files to upload")

    # Step 0: GitHub requires non-empty repo before git/blobs API works
    init_repo_with_readme()

    # Step 1: create blobs for all files (parallel batches via xargs would be faster,
    # but Python sequential is fine for 143 files)
    tree_entries = []
    print("Creating blobs...")
    for i, (rel_path, abs_path) in enumerate(files, 1):
        sha = create_blob(abs_path)
        tree_entries.append({
            "path": rel_path,
            "mode": "100644",
            "type": "blob",
            "sha": sha,
        })
        if i % 20 == 0:
            print(f"  {i}/{len(files)} blobs created")

    print(f"  All {len(tree_entries)} blobs created")

    # Step 2: create tree from all blobs
    print("Creating tree...")
    tree_resp = gh("POST", "git/trees", {"tree": tree_entries}, expect=201)
    tree_sha = tree_resp["sha"]
    print(f"  Tree SHA: {tree_sha}")

    # Step 3: get current main HEAD (from init commit) to use as parent
    print("Fetching current main HEAD...")
    try:
        ref_resp = gh("GET", "git/refs/heads/main")
        parent_sha = ref_resp["object"]["sha"]
        parents = [parent_sha]
        print(f"  Parent: {parent_sha}")
    except SystemExit:
        # main branch doesn't exist yet (shouldn't happen after init, but just in case)
        parents = []
        print("  No parent (will create root commit)")

    # Step 4: create commit
    print("Creating commit...")
    commit_msg = (
        "Initial commit: dealer discount calculator\n\n"
        "- Next.js 16 + TypeScript + Tailwind CSS + Prisma ORM\n"
        "- 143 source files including components, API routes, schemas\n"
        "- README, LICENSE, configs included\n"
        "- No secrets, no node_modules, no build artifacts"
    )
    commit_body = {
        "message": commit_msg,
        "tree": tree_sha,
        "parents": parents,
    }
    commit_resp = gh("POST", "git/commits", commit_body, expect=201)
    commit_sha = commit_resp["sha"]
    print(f"  Commit SHA: {commit_sha}")

    # Step 5: update main branch to point to this new commit
    print("Updating main branch...")
    gh("PATCH", "git/refs/heads/main", {"sha": commit_sha, "force": True}, expect=200)
    print(f"  refs/heads/main -> {commit_sha}")

    print()
    print("SUCCESS!")
    print(f"  Repo: https://github.com/{OWNER}/{REPO}")
    print(f"  Files: {len(tree_entries)}")
    print(f"  Commit: {commit_sha[:7]}")


if __name__ == "__main__":
    main()
