# API Client Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the same session usable by a browser over a cookie and by a phone over `Authorization: Bearer`, without weakening the CSRF defence that the cookie needs and the Bearer does not.

**Architecture:** One extractor becomes the single answer to "how is this request credentialed", returning both the token and the transport that carried it. `SessionService` uses it to resolve a session; `OriginGuard` uses it to decide whether the CSRF check applies. A new content-type guard requires `application/json` on every mutating route, which is what makes skipping the `Origin` check for Bearer safe.

**Tech Stack:** NestJS 10, Express 4, TypeScript strict, Jest, Playwright, `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-08-13-api-client-contract-design.md` (merged `4bbe2b5`).

## Global Constraints

- **No verification rule may weaken.** Nothing in `libs/filings/src/logic/` is touched by this plan.
- **The browser path keeps working unchanged.** The cookie stays `HttpOnly`, host-only (no `Domain`), `SameSite=Lax`, `Path=/`, `Secure` in production. Minting, `sha256` storage, the 30-day TTL and `slide()` are untouched.
- **Bearer wins when both credentials are present.** It is explicit; a cookie is ambient; and cookie-first would let a stale cookie shadow a fresh token.
- **`Origin` is enforced for cookie-authenticated requests and skipped for Bearer.** Never skipped for both.
- **All 8 mutating routes require `Content-Type: application/json`, else 415**, and the 415 fires before the handler runs.
- **`CORS_ALLOWED_ORIGINS` is comma-separated, never a wildcard, and fails closed when blank** — the same posture `isAllowedOrigin` already takes.
- **Cloudflare stays at zero cost.** No Workers, no Pages Functions. `/api/*` is never edge-cached.
- **Client script files are TypeScript template literals.** No backtick and no `${` may enter `script-base.ts` or any `ui/script/*.ts`, including in comments. `script-fragments.spec.ts` enforces this.
- **Gates:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint:ci` (**not** `npm run lint`, which carries `--fix` and passes by rewriting the tree).
- **`main` is branch-protected.** Every task lands on the shared feature branch; the branch merges to `main` by PR with the `lint, types, tests, build` check green.

**Baseline before Task 1:** 5,613 Jest tests passing, 142 suites.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `libs/accounts/src/session-token.ts` | Add `readSessionToken` beside `readSessionCookie`. The one answer to how a request is credentialed | 1 |
| `libs/accounts/src/session-token.spec.ts` | Extractor unit tests | 1 |
| `apps/dashboard/src/auth/session.service.ts` | `resolve()` and `close()` consume the extractor | 2 |
| `apps/dashboard/src/auth/session.guard.ts` | `OriginGuard` becomes transport-aware | 3 |
| `apps/dashboard/src/auth/json-only.guard.ts` | **New.** The 415 content-type guard | 4 |
| `apps/dashboard/src/auth/json-only.guard.spec.ts` | **New.** Its tests | 4 |
| `apps/dashboard/src/auth/auth.controller.ts` | Add `JsonOnlyGuard` to 6 mutating routes | 4 |
| `apps/dashboard/src/auth/watchlist.controller.ts` | Add `JsonOnlyGuard` to 2 mutating routes | 4 |
| `apps/dashboard/src/ui/script/script-base.ts` | `postJson` must send the header on bodyless mutations | 4 |
| `apps/dashboard/src/filings/ist-contract.spec.ts` | **New.** The IST regression lock | 5 |
| `apps/dashboard/src/config/configuration.ts` | `corsAllowedOrigins` | 6 |
| `apps/dashboard/src/main.ts` | `enableCors` from that config | 6 |
| `k8s/40-ingress.yaml` | `api.disclosed.live` host rule | 6 |
| `.env.example` | Document `CORS_ALLOWED_ORIGINS` | 6 |

---

### Task 1: The transport-aware extractor

**Files:**
- Modify: `libs/accounts/src/session-token.ts`
- Test: `libs/accounts/src/session-token.spec.ts`

**Interfaces:**
- Consumes: `SESSION_COOKIE`, `TOKEN_SHAPE`, `readSessionCookie` — all already in this file.
- Produces:
  ```ts
  export type SessionTransport = 'bearer' | 'cookie';
  export interface PresentedSession {
    readonly token: string;
    readonly transport: SessionTransport;
  }
  export const readSessionToken: (
    authorization: string | string[] | undefined,
    cookie: string | undefined,
  ) => PresentedSession | null;
  ```
  Header values are passed individually rather than a request object, matching `readSessionCookie(header)` and `isAllowedOrigin(origin, allowed)` — this library must stay free of Express types.

- [ ] **Step 1: Write the failing tests**

Append to `libs/accounts/src/session-token.spec.ts`:

```ts
describe('readSessionToken', () => {
  const TOKEN = 'A'.repeat(43);
  const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

  it('reads a Bearer token', () => {
    expect(readSessionToken(`Bearer ${TOKEN}`, undefined)).toEqual({
      token: TOKEN,
      transport: 'bearer',
    });
  });

  it('reads the cookie when there is no Authorization header', () => {
    expect(readSessionToken(undefined, COOKIE)).toEqual({
      token: TOKEN,
      transport: 'cookie',
    });
  });

  // BEARER WINS. It is the explicit credential; a cookie is ambient.
  // Cookie-first would let a stale cookie shadow a freshly issued token.
  it('prefers Bearer when both are present', () => {
    const other = 'B'.repeat(43);
    expect(readSessionToken(`Bearer ${TOKEN}`, `${SESSION_COOKIE}=${other}`))
      .toEqual({ token: TOKEN, transport: 'bearer' });
  });

  // RFC 6750 says the scheme is case-insensitive.
  it('accepts the scheme in any case', () => {
    expect(readSessionToken(`bEaReR ${TOKEN}`, undefined)?.transport)
      .toBe('bearer');
  });

  it('refuses a scheme that is not Bearer', () => {
    expect(readSessionToken(`Basic ${TOKEN}`, undefined)).toBeNull();
  });

  // The same shape check readSessionCookie makes, and for the same reason: a
  // value we could not have minted costs an indexed read to disprove.
  it('refuses a Bearer value that is not token-shaped', () => {
    expect(readSessionToken('Bearer not a token!', undefined)).toBeNull();
    expect(readSessionToken('Bearer ', undefined)).toBeNull();
  });

  // Express hands a repeated header through as an array; String(array) would
  // join it into something that could pass.
  it('refuses a repeated Authorization header', () => {
    expect(readSessionToken([`Bearer ${TOKEN}`], undefined)).toBeNull();
  });

  // A malformed Authorization header must NOT silently fall through to the
  // cookie: a client that meant to present a Bearer token and got it wrong is
  // told so, rather than being answered as somebody else.
  it('does not fall back to the cookie when Authorization is malformed', () => {
    expect(readSessionToken('Bearer !!!', COOKIE)).toBeNull();
  });

  it('returns null when neither is present', () => {
    expect(readSessionToken(undefined, undefined)).toBeNull();
  });
});
```

Add `readSessionToken` to the existing import at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest libs/accounts/src/session-token.spec.ts`
Expected: FAIL — `readSessionToken is not a function`.

