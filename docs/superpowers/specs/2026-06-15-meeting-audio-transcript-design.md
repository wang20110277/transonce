# Meeting Records — Audio → Transcript Core — Design

- **Date:** 2026-06-15
- **Status:** Approved
- **Scope:** Add file-upload audio transcription to the 会议 (meetings) tab, using the existing SenseVoice ASR service, storing the transcript as the meeting record.

## 1. Goal

The 会议 tab currently accepts meeting notes via manual paste or browser Web Speech API, then extracts product requirements from them. A dedicated **SenseVoice ASR microservice** (`server/asr_service`, port `:8001`, `POST /asr`) already exists but is **not wired into the UI**.

This feature adds the meetily-style foundation: **upload an audio file → transcribe it server-side via the existing ASR service → store the transcript as the meeting record**, so it flows into the existing notes → requirements pipeline.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Scope this iteration | **Audio → transcript core** (foundation; no summary, no history view) |
| Audio source | **File upload only** (no live mic recording this iteration) |
| Backend flow | **Direct to `/asr` + save** (browser POSTs file to `/asr`, then saves the meeting) — no new backend code |
| Data model | **No schema change** — transcript stored as the meeting's `rawNotes` |

## 3. Prerequisite / branch context

This feature references paths under `client/` (`client/src/...`), which exist only after the **frontend/backend separation** (branch `chore/frontend-backend-separation`, spec `2026-06-15-frontend-backend-separation-design.md`). Implementation must occur on top of that change set (either on the separation branch, or after it is merged to `main`). If the separation is not yet applied, the frontend paths will be at the repo root instead.

## 4. User flow

1. User opens the **会议** tab, optionally enters a title and participants.
2. User uploads an audio file (mp3, wav, webm, m4a, mp4, …) via the new upload control.
3. The frontend POSTs the file to `/asr`; a spinner shows while transcribing.
4. The ASR service returns `{"text": "<transcript>"}`; the transcript is appended into the **notes** textarea.
5. The existing flow continues unchanged: the user may extract requirements from the transcript, then save the meeting. On save, the transcript becomes the meeting's `rawNotes` (the record).

## 5. Frontend changes (no backend, no migration)

### 5.1 `client/src/services/api.ts` — new helper

POST the file directly to `/asr` (it is **not** under `/api`; Vite proxies `/asr` → `:8001`). Parse the `text` field from the JSON response.

```ts
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

### 5.2 `client/src/components/MeetingIngest.tsx` — upload control

Add a file-upload control (file input + drag-and-drop dropzone, in the style of meetily's `ImportDropOverlay`):

- `accept="audio/*,video/*"`; support both drag-drop and click-to-browse.
- On file selected:
  - `setTranscribing(true)`, clear any prior error.
  - `const t = await transcribeAudio(file)`.
  - Append the transcript to the notes box: `setNotes(n => (n ? n + "\n" : "") + t)`.
  - On error: `setError(...)` with a clear message (including guidance if the ASR service is not running).
  - Finally `setTranscribing(false)`.
- Surface transcription state: a spinner while transcribing, the selected filename, and error text.
- **Keep** the existing manual-paste and Web Speech inputs; the upload is an additional input path and all three fill the same notes box.

### 5.3 Meeting source tag

When saving a meeting whose content came from an upload, send `source: "asr"` (the existing manual default is `"manual"`). This is backward compatible — `create_meeting` already accepts an optional `source` and defaults to `"manual"`.

## 6. Backend

**No changes.** Both required endpoints already exist:

- `POST /asr` (ASR service, `:8001`): accepts a file upload, decodes via ffmpeg to 16 kHz mono WAV, runs SenseVoice (language fixed to `zh` via `SENSEVOICE_LANGUAGE`), strips special tokens, returns `{"text": "<transcript>"}`.
- `POST /api/meetings` (main backend, `:9005`): accepts `{title, rawNotes, participants, source}`, inserts into the `meetings` table, returns the mapped meeting.

## 7. Data model

**No schema change.** The transcript is stored as the meeting's `rawNotes` — the meeting's content/record. The `source` field (`"asr"` vs `"manual"`) distinguishes origin. No migration, no new column.

## 8. Out of scope (explicit)

- AI meeting summary / minutes generation (meetily-style structured summary).
- Meeting history / details view (list + transcript/audio playback).
- Raw audio file persistence (only the transcript is stored).
- Live microphone recording (MediaRecorder) — upload only this iteration.
- Speaker diarization, summary templates, re-transcription, transcript search.
- Production CORS/auth hardening for `/asr` (dev relies on the Vite same-origin proxy).

Each of these is a candidate for a later phase; summary generation and the history/details view are the natural next steps.

## 9. Dependencies / operational requirements

- The **ASR service** (`server/asr_service`) must be running on `:8001` for transcription to work; the UI must handle connection/503 errors gracefully.
- **ffmpeg** must be on the host `PATH` (the ASR service shells out to it).
- The **SenseVoice** model must be present at `server/models/SenseVoiceSmall`.

## 10. Verification

1. `cd client && npm run lint` (`tsc --noEmit`) passes with no new errors.
2. Manual: start the ASR service, upload a short Chinese audio clip in the 会议 tab, confirm the transcript fills the notes box, save the meeting, and confirm it appears in the meetings list (via `/api/state`) with `rawNotes` equal to the transcript.
3. Manual: with the ASR service **stopped**, attempt an upload and confirm a clear error message is shown (no uncaught exception).
