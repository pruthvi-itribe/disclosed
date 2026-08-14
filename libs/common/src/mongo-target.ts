/**
 * What a startup line may say about the database it connected to.
 *
 * The password was already redacted. The HOST was not, and this repository's
 * own rule is that a clue is not a secret and is still worth having:
 * `repo-hygiene.spec.ts` fails the build on a managed-database identifier in
 * any tracked file, because naming the cluster names the target. The boot line
 * printed exactly the string that rule exists to keep out of git.
 *
 * Pod logs are not public today, which is why this is hygiene rather than an
 * incident. It is worth fixing now because open item 5 in
 * `docs/deploy-kubernetes.md` is a plan to ship these logs somewhere durable —
 * and when that lands, the hostname goes with them.
 *
 * WHAT AN OPERATOR READING A BOOT LINE ACTUALLY NEEDS is which database, and
 * whether it is the local one. The failures this line helps diagnose are "wrong
 * database" and "cannot reach it", and neither is answered by the address:
 * "cannot reach it" arrives as a connection error carrying the host anyway.
 *
 * LOOPBACK IS PRINTED IN FULL, deliberately. It gives an attacker nothing, and
 * on a laptop the port is the whole question — two local mongods on 27017 and
 * 27117 is exactly the confusion this line exists to settle.
 */

/** Hosts that describe this machine and so reveal nothing about anywhere. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** What replaces a host that is not this machine. */
const HIDDEN = '<host-withheld>';

/**
 * A connection string reduced to what may be logged.
 *
 * NEVER THROWS. A malformed URI is a configuration error that other code
 * reports properly; this function's only job is to not be the thing that
 * crashes a boot, and its failure mode is to say LESS rather than more.
 */
export const describeMongoTarget = (uri: string): string => {
  if (typeof uri !== 'string' || uri === '') return HIDDEN;

  // Split off the scheme by hand rather than with `new URL`: the `mongodb+srv`
  // scheme is not one WHATWG URL parses into a useful host, and a parser that
  // silently returns an empty host would print less than intended without
  // saying why.
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd < 0) return HIDDEN;

  const scheme = uri.slice(0, schemeEnd);
  const rest = uri.slice(schemeEnd + 3);

  // Credentials first, so a password containing `/` or `?` cannot be mistaken
  // for the start of the path.
  const at = rest.lastIndexOf('@');
  const hasCredentials = at >= 0;
  const afterCredentials = hasCredentials ? rest.slice(at + 1) : rest;

  // The OPTIONS ARE DROPPED ENTIRELY, not just trimmed for tidiness:
  // `?replicaSet=...` names the cluster as surely as the hostname does, and an
  // allowlist of safe options is a list somebody has to keep correct forever.
  const pathStart = afterCredentials.search(/[/?]/);
  const hostPart =
    pathStart < 0 ? afterCredentials : afterCredentials.slice(0, pathStart);

  const afterHost = pathStart < 0 ? '' : afterCredentials.slice(pathStart);
  const database = afterHost.startsWith('/')
    ? afterHost.slice(1).split('?')[0]
    : '';

  // A host list (`a:1,b:2`) is a replica set spelled out; one member is as much
  // of a clue as all of them, so the whole thing is withheld together.
  const bareHost = hostPart.split(',')[0].split(':')[0].toLowerCase();
  const host = LOOPBACK.has(bareHost) ? hostPart : HIDDEN;

  const credentials = hasCredentials ? '***@' : '';
  const suffix = database === '' ? '' : `/${database}`;

  return `${scheme}://${credentials}${host}${suffix}`;
};
