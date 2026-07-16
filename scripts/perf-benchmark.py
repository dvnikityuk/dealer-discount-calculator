#!/usr/bin/env python3
"""
Comprehensive performance benchmark for the dealer-discount-calculator app.
Saves results to /tmp/perf-results.json.
"""
import json
import os
import subprocess
import time
import statistics
import concurrent.futures as cf
import urllib.request
import urllib.error
import sys
from pathlib import Path

BASE = "http://localhost:3000"
N = 30                # samples per endpoint for latency
CONCURRENCY = 8       # parallel workers for concurrency test
OUT = "/tmp/perf-results.json"

results = {}


def http_get(path, timeout=10):
    """GET request, return dict with status, total_time, size, ttfb."""
    url = BASE + path
    req = urllib.request.Request(url, method="GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            # Read first byte timing approximated as time to headers
            ttfb = time.perf_counter() - t0
            body = r.read()
            total = time.perf_counter() - t0
            return {
                "status": r.status,
                "ttfb_s": round(ttfb, 4),
                "total_s": round(total, 4),
                "size_bytes": len(body),
            }
    except urllib.error.HTTPError as e:
        return {"status": e.code, "ttfb_s": None, "total_s": round(time.perf_counter() - t0, 4), "size_bytes": 0}
    except Exception as e:
        return {"status": 0, "error": str(e), "ttfb_s": None, "total_s": None, "size_bytes": 0}


def http_post(path, body=None, timeout=10):
    url = BASE + path
    data = body.encode() if body else b""
    req = urllib.request.Request(url, data=data, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ttfb = time.perf_counter() - t0
            r.read()
            total = time.perf_counter() - t0
            return {"status": r.status, "ttfb_s": round(ttfb, 4), "total_s": round(total, 4)}
    except Exception as e:
        return {"status": 0, "error": str(e), "ttfb_s": None, "total_s": None}


def pct(arr, p):
    if not arr:
        return None
    s = sorted(arr)
    k = (len(s) - 1) * (p / 100)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return round(s[f] + (s[c] - s[f]) * (k - f), 4)


def bench_endpoint(name, method, path, n=N, body=None):
    times = []
    statuses = []
    for _ in range(n):
        if method == "GET":
            r = http_get(path)
        else:
            r = http_post(path, body=body)
        if r.get("total_s") is not None:
            times.append(r["total_s"])
        statuses.append(r.get("status"))
        time.sleep(0.05)  # avoid hammering
    return {
        "samples": len(times),
        "statuses": list(set(statuses)),
        "min_s": min(times) if times else None,
        "p50_s": pct(times, 50),
        "p95_s": pct(times, 95),
        "p99_s": pct(times, 99),
        "max_s": max(times) if times else None,
        "mean_s": round(statistics.mean(times), 4) if times else None,
        "stddev_s": round(statistics.stdev(times), 4) if len(times) > 1 else 0,
    }


def concurrency_test(path, workers=CONCURRENCY, total=40):
    """Hammer endpoint with N parallel workers."""
    def one(_):
        return http_get(path)["total_s"] or 0
    t0 = time.perf_counter()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, range(total)))
    wall = time.perf_counter() - t0
    return {
        "workers": workers,
        "total_requests": total,
        "wall_time_s": round(wall, 3),
        "throughput_rps": round(total / wall, 2),
    }


