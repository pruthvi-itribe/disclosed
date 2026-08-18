import { renderDashboardPage } from '../page';

/**
 * `postJson` and `getJson`, as the served document carries them.
 *
 * THE SERVED STRING IS WHAT IS ASSERTED, NEVER THE SOURCE FILE. These fragments
 * are TypeScript template literals, so the compiler consumes part of what is
 * written before a browser sees it; a source-level assertion can pass on a
 * fragment that reaches the page broken. `script-feed.spec.ts` and
 * `script-share.spec.ts` read the rendered page for the same reason.
 */
const html = renderDashboardPage(true);

const SCRIPT = html.slice(
  html.indexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);

/**
 * The source text of one top-level function declaration, by brace matching.
 *
 * The same cut `script-feed.spec.ts` and `script-share.spec.ts` make, for the
 * same reason: the function a browser is handed is the only one worth
 * asserting on. THROWS WHEN THE ANCHOR IS MISSING rather than returning an
 * empty string, so a rename fails as a rename rather than as `getJson is not
 * defined`.
 */
const cutFunction = (source: string, signature: string): string => {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`"${signature}" is not in the served script.`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`"${signature}" is never closed in the served script.`);
};

/** One single-line `var` declaration, cut whole. Throws when it is not there. */
const cutDeclaration = (source: string, name: string): string => {
  const at = source.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`"var ${name}" is not in the served script.`);
  return source.slice(at, source.indexOf('\n', at));
};

interface Answer {
  readonly status: number;
  readonly etag?: string;
  readonly body?: unknown;
}

interface Asked {
  readonly path: string;
  readonly ifNoneMatch: string | undefined;
}

interface Sentinel {
  readonly notModified?: boolean;
}

type GetJson = (path: string, revalidate?: boolean) => Promise<Sentinel>;

/**
 * `getJson` running against a `fetch` this file answers for.
 *
 * WHY IT IS RUN RATHER THAN READ. The one thing that had to be right here is
 * unreadable from the outside: `res.ok` is FALSE for a 304, so the existing
 * failure branch would have thrown on every successful revalidation — a red
 * banner every four seconds on a page that is perfectly up to date. A string
 * assertion about statement order proves the lines are in a sequence; this
 * proves the promise resolves.
 *
 * The two `var`s are cut from the served script rather than declared here, so
 * the harness cannot quietly disagree with the page about what they are.
 */
const harness = (
  answers: readonly Answer[],
): { readonly asked: Asked[]; readonly getJson: GetJson } => {
  const asked: Asked[] = [];
  let at = 0;

  const answerFor = (): Answer => {
    const answer = answers[Math.min(at, answers.length - 1)];
    at += 1;
    return answer;
  };

  const fetchDouble = (
    path: string,
    init: { headers: Record<string, string> },
  ): Promise<unknown> => {
    const answer = answerFor();
    asked.push({ path, ifNoneMatch: init.headers['If-None-Match'] });
    return Promise.resolve({
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      headers: {
        get: (name: string): string | null =>
          name.toLowerCase() === 'etag' ? (answer.etag ?? null) : null,
      },
      json: () => Promise.resolve(answer.body),
      text: () => Promise.resolve(JSON.stringify(answer.body ?? null)),
    });
  };

  const getJson = new Function(
    'fetch',
    `${cutDeclaration(SCRIPT, 'etags')}
${cutDeclaration(SCRIPT, 'NOT_MODIFIED')}
${cutFunction(SCRIPT, 'function getJson(')}
return getJson;`,
  )(fetchDouble) as GetJson;

  return { asked, getJson };
};

const FEED = 'api/filings?limit=25&tier=verified';
const PAGE = { success: true, data: [], meta: null };

describe('postJson', () => {
  it('sends a JSON content type on every mutation, body or not', () => {
    expect(html).toContain("if (method !== 'GET')");
    expect(html).toContain("init.headers['Content-Type'] = 'application/json'");
  });

  // The regression this guards: watchlist add, watchlist remove and sign out
  // all pass no body, and a content type set only alongside a body would 415
  // exactly those three against `JsonOnlyGuard`.
  it('does not make the content type conditional on a body', () => {
    const at = html.indexOf("init.headers['Content-Type']");
    const bodyCheck = html.indexOf('body !== undefined');
    expect(at).toBeGreaterThan(-1);
    expect(bodyCheck).toBeGreaterThan(-1);
    expect(at).toBeLessThan(bodyCheck);
  });
});

