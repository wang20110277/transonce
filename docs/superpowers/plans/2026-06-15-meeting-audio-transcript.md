# Meeting Audio → Transcript Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file-upload audio transcription to the 会议 (meetings) tab — the user uploads an audio file, the frontend POSTs it to the existing SenseVoice `/asr` service, and the returned transcript is appended into the notes box so the existing notes → requirements pipeline and meeting save work unchanged.

**Architecture:** Frontend-only change. No backend code, no migration, no schema change (confirmed against the approved spec §5–§7 and the current code). Two files are touched: a new `transcribeAudio(file)` transport helper in `client/src/services/api.ts`, and an upload control (drag-drop + click-to-browse) plus a notes-origin flag in `client/src/components/MeetingIngest.tsx`. The `/asr` → `:8001` Vite proxy already exists (`client/vite.config.ts:27-30`); `/asr` is **not** under `/api`, so the helper uses a standalone `fetch` rather than the `postJson` (which is hardcoded to the `/api` base).

**Tech Stack:** React 19, TypeScript (`tsc --noEmit`), Tailwind v4, shadcn/ui, lucide-react icons. The client has **no JS test runner** (no vitest/jest in `client/package.json`), so verification follows the project's established pattern and the spec §10: `npm run lint` type-check + manual smoke test.

**Spec deviation (called out, intentional):** Spec §5.3 and §7 reference `source: "asr"`, but the `Meeting.source` union in `client/src/types.ts:137` is `'manual' | 'upload' | 'transcription'` — there is no `"asr"` literal. The backend stores `source` as free-text with no validation (`server/main.py:130`: `body.get("source", "manual")` into a `source TEXT` column, per migration `0001_initial_schema.py:24`). Since §6 forbids backend changes and §7 forbids schema changes (adding `"asr"` to the union would be a type change needing a matching backend enum), this plan uses the **existing `"upload"` literal**. It is semantically exact (the meeting content came from a file upload) and requires zero backend/type/migration changes — fully satisfying §6 and §7.

---

## File Structure

- **Modify `client/src/services/api.ts`** — add `transcribeAudio(file: File): Promise<string>`. A standalone `fetch` to `/asr` (outside the `/api` base used by `postJson`). Returns the transcript text parsed from the `{"text": "..."}` ASR response.
- **Modify `client/src/components/MeetingIngest.tsx`** — add (a) upload state (`transcribing`, `uploadFileName`, `notesOrigin`, `dragOver`) and a hidden file input ref; (b) a `handleFile` async handler that calls `transcribeAudio`, appends the transcript to `notes`, and sets `notesOrigin = "upload"`; (c) a dropzone + click-to-browse UI block rendered between the participants input and the notes textarea; (d) change the hardcoded `source: "manual"` in `handleExtract` to `source: notesOrigin`.

No other files change. The existing manual-paste and Web Speech inputs are untouched (spec §5.2: all three fill the same notes box).

---

## Task 1: Add the `transcribeAudio` ASR helper

**Files:**
- Modify: `client/src/services/api.ts` (insert after the `patchJson` function, before `export interface ServerState`)

- [ ] **Step 1: Add the helper function**

Insert the following block in `client/src/services/api.ts`, immediately after the closing brace of `patchJson` (currently line 46) and before `export interface ServerState` (currently line 48):

```ts
/**
 * Upload an audio/video file to the SenseVoice ASR service and return the
 * transcript text. `/asr` is NOT under `/api` — Vite proxies it to the ASR
 * microservice on :8001 — so this is a standalone fetch, not `postJson`.
 * The ASR service returns `{"text": "<transcript>"}`.
 */
export async function transcribeAudio(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/asr", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`ASR ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.text ?? "").toString();
}
```

- [ ] **Step 2: Type-check**

Run: `cd client && npm run lint`
Expected: PASS with no output (no new errors). The function is exported but not yet imported anywhere; `tsconfig.json` does not enable `noUnusedLocals`, so an unused export does not fail.

- [ ] **Step 3: Commit**

```bash
git add client/src/services/api.ts
git commit -m "feat(client): add transcribeAudio helper for /asr upload"
```

---

## Task 2: Add the upload control and conditional source tag

**Files:**
- Modify: `client/src/components/MeetingIngest.tsx`

This task makes four edits to one file, then type-checks once and commits. The edits are sequenced so that every imported symbol is used by the end of the task (the file type-checks cleanly after Step 4).

- [ ] **Step 1: Extend the React import with the `DragEvent` type**

In `client/src/components/MeetingIngest.tsx`, change line 1 from:

```ts
import { useState, useRef, useEffect } from "react";
```

to:

```ts
import { useState, useRef, useEffect, type DragEvent } from "react";
```

- [ ] **Step 2: Add the `UploadCloud` icon import**

In the `lucide-react` import block (currently lines 2–11), add `UploadCloud` to the list. Change:

```ts
import {
  Mic,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  FileText,
  Wand2,
  Square,
} from "lucide-react";
```

to:

```ts
import {
  Mic,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  FileText,
  Wand2,
  Square,
  UploadCloud,
} from "lucide-react";
```

- [ ] **Step 3: Import `transcribeAudio`**

Immediately after the existing `import { addMeeting, addRequirements } from "../lib/store";` line (currently line 22), add:

```ts
import { transcribeAudio } from "../services/api";
```

- [ ] **Step 4: Add upload state**

Inside `MeetingIngest`, after the line `const recognitionRef = useRef<any>(null);` (currently line 65), add:

```ts
  const [transcribing, setTranscribing] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [notesOrigin, setNotesOrigin] = useState<"manual" | "upload">("manual");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 5: Add `handleFile` and `onDrop` handlers**