- [ ] **Step 3: Implement**

Append to `libs/accounts/src/session-token.ts`, after `readSessionCookie`:

```ts
/** Which header carried the credential. The CSRF decision turns on this. */
export type SessionTransport = 'bearer' | 'cookie';

/** A credential a request presented, and how it arrived. */
export interface PresentedSession {
  readonly token: string;
  readonly transport: SessionTransport;
}

/**
 * The one answer to "how is this request credentialed".
 *
 * Both `SessionService` and `OriginGuard` call this, which is deliberate: the
 * guard must decide whether the CSRF check applies WITHOUT depending on the
 * session guard having run first, because `POST /api/auth/login` carries
 * `OriginGuard` and no `SessionGuard` at all. Two readers of the same headers
 * would be two chances to disagree about what a request is.
 *
 * BEARER IS TRIED FIRST and a malformed one does not fall through to the
 * cookie. A browser never sets `Authorization` by itself, so its presence is a
 * deliberate act by a client that meant to authenticate that way; answering it
 * as somebody else's cookie session would be the wrong user, silently.
 */
export const readSessionToken = (
  authorization: string | string[] | undefined,
  cookie: string | undefined,
): PresentedSession | null => {
  if (authorization !== undefined) {
    // A repeated header arrives as an array, and joining it could produce a
    // value that parses. Refused rather than coerced.
    if (typeof authorization !== 'string') return null;

    const at = authorization.indexOf(' ');
    if (at < 0) return null;
    if (authorization.slice(0, at).toLowerCase() !== 'bearer') return null;

    const value = authorization.slice(at + 1).trim();
    return value !== '' && TOKEN_SHAPE.test(value)
      ? { token: value, transport: 'bearer' }
      : null;
  }

  const fromCookie = readSessionCookie(cookie);
  return fromCookie === null
    ? null
    : { token: fromCookie, transport: 'cookie' };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest libs/accounts/src/session-token.spec.ts`
