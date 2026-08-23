# AGENT_PROTOCOL.md — the dual-agent workflow

Companion to `AGENTS.md` (the delegation contract) and `CLAUDE.md` (the reading
order). This file covers **how the two agents share context without both
reloading the repository**, and what the Codex plugin can actually do.

---

## 1. Verified Codex plugin capabilities

Plugin: `openai-codex/codex` **1.0.6**, at
`~/.claude/plugins/cache/openai-codex/codex/1.0.6`. Codex CLI **0.145.0**.
Everything below was read from the installed plugin's own files, not assumed.

### Commands

| Slash command | Underlying call | What it does |
| --- | --- | --- |
| `/codex:rescue` | `codex-companion.mjs task` | Delegate a task |
| `/codex:status` | `… status [job-id] [--all] [--json]` | List / inspect jobs |
| `/codex:result` | `… result <job-id>` | Retrieve a finished job's report |
| `/codex:cancel` | `… cancel <job-id>` | Cancel a running job |
| `/codex:review` | `… review` | Review the working tree or branch |
| `/codex:adversarial-review` | `… adversarial-review` | Stricter review pass |
| `/codex:transfer` | `… transfer [--source <jsonl>]` | **Transfer this Claude session into a resumable Codex thread** |
| `/codex:setup` | `… setup` | Check CLI/auth; toggle the stop-review gate |

Full `task` signature:

```
task [--background] [--write] [--resume-last|--resume|--fresh]
     [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>]
     [--cwd <dir>] [--prompt-file <path>] [prompt]
```

### The four capabilities, answered

**Resuming an existing Codex thread — YES.**
`--resume` / `--resume-last` continue the thread; `--fresh` forces a new one.
Each job record persists a `threadId`, and the CLI can attach directly with
`codex resume <session-id>`. Omit `--model` / `--effort` when resuming; a
resumed task keeps its own.

**Listing active / resumable sessions — YES, with a scope trap.**
`status --all --json` lists jobs with status, phase, `threadId`, and log path.
`task-resume-candidate --json` reports whether a resumable thread exists for the
current Claude session. **The job store is keyed by workspace root**, so jobs
launched with `--cwd` into a git worktree are invisible from the main checkout.
This bit us: two jobs ran for ~40 minutes while `/codex:status` in the project
reported zero. To see everything:

```powershell
git worktree list --porcelain | Select-String '^worktree ' | ForEach-Object {
  $d = ($_ -replace '^worktree ',''); node "$env:USERPROFILE/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" status --all --cwd $d }
```

**Binding a Codex thread to the current Claude session — YES.**
`getCurrentClaudeSessionId()` reads the harness session id from the environment
and stamps it on each job as `sessionId`; `filterJobsForCurrentClaudeSession()`
filters by it, so `/codex:status` shows this session's jobs rather than every
job in the workspace. Verified: a live job record carried this session's exact
id.

**Passing the Claude transcript automatically — YES.**
`/codex:transfer` resolves the current session's JSONL under
`~/.claude/projects/<encoded-project>/<session-id>.jsonl` and turns it into a
resumable Codex thread, returning a `codex resume <session-id>` command.

**Reading local project files — YES.** Codex runs in the directory given by
`--cwd` with workspace-write sandboxing. It reads anything there. It does not
see gitignored-but-absent files in a worktree — see §3.

### Where session metadata lives

```
~/.claude/plugins/data/codex-inline/state/<rootName>-<hash>/
    state.json              plugin config for that workspace root
    broker.json             app-server broker endpoint
    jobs/<job-id>.json      id, status, phase, pid, threadId, turnId,
                            workspaceRoot, sessionId (Claude session), result
    jobs/<job-id>.log       full transcript of the job
~/.codex/sessions/<year>/…  Codex CLI's own session store
~/.codex/config.toml        default model + reasoning effort
```

### Limitations that remain

- **Worktree jobs are invisible from the main checkout** (above). The single
  biggest operational gotcha.
- **Resume does not survive a plugin runtime restart.** Durable context must be
  in repo files, which is the entire reason this directory exists.
