/**
 * The product's name, in one place.
 *
 * A RENAME IS PENDING and this file is what makes it a one-line change rather
 * than a grep. Every page — the dashboard, the landing page and the sign-in
 * page — draws its title, its wordmark and its prose from here, so the day the
 * founder picks a name the edit is these three constants and nothing else.
 *
 * NOT A CONFIG VALUE. A brand is not an operator setting: two processes reading
 * different names from two environments would be two products. It is a
 * compile-time constant for the same reason the category taxonomy is written
 * into the page rather than fetched — the set is closed and owned here.
 */

/** The product name as it appears in prose and in a page title. */
export const BRAND = 'Turret';

/**
 * The wordmark, in the two halves the header colours differently.
 *
 * Lowercase because the mark is set lowercase, and split as data rather than
 * derived by slicing `BRAND`: where the accent falls is a design decision about
 * a specific word, and a formula that happens to work for "Turret" would put the
 * colour in the wrong place on whatever replaces it.
 */
export const BRAND_MARK = { head: 'tur', tail: 'ret' } as const;

/**
 * What the product does, in the words the title bar and the landing page use.
 *
 * Here rather than beside each page so the two cannot drift — a landing page
 * promising one thing and a title bar promising another is the first thing a
 * visitor can catch this product being careless about.
 */
export const BRAND_TAGLINE = 'what Indian companies said today';
