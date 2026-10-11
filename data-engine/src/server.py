import hashlib
import hmac
import os
import secrets
import time
import threading
from datetime import datetime, timezone
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from src import auto_runner
from src.auto_runner import run_cycle as auto_runner_run_cycle
from src.dashboard import render_dashboard, render_login
from src.utils.logging_utils import log_job_failure

DASHBOARD_USER = os.environ.get("DASHBOARD_USER", "admin")
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD")
SESSION_COOKIE = "de_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60


def _session_key() -> bytes:
    # Sessions are signed with the dashboard password; rotating it logs everyone out.
    return hashlib.sha256((DASHBOARD_PASSWORD or "").encode()).digest()


def _issue_session() -> str:
    expiry = str(int(time.time()) + SESSION_TTL_SECONDS)
    sig = hmac.new(_session_key(), expiry.encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{sig}"


def _session_valid(token: str) -> bool:
    try:
        expiry, sig = token.split(".", 1)
    except ValueError:
        return False
    expected = hmac.new(_session_key(), expiry.encode(), hashlib.sha256).hexdigest()
    if not secrets.compare_digest(sig, expected):
        return False
    try:
        return int(expiry) > time.time()
    except ValueError:
        return False

STATE = {
    "status": "Starting up...",
    "last_check": None,
    "last_error": None,
    "logs": []
}

def log_update(msg):
    print(msg)
    STATE["logs"].append({"time": datetime.now(timezone.utc).isoformat(), "msg": msg})
    if len(STATE["logs"]) > 50:
        STATE["logs"].pop(0)

class HealthCheckHandler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        # Unauthenticated on purpose: UptimeRobot only needs a 200 liveness signal.
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()

    def _authed(self) -> bool:
        if not DASHBOARD_PASSWORD:
            return False
        try:
            jar = SimpleCookie(self.headers.get("Cookie", ""))
        except CookieError:
            return False
        morsel = jar.get(SESSION_COOKIE)
        return bool(morsel and _session_valid(morsel.value))

    def _send_html(self, body: str, status: int = 200):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _redirect(self, location: str, set_cookie: str | None = None):
        self.send_response(303)
        self.send_header("Location", location)
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()

    def do_GET(self):
        route = urlparse(self.path)
        path = route.path

        if not DASHBOARD_PASSWORD:
            self._send_html(render_login(error="Dashboard password is not configured."), status=503)
            return

        if path == "/logout":
            cleared = f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
            self._redirect("/login", set_cookie=cleared)
            return

        if path == "/login":
            if self._authed():
                self._redirect("/")
                return
            failed = "error" in parse_qs(route.query)
            self._send_html(render_login(error="Invalid credentials." if failed else None))
            return

        if not self._authed():
            self._redirect("/login")
            return

        self._send_html(render_dashboard(STATE))

    def do_POST(self):
        if self.path != "/login" or not DASHBOARD_PASSWORD:
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(length).decode("utf-8"))
        user = form.get("username", [""])[0]
        password = form.get("password", [""])[0]
        try:
            ok = secrets.compare_digest(user, DASHBOARD_USER) and secrets.compare_digest(
                password, DASHBOARD_PASSWORD
            )
        except TypeError:
            ok = False

        if not ok:
            self._redirect("/login?error=1")
            return

        flags = f"Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL_SECONDS}"
        if self.headers.get("X-Forwarded-Proto", "http") == "https":
            flags += "; Secure"
        self._redirect("/", set_cookie=f"{SESSION_COOKIE}={_issue_session()}; {flags}")

    def log_message(self, format, *args):
        pass

def start_server():
    port = int(os.environ.get("PORT", 8080))
    server = HTTPServer(("0.0.0.0", port), HealthCheckHandler)
    log_update(f"[server] Listening on port {port} for UptimeRobot pings and dashboard...")
    server.serve_forever()

def start_worker():
    log_update(
        "[worker] Background worker started. Polls ~every 20 min during a race weekend, "
        "~every 6 h otherwise: outside a race weekend it never opens a DB connection."
    )
    memo = auto_runner.WorkerMemo()
    while True:
        result = None
        try:
            STATE["status"] = "Running checks..."
            STATE["last_check"] = datetime.now(timezone.utc).isoformat()
            log_update("[worker] Triggering auto_runner checks...")

            result = auto_runner_run_cycle(log_func=log_update, memo=memo)

            STATE["status"] = "Sleeping (Idle)"
            STATE["last_error"] = None
        except Exception as e:
            log_update(f"[worker] Worker caught error from auto_runner: {e}")
            log_job_failure("auto_runner", e)
            memo.tracked = None
            STATE["status"] = "Error"
            STATE["last_error"] = str(e)

        if result is not None:
            sleep_seconds = auto_runner.poll_interval_for_window(
                result.window, datetime.now(timezone.utc), schedule_available=result.schedule_available
            )
        else:
            sleep_seconds = auto_runner.ACTIVE_POLL_SECONDS  # cycle raised: fail-safe, retry soon
        log_update(f"[worker] Checks finished. Sleeping for {sleep_seconds // 60} minutes...")
        time.sleep(sleep_seconds)

def main():
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    start_worker()

if __name__ == "__main__":
    main()
