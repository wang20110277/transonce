"""ACP (Agent Client Protocol) client: drive `transcode acp` over stdio.

Line-delimited JSON-RPC 2.0 (see transcode docs/ACP.md). One process per
run: initialize → session/new → session/prompt → collect streamed text →
process exits. Permissions are auto-allowed — containment is the throwaway
per-run workspace, the same contract the CLI providers get via
--dangerously-skip-permissions.
"""
import json
import os
import selectors
import shutil
import signal
import subprocess
import time


def resolve_transcode_cli() -> tuple[str | None, str | None]:
    """Resolve the transcode CLI → (path, PATH dir to prepend).

    The npm/bun global bin dir is often absent from the backend's PATH
    (started outside the user's shell profile), so fall back to the
    standard install locations, mirroring resolve_cli() in agents.py.
    """
    hit = shutil.which("transcode")
    if hit:
        return hit, None
    candidates = [
        os.path.expanduser("~/.bun/bin/transcode"),
        "/usr/local/bin/transcode",
        "/opt/homebrew/bin/transcode",
    ]
    for c in candidates:
        if os.access(c, os.X_OK):
            return c, os.path.dirname(c)
    return None, None


class _AcpConn:
    """One ACP child process; requests are strictly sequential per run."""

    def __init__(self, bin_path: str, cwd: str, env: dict[str, str]):
        self.proc = subprocess.Popen(
            [bin_path, "acp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=cwd,
            env=env,
            start_new_session=True,
        )
        self._next_id = 0
        self._stderr_tail: list[str] = []

    def close(self) -> None:
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            try:
                stream.close()
            except Exception:
                pass
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except Exception:
            self.proc.terminate()

    def _send(self, payload: dict) -> None:
        self.proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def _respond(self, request_id, result: dict) -> None:
        self._send({"jsonrpc": "2.0", "id": request_id, "result": result})

    def request(
        self,
        method: str,
        params: dict | None = None,
        on_update=None,
        timeout_s: float = 180.0,
    ) -> dict:
        """Send a JSON-RPC request and pump stdout until its response arrives.

        While waiting, server→client traffic is handled inline:
        - session/update notifications → on_update(update dict)
        - session/request_permission  → auto-allow (first allow option)
        - stderr is drained opportunistically to keep the pipe from filling.
        """
        self._next_id += 1
        req_id = self._next_id
        self._response_seen = False
        self._response_result = {}
        self._send({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}})

        sel = selectors.DefaultSelector()
        sel.register(self.proc.stdout, selectors.EVENT_READ, "out")
        sel.register(self.proc.stderr, selectors.EVENT_READ, "err")
        deadline = time.monotonic() + timeout_s

        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"ACP request '{method}' timed out after {timeout_s:.0f}s")
                for key, _ in sel.select(timeout=min(remaining, 0.5)):
                    stream = key.fileobj
                    if key.data == "out":
                        line = stream.readline()
                        if not line:
                            raise RuntimeError("transcode acp closed stdout unexpectedly")
                        self._handle_line(line, req_id, on_update)
                        if self._response_seen:
                            return self._response_result
                    else:
                        chunk = stream.readline()
                        if chunk:
                            self._stderr_tail.append(chunk)
        finally:
            sel.close()

    _response_seen: bool = False
    _response_result: dict = {}

    def _handle_line(self, line: str, waiting_id: int, on_update) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            return
        if msg.get("id") is not None and msg.get("method"):
            # Server → client request. Auto-allow permission prompts.
            if msg.get("method") == "session/request_permission":
                options = (msg.get("params") or {}).get("options") or []
                option_id = next(
                    (o["optionId"] for o in options if str(o.get("kind", "")).startswith("allow")),
                    "allow_once",
                )
                self._respond(msg["id"], {"outcome": {"outcome": "selected", "optionId": option_id}})
            else:
                self._respond(msg["id"], {})
            return
        if msg.get("method") == "session/update":
            if on_update:
                on_update((msg.get("params") or {}).get("update") or {})
            return
        if msg.get("id") == waiting_id:
            if msg.get("error"):
                raise RuntimeError(
                    f"ACP {waiting_id} error {msg['error'].get('code')}: {msg['error'].get('message')}"
                )
            self._response_result = msg.get("result") or {}
            self._response_seen = True

    def stderr_tail(self, limit: int = 800) -> str:
        return "".join(self._stderr_tail[-20:])[-limit:]


def run_acp_text(
    user_prompt: str,
    model: str | None = None,
    cwd: str | None = None,
    timeout_s: float = 180.0,
    env: dict[str, str] | None = None,
) -> str:
    """One-shot: run a prompt through `transcode acp` and return the final text.

    System/role context reaches the agent either pre-combined into the
    prompt text (text mode) or via the workspace contract file that the
    caller writes before spawning (agentic mode — transcode loads
    AGENTS.md/CLAUDE.md from its cwd into its system prompt).
    """
    bin_path, extra_dir = resolve_transcode_cli()
    if not bin_path:
        raise RuntimeError("transcode CLI not found (looked in PATH, ~/.bun/bin, /usr/local/bin)")

    child_env = dict(env or os.environ.copy())
    if extra_dir:
        child_env["PATH"] = extra_dir + os.pathsep + child_env.get("PATH", "")
    workdir = cwd or os.getcwd()

    conn = _AcpConn(bin_path, workdir, child_env)
    pieces: list[str] = []

    def on_update(update: dict) -> None:
        if update.get("sessionUpdate") == "agent_message_chunk":
            content = update.get("content") or {}
            if content.get("type") == "text" and content.get("text"):
                pieces.append(content["text"])

    try:
        conn.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}},
                "cwd": workdir,
            },
            timeout_s=30,
        )
        new_result = conn.request(
            "session/new",
            {"cwd": workdir, "mcpServers": [], **({"model": model} if model else {})},
            timeout_s=30,
        )
        session_id = new_result.get("sessionId")
        if not session_id:
            raise RuntimeError("session/new returned no sessionId")
        conn.request(
            "session/prompt",
            {"sessionId": session_id, "prompt": [{"type": "text", "text": user_prompt}]},
            on_update=on_update,
            timeout_s=timeout_s,
        )
        return "".join(pieces)
    except TimeoutError:
        conn.close()
        raise
    except Exception as exc:
        tail = conn.stderr_tail()
        conn.close()
        raise RuntimeError(f"{exc}\n[transcode stderr] {tail}") from exc
    finally:
        conn.close()
