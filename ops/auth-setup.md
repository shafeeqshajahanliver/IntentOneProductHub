# Turning on sign-in for the hub: step by step

> **Status: the gate is currently OFF.** The hub is open to anyone with the link. The gate
> code is parked at `ops/auth-middleware.js.off`. To switch it back on, rename that file to
> `middleware.js` at the repo root and push, once the three variables in step 9 are set.
> Do the Vercel side first, otherwise the hub goes down for everyone.

Two parts. Part A is in Google, part B is in Vercel. About ten minutes in total.
Sign in to everything with your `@intenthq.com` account.

Keep this page open and paste values into it as you go.

```
CLIENT ID      ________________________________________

CLIENT SECRET  ________________________________________
```

---

## Part A. Google (about 6 minutes)

**1.** Go to https://console.cloud.google.com

**2.** Top left, click the project dropdown, then **New project**.
Name it `intentone-product-hub`. Click **Create**. Wait a few seconds, then make sure
that project is the one selected in the dropdown.

**3.** In the search bar at the top, type `Google Auth Platform` and open it.
(Depending on the week, Google labels this "Google Auth Platform" or "OAuth consent
screen". Same thing.)

**4.** Click **Get started** and fill in:
- App name: `IntentOne Product Hub`
- User support email: your address
- Audience: **Internal**
- Contact email: your address
- Agree to the policy, then **Create**

**Internal is the important one.** It means only Intent HQ accounts can ever reach the
sign-in screen, and it skips Google's app review entirely.

**5.** In the left menu click **Clients**, then **Create client**.
- Application type: **Web application**
- Name: `IntentOne Product Hub`
- Under **Authorised redirect URIs**, click **Add URI** and paste exactly:

```
https://intentonepathtovalue1.vercel.app/_auth/callback
```

- Leave "Authorised JavaScript origins" empty
- Click **Create**

**6.** A box appears with your **Client ID** and **Client secret**. Copy both into the
space at the top of this page. The secret can be copied again later from the client's
page if you lose it.

Part A done.

---

## Part B. Vercel (about 3 minutes)

**7.** Go to https://vercel.com and open the project `intentonepathtovalue_1`.

**8.** Click **Settings**, then **Environment Variables** in the left menu.

**9.** Add these three, one at a time. For each one, tick **all three** environment
boxes (Production, Preview, Development), then **Save**.

| Key | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | your Client ID from step 6 |
| `GOOGLE_CLIENT_SECRET` | your Client secret from step 6 |
| `AUTH_SECRET` | the long random string Claude gave you |

That is all three. Nothing else is needed.

**10.** Tell Claude **"push to production"**. Claude renames `ops/auth-middleware.js.off`
back to `middleware.js` and pushes. The gate goes live about a minute later.

If you are doing it yourself in the Vercel dashboard, redeploy with **"Use existing Build
Cache" unticked**. Environment variables are baked in at build time, so a cached redeploy
ignores anything you just added.

---

## Checking it worked

Open https://intentonepathtovalue1.vercel.app in a private browsing window.
You should land on the Google account chooser, and picking your Intent HQ account should
drop you straight onto the hub.

If you see a page saying sign-in is not set up, one of the three variables in step 9 is
missing or misspelled. Check the spelling, then redeploy from the Vercel dashboard.

If Google says "redirect_uri_mismatch", the URI in step 5 does not match. It must end in
`/_auth/callback` with no trailing slash.

---

## Everyday use

Sessions last 7 days. Going to `/_auth/logout` signs you out.

To sign everybody out at once, change `AUTH_SECRET` in Vercel and redeploy.

To add a proper address later, such as `hub.intenthq.com`, add the domain in Vercel and
then add `https://hub.intenthq.com/_auth/callback` as a second redirect URI in step 5.

To remove the gate entirely, delete `middleware.js` from the repo and push. The hub goes
back to being open to anyone with the link.

---

## What this does not cover

The gate stops people loading the hub at its URL. It does not hide the underlying data.
`index.html` contains the full DEALS array with client names, values and note detail, and
this repository is public on GitHub, so anyone who finds the repo reads the same thing
without going near the Vercel URL. Making the repo private closes that and changes nothing
about how Vercel deploys.

---

## For the weekly refresh job

With the gate on, an anonymous request to the hub returns a `302` to Google instead of a
`200`. `ops/refresh.md` already expects this. A `503` means the three variables above are
missing, and the hub is down for everyone until they are added.

There is an optional fourth variable, `AUTOMATION_KEY`. If set, the weekly job can send
the header `x-automation-key: <value>` to check the deployed content directly. Leaving it
unset is fine and is the safer default.
