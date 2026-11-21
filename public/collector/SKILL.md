---
name: ai-partner-style-collector
description: Scan local agent logs with the verified collect.py and submit one minimal AI Partner Style Guide observation.
---

# Submit one AI Partner Style Guide observation

This is a record of how the user leads a coding agent. The letters use the custom rubric `agent-workstyle-v2`, judged from the user's own turns. This is not a personality test, not a psychological diagnosis, and not a claim that a model has a fixed personality. The site checks that the summary is internally consistent. It cannot check the logs that stay on this machine.

You run `public/collector/collect.py`. You do not write a scanner, and you do not walk the disk looking for logs.

## Show one confirmation

The prompt already names the destination, the session, the nickname, the expiry, the write token, and the scope. Do not ask the user to pick sources, dates, or a Tokscale mode.

Show the confirmation paragraph from the prompt. Wait for one explicit yes. That yes sets both `localAnalysisApproved` and `aggregateUploadApproved` to true. Before the yes, leave both false and do not run the script. After the yes, do not ask for a second confirmation, and do not print the type or the full summary in the terminal.

A resumed prompt is a new destination. The previous yes does not cover it. Show the new confirmation and wait again. Then submit the summary you already have. Do not scan again.

## Verify the script

Download `{origin}/collector/collect.py`. Compute its SHA-256 and compare it to the hash in the prompt.

```
shasum -a 256 collect.py
```

If the hash differs, stop. Do not edit the script. It uses the Python 3 standard library only.

## Run the scan

Use the scope line from the prompt. `TOKSCALE_MODE` is `off`, `existing`, or `install`.

```
python3 collect.py scan --from FROM --to TO --tz TZ --sources SOURCES --tokscale TOKSCALE_MODE --out digest.json
```

The window is whole local days. `from` is local midnight of the first day. `to` is now. A timestamp counts when `from <= timestamp < to`. The script lists candidate log files from each adapter root without reading them, keeps regular files whose modification time is inside that window, and skips symbolic links. OpenCode and Hermes keep many sessions in one database, so each top-level session in the window is listed as its own item and read on its own. Codex logs come from `~/.codex`, every `~/.codex-*` profile, and the folder `CODEX_HOME` names. Claude Code logs come from `~/.claude`, every `~/.claude-*` profile, and the folder `CLAUDE_CONFIG_DIR` names. A folder reached twice is read once. It then reads the listed files in a fixed order, ranked by a hash of each file's path under the home folder, until it has 24 candidates or the time budget runs out. A repeat scan of the same logs reads the same sessions, and a new log only takes a slot it outranks. The default budget is 20 seconds. Pass `--budget-seconds` to change it. A text log of 2 MB or smaller is read whole. A larger text log is read from the first 1 MB and the last 1 MB, and a partial line at each cut is dropped. SQLite logs use a bounded query. Do not add skipped files back, and do not treat modification time as a message timestamp. A Cursor transcript with no timestamps counts only when both its creation time and its modification time are inside the window.