describe('getJson — revalidating instead of re-fetching', () => {
  it('asks without a validator first, then with the one it was given', async () => {
    const { asked, getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
      { status: 304, etag: '"tag-one"' },
    ]);

    await getJson(FEED);
    await getJson(FEED);

    expect(asked.map((ask) => ask.ifNoneMatch)).toEqual([
      undefined,
      '"tag-one"',
    ]);
  });

  // A 304 answers "what you hold is current", which is only true while the
  // page still shows this path's answer. The feed keeps ONE painted body
  // while validators are kept per path, so a filter round-trip re-asks a
  // path whose validator is still held — and a 304 for it would confirm rows
  // no longer on screen. Found live on 2026-08-18: uncheck 'Only filings
  // with verified claims', re-check it, and the feed stayed unfiltered.
  it("asks unconditionally when told the painted body is another path's", async () => {
    const { asked, getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
      { status: 200, etag: '"tag-two"', body: PAGE },
      { status: 304, etag: '"tag-two"' },
    ]);

    await getJson(FEED);
    await getJson(FEED, false);
    // The fresh validator is still remembered, so the next same-path ask —
    // once the body is painted again — revalidates as usual.
    await getJson(FEED);

    expect(asked.map((ask) => ask.ifNoneMatch)).toEqual([
      undefined,
      undefined,
      '"tag-two"',
    ]);
  });

  it('resolves a 304 rather than throwing, because res.ok is false for one', async () => {
    // THE TRAP THIS WHOLE MECHANISM TURNS ON. `getJson` reports a non-ok
    // response as a failure, and 304 is not ok — handled after that branch,
    // every successful revalidation becomes "refresh failed" in a red banner.
    const { getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
      { status: 304, etag: '"tag-one"' },
    ]);

    await getJson(FEED);

    await expect(getJson(FEED)).resolves.toEqual({ notModified: true });
  });

  it('hands every 304 the same object, so a caller can test identity', async () => {
    const { getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
      { status: 304, etag: '"tag-one"' },
    ]);

    await getJson(FEED);

    expect(await getJson(FEED)).toBe(await getJson(FEED));
  });

  it('keys the store by the whole path, so a filter change is asked afresh', async () => {
    const { asked, getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
    ]);

    await getJson(FEED);
    await getJson(`${FEED}&topic=capital`);

    expect(asked[1].ifNoneMatch).toBeUndefined();
  });

  it('ignores the weak validator express puts on everything else', async () => {
    // Express tags every response it sends `W/"..."` whether or not the route
    // meant to have a validator. Revalidating against those would send a 304 to
    // renderers that were never taught what one means — the summary's, the
    // watchlist's, the type-ahead's. Only a strong tag is a contract.
    const { asked, getJson } = harness([
      { status: 200, etag: 'W/"weak-one"', body: PAGE },
    ]);

    await getJson(FEED);
    await getJson(FEED);

    expect(asked[1].ifNoneMatch).toBeUndefined();
  });

  it('forgets a validator the next answer did not carry', async () => {
    const { asked, getJson } = harness([
      { status: 200, etag: '"tag-one"', body: PAGE },
      { status: 200, body: PAGE },
      { status: 200, body: PAGE },
    ]);

    await getJson(FEED);
    await getJson(FEED);
    await getJson(FEED);

    expect(asked.map((ask) => ask.ifNoneMatch)).toEqual([
      undefined,
      '"tag-one"',
      undefined,
    ]);
  });

  it('still reports a real failure, and still carries its status', async () => {
    const { getJson } = harness([{ status: 500, body: { error: 'boom' } }]);

    await expect(getJson(FEED)).rejects.toMatchObject({ status: 500 });
  });

  it('still refuses a 200 that is not a success envelope', async () => {
    const { getJson } = harness([{ status: 200, body: { rows: [] } }]);

    await expect(getJson(FEED)).rejects.toThrow('not a success envelope');
  });

  it('handles the 304 before the branch that throws on a non-ok response', () => {
    // Stated as an ordering too, because the behaviour above is only correct
    // while these two are in this order and nothing else says so.
    const notModified = SCRIPT.indexOf('res.status === 304');
    const notOk = SCRIPT.indexOf('if (!res.ok)');
    expect(notModified).toBeGreaterThan(-1);
    expect(notOk).toBeGreaterThan(-1);
    expect(notModified).toBeLessThan(notOk);
  });

  it('keeps the validator in memory and nowhere a second session can read it', () => {
    // A validator is a fingerprint of an authenticated response. It lives in a
    // JS object for as long as the tab is open and is written nowhere else.
    //
    // THE USE, NOT THE WORD: the fragment names both APIs in the comment that
    // forbids them, and a rule that fails on its own rationale is a rule
    // somebody deletes.
    expect(SCRIPT).not.toContain('localStorage.');
    expect(SCRIPT).not.toContain('sessionStorage.');
    expect(SCRIPT).not.toContain('setItem(');
    expect(SCRIPT).not.toContain('getItem(');
  });
});
