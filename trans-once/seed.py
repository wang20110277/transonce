"""Idempotent bootstrap: super admin only.

Tenants start empty — real data is created by users through the API/UI.

超管身份可在界面里转让（转让后原账号降为普通用户，平台始终只有一个超管），
因此这里只在**全平台没有任何超管**时才补建种子账号——绝不能在每次启动时
把种子账号重新提权，否则转让会被重启悄悄撤销。
"""
import logging

import db
from config import ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
from security import hash_password

log = logging.getLogger("transonce.seed")


def seed() -> None:
    any_admin = db.fetch_one("SELECT id FROM users WHERE is_super_admin LIMIT 1")
    if any_admin:
        return
    existing = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (ADMIN_EMAIL,))
    if existing:
        # 平台没有超管但种子账号存在（转让后的极端场景）→ 恢复它
        db.execute("UPDATE users SET is_super_admin=TRUE WHERE id=%s", (existing["id"],))
        log.info("super admin restored: %s", ADMIN_EMAIL)
        return
    db.execute_returning(
        """INSERT INTO users (email, name, password_hash, is_super_admin)
           VALUES (%s, %s, %s, TRUE) RETURNING *""",
        (ADMIN_EMAIL, ADMIN_NAME, hash_password(ADMIN_PASSWORD)),
    )
    log.info("super admin bootstrap: %s", ADMIN_EMAIL)
