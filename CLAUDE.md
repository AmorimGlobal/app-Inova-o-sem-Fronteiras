# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Inovação sem Fronteiras" — an internal innovation-submission app for Amorim Global, written as a single self-contained HTML file (vanilla JS, no framework, no build step) that runs **embedded inside Bitrix24** as a local app. Bitrix24 is the source of truth for data: ideas and leadership agendas ("pautas") are stored as cards in a Bitrix Smart Process funnel, created and read through the `BX24` JS bridge. UI text and identifiers are Portuguese (pt-BR) — keep it that way.

## Layout

- [app-inovacao/](app-inovacao/) — **the live app**. Everything you edit lives here.
  - [public/index.html](app-inovacao/public/index.html) — the entire app: CSS, ~1500 lines of JS, and two base64 PNG logos on lines 176–177 (do not try to read those lines).
  - [api/app.js](app-inovacao/api/app.js) — Vercel serverless function. Line 4 is a base64 copy of `public/index.html`; the rest is a 7-line handler. See "The base64 duplication" below.
  - [vercel.json](app-inovacao/vercel.json) — `includeFiles` for the function. Vestigial: the handler serves the embedded base64 string, it never reads the file from disk.
- [App_Inovacao_ligado_ao_bitrix.html](App_Inovacao_ligado_ao_bitrix.html) — **stale**. An earlier standalone snapshot, last touched at commit `de98431`; it lacks the whole persistent-read layer (`bitrixLoadAll`, `loadStages`, `loadPautaPerms`, pautas cards). Don't edit it and don't use it as a reference.
- `app-inovacao.zip` — packaging artifact for handing the app to IT / uploading to Bitrix. Regenerate it from `app-inovacao/` when the contents change.

There is no `package.json`, no dependencies, no lint config, and no test suite. Nothing to build or install.

## The base64 duplication (read before editing)

`api/app.js` exists because Bitrix24, in "server handler" mode, requests the app via **POST** — static hosting only answers GET. The function accepts GET and POST, and removes `X-Frame-Options` so the page can be iframed inside Bitrix24.

`api/app.js` line 4 is a byte-exact base64 of `public/index.html`. **Any edit to `public/index.html` must be followed by regenerating it**, or the deployed Bitrix app silently keeps serving the old UI while local browser testing looks correct.