Expected: PASS, all 9 new tests plus the existing ones.

- [ ] **Step 5: Commit**

```bash
git add libs/accounts/src/session-token.ts libs/accounts/src/session-token.spec.ts
git commit -m "feat: read a session credential from either transport"
```

---

### Task 2: SessionService resolves either transport

**Files:**
- Modify: `apps/dashboard/src/auth/session.service.ts` (`resolve()` ~line 81, `close()` ~line 117)
- Test: `apps/dashboard/src/auth/auth.e2e.spec.ts`

**Interfaces:**
- Consumes: `readSessionToken`, `PresentedSession` from Task 1.
- Produces: `Signedin` gains `readonly transport: SessionTransport;` — Task 3 does **not** read it (the guard re-reads the headers itself), but a handler and the logs benefit from knowing, and `api/me` can report it.

- [ ] **Step 1: Write the failing test**

Append to `apps/dashboard/src/auth/auth.e2e.spec.ts`, inside the existing top-level `describe`:

```ts
describe('Bearer transport', () => {
  it('resolves the same session from a Bearer header as from the cookie', async () => {
    const agent = request(app.getHttpServer());
    const registered = await agent
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ email: 'bearer@turret.test', password: 'Probe!12345678' })
      .expect(200);

    // The cookie the browser would keep, read back as a raw token so the same
    // credential can be presented the other way.
    const setCookie = registered.headers['set-cookie'][0] as string;
    const token = setCookie.slice(
      setCookie.indexOf('=') + 1,
      setCookie.indexOf(';'),
    );

    const viaCookie = await agent
      .get('/api/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(200);

    const viaBearer = await agent
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(viaBearer.body.data.email).toBe('bearer@turret.test');
    expect(viaBearer.body.data.email).toBe(viaCookie.body.data.email);
  });

  it('refuses a Bearer token that was never minted', async () => {
    await request(app.getHttpServer())
      .get('/api/watchlist')
      .set('Authorization', `Bearer ${'Z'.repeat(43)}`)
      .expect(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/dashboard/src/auth/auth.e2e.spec.ts -t 'Bearer transport'`
Expected: FAIL — the Bearer request answers 401, because `resolve()` still reads only the cookie.

- [ ] **Step 3: Implement**

In `session.service.ts`, change the import from `@app/accounts` to add `readSessionToken` and `type SessionTransport`, then:

Replace the first two lines of `resolve()`:

```ts
  async resolve(request: Request): Promise<Signedin | null> {
    const presented = readSessionToken(
      request.headers.authorization,
      request.headers.cookie,
    );
    if (presented === null) return null;

    const tokenHash = hashSessionToken(presented.token);
```

and add `transport: presented.transport,` to the returned `Signedin` object.

Replace the first two lines of `close()`:

```ts
  async close(request: Request, response: Response): Promise<void> {
    const presented = readSessionToken(
      request.headers.authorization,
      request.headers.cookie,
    );
    if (presented !== null) {
      await this.sessions.deleteByTokenHash(hashSessionToken(presented.token));
    }
    // The cookie is cleared regardless of which transport signed out. A Bearer
    // client has no cookie to clear and the header is harmless to it; a browser
    // that somehow presented both must not be left holding a live cookie.
    this.clearCookie(request, response);
  }
```

Add to the `Signedin` interface:

```ts
  /** Which header carried the credential on THIS request. */
  readonly transport: SessionTransport;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest apps/dashboard/src/auth/auth.e2e.spec.ts`
