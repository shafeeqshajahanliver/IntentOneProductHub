// Google sign-in gate for the IntentOne Product Hub.
//
// Runs on every request before Vercel serves index.html. Anyone without a valid
// session is bounced to Google. Only accounts on the allowed Workspace domain
// (intenthq.com) get a session cookie back.
//
// index.html is never modified by this file. Remove middleware.js and the gate
// disappears, leaving the hub exactly as it was.
//
// Required environment variables (Vercel project settings):
//   GOOGLE_CLIENT_ID       from the Google Cloud OAuth client
//   GOOGLE_CLIENT_SECRET   from the same client
//   AUTH_SECRET            any long random string, used to sign the session cookie
// Optional:
//   ALLOWED_DOMAIN         defaults to intenthq.com
//   AUTOMATION_KEY         if set, a request carrying header x-automation-key with
//                          this value skips the gate. Used by the weekly refresh job.

import { next } from '@vercel/functions';

const COOKIE = 'ihq_hub';
const SESSION_DAYS = 7;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const encoder = new TextEncoder();

function toB64u(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const encodeJson = (obj) => toB64u(encoder.encode(JSON.stringify(obj)));
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(fromB64u(s)));

async function hmacKey() {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(process.env.AUTH_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
async function seal(obj) {
  const body = encodeJson(obj);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(body));
  return body + '.' + toB64u(sig);
}
async function unseal(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const cut = token.lastIndexOf('.');
  const body = token.slice(0, cut);
  const sig = token.slice(cut + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64u(sig), encoder.encode(body));
  } catch (e) {
    return null;
  }
  if (!ok) return null;
  try {
    return decodeJson(body);
  } catch (e) {
    return null;
  }
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Only ever redirect back to a path on this site.
function safePath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return '/';
  if (p.startsWith('/_auth/')) return '/';
  return p;
}

function redirect(location, cookie) {
  const headers = { Location: location, 'cache-control': 'no-store' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

function page(status, heading, message, actionHref, actionLabel) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#fffcf7;color:#1a1310;font-family:'Barlow Semi Condensed',system-ui,sans-serif;padding:32px}
.w{max-width:520px}
.o{font-size:14px;line-height:13px;font-weight:500;letter-spacing:2.52px;text-transform:uppercase;color:#785940;margin:0 0 22px}
h1{font-size:64px;line-height:60px;font-weight:700;letter-spacing:-1.6px;margin:0 0 18px}
p{font-size:19px;line-height:27px;font-weight:400;color:#785940;margin:0 0 28px}
a.b{display:inline-block;font-size:16px;line-height:1;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;
text-decoration:none;color:#fffcf7;background:#1a1310;padding:16px 26px;border-radius:2px}
a.b:hover{background:#00d058;color:#1a1310}
</style></head><body><div class="w">
<p class="o">IntentOne Product Hub</p>
<h1>${heading}</h1>
<p>${message}</p>
${actionHref ? `<a class="b" href="${actionHref}">${actionLabel}</a>` : ''}
</div></body></html>`;
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  const redirectUri = origin + '/_auth/callback';
  const domain = (process.env.ALLOWED_DOMAIN || 'intenthq.com').toLowerCase();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const authSecret = process.env.AUTH_SECRET;

  if (!clientId || !clientSecret || !authSecret) {
    return page(
      503,
      'Sign-in is not set up yet',
      'This hub is waiting on its Google credentials. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET to the Vercel project settings and redeploy.'
    );
  }

  // Machine access for the weekly refresh job, only if a key has been configured.
  const automationKey = process.env.AUTOMATION_KEY;
  if (automationKey && request.headers.get('x-automation-key') === automationKey) {
    return next();
  }

  // Step 1. Landing page for an unauthenticated visitor. Its only job is to carry the
  // hash route (#deliver, #build) across the Google round trip, which servers never see.
  if (path === '/_auth/login') {
    const want = safePath(url.searchParams.get('r') || '/');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing in</title>
<style>body{background:#fffcf7;margin:0}</style></head><body>
<script>
var want=${JSON.stringify(want)};
location.replace('/_auth/start?r='+encodeURIComponent(want+location.hash));
</script>
<noscript><a href="/_auth/start?r=${encodeURIComponent(want)}">Continue to sign in</a></noscript>
</body></html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  // Step 2. Hand off to Google.
  if (path === '/_auth/start') {
    const want = safePath(url.searchParams.get('r') || '/');
    const state = await seal({ r: want, t: Date.now() });
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      hd: domain,
      prompt: 'select_account'
    });
    return redirect(AUTH_URL + '?' + q.toString());
  }

  // Step 3. Google sends the visitor back here.
  if (path === '/_auth/callback') {
    const err = url.searchParams.get('error');
    if (err) {
      return page(400, 'Sign-in was cancelled', 'Google did not complete the sign-in.', '/_auth/login', 'Try again');
    }
    const code = url.searchParams.get('code');
    const state = await unseal(url.searchParams.get('state'));
    if (!code || !state || typeof state.t !== 'number' || Date.now() - state.t > 10 * 60 * 1000) {
      return page(400, 'That sign-in link expired', 'Start again from the hub.', '/_auth/login', 'Sign in');
    }

    let payload;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.id_token) throw new Error('no id_token');
      // The id_token came straight from Google over TLS in this server-to-server
      // call, so the payload is trusted without a separate signature check.
      payload = decodeJson(data.id_token.split('.')[1]);
    } catch (e) {
      return page(502, 'Google could not be reached', 'Something went wrong talking to Google. Try again in a moment.', '/_auth/login', 'Try again');
    }

    const email = String(payload.email || '').toLowerCase();
    const hd = String(payload.hd || '').toLowerCase();
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    const allowed = verified && hd === domain && email.endsWith('@' + domain);

    if (!allowed) {
      return page(
        403,
        'Wrong account',
        `${email || 'That account'} is not on the ${domain} domain. This hub is limited to Intent HQ accounts.`,
        '/_auth/login',
        'Sign in with another account'
      );
    }

    const session = await seal({ e: email, x: Date.now() + SESSION_DAYS * 86400000 });
    const cookie = `${COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
    return redirect(origin + safePath(state.r || '/'), cookie);
  }

  // Sign out.
  if (path === '/_auth/logout') {
    return redirect(origin + '/', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  }

  // Everything else needs a live session.
  const session = await unseal(readCookie(request, COOKIE));
  if (session && typeof session.x === 'number' && session.x > Date.now() && String(session.e || '').endsWith('@' + domain)) {
    return next();
  }

  return redirect(origin + '/_auth/login?r=' + encodeURIComponent(path + url.search));
}
