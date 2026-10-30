"""Idempotent bootstrap: super admin only.

Tenants start empty — real data is created by users through the API/UI.
"""
import logging

import db
from config import ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
from security import hash_password

log = logging.getLogger("transonce.seed")


def seed() -> None:
    existing = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (ADMIN_EMAIL,))
    if existing:
        if not existing.get("is_super_admin"):
            db.execute("UPDATE users SET is_super_admin=TRUE WHERE id=%s", (existing["id"],))
        return
    db.execute_returning(
        """INSERT INTO users (email, name, password_hash, is_super_admin)
           VALUES (%s, %s, %s, TRUE) RETURNING *""",
        (ADMIN_EMAIL, ADMIN_NAME, hash_password(ADMIN_PASSWORD)),
    )
    log.info("super admin bootstrap: %s", ADMIN_EMAIL)