Expected: PASS, including every pre-existing cookie test — that is the assertion that the browser path is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/auth/session.service.ts apps/dashboard/src/auth/auth.e2e.spec.ts
git commit -m "feat: resolve a session from a Bearer header as well as the cookie"
```

---

### Task 3: The CSRF check keys on transport

**Files:**
- Modify: `apps/dashboard/src/auth/session.guard.ts` (`OriginGuard`, ~lines 47-89)
- Test: `apps/dashboard/src/auth/auth.e2e.spec.ts`

**Interfaces:**
- Consumes: `readSessionToken` from Task 1.
- Produces: no new exports. `OriginGuard`'s constructor and class name are unchanged, so no controller decorator moves.

- [ ] **Step 1: Write the failing test**

Append to `auth.e2e.spec.ts`:

```ts
describe('CSRF keys on transport, not on route', () => {
  const BAD = 'https://evil.example';

  it('still refuses a cookie-authenticated mutation from a foreign origin', async () => {
    await request(app.getHttpServer())
      .post('/api/watchlist?symbol=INFY')
      .set('Cookie', `${SESSION_COOKIE}=${'A'.repeat(43)}`)
      .set('Origin', BAD)
      .set('Content-Type', 'application/json')
      .expect(403);
  });

  // Today's behaviour, and it must survive: a browser sends Origin on every
  // cross-origin request and on every same-origin POST, so an absent one on a
  // cookie mutation is not a browser this application serves.
  it('still refuses a cookie-authenticated mutation with no Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/watchlist?symbol=INFY')
      .set('Cookie', `${SESSION_COOKIE}=${'A'.repeat(43)}`)
      .set('Content-Type', 'application/json')
      .expect(403);
  });

  // THE CHANGE. A phone sends no Origin and must not be refused for it: the
  // browser never attaches an Authorization header by itself, so there is no
  // ambient authority for a forged request to abuse. 401 here (the token is
  // not real) proves the ORIGIN guard let it through to the session guard.
  it('lets a Bearer mutation with no Origin reach the session guard', async () => {
    await request(app.getHttpServer())
      .post('/api/watchlist?symbol=INFY')
      .set('Authorization', `Bearer ${'A'.repeat(43)}`)
      .set('Content-Type', 'application/json')
      .expect(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/dashboard/src/auth/auth.e2e.spec.ts -t 'CSRF keys on transport'`
Expected: FAIL on the third test only — it answers 403, because `OriginGuard` refuses the absent `Origin` before the session guard runs.

- [ ] **Step 3: Implement**

In `session.guard.ts`, add `readSessionToken` to the `@app/accounts` import and replace `OriginGuard.canActivate` and the paragraph of its doc comment that explains the absent-`Origin` rule:

```ts
  /**
   * CSRF DEFENDS AMBIENT AUTHORITY, so this check keys on the TRANSPORT that
   * carried the credential rather than on the route.
   *
   * A browser attaches cookies by itself and never attaches an `Authorization`
   * header by itself. A forged cross-site request can therefore ride a cookie
   * and cannot ride a Bearer token, so a Bearer request has nothing for this
   * check to protect and is refused by it only spuriously — which is what a
   * phone, sending no `Origin` at all, would have hit on every mutation.
   *
   * `origin-guard.spec.ts` used to justify refusing an absent `Origin` with
   * "a non-browser client has no cookie this design would honour anyway". That
   * was true until Bearer existed and is the sentence this change invalidates.
   *
   * WHAT STILL COVERS A BEARER REQUEST is `JsonOnlyGuard`: an HTML form can
   * emit only urlencoded, multipart or text-plain, so requiring
   * `application/json` means a form can never reach a mutating handler, and
   * every remaining cross-origin attempt is preflighted and answerable by the
   * CORS allowlist. That guard is what makes skipping this one safe.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const presented = readSessionToken(
      request.headers.authorization,
      request.headers.cookie,
    );
    if (presented?.transport === 'bearer') return true;

    if (!isAllowedOrigin(request.headers.origin, this.publicOrigin)) {
      throw new ApiError(
        'BAD_ORIGIN',
        'This request did not come from this site.',
        403,
      );
    }

    return true;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest apps/dashboard/src/auth`
Expected: PASS. The two "still refuses" tests are the regression guard.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/auth/session.guard.ts apps/dashboard/src/auth/auth.e2e.spec.ts
git commit -m "feat: apply the CSRF origin check to ambient credentials only"
```

---

### Task 4: JSON-only mutating routes

**Files:**
- Create: `apps/dashboard/src/auth/json-only.guard.ts`, `apps/dashboard/src/auth/json-only.guard.spec.ts`
- Modify: `apps/dashboard/src/auth/auth.controller.ts` (6 routes), `apps/dashboard/src/auth/watchlist.controller.ts` (2 routes), `apps/dashboard/src/dashboard.module.ts` (provider), `apps/dashboard/src/ui/script/script-base.ts` (`postJson`)

**Interfaces:**
- Consumes: `ApiError` from `./api-error`.
- Produces: `export class JsonOnlyGuard implements CanActivate`. It takes no constructor arguments, so `@UseGuards(JsonOnlyGuard)` needs only a provider entry.

**⚠ The trap this task exists around:** `postJson` in `script-base.ts` sets `Content-Type` **only when a body is present**, and three shipped mutations pass no body — `script-account.ts:102` (watchlist add/remove) and `:211` (logout). Adding the guard without fixing the client 415s the live dashboard. `auth-script.ts` has its own `postJson(path, body)` which always sets the header, so `/auth` is unaffected.

- [ ] **Step 1: Write the failing guard test**

Create `apps/dashboard/src/auth/json-only.guard.spec.ts`:

```ts
import { JsonOnlyGuard } from './json-only.guard';

/**
 * The layer that makes skipping the Origin check for Bearer safe.
 *
 * An HTML form can emit only `application/x-www-form-urlencoded`,
 * `multipart/form-data` or `text/plain`. Requiring `application/json` means a
 * cross-origin form POST cannot reach a mutating handler at all, and every
 * remaining cross-origin attempt is preflighted — which the CORS allowlist can
 * refuse before the request is ever sent.
 */
const contextFor = (contentType: string | undefined) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: contentType === undefined ? {} : { 'content-type': contentType },
      }),
    }),
  }) as never;

