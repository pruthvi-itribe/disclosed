/**
 * A lookup that cannot be walked into the prototype chain. The keys come from
 * the server and are a closed set, but the value may be exchange-derived —
 * the old client guarded 'constructor' by hand on plain objects; a Map has no
 * prototype to walk into, and the fallback is the key itself so an unknown
 * value still names itself.
 */
export const describeKey = (
  table: ReadonlyMap<string, string>,
  key: string,
): string => table.get(key) ?? key;