Immediately after the closing brace of `stopRecording` (currently line 123) and before `const canExtract = ...` (currently line 125), add:

```ts
  // Upload an audio/video file → transcribe via the SenseVoice ASR service,
  // then append the transcript to the notes box (same target as paste/voice).
  async function handleFile(file: File) {
    setError(null);
    setUploadFileName(file.name);
    setTranscribing(true);
    try {
      const transcript = await transcribeAudio(file);
      if (!transcript.trim()) {
        setError("ASR 返回了空转写结果，请确认音频包含有效语音后重试。");
        return;
      }
      setNotes((n) => (n ? n + "\n" : "") + transcript);
      setNotesOrigin("upload");
    } catch (e) {
      console.error(e);
      setError(
        "音频转写失败，请确认 ASR 服务已启动（端口 :8001）且 ffmpeg 可用后重试。",
      );
    } finally {
      setTranscribing(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !transcribing) handleFile(file);
  }
```

- [ ] **Step 6: Make the saved meeting's source reflect the upload origin**

In `handleExtract`, change the `source: "manual",` line inside the `addMeeting({...})` call (currently line 140) from:

```ts
        source: "manual",
```

to:

```ts
        source: notesOrigin,
```

(`notesOrigin` is `"manual" | "upload"`, a subset of `Meeting["source"]` (`'manual' | 'upload' | 'transcription'`), so this satisfies `addMeeting`'s `source?: Meeting["source"]` parameter without a type error.)

- [ ] **Step 7: Render the upload control**

Insert the following block **between** the participants input block (which ends at the closing `</div>` after the participants `<Input>`, currently line 217) and the notes block (which begins with `<div className="space-y-1.5">` and the 会议纪要 label, currently line 218). Place it directly after the participants block's closing `</div>`:

```tsx
          <div className="space-y-1.5">
            <label className="text-sm font-medium">上传音频转写</label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!transcribing) fileInputRef.current?.click();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !transcribing) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-3 py-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-primary/50"
              }`}
            >
              {transcribing ? (
                <>
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    正在转写 {uploadFileName ?? ""}…
                  </span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 text-muted-foreground" />
                  <span className="text-sm">
                    {uploadFileName ? (
                      <>
                        已选择：<span className="font-medium">{uploadFileName}</span>
                      </>
                    ) : (
                      "拖放音频文件到此处，或点击选择"
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    支持 mp3 / wav / webm / m4a / mp4，转写结果会填入下方纪要
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
```

- [ ] **Step 8: Type-check**

Run: `cd client && npm run lint`
Expected: PASS with no output (no new errors).

- [ ] **Step 9: Commit**

```bash
git add client/src/components/MeetingIngest.tsx
git commit -m "feat(client): add audio upload → transcript control to 会议 tab"
```

---

## Task 3: End-to-end verification (spec §10)

**Files:** none (verification only)

- [ ] **Step 1: Static verification — type-check passes**

Run: `cd client && npm run lint`
Expected: PASS, no output. (Covers spec §10.1.)

- [ ] **Step 2: Manual — happy path (spec §10.2)**

Prerequisites: ASR service running on `:8001` (`server/asr_service`), ffmpeg on `PATH`, SenseVoice model present at `server/models/SenseVoiceSmall`, and the main backend on `:9005`. Start the client with `cd client && npm run dev` (serves on `:3000`, proxies `/asr` → `:8001` and `/api` → `:9005`).

1. Open the 会议 tab.
2. Enter a title (e.g. "V1.0 需求评审会") and optional participants.
3. Drag (or click-to-browse) a short Chinese audio clip (mp3/wav/m4a/…) into the new 上传音频转写 dropzone.
4. Expected: a spinner shows with the filename ("正在转写 <file>…"), then the transcript text is appended into the 会议纪要 textarea.
5. Click "Agent 提取需求"; confirm requirements are extracted as before.
6. Adopt the requirements, then confirm the meeting appears (via `GET /api/state` → `meetings[]`) with `rawNotes` equal to the transcript and `source` equal to `"upload"`.

- [ ] **Step 3: Manual — ASR-down error path (spec §10.3)**

With the ASR service **stopped** (nothing listening on `:8001`), upload an audio file in the 会议 tab.

Expected: no uncaught exception; a clear red error message appears under the input card ("音频转写失败，请确认 ASR 服务已启动（端口 :8001）且 ffmpeg 可用后重试。"). The notes box is unchanged and the UI remains interactive.

- [ ] **Step 4: Commit the finished work (if any docs/notes changed)**

If no further files changed, this step is a no-op. Otherwise:

```bash
git add -A
git commit -m "chore: finalize meeting audio transcript feature"
```

---

## Out of scope (from spec §8 — do NOT implement)

AI meeting summary/minutes, meeting history/details view, raw audio file persistence, live microphone recording (MediaRecorder), speaker diarization, summary templates, re-transcription, transcript search, and production CORS/auth hardening for `/asr`. Each is a candidate for a later phase.