describe('JsonOnlyGuard', () => {
  const guard = new JsonOnlyGuard();

  it('accepts application/json', () => {
    expect(guard.canActivate(contextFor('application/json'))).toBe(true);
  });

  // A charset parameter is legal and common; fetch does not add one, but a
  // hand-written client will.
  it('accepts application/json with a charset parameter', () => {
    expect(guard.canActivate(contextFor('application/json; charset=utf-8')))
      .toBe(true);
  });

  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain',
    'application/json-patch+json',
  ])('refuses %s with 415', (type) => {
    expect(() => guard.canActivate(contextFor(type))).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });

  // A bodyless mutation is exactly where this could have been made optional,
  // and must not be: `POST /api/watchlist?symbol=X` takes its argument from the
  // query string, so a form whose action carries the query needs no body at all.
  it('refuses a missing content type with 415', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/dashboard/src/auth/json-only.guard.spec.ts`
Expected: FAIL — cannot find module `./json-only.guard`.

- [ ] **Step 3: Implement the guard**

Create `apps/dashboard/src/auth/json-only.guard.ts`:

```ts
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from './api-error';

/**
 * Every mutating route must be asked in JSON.
 *
 * THIS IS A CSRF CONTROL, not a tidiness rule, and it is what lets
 * `OriginGuard` skip the origin check for a Bearer request. An HTML form can
 * emit only `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain` — never `application/json` — so a cross-origin form POST cannot
 * reach a handler here. Everything else cross-origin is then a preflighted
 * request, which the CORS allowlist answers before the real one is sent.
 *
 * IT APPLIES TO BODYLESS MUTATIONS TOO. `POST /api/watchlist?symbol=X` takes
 * its argument from the query string, so a form whose `action` carries the
 * query needs no body — exempting bodyless requests would leave the hole open
 * on the route most worth attacking.
 *
 * A 415 rather than a 400: the request is well-formed and the media type is the
 * thing being refused, which is what 415 means.
 */
@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['content-type'];

    // Compared on the media type alone: `application/json; charset=utf-8` is
    // the same type, and a suffixed type like `application/json-patch+json` is
    // a DIFFERENT one that must not pass on a prefix match.
    const mediaType =
      typeof header === 'string'
        ? header.split(';')[0].trim().toLowerCase()
        : '';

    if (mediaType !== 'application/json') {
      throw new ApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Send this request as application/json.',
        415,
      );
    }

    return true;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest apps/dashboard/src/auth/json-only.guard.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Apply it to all 8 mutating routes**

Add `JsonOnlyGuard` to the `./json-only.guard` import in both controllers and to the `providers` array in `dashboard.module.ts` beside `OriginGuard`.

In `auth.controller.ts`, on each of the six mutating routes, change the guard list so `JsonOnlyGuard` runs **first**:

