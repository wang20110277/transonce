"""Outbound URL guard (SSRF protection).

Monitor health checks accept operator-supplied URLs. Before fetching one we
resolve the host and reject targets that are only reachable from the platform's
own network unless they are explicitly declared as one of the tenant's
environments. Link-local/metadata endpoints are always rejected.

The guard is intentionally dependency-free and does not touch the database:
callers pass the set of allowed hosts/IPs derived from `environments`.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

# Hostnames that serve cloud metadata / control planes.
BLOCKED_HOSTNAMES = {
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
    "metadata.azure.internal",
}

# 100.64.0.0/10 (carrier-grade NAT) is not flagged by ipaddress.is_private on
# Python 3.12 but is commonly used by cloud metadata services (e.g. Aliyun).
SHARED_NETWORKS = (ipaddress.ip_network("100.64.0.0/10"),)


class UnsafeTarget(ValueError):
    """Raised when a URL is not a permitted outbound target."""


def _is_shared(ip: ipaddress._BaseAddress) -> bool:
    return any(ip in net for net in SHARED_NETWORKS if net.version == ip.version)


def resolve(host: str) -> set[str]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeTarget(f"无法解析主机: {host}") from exc
    ips = {str(info[4][0]).split("%")[0] for info in infos}
    if not ips:
        raise UnsafeTarget(f"无法解析主机: {host}")
    return ips


def targets_from_environments(rows: list[dict]) -> set[str]:
    """Collect the hosts/IPs a tenant has explicitly configured."""
    targets: set[str] = set()
    for row in rows:
        for value in (row.get("base_url"), row.get("ip")):
            if not value:
                continue
            text = str(value).strip()
            host = urlsplit(text).hostname if "://" in text else text
            if host:
                targets.add(host.strip("[]").lower())
    return targets


def validate_url(url: str, allowed_targets: set[str] | None = None) -> str:
    """Return a normalized URL or raise `UnsafeTarget`.

    Public http(s) targets are always allowed. Loopback/private/shared targets
    are allowed only when the hostname or one of its resolved IPs was declared
    by the tenant's environments.
    """
    if not url or not isinstance(url, str):
        raise UnsafeTarget("URL 不能为空")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise UnsafeTarget("仅支持 http/https 地址")
    if parts.username or parts.password:
        raise UnsafeTarget("URL 不能携带用户名或密码")
    host = (parts.hostname or "").strip("[]").lower()
    if not host:
        raise UnsafeTarget("URL 缺少主机名")
    if host in BLOCKED_HOSTNAMES:
        raise UnsafeTarget("禁止访问云元数据地址")

    allowed = {a.strip("[]").lower() for a in (allowed_targets or set())}
    host_allowed = host in allowed
    for raw in resolve(host):
        ip = ipaddress.ip_address(raw)
        if ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            raise UnsafeTarget(f"禁止访问保留地址: {raw}")
        if ip.is_loopback or ip.is_private or ip.is_reserved or _is_shared(ip):
            if not (host_allowed or raw in allowed):
                raise UnsafeTarget(
                    f"目标 {host} 属于内网地址，需先在「环境配置」中登记该主机或 IP"
                )

    path = parts.path or "/"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))
