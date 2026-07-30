# Weekly refresh runbook — IntentOne Product Hub, Deliver view

This is a standalone procedure. Assume the session running it has no memory of how the hub
was built. Everything needed is in this repo.

**What this job does:** re-reads Lightfield for the 70 deals in the Deliver dropdown, updates
the extracted answers to the 12 delivery questions where the record has changed, rebuilds the
dropdown labels and coverage pills, and pushes the updated hub to production.

**What it deliberately does not do:** add or remove deals from the dropdown, change the
question set, or touch anything in the Build view. If new opportunities look like they belong
in the dropdown, report them, do not add them.

---

## 0. Setup

```
git clone https://github.com/shafeeqshajahanliver/IntentOneProductHub.git repo
cd repo
```

`index.html` is the hub. `ops/state.json` is what the last run saw. `ops/extract-spec.md` is
the extraction brief. `ops/merge.js` applies results.

Node is available. No npm install needed.

---

## 1. Scan for change (cheap, do this first)

For every deal in `ops/state.json`, call Lightfield:

```
mcp__Lightfield__read_from_lightfield
  path: /v1/notes?$note-opportunity[contains]=<oppId without the opp_ prefix>&limit=1
```

The response carries `totalCount`. Compare it to the deal's `nc` in `state.json`.

Rules for building the re-extract list:

- `totalCount > nc` → re-extract. New notes exist.
- `totalCount === nc` and `cov > 0` → skip. Nothing has changed and we already have answers.
- `totalCount === nc` and `cov === 0` and `nc === 0` → skip. Still no notes, still nothing to find.
- `totalCount === nc` and `cov === 0` and `nc > 0` → skip, but only for three consecutive runs.
  Track this with a `dry` counter on the deal in `state.json`. After three dry runs, retry once
  and reset the counter. This stops us re-reading the same empty notes every week forever.

Do the scan with 3 to 4 subagents in parallel, roughly 20 deals each, each returning a plain
list of `oppId, name, totalCount`. It is a cheap call, one per deal.

If nothing needs re-extraction, skip to step 4 and report "no change" without committing.

---

## 2. Re-extract the changed deals

Read `ops/extract-spec.md` in full. It defines the question keys, the option indices, the
conditional logic, the citation rule and the exact output JSON shape. Do not improvise a
different shape, `ops/merge.js` depends on it.

Split the re-extract list across subagents, no more than 8 deals per agent. Give each agent
the full text of `ops/extract-spec.md` plus its deal list (name, oppId, stage, value, products).

Each agent writes `extract/<batch>.json`. Merge the batches into one array:

```
node -e "const fs=require('fs');const a=fs.readdirSync('extract').filter(f=>/^r-.*\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync('extract/'+f)));fs.writeFileSync('extract/results.json',JSON.stringify(a));console.log(a.length)"
```

Two things the extraction agents get wrong if not told:

- The Lightfield parameter is `path`, not `apiPath`, and the opportunity id in the notes filter
  has no `opp_` prefix.
- Note bodies come back truncated in list responses. To read a note you must fetch
  `/v1/notes/<nte_id>` individually. The full markdown is in `fields.$content.value`.

Also required in each result object, beyond the spec:

- `noteCount` — the totalCount seen for that deal.
- `why` — only when the deal ends at zero answers. One of exactly:
  `no notes`, `notes exist but contain no delivery detail`, `bulk pipeline notes only`,
  `notes are about commercials only`. This drives the amber explainer pill in the UI.

---

## 3. Merge and verify

```
node ops/merge.js index.html extract/results.json
node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/const DEALS=(\[[\s\S]*?\]);\n/);eval(m[1]);console.log('DEALS parse OK')"
```

`merge.js` prints how many deals it patched and the new headline coverage. Sanity checks
before committing:

- DEALS count must still be 133 and the dropdown must still hold 70 options.
- Coverage should move by a few points at most. A large jump either way means an extraction
  agent misread the spec. Investigate rather than push.
- File size should stay in the 220 to 260 KB range.

---

## 4. Push

Commit author must be `Claude <noreply@anthropic.com>` (a repo hook enforces this).

```
git config user.name "Claude"
git config user.email "noreply@anthropic.com"
git add index.html ops/state.json
git commit -m "Weekly Lightfield refresh: <n> deals re-extracted, coverage <x>%"
git push origin main
```

Vercel deploys automatically from `main`. Confirm with:

```
curl -s -o /dev/null -w "%{http_code}" https://intentonepathtovalue1.vercel.app
```

**Expect `302`, not `200`.** The hub sits behind Google sign-in for `@intenthq.com`
accounts (see `ops/auth-setup.md`), so an anonymous request is redirected to Google. A
`302` means the site is up and the gate is working. A `200` means the gate is off. A `503`
means the Google credentials are missing from the Vercel project settings, and the hub is
unreachable for everyone until they are added, so say so in the report.

If the job has been given an `AUTOMATION_KEY` value, it can check the deployed content
instead by adding `-H "x-automation-key: <value>"` to the curl. Without that value, verify
the push succeeded and stop there. Do not try to work around the gate.

**Push credential:** the remote needs a GitHub token. If the clone URL has no credential and
`git push` fails with authentication, stop. Do not attempt workarounds. Write the updated
`index.html` to the project doc `claude/intentone-product-hub.html` instead and say clearly in
the report that the push could not be made.

---

## 5. Report to Slack

This is the primary delivery, not an extra. Send Shaf a direct message with
`mcp__Slack__slack_send_message` to user `U09JWELV5PY`. Send it, do not leave a draft.

Short enough to read on a phone. Cover:

- How many deals changed and what the new headline coverage is, versus last week.
- Any deal that moved from zero answers to some answers, named.
- Any data quality problem worth a human fixing in Lightfield: opportunities named after
  products rather than clients, duplicate records, wrong country, notes linked to the wrong
  deal, high-value deals with no notes at all.
- Nothing else. No recap of the process. If nothing changed, one line saying so.

Write "IntentOne" as one word. No em dashes.