| Line | Route | Becomes |
|---|---|---|
| 130 | `POST auth/firebase` | `@UseGuards(JsonOnlyGuard, OriginGuard)` |
| 163 | `POST auth/register` | `@UseGuards(JsonOnlyGuard, OriginGuard)` |
| 184 | `POST auth/login` | `@UseGuards(JsonOnlyGuard, OriginGuard)` |
| 228 | `POST auth/logout` | `@UseGuards(JsonOnlyGuard, OriginGuard)` |
| 242 | `POST auth/logout-all` | `@UseGuards(JsonOnlyGuard, SessionGuard, OriginGuard)` |
| 266 | `POST auth/password` | `@UseGuards(JsonOnlyGuard, SessionGuard, OriginGuard)` |

In `watchlist.controller.ts`, lines 259 and 300: `@UseGuards(JsonOnlyGuard, OriginGuard)`.

- [ ] **Step 6: Fix the client so the live dashboard still works**

In `apps/dashboard/src/ui/script/script-base.ts`, replace the body-conditional header block inside `postJson`. **No backtick and no `${` may appear in this file.**

```js
  function postJson(path, method, body) {
    var init = {
      method: method,
      // The default, stated: this cookie is the whole session and a future
      // edit that set 'omit' would sign everybody out silently.
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    // SENT ON EVERY MUTATION, INCLUDING THE ONES WITH NO BODY. The server
    // answers 415 without it - see json-only.guard.ts - and three calls here
    // pass no body at all: watchlist add, watchlist remove and sign out. Making
    // this conditional on a body is what would 415 the live dashboard.
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
    }
    if (body !== undefined && body !== null) {
      init.body = JSON.stringify(body);
    }
```

- [ ] **Step 7: Prove the served page carries it**

**Create** `apps/dashboard/src/ui/script/script-base.spec.ts` — it does not exist
yet. A spec per script fragment is the established pattern here
(`script-share.spec.ts`, `script-feed.spec.ts`); `script-fragments.spec.ts` is
about backtick hygiene only and is the wrong home for a behavioural assertion.

```ts
import { SCRIPT_BASE } from './script-base';

/**
 * The SERVED string is what is asserted, never the source.
 *
 * This file is a TypeScript template literal, so the compiler consumes part of
 * what is written before a browser sees it. A source-level assertion can pass
 * on a fragment that reaches the page broken.
 */
describe('postJson', () => {
  it('sends a JSON content type on every mutation, body or not', () => {
    expect(SCRIPT_BASE).toContain("if (method !== 'GET')");
    expect(SCRIPT_BASE).toContain(
      "init.headers['Content-Type'] = 'application/json'",
    );
  });

  // The regression this guards: watchlist add, watchlist remove and sign out
  // all pass no body, and a content type set only alongside a body would 415
  // exactly those three.
  it('does not make the content type conditional on a body', () => {
    const at = SCRIPT_BASE.indexOf("init.headers['Content-Type']");
    const bodyCheck = SCRIPT_BASE.indexOf('body !== undefined');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(bodyCheck);
  });
});
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. `script-fragments.spec.ts` must stay green — it is what catches a stray backtick in the fragment edited at Step 6.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/auth/json-only.guard.ts \
        apps/dashboard/src/auth/json-only.guard.spec.ts \
        apps/dashboard/src/auth/auth.controller.ts \
        apps/dashboard/src/auth/watchlist.controller.ts \
        apps/dashboard/src/dashboard.module.ts \
        apps/dashboard/src/ui/script/script-base.ts \
        apps/dashboard/src/ui/script/script-base.spec.ts
git commit -m "feat: require application/json on every mutating route"
```

---

### Task 5: Lock the IST contract

**Files:**
- Create: `apps/dashboard/src/filings/ist-contract.spec.ts`
- Reads: `apps/dashboard/src/filings/dashboard.types.ts`

**Interfaces:**
- Consumes: nothing at runtime. This task adds no production code — the `*Ist` companions already exist, so this is a regression guard on a property that currently holds by consistent practice.

- [ ] **Step 1: Write the lock, and prove it can fail**

