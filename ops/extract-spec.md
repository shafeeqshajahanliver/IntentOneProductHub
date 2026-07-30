# Extraction spec — IntentOne delivery questions from Lightfield

You are extracting answers to 12 standard delivery-path questions for a set of Lightfield
opportunities (deals). Output is structured JSON, one object per deal.

## How to read a deal's context (Lightfield MCP)

Mandatory workflow reminder: the tool is `mcp__Lightfield__read_from_lightfield` and the
parameter is `path` (NOT apiPath). Paths start with `/`.

1. List the deal's notes:
   `/v1/notes?$note-opportunity[contains]=<oppId>&limit=25`
   (oppId is the bare id WITHOUT the `opp_` prefix — e.g. `cmpnp2wlq008do3ob1elk0g58`)
   Note bodies come back compacted in list responses. You only get titles + note ids here.

2. Retrieve the full body of each note that looks substantive:
   `/v1/notes/<noteId>`   e.g. `/v1/notes/nte_cms1p6w9i0480o2o6hcdoe22q`
   This returns the FULL markdown in `fields.$content.value`.

   Prioritise notes titled like: "Slack deal context", "Pain point ...", "Meeting notes",
   "Technical ...", "Discovery ...", proposal/scoping notes. These are the rich ones
   (often 5k-15k chars). SKIP short "Asana Status — Week of ..." notes (usually ~250 chars,
   low value) unless the deal has nothing else.

   Budget roughly 4-8 note retrievals per deal. Do not retrieve all 25 if the first few
   answer the questions.

3. Meetings CANNOT be filtered by opportunity in Lightfield (no relationship filter exists),
   so do not try. If a deal's notes are thin (fewer than 2 substantive notes), you MAY do ONE
   Slack search via `mcp__Slack__slack_search_public_and_private` for the deal's presales
   channel (channels are named like `#intentone-presales-<client>` or `#edge-presales-<client>`),
   and/or ONE Granola search via `mcp__Granola__query_granola_meetings` using the client name.
   Keep this to at most 2 extra calls per deal. Do not go hunting.

## The 12 questions and their option indices

Answer with the INTEGER INDEX of the option. Use `null` when the record does not say.
Do not guess. "Not in the record" is a valid and expected answer.

| key    | question (starts with)                      | options by index |
|--------|---------------------------------------------|------------------|
| infra  | "Where must the application"                 | 0 Their environment, 1 Our cloud |
| cp     | "Their cloud, or on-prem?"                   | 0 Their cloud, 1 On-prem / air-gapped |
| cloud  | "Which cloud?"                               | 0 AWS, 1 Azure, 2 GCP |
| acc    | "How will our engineers access"              | 0 Bastion / VDI, 1 Scoped VPN, 2 Client workspace, 3 Push-only |
| res    | "Data residency"  **MULTI**                  | 0 EU, 1 UK, 2 US, 3 Brazil, 4 South Africa, 5 None / flexible |
| goal   | "What goals are the client"                  | 0 Acquire, 1 Uplift, 2 Retain, 3 Enrich |
| sdkAI  | "Do the client's mobile developers"          | 0 Yes, 1 No  (Yes = they use AI coding tools / Cursor and are open to our MCP) |
| weblog | "How will weblog data arrive?"               | 0 S3 bucket, 1 Webhook / API, 2 Databricks |
| crm    | "Where does the client's CRM data live"      | 0 S3, 1 Databricks, 2 Salesforce, 3 HubSpot, 4 Zendesk, 5 Intercom, 6 Freshdesk |
| camp   | "Which campaign management system"           | 0 IntentOne, 1 Their own system |
| sys    | "Which system?"  **MULTI**                   | 0 Pega, 1 Adobe, 2 Salesforce MC, 3 Braze, 4 Other |
| val    | "How will the client create value" **MULTI** | 0 Autopilot, 1 Co-pilot |

Conditional logic (respect it, do not invent answers):
- `cp` and `cloud` and `acc` only apply when `infra` = 0 (their environment). If `infra` = 1
  (our cloud), leave cp/cloud/acc as null.
- `sys` only applies when `camp` = 1 (their own system). If `camp` = 0, leave `sys` as null.

Interpretation aids drawn from how these deals are actually described:
- "Blue box" / "hosted by Intent HQ" / "our AWS" => infra = 1 (Our cloud).
- "Red box" / "deployed in the client's environment" / "their VPC" => infra = 0.
- A deployment region like "AWS EU" implies cloud = 0 ONLY if infra = 0; if it is our cloud,
  AWS EU is our hosting choice, so record residency instead (res = [0] for EU).
- "Push notifications via our platform" / "campaigns run in IntentOne" => camp = 0.
- Named martech (Pega, Adobe Campaign, Salesforce Marketing Cloud, Braze) => camp = 1 plus
  the matching `sys` index. Anything else named (e.g. Jema, Fast Track, in-house CVM tool)
  => camp = 1, sys = [4] (Other).
- "Autopilot" = the system decides and acts. "Co-pilot" = a campaign manager decides with
  our recommendations. Most deals are co-pilot [1] unless autonomy is explicitly discussed.
- Retention / churn / CVM language => goal = 2. Upsell / ARPU / cross-sell => goal = 1.
  New customer acquisition => goal = 0. Data enrichment / audience sale => goal = 3.

## Required output

Write your result as a JSON file per agent to `/home/claude/work/extract/<batch>.json`
(create the directory if needed). The file is an ARRAY of objects, one per deal, shaped:

```json
[{
  "oppId": "opp_cmpnp2wlq008do3ob1elk0g58",
  "name": "Parimatch -Ginja casino Portugal",
  "notesRead": 5,
  "a": {"infra":1,"cp":null,"cloud":null,"acc":null,"res":[0],"goal":2,"sdkAI":null,
        "weblog":0,"crm":0,"camp":0,"sys":null,"val":[1]},
  "conf": {"infra":"high","res":"high","goal":"med","weblog":"med","crm":"high","camp":"high","val":"low"},
  "cite": {"infra":"Slack deal context 24 Jul: standard blue-box AWS EU deployment hosted by Intent HQ",
           "crm":"Shafeeq 27 Jul: CRM ingestion via S3 buckets confirmed feasible"},
  "ctx": "One or two sentences a VP Product would want: where the deal actually is, what is blocking it, what was last decided. Plain English, no fluff.",
  "notes": [[1,"<b>Customer data: ...</b> short factual detail worth surfacing"],
            [3,"another row-specific fact"]]
}]
```

Rules for the output:
- `conf` and `cite` only need entries for keys you answered non-null. Confidence is
  "high" (explicitly stated), "med" (strongly implied), "low" (inferred from weak signal).
- Never emit an answer without a citation. If you cannot cite it, the answer is null.
- `notes` is optional. Row index meanings: 0 header, 1 infrastructure, 2 goals, 3 ingest,
  4 activate, 5 support. Only include a note when there is a concrete, useful fact.
  Keep each under 220 characters. Simple HTML (`<b>`) allowed, nothing else.
- `ctx` must be factual and current. Include the date of the most recent signal.
- Write "IntentOne" as one word, never "Intent One". No em dashes anywhere.

## Working style

Do not print note bodies back in your final message — they are large. Do the reading,
write the JSON file, and return ONLY a short summary: deals processed, how many of the
12 questions you could answer per deal, and anything that looked wrong or missing.