- **Model choice is account-limited.** On a ChatGPT account the small tier is
  refused (`gpt-5.3-codex-spark` → 400). Route by `--effort`, leave `--model`
  unset. See `DECISIONS.md` D16.
- **A worktree has no `node_modules`**, so a job there cannot run
  `npm test` / `npm run build`. Only structurally-judgeable work belongs in a
  worktree (D14, D21).
- **A bad `--model` still returns a job id** and sits in `running` for seconds
  before flipping to `failed`. A mis-modelled launch looks healthy at first.
- Codex cannot ask a question. Anything ambiguous in a packet becomes a guess.

---

## 2. Roles

| | Claude | Codex |
| --- | --- | --- |
| Architecture, decomposition, scope | ✅ | ❌ |
| Product / UX / trade-off judgement | ✅ | ❌ |
| Implementing a fully specified task | ✅ | ✅ |
| Reviewing the other's diff | ✅ | ❌ |
| **Commits** | ✅ only | ❌ never |

**Delegate when** the task is fully specified, its files are enumerable, and its
acceptance criteria are checkable. **Do not delegate** product decisions, UI
design requiring human eyes, anything needing a verification loop a worktree
cannot run, or work whose scope you cannot draw a boundary around.

---

## 3. Avoiding duplicate context loading

This is the point of the whole directory.

- **Do not paste repository contents into a packet.** Codex reads the checkout.
  Point at paths; quote only the specific lines a decision hinges on.
- **Point at context packs, not at "the codebase".** A packet that says "read
  `src/`" has delegated the audit, not the task.
- **Never point a packet at a gitignored path.** `.agents/`, `.impeccable/`, and
  `.codex/` are ignored and are **not present in a worktree**. `.claude/` is
  deliberately tracked (see `.gitignore`) so packs and protocol survive a clone
  and reach a delegated agent.
- **Use `--resume` for follow-ups** in the same subsystem; the thread already
  holds the context. `--fresh` only for genuinely independent work.
- **Write findings down immediately.** An audit that lives only in a transcript
  is an audit you will pay for again.

---

## 4. File locking

Two writing agents in one checkout can leave a half-written file that still
compiles. The rules:

1. **One writing agent per checkout.** Parallel work needs a branch **and** a
   git worktree each, one job per worktree.
2. **Claim before editing.** Add an entry to `.claude/ACTIVE_TASK.md` listing
   the task id, owner, branch, and the files you expect to touch. Commit the
   claim.
3. **Check before claiming.** Overlapping file sets mean you wait, not race.
4. **Release when done**, in the same commit that updates the handoff.
5. **Permanent serialization points** — never two writers, ever:
   `src/renderer/App.tsx`, `src/main/main.ts`, `src/main/htmx/**`,
   `src/renderer/index.css`, `package.json`.

---

## 5. Packaging a task for Codex

Full field list in `AGENTS.md` §6. The failure mode worth repeating, because it
happened four times in one day (`DECISIONS.md` D35):

> **An acceptance criterion may not require a file the packet forbids.**

Before sending: walk each criterion back to the files it forces, and confirm each is
authorized. Any criterion of the form "nothing anywhere does X" must be **run**
(`grep -rl`) first, with every hit either authorized or explicitly exempted.
Historical records — decision docs, changelogs, handoff logs — are exempt from
cleanup criteria by default; a record of a removal has to name what was removed.

Every packet ends with:

> If you hit a question you cannot answer from the repository and this packet,
> stop and report it rather than choosing.

A reported blocker is a **successful** outcome.

---

## 6. Recovering a session that lost context

1. Read `.claude/CURRENT_STATE.md`, then `.claude/HANDOFF.md` (newest first).
2. `git log --oneline -20` and `git status` — commit messages here carry the
   reasoning, not just the change.
3. `.claude/ACTIVE_TASK.md` for locks held by a session that may be gone. If a
   lock is stale (its branch has no recent commits), say so in the handoff and
   release it deliberately rather than silently.
4. Check for orphaned Codex jobs with the worktree-walking status command in §1.
5. Re-run the four standing commands to establish a real baseline before
   trusting any recorded status.
6. **Do not** start with a full-repo audit. See `CLAUDE.md`.
