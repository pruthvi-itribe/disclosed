/**
 * The company page: the day bar, the filing strip, the group mix, and the
 * floor below which a per-company distribution is not drawn at all.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_COMPANY = `

  /**
   * The day as one bar and one sentence.
   *
   * Reads the category breakdown the summary route already returns, so it costs
   * no extra request. The sentence names the two numbers a reader actually
   * wants: how much of today is compliance paperwork, and how much of it said
   * something a document verified.
   */
  function renderDayBar(byGroup, total, verified) {
    var bar = el('day-mix');
    if (!bar) return;
    bar.textContent = '';

    var groups = Object.keys(byGroup).sort(function (a, b) {
      return byGroup[b] - byGroup[a];
    });
    var quiet = 0;
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (byGroup[g] === 0) continue;
      if (g === 'routine' || g === 'governance') quiet += byGroup[g];
      var seg = document.createElement('div');
      seg.className = 'mixseg g-' + g;
      seg.style.flexGrow = String(byGroup[g]);
      seg.title = g + ': ' + byGroup[g];
      bar.appendChild(seg);
    }

    setText(
      'day-sentence',
      total === 0
        ? ''
        : groupInt(total) +
            ' filings today. ' +
            groupInt(quiet) +
            ' of them are routine or governance paperwork. ' +
            groupInt(verified) +
            ' said something a document verified.',
    );
  }

  /**
   * Filings below which a per-company distribution is not drawn.
   *
   * Five, and it suppresses the mix bar for most companies — measured on
   * 2026-08-07, 460 of 960 companies had filed exactly ONCE and only 128 had
   * filed five times or more. A stacked bar over one observation is not a
   * distribution, it is a single colour claiming to be a summary.
   *
   * That the widget is usually absent is the widget working. 'context-line.ts'
   * settled this argument for the alert path already: a claim about thirty days
   * of data, made by a database holding four, is every word true and the whole
   * sentence false.
   */
  var MIN_DISTRIBUTION_FILINGS = 5;

  /** Every IST day from first to last inclusive, so gaps are drawn as gaps. */
  function istDaySpan(from, to) {
    var days = [];
    var cursor = Date.parse(from + 'T00:00:00Z');
    var end = Date.parse(to + 'T00:00:00Z');
    if (isNaN(cursor) || isNaN(end)) return days;
    // Bounded independently of the dates, so a malformed pair cannot spin.
    for (var guard = 0; cursor <= end && guard < 400; guard += 1) {
      days.push(new Date(cursor).toISOString().slice(0, 10));
      cursor += 86400000;
    }
    return days;
  }

  var WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var WEEKDAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /**
   * The filing strip: one column per IST day, one square per filing.
   *
   * A SQUARE PER FILING, NOT A BAR, and that is the whole design. At the
   * measured 2.36 filings a company, a bar chart is two bars of height one and
   * needs an axis before it can be read at all. Squares are countable — a
   * reader gets the number without reading anything.
   *
   * A DAY WITH NO FILINGS GETS A RULE, NOT A SHORT COLUMN. In the 32-day corpus
   * a Sunday carries 26 filings against a Tuesday's 832 — a factor of 32 — so a
   * proportional bar renders an ordinary weekend as an outage. "Nobody filed"
   * and "one filing" must not look alike.
   */
  function renderStrip(box, items) {
    box.textContent = '';
    if (items.length === 0) return;

    var byDay = {};
    for (var i = 0; i < items.length; i++) {
      var key = items[i].istDay;
      if (!key) continue;
      if (!Object.prototype.hasOwnProperty.call(byDay, key)) byDay[key] = [];
      byDay[key].push(items[i]);
    }

    var keys = Object.keys(byDay).sort();
    if (keys.length === 0) return;

    var days = istDaySpan(keys[0], keys[keys.length - 1]);
    for (var d = 0; d < days.length; d++) {
      var day = days[d];
      var onDay = Object.prototype.hasOwnProperty.call(byDay, day)
        ? byDay[day]
        : [];
      var weekday = new Date(day + 'T00:00:00Z').getUTCDay();

      var column = document.createElement('div');
      column.className =
        'stripday' + (weekday === 0 || weekday === 6 ? ' weekend' : '');

      var stack = document.createElement('div');
      stack.className = 'stripstack';
      if (onDay.length === 0) {
        var none = document.createElement('div');
        none.className = 'stripnone';
        stack.appendChild(none);
      }
      for (var k = 0; k < onDay.length; k++) {
        var cell = document.createElement('button');
        cell.type = 'button';
        var f = onDay[k];
        // Three meanings, not eleven. Eleven groups cannot take eleven hues on
        // a dark theme without a legend, and a legend defeats a glance — so
        // colour carries what a reader already learned from the cards.
        var kind =
          f.categoryGroup === 'results'
            ? ' results'
            : (f.enrichment && f.enrichment.claims || []).length > 0
              ? ' claim'
              : f.categoryGroup === 'routine' ||
                  f.categoryGroup === 'governance'
                ? ' quiet'
                : '';
        cell.className = 'stripcell' + kind;
        cell.title = f.disseminatedAtIst + ' IST · ' + f.category;
        cell.onclick = (function (seqId) {
          return function () {
            var card = document.querySelector(
              '#company-feed .card[data-seq="' + seqId + '"]',
            );
            if (card && card.scrollIntoView) {
              card.scrollIntoView({ block: 'center' });
            }
          };
        })(f.seqId);
        stack.appendChild(cell);
      }
      column.appendChild(stack);

      var label = document.createElement('div');
      label.className = 'striplabel';
      label.textContent = WEEKDAY[weekday];
      column.appendChild(label);

      var dayNum = document.createElement('div');
      dayNum.className = 'stripday-num';
      dayNum.textContent = day.slice(8);
      column.appendChild(dayNum);

      box.appendChild(column);
    }
  }

  /**
   * The group mix, as one bar.
   *
   * Widths are set with 'flexGrow' rather than a percentage, so flex does the
   * arithmetic exactly and no rounding has to be reconciled against 100.
   */
  function renderMix(bar, legend, items) {
    bar.textContent = '';
    legend.textContent = '';

    var counts = {};
    var order = [];
    for (var i = 0; i < items.length; i++) {
      var g = items[i].categoryGroup;
      if (!Object.prototype.hasOwnProperty.call(counts, g)) {
        counts[g] = { n: 0, label: items[i].categoryGroupLabel };
        order.push(g);
      }
      counts[g].n += 1;
    }
    order.sort(function (a, b) { return counts[b].n - counts[a].n; });

    for (var j = 0; j < order.length; j++) {
      var group = order[j];
      var seg = document.createElement('div');
      seg.className = 'mixseg g-' + group;
      seg.style.flexGrow = String(counts[group].n);
      seg.title = counts[group].label + ': ' + counts[group].n;
      bar.appendChild(seg);

      if (j < 3) {
        var item = document.createElement('span');
        item.className = 'mixitem';
        var swatch = document.createElement('span');
        swatch.className = 'mixdot g-' + group;
        item.appendChild(swatch);
        var text = document.createElement('span');
        text.textContent = counts[group].label + ' ' + counts[group].n;
        item.appendChild(text);
        legend.appendChild(item);
      }
    }
  }

  // The reader-facing name for each topic, and the same words the filter chips
  // use. A company page that called it "acquisition" beside a chip that says
  // "Deals" would be two names for one thing on one screen.
  var TOPIC_LABEL = {
    financial: 'Financials',
    dividend: 'Dividends',
    orders: 'Order wins',
    acquisition: 'Deals',
    capacity: 'Capacity',
    product: 'Product',
    ratings: 'Ratings',
    governance: 'Governance',
    other: 'Everything else'
  };

  /**
   * Claims below which a company's topic mix is not drawn.
   *
   * FOUR CLAIMS, NOT FIVE FILINGS, and the different unit is the point rather
   * than an oversight. MIN_DISTRIBUTION_FILINGS guards a bar whose
   * observations ARE filings; this one's observations are claims, and the two
   * counts are only loosely related — CAPACITE has 23 claims across 2 filings
   * and would be suppressed by a filing floor while having more to say than
   * almost anyone.
   *
   * Measured over the 547 companies holding at least one claim:
   *
   *     floor   companies drawn   of those, showing 2+ topics
   *       1           547                  64%
   *       2           466                  75%
   *       3           368                  84%
   *       4           257                  90%
   *       5           222                  92%
   *
   * Four is where the curve flattens: 3 to 4 buys six points and 4 to 5 buys
   * two. It also draws the bar for 257 companies where the filing floor draws
   * the one above it for 128, so the newer bar is the one more readers see.
   *
   * A SINGLE-COLOUR BAR IS NOT THE FAILURE HERE, which is why the floor sits on
   * count and not on diversity. "Every one of these nine claims is financial"
   * is a true and useful thing to learn about a company. "This company's one
   * claim was financial" is not a distribution at all.
   */
  var MIN_TOPIC_CLAIMS = 4;

  /**
   * What a company actually said, as one bar.
   *
   * The same shape as renderMix one axis over, and deliberately not shared
   * with it: that one counts filings by a field on the filing, this one counts
   * claims by a field on each claim, and a parameterised version would take a
   * getter, a labeller and a class prefix to save eleven lines.
   */
  function renderTopics(bar, legend, items) {
    bar.textContent = '';
    legend.textContent = '';

    var counts = {};
    var order = [];
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      var claims = (items[i].enrichment && items[i].enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        // A claim stored before the classifier existed carries no topic. It is
        // counted under the topic that means "nothing in particular" rather
        // than dropped, so the bar's segments still add up to the claim count
        // the rest of the page shows.
        var topic = claims[c].topic || 'other';
        if (!Object.prototype.hasOwnProperty.call(counts, topic)) {
          counts[topic] = 0;
          order.push(topic);
        }
        counts[topic] += 1;
        total += 1;
      }
    }
    if (total < MIN_TOPIC_CLAIMS) return false;

    order.sort(function (a, b) {
      // Ties broken by name, so a repaint four seconds from now cannot reorder
      // two equal segments and make the bar appear to move on its own.
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a < b ? -1 : 1;
    });

    for (var j = 0; j < order.length; j++) {
      var name = order[j];
      var label = describe(TOPIC_LABEL, name);
      var seg = document.createElement('div');
      seg.className = 'mixseg t-' + name;
      seg.style.flexGrow = String(counts[name]);
      seg.title = label + ': ' + counts[name] + ' claim(s)';
      bar.appendChild(seg);

      if (j < 3) {
        var item = document.createElement('span');
        item.className = 'mixitem';
        var swatch = document.createElement('span');
        swatch.className = 'mixdot t-' + name;
        item.appendChild(swatch);
        var text = document.createElement('span');
        text.textContent = label + ' ' + counts[name];
        item.appendChild(text);
        legend.appendChild(item);
      }
    }
    return true;
  }

  function renderCompany(items, meta) {
    if (state.company === null) return;

    setText('co-symbol', state.company);
    setText('co-name', items.length > 0 ? items[0].companyName : '');

    // Industry appears ONLY when it is known. It is null on 58.2% of filings,
    // so it can never be a structural element — a page whose third line reads
    // "Industry: —" on six companies in ten looks broken rather than honest.
    var industry = items.length > 0 ? items[0].industry : null;
    var industryTag = el('co-industry');
    industryTag.hidden = !industry;
    if (industry) industryTag.textContent = industry;

    // The watch control, hidden exactly the way the industry tag above it is.
    // Absent when signed out for the same reason the card's star is: a
    // permanently disabled control explains nothing.
    var watch = el('co-watch');
    watch.hidden = !signedIn();
    if (!watch.hidden) setWatchLabel(watch, state.company);

    var verified = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].confidenceTier === 'verified') verified += 1;
    }
    setText('co-filings', groupInt(meta.total));
    setText('co-verified', groupInt(verified));
    setText('co-last', items.length > 0 ? relativeTime(items[0].disseminatedAt) : '—');

    // THE COVERAGE LINE, and it is the first thing that tells a reader whether
    // anything below it means anything.
    var days = {};
    for (var d = 0; d < items.length; d++) {
      if (items[d].istDay) days[items[d].istDay] = true;
    }
    var dayKeys = Object.keys(days).sort();
    setText(
      'co-coverage',
      dayKeys.length === 0
        ? ''
        : groupInt(meta.total) +
            ' filings held · ' +
            dayKeys[0] +
            ' to ' +
            dayKeys[dayKeys.length - 1] +
            ' · ' +
            dayKeys.length +
            (dayKeys.length === 1 ? ' IST day' : ' IST days'),
    );

    renderStrip(el('co-strip'), items);

    var mixWrap = el('co-mix-wrap');
    mixWrap.hidden = items.length < MIN_DISTRIBUTION_FILINGS;
    if (!mixWrap.hidden) {
      renderMix(el('co-mix'), el('co-mix-legend'), items);
    }

    // DRAWN FIRST, HIDDEN AFTER, because only the renderer can count the claims
    // — they are nested inside the filings and the floor is on their total, not
    // on anything renderCompany already holds. It returns whether it drew
    // anything rather than having the floor written down in two places.
    var topicsWrap = el('co-topics-wrap');
    var drewTopics = renderTopics(
      el('co-topics'),
      el('co-topics-legend'),
      items,
    );
    topicsWrap.hidden = !drewTopics;

    renderFeedInto(el('company-feed'), items, meta, false);
  }

`;
