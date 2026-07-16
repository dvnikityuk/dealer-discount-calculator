import subprocess
import time
import os
import signal

os.chdir("/home/z/my-project")
log = open("/tmp/next-supervised.log", "ab", buffering=0)

def start():
    p = subprocess.Popen(
        ["node", ".next/standalone/server.js"],
        stdout=log, stderr=subprocess.STDOUT,
        # Detach from process group
        start_new_session=True,
    )
    print(f"[{time.strftime('%H:%M:%S')}] Started PID {p.pid}", flush=True)
    return p

# Signal handler: forward SIGTERM to child
current = None
def forward(sig, frame):
    if current:
        try: current.terminate()
        except: pass
    os._exit(0)
signal.signal(signal.SIGTERM, forward)
signal.signal(signal.SIGINT, forward)

current = start()
while True:
    rc = current.poll()
    if rc is not None:
        print(f"[{time.strftime('%H:%M:%S')}] Process exited with rc={rc}, restarting...", flush=True)
        time.sleep(2)
        current = start()
    time.sleep(2)
