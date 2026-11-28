"""Per-user agent conversations and chat-driven orchestration."""
from fastapi import APIRouter, Body, Depends, HTTPException
from psycopg2.extras import Json

import acp_agent
import db
import orchestration
import serializers
from deps import get_current_user, load_tenant_context, log_activity

router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["chat"])


def _conversation_or_404(tenant_id: str, conversation_id: str, user: dict) -> dict:
    row = db.fetch_one(
        "SELECT * FROM conversations WHERE id=%s AND tenant_id=%s AND user_id=%s",
        (conversation_id, tenant_id, user["id"]),
    )
    if not row:
        raise HTTPException(404, "对话不存在")
    return row


@router.get("/conversations")
def list_conversations(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    rows = db.fetch_all(
        """SELECT * FROM conversations WHERE tenant_id=%s AND user_id=%s
           ORDER BY updated_at DESC LIMIT 50""",
        (tenant_id, user["id"]),
    )
    return [serializers.conversation(r) for r in rows]


@router.post("/conversations")
def create_conversation(tenant_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    agent = orchestration.ensure_personal_agent(ctx)
    row = db.execute_returning(
        """INSERT INTO conversations (tenant_id, user_id, agent_id, title, context)
           VALUES (%s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, user["id"], agent["id"],
            body.get("title") or "与 Agent 的对话",
            Json(body.get("context") or {}),
        ),
    )
    return serializers.conversation(row)


@router.get("/conversations/{conversation_id}/messages")
def list_messages(tenant_id: str, conversation_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    _conversation_or_404(tenant_id, conversation_id, user)
    rows = db.fetch_all(
        "SELECT * FROM messages WHERE conversation_id=%s ORDER BY created_at",
        (conversation_id,),
    )
    return [serializers.message(r) for r in rows]


@router.patch("/conversations/{conversation_id}")
def update_conversation(tenant_id: str, conversation_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    conv = _conversation_or_404(tenant_id, conversation_id, user)
    row = db.execute_returning(
        "UPDATE conversations SET title=%s, context=%s, updated_at=now() WHERE id=%s RETURNING *",
        (
            body.get("title") or conv["title"],
            Json(body.get("context") if body.get("context") is not None else conv.get("context") or {}),
            conversation_id,
        ),
    )
    return serializers.conversation(row)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(tenant_id: str, conversation_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    _conversation_or_404(tenant_id, conversation_id, user)
    db.execute("DELETE FROM conversations WHERE id=%s", (conversation_id,))
    return {"ok": True}


@router.post("/conversations/{conversation_id}/messages")
def send_message(tenant_id: str, conversation_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    conv = _conversation_or_404(tenant_id, conversation_id, user)
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(400, "消息不能为空")
    if body.get("context") is not None:
        # Merge rather than replace: the pending confirmation lives in the
        # conversation context and must survive the next turn's page context.
        conv = db.execute_returning(
            """UPDATE conversations
               SET context = COALESCE(context, '{}'::jsonb) || %s::jsonb
               WHERE id=%s RETURNING *""",
            (Json(body["context"]), conversation_id),
        )

    user_msg = db.execute_returning(
        """INSERT INTO messages (conversation_id, role, content) VALUES (%s, 'user', %s) RETURNING *""",
        (conversation_id, content),
    )
    log_activity(ctx, "agent.chat", {"conversationId": conversation_id, "message": content[:160]})
    assistant = orchestration.handle_chat(ctx, conv, content, bool(body.get("confirm")))
    return {
        "userMessage": serializers.message(user_msg),
        "assistantMessage": assistant,
    }


@router.post("/chat")
def quick_chat(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    """Create (or reuse) a conversation and send one message — used by the
    floating agent console and page-level 'ask agent' actions."""
    ctx = load_tenant_context(user, tenant_id)
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(400, "消息不能为空")
    conversation_id = body.get("conversationId")
    if conversation_id:
        conv = _conversation_or_404(tenant_id, conversation_id, user)
    else:
        agent = orchestration.ensure_personal_agent(ctx)
        conv = db.execute_returning(
            """INSERT INTO conversations (tenant_id, user_id, agent_id, title, context)
               VALUES (%s, %s, %s, %s, %s) RETURNING *""",
            (
                tenant_id, user["id"], agent["id"], content[:24] or "与 Agent 的对话",
                Json(body.get("context") or {}),
            ),
        )
    user_msg = db.execute_returning(
        "INSERT INTO messages (conversation_id, role, content) VALUES (%s, 'user', %s) RETURNING *",
        (conv["id"], content),
    )
    assistant = orchestration.handle_chat(ctx, conv, content, bool(body.get("confirm")))
    return {
        "conversation": serializers.conversation(conv),
        "userMessage": serializers.message(user_msg),
        "assistantMessage": assistant,
    }


@router.post("/conversations/{conversation_id}/cancel")
def cancel_reply(tenant_id: str, conversation_id: str, user: dict = Depends(get_current_user)):
    """停止该对话正在生成的回复（transcode session/cancel）。"""
    _conversation_or_404(tenant_id, conversation_id, user)
    hit = acp_agent.cancel(f"chat:{conversation_id}")
    return {"cancelled": hit}
