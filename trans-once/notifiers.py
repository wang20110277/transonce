"""Alert channel messaging: render one notification for each IM platform,
sign it and POST it to the group robot's webhook.

This module knows nothing about the platform: no database, no config. Callers
pass plain (already decrypted) values and get a result dict back. Choosing
which channels to talk to and logging the outcome live in `alert_notify.py`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlsplit, urlunsplit

PROVIDERS = ("dingtalk", "wecom", "feishu")
EVENTS = ("monitor", "manual", "status")
SEVERITIES = ("info", "warning", "critical")
DEFAULT_EVENTS = {"monitor": True, "manual": True, "status": False}
# 企业微信 markdown 上限 4096 字节，飞书请求体上限 20KB；统一按最严的那家截断并留出余量。
MAX_BODY_TEXT_BYTES = 3800
MAX_DETAIL_CHARS = 1000
MAX_ERROR_CHARS = 300
# 平台应答只有几百字节的 JSON；读多了没有用处。
MAX_RESPONSE_BYTES = 65536
SEND_TIMEOUT_SECONDS = 5
MASK = "••••••"
BRAND = "TransOnce"

SEVERITY_LABELS = {"info": "提示", "warning": "警告", "critical": "严重"}
STATUS_LABELS = {"open": "未处理", "acknowledged": "已确认", "resolved": "已解决"}


def _hmac_b64(key: bytes, message: bytes) -> str:
    return base64.b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode()


def dingtalk_sign(timestamp_ms: int, secret: str) -> str:
    """钉钉加签：以 secret 为密钥，对「毫秒时间戳 + 换行 + secret」做 HMAC-SHA256，
    结果 Base64 后再做 URL 编码，拼到 Webhook 地址的 timestamp / sign 参数上。"""
    text = f"{timestamp_ms}\n{secret}"
    return urllib.parse.quote_plus(_hmac_b64(secret.encode(), text.encode()))


def feishu_sign(timestamp_s: int, secret: str) -> str:
    """飞书签名校验：以「秒时间戳 + 换行 + secret」为密钥，对空串做 HMAC-SHA256，
    结果 Base64 后放在请求体的 timestamp / sign 字段里。"""
    return _hmac_b64(f"{timestamp_s}\n{secret}".encode(), b"")


def sanitize_error(text: str, *secrets: str | None) -> str:
    """去掉错误信息里可能出现的地址和密钥，并限制长度。"""
    out = text
    for secret in secrets:
        if secret:
            out = out.replace(secret, MASK)
    return out[:MAX_ERROR_CHARS]


def _url_parts_to_mask(url: str) -> list[str]:
    """发送失败时要一并去掉的地址片段：查询串和最后一段路径，凭证通常就在这两处。

    地址中间夹了空白或控制字符时，`http.client` 在建连前就抛 `InvalidURL`，并把路径和查询串原样写进异常文本，
    只替换整串地址挡不住。长度不大于 1 的片段不返回：避免把 `/` 也换掉，空串更不能拿去替换。
    """
    try:
        parts = urlsplit(url)
    except ValueError:  # 地址本身解析不了时只靠整串替换
        return []
    out = []
    if len(parts.query) > 1:
        out.append(parts.query)
    last = parts.path.rstrip("/").split("/")[-1]
    if len(last) > 1:
        out.append(last)
    return out


def truncate_utf8(text: str, limit: int) -> str:
    """按 UTF-8 字节数截断，不会切坏多字节字符；末尾的省略号占 3 字节。"""
    if len(text.encode()) <= limit:
        return text
    out = bytearray()
    for ch in text:
        raw = ch.encode()
        if len(out) + len(raw) > limit - 3:
            break
        out += raw
    return out.decode() + "…"


def mask_webhook(url: str | None) -> str | None:
    """保留协议、主机和路径，把凭证部分换成掩码加末 4 位。

    凭证是查询串（钉钉、企业微信）或最后一段路径（飞书）。凭证不超过 4 个字符时只留掩码。
    """
    if not url:
        return None
    parts = urlsplit(url)
    if parts.query:
        tail = parts.query[-4:] if len(parts.query) > 4 else ""
        return urlunsplit((parts.scheme, parts.netloc, parts.path, MASK + tail, ""))
    segments = parts.path.rstrip("/").split("/")
    if len(segments) > 1:
        last = segments[-1]
        tail = last[-4:] if len(last) > 4 else ""
        masked = "/".join(segments[:-1] + [MASK + tail])
        return urlunsplit((parts.scheme, parts.netloc, masked, "", ""))
    # 没有查询串也没有路径：地址里没有凭证部分，原样返回。
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def compose(event: str, *, tenant: str, title: str, severity: str = "", origin: str = "",
            environment: str = "", notified: list[str] | None = None,
            created_at=None, detail: str = "", status: str = "") -> tuple[str, list[str]]:
    """生成一条消息的标题和正文行。标题固定带「TransOnce」，方便在平台上配关键词校验。"""
    if event == "manual":
        headline = f"【{BRAND} 问题】{title}"
    elif event == "status":
        headline = f"【{BRAND} 告警】{title}：{STATUS_LABELS.get(status, status)}"
    else:
        headline = f"【{BRAND} 告警】{title}"
    lines = [f"租户：{tenant}"]
    if severity:
        lines.append(f"级别：{SEVERITY_LABELS.get(severity, severity)}")
    if origin:
        lines.append(f"来源：{origin}")
    if environment:
        lines.append(f"环境：{environment}")
    if notified:
        lines.append(f"通知：{'、'.join(notified)}")
    if created_at is not None:
        lines.append(f"时间：{created_at.astimezone().strftime('%Y-%m-%d %H:%M')}")
    if detail:
        cut = detail if len(detail) <= MAX_DETAIL_CHARS else detail[:MAX_DETAIL_CHARS] + "（已截断）"
        lines.append(f"详情：{cut}")
    return headline, lines


def render(provider: str, webhook: str, secret: str | None, headline: str,
           lines: list[str]) -> tuple[str, bytes]:
    """返回 (请求地址, 请求体)。钉钉的签名拼在地址上，飞书的签名放在请求体里。"""
    if provider == "dingtalk":
        url = webhook
        if secret:
            timestamp = int(time.time() * 1000)
            joiner = "&" if urlsplit(webhook).query else "?"
            url = f"{webhook}{joiner}timestamp={timestamp}&sign={dingtalk_sign(timestamp, secret)}"
        text = truncate_utf8(f"### {headline}\n\n" + "  \n".join(lines), MAX_BODY_TEXT_BYTES)
        body = {"msgtype": "markdown", "markdown": {"title": headline, "text": text}}
        return url, json.dumps(body, ensure_ascii=False).encode()
    if provider == "wecom":
        content = truncate_utf8(f"### {headline}\n" + "\n".join(lines), MAX_BODY_TEXT_BYTES)
        body = {"msgtype": "markdown", "markdown": {"content": content}}
        return webhook, json.dumps(body, ensure_ascii=False).encode()
    if provider == "feishu":
        body = {
            "msg_type": "post",
            "content": {"post": {"zh_cn": {
                "title": headline,
                "content": [[{"tag": "text", "text": line}] for line in lines],
            }}},
        }
        if secret:
            timestamp = int(time.time())
            body["timestamp"] = str(timestamp)
            body["sign"] = feishu_sign(timestamp, secret)
        return webhook, json.dumps(body, ensure_ascii=False).encode()
    raise ValueError(f"unknown alert channel provider: {provider}")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Webhook 必须自己应答，不跟随跳转到别处。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _platform_error(provider: str, status: int, raw: bytes) -> str | None:
    """判断平台的一次应答：成功返回 None，否则返回要写进推送记录的错误信息。

    飞书的错误码在 `code`，钉钉和企业微信的在 `errcode`。应答体是 JSON 对象且状态码是 2xx、但没有错误码
    （或错误码为 0）时按成功处理；应答体不是 JSON 对象，或者不是 2xx 又没有错误码可记时，记 `HTTP {状态码}`。
    非 2xx 的应答体也要看：飞书的签名、token 错误都是以 400 加 JSON 体返回的，错误码和原因都要记下来。
    """
    http_error = f"HTTP {status}"
    try:
        payload = json.loads(raw.decode(errors="replace"))
    except ValueError:  # 空应答或不是 JSON
        return http_error
    if not isinstance(payload, dict):
        return http_error
    code = payload.get("code" if provider == "feishu" else "errcode")
    if not code:
        # 2xx 且没有错误码（或为 0）是成功；其它状态码下没有错误码可记。
        return None if 200 <= status < 300 else http_error
    reason = payload.get("msg") or payload.get("errmsg") or ""
    return f"{code} {reason}".strip()


def send(provider: str, webhook: str, secret: str | None, headline: str,
         lines: list[str]) -> dict:
    """向一个机器人发一条消息。永不抛异常。

    返回 {"status": "sent" | "failed", "httpStatus": int | None,
          "error": str | None, "durationMs": int}
    """
    started = time.time()
    result = {"status": "failed", "httpStatus": None, "error": None, "durationMs": 0}
    try:
        url, body = render(provider, webhook, secret, headline, lines)
        request = urllib.request.Request(
            url, data=body, method="POST", headers={"Content-Type": "application/json"},
        )
        try:
            with _OPENER.open(request, timeout=SEND_TIMEOUT_SECONDS) as response:
                result["httpStatus"] = response.status
                # 只读前 64KB：地址可以指向内网，对端返回超大响应时不能一直读。
                status, raw = response.status, response.read(MAX_RESPONSE_BYTES)
        except urllib.error.HTTPError as exc:
            result["httpStatus"] = status = exc.code
            try:
                raw = exc.read()
            except Exception:  # 错误应答体读不到时只剩状态码
                raw = b""
        error = _platform_error(provider, status, raw)
        if error is None:
            result["status"] = "sent"
        else:
            result["error"] = sanitize_error(error, webhook, secret)
    except Exception as exc:  # 超时、连不上、地址非法
        result["error"] = sanitize_error(
            f"{type(exc).__name__}: {exc}", webhook, secret, *_url_parts_to_mask(webhook)
        )
    result["durationMs"] = int((time.time() - started) * 1000)
    return result
