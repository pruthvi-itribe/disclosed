/**
 * The product's name, in one place.
 *
 * THIS FILE IS WHY THE RENAME WAS ONE COMMIT. Every page — the dashboard, the
 * landing page and the sign-in page — draws its title, its wordmark and its
 * prose from here, so "Turret" became "Disclosed" by editing four constants
 * rather than by grepping for a word that also appears in comments.
 *
 * NOT A CONFIG VALUE. A brand is not an operator setting: two processes reading
 * different names from two environments would be two products. It is a
 * compile-time constant for the same reason the category taxonomy is written
 * into the page rather than fetched — the set is closed and owned here.
 *
 * WHAT DELIBERATELY DID NOT CHANGE WITH THE NAME: the npm package, the Nest
 * module names, the `turret` database, the `turret_sid` cookie and the
 * `DASHBOARD_*` environment keys. Renaming those is churn with no user-visible
 * value, and the cookie in particular would sign every existing session out.
 */

/** The product name as it appears in prose and in a page title. */
export const BRAND = 'Disclosed';

/**
 * The wordmark: the word, and the accent character set after it.
 *
 * A FULL STOP, IN THE ACCENT COLOUR. "Turret" was split into two coloured
 * halves, which does not transfer — "disclos/ed" cuts a word nobody reads in
 * two parts, and the name's whole value is that it is a plain English verb. So
 * the accent moves off the letters and onto a terminating dot: *Disclosed.* is
 * the sentence this product is, and the CSS class that colours it has been
 * called `.dotmark` since before there was a dot.
 *
 * A CAPITAL D, EVERYWHERE. The mark was set lowercase, which is the house style
 * of a certain kind of developer tool and is wrong for this one: the name is a
 * proper noun in the footer, in the title bar and in every sentence of copy, and
 * a header that spelled it `disclosed` made the product's own name look like a
 * file name beside its own prose. One spelling, and it is this one.
 *
 * The word is `BRAND` itself, so the two cannot drift. The accent is held as
 * data rather than derived, because where an accent falls is a decision about a
 * specific word and a formula that happened to work for one name would put the
 * colour in the wrong place on the next.
 */
export const BRAND_MARK = { word: BRAND, accent: '.' } as const;

/**
 * What the product does, in the words the title bar and the landing page use.
 *
 * Here rather than beside each page so the two cannot drift — a landing page
 * promising one thing and a title bar promising another is the first thing a
 * visitor can catch this product being careless about.
 *
 * The name is a verb, and the copy uses it as one: a company DISCLOSED
 * something, and this is the record of it.
 */
export const BRAND_TAGLINE = 'what Indian companies disclosed today';

/**
 * The origin this product is served from in production.
 *
 * COPY, NOT CONFIGURATION, and the distinction is load-bearing. Nothing in the
 * request path may read this: the cookie's scope, the CSRF origin check and
 * every fetch the page makes are host-derived (`PUBLIC_ORIGIN`, defaulted to
 * this process's own loopback URL), which is what keeps `127.0.0.1:7717`
 * working. This constant exists so the landing page can print the address a
 * visitor would type, and for nothing else.
 */
export const BRAND_DOMAIN = 'disclosed.live';