# ──────────────────────────────────────────────────────────────────────
# 1. Endpoints latency
# ──────────────────────────────────────────────────────────────────────
print("=== 1. Endpoint latency benchmarks ===", flush=True)
endpoints = [
    ("GET /",                "GET",  "/"),
    ("GET /api/excel?q=1",   "GET",  "/api/excel?q=1"),
    ("GET /api/excel?q=2",   "GET",  "/api/excel?q=2"),
    ("GET /api/upload (405)","GET",  "/api/upload"),
    ("POST /api/drive/sync", "POST", "/api/drive/sync"),
    ("POST /api/quarter",    "POST", "/api/quarter", json.dumps({"quarter": 1})),
]
results["endpoints"] = {}
for ep in endpoints:
    name, method, path = ep[0], ep[1], ep[2]
    body = ep[3] if len(ep) > 3 else None
    print(f"  → {name}...", end=" ", flush=True)
    r = bench_endpoint(name, method, path, body=body)
    results["endpoints"][name] = r
    print(f"p50={r['p50_s']}s p95={r['p95_s']}s mean={r['mean_s']}s")

# ──────────────────────────────────────────────────────────────────────
# 2. Page payload analysis
# ──────────────────────────────────────────────────────────────────────
print("\n=== 2. Page payload analysis ===", flush=True)
r = http_get("/")
html = b""  # we'll re-fetch to keep body
req = urllib.request.Request(BASE + "/")
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read()

# Find all asset URLs in HTML (script src, link href)
import re
scripts = re.findall(rb'<script[^>]+src="(/[^"]+)"', html)
links = re.findall(rb'<link[^>]+href="(/[^"]+)"', html)
assets = [s.decode() for s in scripts] + [l.decode() for l in links if l.decode().endswith(".css")]

asset_info = []
for a in assets:
    if a.startswith("/_next"):
        full = BASE + a
        rr = http_get(a)
        asset_info.append({"url": a, "size_bytes": rr.get("size_bytes"), "ttfb_s": rr.get("ttfb_s")})

results["page_payload"] = {
    "html_size_bytes": len(html),
    "html_size_kb": round(len(html) / 1024, 1),
    "asset_count": len(asset_info),
    "assets": asset_info,
    "total_asset_bytes": sum(a["size_bytes"] or 0 for a in asset_info),
    "total_asset_kb": round(sum(a["size_bytes"] or 0 for a in asset_info) / 1024, 1),
}
print(f"  HTML: {results['page_payload']['html_size_kb']} KB")
print(f"  Assets: {len(asset_info)} files, total {results['page_payload']['total_asset_kb']} KB")

# ──────────────────────────────────────────────────────────────────────
# 3. Concurrency test
# ──────────────────────────────────────────────────────────────────────
print("\n=== 3. Concurrency test ===", flush=True)
results["concurrency"] = {}
for path in ["/", "/api/excel?q=1"]:
    print(f"  → {path} (workers={CONCURRENCY}, reqs=40)...", end=" ", flush=True)
    r = concurrency_test(path)
    results["concurrency"][path] = r
    print(f"{r['throughput_rps']} req/s")

# ──────────────────────────────────────────────────────────────────────
# 4. Server process metrics
# ──────────────────────────────────────────────────────────────────────
print("\n=== 4. Server process metrics ===", flush=True)
# Find next-server PID
ps = subprocess.run(["ps", "-eo", "pid,ppid,rss,vsz,pcpu,etime,comm"], capture_output=True, text=True)
server_procs = [l for l in ps.stdout.splitlines() if "next-server" in l or "node server.js" in l]
proc_info = []
for line in server_procs:
    parts = line.split()
    if len(parts) >= 7:
        proc_info.append({
            "pid": int(parts[0]),
            "ppid": int(parts[1]),
            "rss_kb": int(parts[2]),
            "vsz_kb": int(parts[3]),
            "pcpu": parts[4],
            "etime": parts[5],
            "comm": " ".join(parts[6:]),
        })
results["server_process"] = {
    "processes": proc_info,
    "rss_mb": round(proc_info[0]["rss_kb"] / 1024, 1) if proc_info else 0,
    "vsz_mb": round(proc_info[0]["vsz_kb"] / 1024, 1) if proc_info else 0,
}
if proc_info:
    print(f"  PID={proc_info[0]['pid']} RSS={results['server_process']['rss_mb']}MB VSZ={results['server_process']['vsz_mb']}MB uptime={proc_info[0]['etime']}")