Create `apps/dashboard/src/filings/ist-contract.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every instant a response carries must ship a server-formatted companion.
 *
 * IST IS SERVER-OWNED and the browser formats no timestamp — that is a stated
 * invariant, and it currently holds because four files happen to agree. This
 * makes it fail the build instead.
 *
 * The failure mode it guards has no symptom: a phone in another timezone
 * renders every filing at the wrong time and looks entirely normal doing it.
 * That is why the lock arrives WITH the Bearer work rather than after it.
 *
 * Read as text rather than through the type system because the property is
 * about field NAMES appearing in pairs, which no TypeScript check expresses.
 */
const TYPES_PATH = join(__dirname, 'dashboard.types.ts');

/** A field naming an instant: `somethingAt`, and not already the companion. */
const INSTANT_FIELD = /^\s*readonly (\w+At): /;

const fieldsIn = (source: string): readonly string[] =>
  source
    .split('\n')
    .map((line) => INSTANT_FIELD.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);

describe('the IST contract', () => {
  const source = readFileSync(TYPES_PATH, 'utf8');

  it('gives every instant field an Ist companion', () => {
    const missing = fieldsIn(source).filter(
      (name) => !source.includes(`readonly ${name}Ist`),
    );
    expect(missing).toEqual([]);
  });

  // THE LOCK IS PROVEN TO FAIL, not merely observed to pass. A guard that
  // cannot fail is a guard that is green for the wrong reason, which this
  // repository has shipped twice.
  it('fails when an instant field has no companion', () => {
    const withHole = `${source}\ninterface Hole { readonly publishedAt: string; }`;
    const missing = fieldsIn(withHole).filter(
      (name) => !withHole.includes(`readonly ${name}Ist`),
    );
    expect(missing).toEqual(['publishedAt']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest apps/dashboard/src/filings/ist-contract.spec.ts`
Expected: **PASS both**. The first asserts today's state; the second proves the check has teeth.

If the first test FAILS, do not weaken the regex — a real gap has been found. Report it as a finding: the missing companion is a live bug that would render a wrong time on a phone.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/filings/ist-contract.spec.ts
git commit -m "test: fail the build when a response instant has no IST companion"
```

---

### Task 6: The API subdomain and the CORS allowlist

**Files:**
- Modify: `apps/dashboard/src/config/configuration.ts`, `apps/dashboard/src/main.ts`, `k8s/40-ingress.yaml`, `.env.example`
- Test: `apps/dashboard/src/config/configuration.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DashboardConfig` gains `readonly corsAllowedOrigins: readonly string[];`.

**Note:** the browser does not need CORS — the React app will be served same-origin by the Caddy sidecar. This exists for non-browser clients, a staging build, and a local React dev server on another port.

- [ ] **Step 1: Write the failing config test**

`loadDashboardConfig(env: NodeJS.ProcessEnv = process.env)` takes an
environment, and the existing suite builds one with a local `env()` helper —
use it rather than hand-rolling an object.

**First, update the exhaustive-equality test that this new field will break.**
`configuration.spec.ts:114` asserts the whole config with `toEqual({...})`, so
adding a field fails it. That failure is the test working; add the line:

```ts
      trustProxy: false,
      // Nothing calls this API cross-origin by default. The React client is
      // served same-origin by the Caddy sidecar and never needs an entry here.
      corsAllowedOrigins: [],
    });