Verified regeneration command (preserves the file's LF endings and no-BOM UTF-8):

```powershell
$src = "app-inovacao/public/index.html"; $dst = "app-inovacao/api/app.js"
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($src))
$lines = [IO.File]::ReadAllLines($dst); $lines[3] = 'const HTML_B64 = "' + $b64 + '";'
[IO.File]::WriteAllText($dst, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
```

To confirm the two are in sync, decode line 4 and diff it against `public/index.html` — they should be identical.

## Running and testing

Open `app-inovacao/public/index.html` directly in a browser. `window.BX24` will be absent, so the app takes its offline path: `MEMORIA` (in-memory arrays) instead of Bitrix, and `state.perm` forced to `{isAdmin: true, canPauta: true}` so every gated screen is reachable. No real card is created (`bitrixCreateCard` warns and resolves `{ok: true, memoria: true}` so the offline flow still reaches the confirmation screen), and everything is lost on reload. To exercise a logged-in view, stub `MEMORIA.perfil` — `init()` overwrites `state.profile` at the end, so patching `state.profile` alone has no effect.

A headless smoke test that catches boot-time JS errors and checks rendered markup:

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Start-Process $edge -ArgumentList @("--headless=new","--disable-gpu","--virtual-time-budget=9000",
  "--dump-dom","file:///$((Resolve-Path 'app-inovacao/public/index.html').Path -replace '\\','/')") `
  -RedirectStandardOutput "$env:TEMP\dump.html" -Wait -NoNewWindow
```

Inspect only the substring between `<div id="app">` and `<script>` — `--dump-dom` also serializes the inline script, so grepping the whole dump matches the source text rather than the rendered DOM.

Anything involving real cards, stage names, field discovery, user identity, or the pautas permission list can only be exercised with the app installed in Bitrix24 — there is no mock for `BX24`.

## Architecture of `public/index.html`

Sections are separated by banner comments (`/* ===== SECTION ===== */`); use those to navigate.

**Render model.** A single mutable `state` object (line ~390) plus `render()`, which rebuilds the whole page with `app.innerHTML = renderHeader() + renderContent()`. `renderContent()` dispatches on `state.tab` to one of four views: `renderHome`, `renderEnviar`, `renderMinhas`, `renderPautas`. Every `render*` function returns an HTML **string**, so all interpolated user/Bitrix data must go through `esc()`.

Consequences to respect:
- Interactivity is wired through **event delegation on `document`** (the `click`/`change`/`input` listeners near line 1349), keyed on `data-action` attributes. Never attach a listener to an element produced by a `render*` function — it gets destroyed on the next render. The one exception is `attachLiveListeners()`, re-run after each render, for the form progress bars.
- Form values are read from the DOM on submit (`readForm(flow)` collects `[data-field]` inside `#form-<flow>`), not tracked in `state`. Keystrokes deliberately do not trigger a render.
- Text filters *do* re-render, which destroys the focused input — `refocusInput()` restores focus and caret. Copy that pattern for any new filter input.
- `[data-track-dirty]` marks unsaved forms; `isFormDirty()` gates tab switches (`guardedSetTab`) and `beforeunload`.

**Two data layers, and they are not equivalent.**

1. `DATA_STORE` (line ~297) — the layer the code comments hand to the IT team. It `fetch()`es placeholder REST endpoints (`/api/inovacao/perfil|submissoes|pautas`) and falls back to `MEMORIA` when they 404, which they currently always do.
2. The Bitrix CRM layer (line ~563 onward) — the real persistence. `bitrixLoadAll()` calls `crm.item.list`, splits results by the Categoria field into submissions vs pautas (`mapItemToSubmission` / `mapItemToPauta`), and overwrites `state.submissions` / `state.pautas`. Submits go through `bitrixCreateCard` / `bitrixCreatePauta` (`crm.item.add`) and then re-read via `bitrixLoadAll()`.

**Bitrix failures must stay visible.** `bitrixCreateCard` / `bitrixCreatePauta` / `addSubmission` / `addPauta` resolve `{ok, erro}`, and callers must check `.ok` before showing success — an earlier version discarded the result and displayed "Ideia enviada!" with a protocol number even when `crm.item.add` was refused. Read failures land in `state.loadError` and surface as a banner on Painel and Minhas ideias. The submit handlers deliberately avoid `render()` between click and result, because the typed values live only in the DOM and a re-render would wipe them on failure; use `setSubmitBusy` / `mostrarErroEnvio` to update the button and error box in place.

Note the seam: submissions and pautas are read from and written to Bitrix, but `toggleInteresse` (the "quem contribuiu" list) and the profile cache still write only through `DATA_STORE`, so interest marks do not survive a reload. `mapItemToPauta` always returns `interessados: []`. If you touch that feature, this is the reason it looks broken.

**Bitrix wiring lives in `CONFIG`** (line ~440) — `entityTypeId: 1046`, `categoryId: 65`, and every `ufCrm13_*` field code, all hardcoded from the customer's Bitrix instance. Change funnel or fields there and nowhere else. Two safety nets exist and should be maintained when adding a field: `trackFieldTitles` lets `loadBitrixFields()` (via `crm.item.fields`) resolve a field by its human title if the code changes, and `statusStyle()` matches stage names by substring so any funnel naming works. Stage IDs are resolved to names at boot by `loadStages()` into `STAGE_MAP`.

**Permissions for publishing pautas** are stored in `BX24.appOption` under the key `inovacao_pautas_perm` (`{people: [{id, name}]}`) — shared config, editable in-app by Bitrix admins via the `pauta-*-admin` actions and `BX24.selectUsers`, so no code change is needed to grant access. `state.perm.canPauta = isAdmin || listed`, enforced in both `renderPautas` and `handleSubmitPauta`.

**Boot sequence** (`init()`, end of file, strictly ordered): inject the BX24 script → `loadBitrixFields` → `loadPautaPerms` → `loadStages` → `bitrixLoadAll` → `identifyViaBitrix` (`user.current` + `department.get` for the área, plus the mandatory `installFinish()`/`fitWindow()` calls — without `installFinish` the app renders blank on first install) → `render()`.

## Domain rules encoded in the code

Three submission tracks, each with its own form, required-field list, protocol prefix, and Categoria enum:

| Track | `flow` key | Prefix | Required fields | Categoria enum |
|---|---|---|---|---|
| Melhoria Incremental | `melhoria` | `MI` | `REQ_MELHORIA` | `225463` |
| Novos Horizontes | `novos` | `NH` | `REQ_NOVOS` | `225465` |
| Ponte de Negócios | `rede` | `RV` | `REQ_REDE` | `225467` |
| Pauta das lideranças | — | `PL` | — | `225493` |

`Novos Horizontes` is only open in the 3rd quarter — `isJanela3T()` (months 7–9) gates both the form UI and `handleSubmitForm`. Adding a track means touching all of: `FLOW_LABELS`, `PROTOCOL_PREFIX`, `LINE_STYLE`, `FIELD_LABELS`, `REQ_*`, `CONFIG.categoriaEnum`, `CAT_TO_LINHA`, `PROTOCOL_TO_FLOW`, a `renderForm*`, and the `attachLiveListeners` block.

Locally generated protocols (`genProtocol`) are only used for the confirmation screen and the card body; once read back from Bitrix the protocol becomes `"#" + item.id`.

## Conventions

Match the existing style rather than modernizing: `var` throughout, `function` expressions over arrow functions, string concatenation over template literals, `'use strict'` at the top of the one script block. `async/await` is used only in the data/submit functions. Comments are in Portuguese and several encode instructions for the customer's IT team — preserve them.
