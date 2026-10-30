"""Platform-wide runtime settings stored in the `platform_settings` table.

One JSONB row per key, merged over defaults on read so new switches work on
databases migrated before the setting existed. Currently holds the auth/login
switches plus two redirect-based identity providers — Microsoft and a generic
OIDC provider (Keycloak / Casdoor / Authing / Google / ...). Client secrets are
encrypted at rest with the platform SECRET_KEY (same scheme as environment
passwords) and are write-only: they never leave the backend unmasked.
"""
from typing import Any

from psycopg2.extras import Json

import db
from security import decrypt_secret, encrypt_secret, mask_secret

AUTH_KEY = "auth"

# Redirect-based providers share one shape; both keep their secret under
# clientSecretEnc (write-only) in the stored row.
DEFAULT_MICROSOFT = {
    "enabled": False,
    "tenantId": "common",
    "clientId": "",
    "clientSecret": "",
}

DEFAULT_OIDC = {
    "enabled": False,
    "issuerUrl": "",
    "clientId": "",
    "clientSecret": "",
    "displayName": "",  # 登录按钮文案；空 = 「使用单点登录（OIDC）」
    "scope": "openid profile email",
}

PROVIDERS = {"microsoft": DEFAULT_MICROSOFT, "oidc": DEFAULT_OIDC}

DEFAULT_AUTH_SETTINGS = {
    "passwordLoginEnabled": True,
    "registrationEnabled": True,
    "microsoft": DEFAULT_MICROSOFT,
    "oidc": DEFAULT_OIDC,
}

# What a provider needs before it can be enabled (and advertised on the login
# page). Checked on save so the switch never turns on half-configured.
_PROVIDER_REQUIRED_FIELDS = {
    "microsoft": ("clientId", "clientSecret"),
    "oidc": ("issuerUrl", "clientId", "clientSecret"),
}


def _decrypt(row: dict | None) -> dict:
    """Merge the stored row over the defaults, decrypting provider secrets."""
    stored = dict(row["value"]) if row and row.get("value") else {}
    out = {k: v for k, v in stored.items() if k not in PROVIDERS}
    for key, defaults in PROVIDERS.items():
        block = {**defaults, **(stored.get(key) or {})}
        block["clientSecret"] = decrypt_secret(block.pop("clientSecretEnc", None)) or ""
        out[key] = block
    return {**DEFAULT_AUTH_SETTINGS, **out}


def get_auth_settings() -> dict:
    row = db.fetch_one(
        "SELECT value FROM platform_settings WHERE key = %s", (AUTH_KEY,)
    )
    return _decrypt(row)


def save_auth_settings(patch: dict[str, Any]) -> dict:
    """Validate + merge a partial update, upsert the row, return the new value.

    Provider `clientSecret` omitted → keep the stored secret (the UI sends
    nothing when the admin leaves the field blank); non-empty → replace;
    empty string → clear."""
    current = get_auth_settings()
    patch = dict(patch)
    provider_patches: dict[str, dict] = {}
    for key in PROVIDERS:
        provider_patches[key] = dict(patch.pop(key, None) or {})
        provider_patches[key].pop("clientSecretEnc", None)  # never accept pre-encrypted

    next_settings = {**current, **patch}

    for key, defaults in PROVIDERS.items():
        block = {**(current.get(key) or defaults)}
        p = provider_patches[key]
        secret = p.get("clientSecret", None)
        if secret is None:  # not provided → keep
            pass
        elif str(secret).strip() == "":
            block["clientSecret"] = ""
        else:
            block["clientSecret"] = str(secret).strip()
        p.pop("clientSecret", None)
        block.update(p)
        if block.get("enabled"):
            missing = [
                f for f in _PROVIDER_REQUIRED_FIELDS[key] if not block.get(f)
            ]
            if missing:
                label = "微软登录" if key == "microsoft" else "OIDC 登录"
                raise ValueError(f"开启{label}前，需要先配置 {' / '.join(missing)}")
        next_settings[key] = block

    stored = {k: v for k, v in next_settings.items() if k not in PROVIDERS}
    for key, block in PROVIDERS.items():
        merged = next_settings[key]
        stored[key] = {
            **{k: v for k, v in merged.items() if k != "clientSecret"},
            "clientSecretEnc": encrypt_secret(merged["clientSecret"]) or None,
        }
    db.execute(
        """INSERT INTO platform_settings (key, value, updated_at)
           VALUES (%s, %s, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        (AUTH_KEY, Json(stored)),
    )
    return next_settings


def _provider_ready(settings: dict, key: str) -> bool:
    block = settings.get(key) or {}
    return all(
        bool(block.get(f)) for f in _PROVIDER_REQUIRED_FIELDS[key]
    ) and bool(block.get("enabled"))


def microsoft_ready(settings: dict) -> bool:
    return _provider_ready(settings, "microsoft")


def oidc_ready(settings: dict) -> bool:
    return _provider_ready(settings, "oidc")


def public_auth_config(settings: dict) -> dict:
    """The subset the (unauthenticated) login page needs to render itself."""
    return {
        "passwordLoginEnabled": bool(settings.get("passwordLoginEnabled")),
        "registrationEnabled": bool(settings.get("registrationEnabled")),
        "microsoftEnabled": microsoft_ready(settings),
        "oidcEnabled": oidc_ready(settings),
        "oidcDisplayName": (settings.get("oidc") or {}).get("displayName") or "",
    }


def admin_auth_settings(settings: dict) -> dict:
    """Full settings for the super-admin UI; secrets masked, never plaintext."""

    def masked_block(key: str) -> dict:
        block = settings.get(key) or {}
        out = {k: v for k, v in block.items() if k != "clientSecret"}
        out["hasClientSecret"] = bool(block.get("clientSecret"))
        out["clientSecretMasked"] = mask_secret(block.get("clientSecret"))
        return out

    return {
        "passwordLoginEnabled": bool(settings.get("passwordLoginEnabled")),
        "registrationEnabled": bool(settings.get("registrationEnabled")),
        "microsoft": masked_block("microsoft"),
        "oidc": masked_block("oidc"),
    }