```

Then append the new suite:

```ts
describe('CORS_ALLOWED_ORIGINS', () => {
  it('is empty when unset, which allows nothing', () => {
    expect(loadDashboardConfig(env()).corsAllowedOrigins).toEqual([]);
  });

  // FAILS CLOSED, the posture isAllowedOrigin already takes: a blank setting
  // that parsed to [''] would match an empty Origin header and allow it.
  it('is empty when blank, rather than holding an empty entry', () => {
    expect(
      loadDashboardConfig(env({ CORS_ALLOWED_ORIGINS: '  ' }))
        .corsAllowedOrigins,
    ).toEqual([]);
  });

  it('splits on commas and trims', () => {
    expect(
      loadDashboardConfig(
        env({ CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example' }),
      ).corsAllowedOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  // A wildcard is refused rather than honoured: `*` and credentials are
  // mutually exclusive per the CORS specification, so an operator who sets it
  // gets a server that will not start instead of a session that never arrives.
  it('refuses a wildcard by stopping the process', () => {
    expect(() =>
      loadDashboardConfig(env({ CORS_ALLOWED_ORIGINS: '*' })),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/dashboard/src/config/configuration.spec.ts -t CORS_ALLOWED_ORIGINS`
Expected: FAIL — `corsAllowedOrigins` is undefined.

- [ ] **Step 3: Implement the config**

Add to the `DashboardConfig` interface:

```ts
  /**
   * Origins allowed to call this API cross-origin, or empty.
   *
   * NOT the browser path. The React client is served same-origin by the Caddy
   * sidecar, so it never makes a cross-origin request and never needs this.
   * It exists for a local React dev server on another port, a staging build,
   * and non-browser clients.
   *
   * Empty allows nothing, and a wildcard is refused outright: `*` and
   * `credentials` are mutually exclusive per the CORS specification, so
   * honouring one would produce a server that answers every preflight and
   * still drops every session.
   */
  readonly corsAllowedOrigins: readonly string[];
```

Add the reader beside the other helpers:

```ts
const readCorsAllowedOrigins = (env: NodeJS.ProcessEnv): readonly string[] => {
  const raw = env.CORS_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === '') return [];

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  if (origins.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS may not be `*`: a wildcard cannot carry ' +
        'credentials, so every session cookie and Bearer header would be ' +
        'dropped. Name the origins.',
    );
  }

  return origins;
};
```

and `corsAllowedOrigins: readCorsAllowedOrigins(env),` to the returned object. Add `cors=${config.corsAllowedOrigins.length}` to `describeDashboardConfig`.

- [ ] **Step 4: Enable CORS in the bootstrap**

In `main.ts`, after the `x-powered-by` line:

```ts
  // CROSS-ORIGIN CALLERS, AND THERE ARE NORMALLY NONE. The React client is
  // served same-origin by the Caddy sidecar, so this list is empty in
  // production and CORS never engages. It is here for a local dev server on
  // another port and for non-browser clients.
  //
  // `credentials` is on because the session travels as a cookie for a browser,
  // and that is precisely why the origin list may never be `*` — the
  // configuration reader refuses one.
  if (config.corsAllowedOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsAllowedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    });
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest apps/dashboard/src/config && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 6: Add the Ingress host**

Append to `k8s/40-ingress.yaml`, following the `www.disclosed.live` block already there as the pattern — same `cert-manager.io/cluster-issuer: letsencrypt-cloudflare`, its own `secretName: disclosed-api-tls`, `host: api.disclosed.live`, routing to the same dashboard Service and port. Head it with:

```yaml
# api.disclosed.live — the SAME pods, reached by another name.
#
# For MOBILE. The browser never uses this: the React client is served
# same-origin by the Caddy sidecar, and the session cookie is host-only, so a
# browser calling this host would arrive with no session and look signed out
# with nothing explaining why. A phone carries a Bearer token and has no such
# problem.
#
# Paths are IDENTICAL rather than rewritten, so there is one URL space and no
# rewrite middleware: `api.disclosed.live/api/summary` is the same route as
# `disclosed.live/api/summary`. Mildly redundant to read, and the alternative is
# two ways to reach every route.
```

- [ ] **Step 7: Document the variable**

Add to `.env.example`, in the dashboard section:

```
# Origins allowed to call the API cross-origin, comma-separated. Empty allows
# nothing, which is correct in production: the React client is served
# same-origin by the Caddy sidecar and never makes a cross-origin request.
# Set it for a local React dev server on another port. A `*` is refused at
# startup — a wildcard cannot carry credentials, so it would drop every session.
CORS_ALLOWED_ORIGINS=
```

- [ ] **Step 8: Run every gate**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint:ci && npm run build
```
Expected: all pass, 5,613 + new tests.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/config/configuration.ts \
        apps/dashboard/src/config/configuration.spec.ts \
        apps/dashboard/src/main.ts k8s/40-ingress.yaml .env.example
git commit -m "feat: serve the API on its own hostname for non-browser clients"
```

---

## Final verification, before the PR

- [ ] **Playwright against a real stack.** `npm run start:dashboard` with `AUTH_MODE=local`, then `npm run test:e2e`. This is the only gate that exercises the real browser path end to end, and CI does not run it. **Sign in, add a watchlist entry, remove it, and sign out by hand as well** — those are the three calls Task 4 Step 6 fixed, and a 415 there is the regression this plan is most likely to cause.
- [ ] **Confirm the cookie is byte-for-byte unchanged.** `curl -si` a login and check the `Set-Cookie` still reads `Path=/; HttpOnly; SameSite=Lax` with no `Domain`.
- [ ] Open the PR; `lint, types, tests, build` must be green before merge.

## Out of scope

The React application; the admin panel; removing the cookie; rewriting the 7,707 lines of specs that assert the served document; task #60's read-route caching.