# ──────────────────────────────────────────────────────────────────────
# 5. Build artifacts
# ──────────────────────────────────────────────────────────────────────
print("\n=== 5. Build artifacts ===", flush=True)
build_info = {}
next_dir = Path("/home/z/my-project/.next")
if next_dir.exists():
    standalone = next_dir / "standalone"
    if standalone.exists():
        total = sum(f.stat().st_size for f in standalone.rglob("*") if f.is_file())
        build_info["standalone_total_mb"] = round(total / 1024 / 1024, 2)
    static_dir = next_dir / "static"
    if static_dir.exists():
        chunks = list(static_dir.rglob("*.js"))
        chunk_total = sum(f.stat().st_size for f in chunks)
        build_info["static_chunks"] = len(chunks)
        build_info["static_js_kb"] = round(chunk_total / 1024, 1)
        # Largest chunks
        sorted_chunks = sorted(chunks, key=lambda f: f.stat().st_size, reverse=True)[:5]
        build_info["largest_chunks"] = [
            {"name": str(f.relative_to(static_dir)), "kb": round(f.stat().st_size / 1024, 1)}
            for f in sorted_chunks
        ]
    # server bundle
    server_dir = next_dir / "server"
    if server_dir.exists():
        server_total = sum(f.stat().st_size for f in server_dir.rglob("*") if f.is_file())
        build_info["server_bundle_mb"] = round(server_total / 1024 / 1024, 2)
results["build_artifacts"] = build_info
for k, v in build_info.items():
    if isinstance(v, list):
        print(f"  {k}:")
        for item in v:
            print(f"    - {item}")
    else:
        print(f"  {k}: {v}")

# ──────────────────────────────────────────────────────────────────────
# 6. Data files
# ──────────────────────────────────────────────────────────────────────
print("\n=== 6. Data files ===", flush=True)
data_info = {}
for name, p in [
    ("plans_xlsx", "/home/z/my-project/data/uploads/plans.xlsx"),
    ("facts_csv", "/home/z/my-project/data/uploads/facts.csv"),
    ("state_json", "/home/z/my-project/data/state.json"),
]:
    if os.path.exists(p):
        sz = os.path.getsize(p)
        data_info[name] = {"path": p, "size_bytes": sz, "size_kb": round(sz / 1024, 1)}
results["data_files"] = data_info
for k, v in data_info.items():
    print(f"  {k}: {v['size_kb']} KB")

# ──────────────────────────────────────────────────────────────────────
# 7. State rebuild time (using rebuild-state.ts)
# ──────────────────────────────────────────────────────────────────────
print("\n=== 7. State rebuild time (cold) ===", flush=True)
rebuild_times = []
for _ in range(3):
    t0 = time.perf_counter()
    r = subprocess.run(["bun", "scripts/rebuild-state.ts"], capture_output=True, text=True, cwd="/home/z/my-project")
    elapsed = time.perf_counter() - t0
    rebuild_times.append(round(elapsed, 3))
results["state_rebuild"] = {
    "samples_s": rebuild_times,
    "mean_s": round(statistics.mean(rebuild_times), 3),
    "min_s": min(rebuild_times),
    "max_s": max(rebuild_times),
}
print(f"  Mean: {results['state_rebuild']['mean_s']}s, range: {results['state_rebuild']['min_s']}–{results['state_rebuild']['max_s']}s")

# ──────────────────────────────────────────────────────────────────────
# 8. Save results
# ──────────────────────────────────────────────────────────────────────
results["meta"] = {
    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
    "samples_per_endpoint": N,
    "concurrency_workers": CONCURRENCY,
    "server": "Next.js 16.1.3 production (standalone)",
}
with open(OUT, "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print(f"\n✅ Results saved to {OUT}", flush=True)
print(f"Total size: {os.path.getsize(OUT)} bytes")
