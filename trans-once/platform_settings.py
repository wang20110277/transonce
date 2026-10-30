"""Platform-wide runtime settings stored in the `platform_settings` table.

One JSONB row per key, merged over defaults on read so new switches work on
databases migrated before the setting existed. Currently holds the auth/login
switches and the Microsoft OAuth client config; the client secret is encrypted
at rest with the platform SECRET_KEY (same scheme as environment passwords).
"""
from typing import Any

from psycopg2.extras import Json

import db
from security import decrypt_secret, encrypt_secret, mask_secret

AUTH_KEY = "auth"

DEFAULT_MICROSOFT = {
    "enabled": False,
    "tenantId": "common",
    "clientId": "",
    # stored encrypted under clientSecretEnc; never returned in the clear
    "clientSecret": "",
}

DEFAULT_AUTH_SETTINGS = {
    "passwordLoginEnabled": True,
    "registrationEnabled": True,
    "microsoft": DEFAULT_MICROSOFT,
}


def _decrypt(row: dict | None) -> dict:
    """Merge the stored row over the defaults, decrypting the MS secret."""
    stored = dict(row["value"]) if row and row.get("value") else {}
    ms = {**DEFAULT_MICROSOFT, **(stored.pop("microsoft", {}) or {})}
    ms["clientSecret"] = decrypt_secret(ms.pop("clientSecretEnc", None)) or ""
    return {**DEFAULT_AUTH_SETTINGS, **stored, "microsoft": ms}


def get_auth_settings() -> dict:
    row = db.fetch_one(
        "SELECT value FROM platform_settings WHERE key = %s", (AUTH_KEY,)
    )
    return _decrypt(row)


def save_auth_settings(patch: dict[str, Any]) -> dict:
    """Validate + merge a partial update, upsert the row, return the new value.

    `clientSecret` omitted → keep the stored secret (the UI sends nothing when
    the admin leaves the field blank); non-empty → replace; empty string → clear."""
    current = get_auth_settings()
    patch = dict(patch)
    ms_patch = dict(patch.pop("microsoft", None) or {})
    ms_patch.pop("clientSecretEnc", None)  # never accept a pre-encrypted value
    next_settings = {**current, **patch}

    ms = {**current["microsoft"]}
    secret = ms_patch.get("clientSecret", None)
    if secret is None:  # not provided → keep
        pass
    elif str(secret).strip() == "":
        ms["clientSecret"] = ""
    else:
        ms["clientSecret"] = str(secret).strip()
    ms_patch.pop("clientSecret", None)
    ms.update(ms_patch)
    if "enabled" in ms and ms["enabled"]:
        if not ms.get("clientId") or not ms.get("clientSecret"):
            raise ValueError("开启微软登录前，需要先填写 Client ID 和 Client Secret")
    next_settings["microsoft"] = ms

    stored = {k: v for k, v in next_settings.items() if k != "microsoft"}
    stored["microsoft"] = {
        **{k: v for k, v in ms.items() if k != "clientSecret"},
        "clientSecretEnc": encrypt_secret(ms["clientSecret"]) or None,
    }
    db.execute(
        """INSERT INTO platform_settings (key, value, updated_at)
           VALUES (%s, %s, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        (AUTH_KEY, Json(stored)),
    )
    return next_settings


def microsoft_ready(settings: dict) -> bool:
    """The Microsoft button only shows when the flow can actually complete."""
    ms = settings.get("microsoft") or {}
    return bool(
        ms.get("enabled") and ms.get("clientId") and ms.get("clientSecret")
    )


def public_auth_config(settings: dict) -> dict:
    """The subset the (unauthenticated) login page needs to render itself."""
    return {
        "passwordLoginEnabled": bool(settings.get("passwordLoginEnabled")),
        "registrationEnabled": bool(settings.get("registrationEnabled")),
        "microsoftEnabled": microsoft_ready(settings),
    }


def admin_auth_settings(settings: dict) -> dict:
    """Full settings for the super-admin UI; secret masked, never plaintext."""
    ms = settings.get("microsoft") or {}
    return {
        "passwordLoginEnabled": bool(settings.get("passwordLoginEnabled")),
        "registrationEnabled": bool(settings.get("registrationEnabled")),
        "microsoft": {
            "enabled": bool(ms.get("enabled")),
            "tenantId": ms.get("tenantId") or "common",
            "clientId": ms.get("clientId") or "",
            "hasClientSecret": bool(ms.get("clientSecret")),
            "clientSecretMasked": mask_secret(ms.get("clientSecret")),
        },
    }