After sampling, the script makes a second pass over the same Claude Code, Codex, and Cursor files in the same order, with its own budget of about 6 seconds. It reads each file with the same head and tail cap and looks only at lines that carry a tool call or the opening human message, at most 4 KiB per line. It counts sessions that ran without a human, subagent sessions, and sessions that wrote or reused agent assets such as `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `scripts/`, CI workflows, launch agents, and hooks. File paths are compared in memory and never written. The counts land in `systemEvidence`, with `filesScanned` against `filesListed`.

The script writes `digest.json` with mode `0600` as soon as both passes finish, then starts Tokscale. Tokscale keeps running after the scan exits. Read the digest. Do not paste it into the chat, and do not upload it. The terminal prints candidate counts, files read, system files scanned against listed, digest size, timing, and whether Tokscale started.

Copy `observedPeriod`, `coverage`, `metrics`, and `systemEvidence` into the summary unchanged. The digest token fields are empty at this point. `tokenSource` is `unavailable`, both token counts are null, and `modelUsage` is empty. Leave those fields as copied. Do not fill token totals from the logs. Submit replaces them from the Tokscale output.

`observedPeriod` is the local dates the script actually saw. It can be narrower than the granted window. Task dates have to fall inside it.

`coverage.scope` is `partial` whenever a gap remains or the budget or a read cap stops the sample early, and `insufficient` when no candidate was kept. This script always records `web_history_unavailable` and `no_artifact_inspection`, so a scan that kept a candidate stays `partial`. Do not rewrite `partial` to `adequate`.

Gaps you may see:

- `web_history_unavailable`. Browser history was not read.
- `no_artifact_inspection`. Project files were not opened.
- `no_tokscale`. Token totals were not available.
- `partial_window`. A chat log had no per-line times, and the session was not fully inside the window.
- `unattributed_runs`. A record had no usable timestamp. Cursor transcripts often have none.
- `insufficient_records`. No sampled file had two human messages and an agent message inside the window.
- `other_sources_missing`. A requested source has no local adapter here, or its log root is missing. `antigravity` and `chatgpt` have no local adapter.

Grok, OpenCode, and Hermes count as `other`. `sampledSessions` is the number of files the script actually read. It is not the candidate count. `humanSessions`, `automatedSessions`, `subagentSessions`, and `userMessages` stay null. Leave them null.

Token totals come only from Tokscale, grouped by client and model, for the local dates of the window. Null stays null. Do not copy token totals out of local logs, and do not replace null with zero. When `tokenSource` is `unavailable`, both token counts stay null and `modelUsage` stays empty. When `modelUsageUnit` is `unknown`, `modelUsage` stays empty. A tie, or a zero count, makes `mostUsedModelFamily` or `mostUsedClient` `unknown`. When Tokscale has no client totals, the scan sets `mostUsedClient` to the client with the most session files in the window, and a tie leaves it `unknown`.

The script uses a `tokscale` binary that is already on `PATH` for `existing` and for `install`. Only `install`, and only when that binary is missing, runs `npm exec --yes @tokscale/cli@4.18.0` once. If that binary is missing, or Tokscale fails, the digest keeps `tokenSource` `unavailable`, null token counts, and gap `no_tokscale`. Do not install Tokscale yourself. Do not run its TUI, `login`, `usage`, `sync`, `submit`, or `autosubmit`. Do not pass `sudo`.

## Classify from user turns

`candidates` holds at most 24 sessions, refs `C01` through `C24`. Each one has at least two human messages and one agent message. Tool calls alone do not qualify. A session whose first human message is an automation template, or this site's own prompt, is left out. The same first human message, compared on its first 120 characters, is kept once. Consecutive tool calls become one tool turn. That turn lists up to four tool names, then `(+N)` when more names remain, and `xN` when the turn covers more than one call. The script keeps the first human message and the agent message after it, plus the tool turn after that agent message when one is next. For each later human message it keeps the agent message before it, the human message, and the agent message after it, plus the tool turn after that later agent message when one is next. It also keeps the last agent message. Middle groups are spaced evenly inside a budget of 24 turns. A candidate keeps at most 28 turns. When the kept groups would pass 28 turns, the script keeps fewer middle groups, so the opening exchange and the last agent message always stay. Each turn has `n`, `role` of `user` or `agent`, `kind` of `message` or `tool`, and redacted `text` cut to about 200 characters.

Build one task per candidate: `C01` becomes `T001`, `C02` becomes `T002`, and so on. Do not split a candidate into several tasks, and do not merge candidates, even when the user changed goals inside one session. Judge the session as a whole. One vote per session keeps the result stable from one scan, and one agent, to the next. Skip a candidate only when its user turns carry no goal at all, and leave its number unused. Each task has `id`, `date`, `source`, `context`, and `axes`. `context` is `research`, `build`, `writing`, `planning`, `support`, or `other`. `date` is inside `observedPeriod` and is not in the future. `source` is one of `coverage.sources`.

Judge how the user led the agent. Read only the user turns as evidence. Agent turns are context for what the user reacted to. The agent's own habits never count.

For each task and each axis, pick the letter whose description fits the user's turns better. Compare the two sides and pick the heavier one. The user does not have to say it outright. Answer `unclear` only when the user's turns give nothing to compare on that axis.

| Axis | Left | Right |
| --- | --- | --- |
| `EI` | `E` The user shaped the result by steering during the work: reacting to intermediate output, changing direction, scope, or priority. | `I` The user shaped the result through the opening brief: goal, context, limits, or done criteria up front, then little steering. |
| `SN` | `S` The user's instructions lean on the concrete how: specific files, steps, commands, tools, exact output, existing examples. | `N` The user's instructions lean on the goal, intent, or direction, and leave the route to the agent. |
| `TF` | `T` When the user evaluated, corrected, or decided, they appealed to explicit checks: tests, numbers, specs, diffs, sources, rules. | `F` When the user evaluated, corrected, or decided, they appealed to feel, taste, audience, tone, or the experience of the people affected. |
| `JP` | `J` The user treated the work as structured or lasting: a plan with milestones, a defined process, a reusable asset such as a skill, script, template, or automation, or invoked one. | `P` The user treated the work as open-ended: exploring, trying, adjusting as they go, one-off use with nothing kept. |

`TF` is `unclear` when the user never evaluated, corrected, or chose between options in that task.

Alignment before any work is produced belongs to the opening brief and counts toward `I`: the user asks the agent to restate the goal and process first, answers its clarifying questions, or corrects that restatement. `E` needs the user to react to work the agent has already produced.

These are never evidence on any axis: prompt length, turn count, jargon, approvals, "continue" or "ok", pasted errors without a judgment, and injected system or tool text.

```json
{ "id": "T001", "date": "2026-10-04", "source": "codex", "context": "build", "axes": { "EI": "E", "SN": "S", "TF": "unclear", "JP": "P" } }
```

Keep your reasoning out of the JSON. No notes, no quotes, no extra keys.

## Let the server score

For each axis the server counts the tasks that picked each side and ignores `unclear`. Fewer than 3 picks, or a tie, leaves the letter `?`. Otherwise the majority wins. The letter is `clear` when the winner times 3 is at least the picks times 2 and the sides differ by at least 2. Any other win is `lean`. Tasks from an `unknown` source do not count, and `coverage.scope` of `insufficient` leaves every axis `?`. These cuts are a heuristic. They are not an accuracy, a reliability coefficient, or a trait strength. Do not tell the user a percentage or a count.

Omit `assessment`. The summary rejects it. The server derives `type`, `pattern`, `status`, and per-axis `value` and `strength`. Four decided letters, clear or lean, become one of `INTJ`, `INTP`, `ENTJ`, `ENTP`, `INFJ`, `INFP`, `ENFJ`, `ENFP`, `ISTJ`, `ISFJ`, `ESTJ`, `ESFJ`, `ISTP`, `ISFP`, `ESTP`, `ESFP`, with status `complete`. Any `?` yields `type` null, status `incomplete`, and a pattern such as `IN?J`. Do not convert an older type, a usage level, or a title. Card art does not enter the score.

Letter names follow the four preference pairs and the 16 standard codes as published by the Myers & Briggs Foundation. This site is not affiliated with it. The axis rules, the cuts, and the descriptions belong to `agent-workstyle-v2`. They do not use an official instrument.

## Usage level evidence

The level has two sources. Both stay separate from the letters, the tokens, the client, and the model. The server computes the level. Do not send a level number, and do not raise a level because evidence is missing.

`usageEvidence` is what you saw the human do with the agent. It is optional. Send `version` `usage-level-v2` and at most 64 observations. Each observation has only `task` and `signal`. Omit `usageEvidence` when none of these facts is visible. Record a fact only when the granted records show it. A missing check record does not prove `unchecked_adoption`. Do not open project files the grant did not already include.

- `unchecked_adoption`. A result needed a check, and the user took it without one.
- `retry_after_error`. Someone noticed an error, and a new attempt followed.
- `useful_result_verified`. A task's result was confirmed to work.
- `context_scoped`, `acceptance_defined`, and `targeted_correction_verified`. One task narrowed the context, said what done looks like, and confirmed a specific fix. `acceptance_defined` needs the outcome the user wants to see, such as "the customer received the confirmation" or a command that has to pass. A step being carried out, such as "send the email" or "fill in the form", is process and does not count.

`systemEvidence` comes from the script, not from you. Copy it as it is. It counts automation sessions, subagent sessions, how many days the automation spans, sessions that wrote or reused an agent asset, asset writes after automation began, and the kinds of scheduling, CI, hook, or heartbeat gear seen. A null count stays null.

Levels 0 to 3 come from `usageEvidence`. Level 0 needs `unchecked_adoption`. Level 1 needs `retry_after_error`. Level 2 needs `useful_result_verified` on two different tasks. Level 3 needs the three scoped-fix signals on the same task. Levels 4 and 5 come only from `systemEvidence`. Level 4 needs at least one session that wrote an asset and at least two sessions that used an asset another session wrote. Level 5 adds at least three automation sessions spread over at least 14 days, at least one kind of gear, and at least one asset write after the first automation session. Evidence short of every level leaves the level unknown.

## Build the summary

Read `{origin}/collector-schema.json`. Keep only fields it allows. `version` is `3.0`. `kind` is `observed` for this grant. `fixture` is only for an example that is not a real submission. `nickname` matches the session nickname exactly.

The summary contains no transcript text, code, file paths, task titles, links, secrets, email addresses, or free-text notes. The body must be at most 24 KiB.

Validate the JSON against the schema before you submit. The server also refuses counts that collect.py could not have produced, such as more automation sessions than files scanned, or more tasks than sessions read, so copy `systemEvidence` and `coverage` exactly as the digest has them. A future `observedPeriod.to` is rejected. Task ids are unique. Every task has all four axes. Every `usageEvidence` observation points at a task.

## Submit with the write token

The write token is 64 hex characters from the prompt. Pass it as the only line on stdin. Keep it out of argv, shell history, the summary, the idempotency file, logs, and the chat.

```
python3 collect.py submit --origin ORIGIN --session SESSION --summary summary.json --digest digest.json
```

Submit waits up to 20 seconds for the Tokscale output beside that digest. Pass `--wait-seconds` to change the wait. It writes `inputTokens`, `outputTokens`, `tokenSource`, `modelUsage`, `modelUsageUnit`, and `mostUsedModelFamily` from that output only. It replaces `mostUsedClient` only when that output has client totals. It also adds Tokscale clients from the scan to `coverage.sources`. Numbers already in the summary are ignored. If Tokscale is still running at the deadline, submit stops that process, leaves both token counts null, sets `tokenSource` to `unavailable`, and adds gap `no_tokscale`. The script prints `tokscale_wait_seconds` and `tokens_filled` before the HTTP line.

The script writes `summary.json.idempotency` with mode `0600` before the POST and reuses that key on a retry. Leave the file. Do not mint a new key to replace a stored result. The POST goes to `{origin}/api/collect/{session}` with `Content-Type: application/json`, `Authorization: Bearer`, and `Idempotency-Key`. Redirects are disabled. The script retries only a dropped connection or HTTP 503, twice, after 1 second and then 2 seconds.

Read the printed HTTP outcome.

- `http 201`. The summary was stored. The script then prints a `done:` line.
- `http 200`. The same key and the same body were already stored. The script then prints a `done:` line.
- `http 409`. A different result is already stored. Stop. Do not change the key.
- `http 404` or `http 410`. The session is expired, or the rules require a new observation. Stop.
- `http 422`. The summary or the nickname was rejected. Fix the summary and submit again. The server has not stored the key yet.
- `http 413` or `http 400`. The body or the key was refused. Shrink the body to 24 KiB and keep the key valid. Do not add fields.
- `http 302`, or any other redirect status. Stop. Do not follow the `Location`.
- `http 503` or `network_error` after the retries. Tell the user the submit did not land. Keep the summary and the key.

After a `done:` line, end with one short message in the user's language: the card is ready in the browser tab that opened this observation. You cannot read the result, so do not guess the type or the level.

A general 401 or 403 is not a reason to change credentials or widen access. There is no site-wide token. This write token can post status and can submit one summary for this session. It cannot read or list results.

## Report progress

Post a phase only when it actually changes.

```
python3 collect.py status --origin ORIGIN --session SESSION --sequence N --phase PHASE
```

`N` is an integer from 1 to 1000 and increases. `PHASE` is `analyzing`, `validating`, `submitting`, or `paused`. For those phases the script sends `approvalKind` null. Use `awaiting_host_approval` only when the host tool says it is waiting, and pass `--approval-kind` as `local_read`, `network`, or `command`. A generic 403 or a dropped connection is not that wait.

Retry a progress post with the same sequence and the same phase. Do not bump the sequence to refresh the clock. `duplicate: true` means the original event was stored. An older sequence, or the same sequence with a different body, returns 409. You cannot declare `complete`. Only a stored summary does that. Progress does not extend the 30 minute expiry.

The site shows the last phase it received. After 90 seconds without a new phase it says progress has paused, which can mean the work continues or has stopped. If a network approval blocks the status call, say that once in the terminal. Do not invent a percentage or a heartbeat.

## After expiry

Stop when the script prints `http 404` or `http 410`, or when the local clock is past the expiry in the prompt. Do not stretch the old link, and do not switch destination on your own.

You may keep the summary, mode `0600`, in the granted local scope. You may also keep it in the current conversation memory. Do not store the write token or the raw logs in that checkpoint. Keep the idempotency file beside the summary for a retry of the same session.

Ask the user to choose "reuse this analysis, new link" on the site. The next prompt names a new destination and needs its own yes. Submit the same summary there. If you no longer have the summary, the new confirmation has to name the sources and the period again, and the scan stays inside that grant.

## Optional local preview

Run this only when the user separately asks to inspect the summary.

```
node scripts/review-collector.ts --approved-input summary.json preview.json
```

The tool reads that JSON only. It uses no network and does not scan sessions. It recomputes the type into a new mode `0600` file and leaves `aggregateUploadApproved` false. The terminal does not print the type. This is not a second approval, and it grants nothing.
