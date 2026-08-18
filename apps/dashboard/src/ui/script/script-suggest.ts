/**
 * The type-ahead: its debounce, its listbox, and the keyboard contract that
 * makes it a combobox rather than a menu that happens to appear.
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
export const SCRIPT_SUGGEST = `
  function closeSuggest() {
    var box = el('suggest');
    if (box) box.hidden = true;
    suggestState.open = false;
    suggestState.active = -1;
    var input = el('symbol');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  // THE ONE HIGHLIGHT, for the mouse and the keyboard alike.
  //
  // Deliberately not a ':hover' rule. The arrow keys move a highlight without
  // moving the pointer, so a hover rule would light up whichever row the mouse
  // is resting over AS WELL as the one Enter would pick - two highlighted rows,
  // one of them lying about what the next keypress does.
  //
  // 'aria-activedescendant' is what makes this announceable: DOM focus never
  // leaves the input (it must not - the reader is still typing), so the
  // highlight is only a colour unless the input names the option it is on.
  function highlight(index) {
    var options = el('suggest').getElementsByClassName('sopt');
    for (var i = 0; i < options.length; i++) {
      var mine = i === index;
      options[i].className = 'sopt' + (mine ? ' active' : '');
      options[i].setAttribute('aria-selected', mine ? 'true' : 'false');
    }
    suggestState.active = index;

    var input = el('symbol');
    if (index < 0 || !options[index]) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    input.setAttribute('aria-activedescendant', options[index].id);
    // A list can be taller than its own box. A reader arrowing past the bottom
    // must not be highlighting a row they cannot see.
    if (options[index].scrollIntoView) {
      options[index].scrollIntoView({ block: 'nearest' });
    }
  }

  // Wraps at both ends, because the list is at most eleven rows: walking off
  // the bottom round to the top is faster than reversing, and there is never
  // enough of it to get lost in.
  function moveActive(delta) {
    var n = suggestState.items.length;
    if (!suggestState.open || n === 0) return;
    var next = suggestState.active + delta;
    if (next < 0) next = n - 1;
    if (next >= n) next = 0;
    highlight(next);
  }

  function suggestHeading(box, label) {
    var li = document.createElement('li');
    li.className = 'sgroup';
    // Presentational, so it is not one of the options the arrow keys walk. A
    // listbox whose headings are arrowable makes Enter do nothing on a third
    // of its rows.
    li.setAttribute('role', 'presentation');
    li.textContent = label;
    box.appendChild(li);
  }

  function suggestOption(box, index, item) {
    var li = document.createElement('li');
    li.className = 'sopt';
    li.id = 'suggest-opt-' + index;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('data-index', String(index));

    var head = document.createElement('span');
    head.className = 'ssym';
    head.textContent = item.head;
    li.appendChild(head);

    if (item.name) {
      var name = document.createElement('span');
      name.className = 'sname';
      name.textContent = item.name;
      li.appendChild(name);
    }

    // How many filings there are behind this row. It is the cheapest possible
    // answer to "is this the one I meant" when two companies both complete
    // what the reader typed.
    var n = document.createElement('span');
    n.className = 'scount';
    n.textContent = groupInt(item.filings);
    li.appendChild(n);

    box.appendChild(li);
  }

  function pushSuggestions(box, items, label, rows, build) {
    if (!rows || rows.length === 0) return;
    suggestHeading(box, label);
    for (var i = 0; i < rows.length; i++) {
      var item = build(rows[i]);
      items.push(item);
      suggestOption(box, items.length - 1, item);
    }
  }

  function renderSuggest(data) {
    var box = el('suggest');
    clear(box);

    var items = [];

    // THE ORDER IS THE SERVER'S RANKING, not a preference expressed twice.
    // Companies lead because a company is what the box is for; groups come
    // last because there are eleven of them and a row of chips for them sits
    // directly underneath.
    pushSuggestions(box, items, 'Companies', data.companies, function (row) {
      return {
        kind: 'company',
        value: row.symbol,
        head: row.symbol,
        name: row.companyName,
        filings: row.filings
      };
    });
    pushSuggestions(box, items, 'Categories', data.categories, function (row) {
      return {
        kind: 'category',
        value: row.category,
        head: row.category,
        name: '',
        filings: row.filings
      };
    });
    pushSuggestions(box, items, 'Groups', data.groups, function (row) {
      return {
        kind: 'group',
        value: row.group,
        head: row.label,
        name: '',
        filings: row.filings
      };
    });

    suggestState.items = items;

    if (items.length === 0) {
      // Hidden rather than showing "no matches". The box also searches free
      // text, so a query with no company behind it is an ordinary thing to be
      // typing - saying "nothing found" mid-word would be wrong as often as it
      // was right.
      closeSuggest();
      return;
    }

    box.hidden = false;
    suggestState.open = true;
    el('symbol').setAttribute('aria-expanded', 'true');
    // NOTHING IS HIGHLIGHTED until the reader presses a key. Pre-selecting the
    // first row is how a search box quietly applies a filter nobody chose: the
    // reader types a phrase, presses Enter to search for it, and gets one
    // company instead. Enter with no highlight searches what was typed.
    highlight(-1);
  }

  function requestSuggestions() {
    var typed = el('symbol').value.trim();
    if (typed.length < SUGGEST_MIN) {
      closeSuggest();
      return;
    }

    suggestState.seq += 1;
    var mine = suggestState.seq;

    getJson('api/suggest?q=' + encodeURIComponent(typed))
      .then(function (body) {
        if (mine !== suggestState.seq) return;
        renderSuggest(body.data);
      })
      .catch(function () {
        // DELIBERATELY SILENT, unlike every other fetch on this page.
        //
        // A failed suggestion costs the reader nothing - the box still searches
        // on Enter and the feed is unaffected - and the alternative is a red
        // banner over the feed because a keystroke raced a restart. That would
        // be the page reporting its own timing as a fault. The live dot and the
        // four-second poll are what say the server is down, and they say it
        // whether anybody is typing or not.
        if (mine === suggestState.seq) closeSuggest();
      });
  }

  function scheduleSuggestions() {
    if (suggestState.timer !== null) window.clearTimeout(suggestState.timer);
    suggestState.timer = window.setTimeout(function () {
      suggestState.timer = null;
      requestSuggestions();
    }, SUGGEST_DEBOUNCE_MS);
  }

  // Undoes exactly what picking a suggestion did, and nothing else - which
  // needs a VALUE check, not just a kind check: Admin's selects write the
  // same fields, so after a pick was overwritten there the field no longer
  // holds what the pick set and clearing it would wipe a filter the reader
  // chose elsewhere. Each field is cleared only while it still holds the
  // picked value. The React client's undoPicked carries the same rule;
  // script-suggest.spec.ts runs this function against both cases.
  function undoPicked() {
    var picked = state.picked;
    if (!picked) return;
    if (picked.kind === 'company' && state.symbol === picked.value) {
      state.symbol = '';
    }
    if (picked.kind === 'category' && state.category === picked.value) {
      state.category = '';
      setControl('category', '');
    }
    if (picked.kind === 'group' && state.group === picked.value) {
      state.group = '';
      syncChips();
    }
    state.picked = null;
  }

  function applySuggestion(index) {
    var item = suggestState.items[index];
    if (!item) return;

    undoPicked();
    // Each kind applies the EXACT filter it names, never a better-ranked fuzzy
    // one. That is the whole reason the list distinguishes three kinds: picking
    // "Stock split" from it is 'category=Stock split', not a text search for
    // two common words that also matches every broking company.
    if (item.kind === 'company') {
      state.symbol = item.value;
    } else if (item.kind === 'category') {
      state.category = item.value;
      setControl('category', item.value);
    } else {
      state.group = item.value;
      syncChips();
    }

    state.picked = item;
    state.q = '';
    state.offset = 0;
    el('symbol').value = item.head;
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  // Enter with nothing highlighted: search what was typed.
  function submitSearch() {
    undoPicked();
    state.q = el('symbol').value.trim();
    state.offset = 0;
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  function clearSearch() {
    undoPicked();
    state.q = '';
    state.offset = 0;
    el('symbol').value = '';
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  // WHAT THE BOX IS CURRENTLY DOING, in words, with a way out.
  //
  // Picking BRITANNIA puts 'BRITANNIA' in the box, which looks identical to
  // having typed it - and the two do different things. This line is what tells
  // a reader which of them is in force, and it is the only affordance for
  // undoing a pick without deleting the text by hand.
  function renderSearchNote() {
    var note = el('search-note');
    if (!note) return;
    clear(note);

    var picked = state.picked;
    var label = null;
    if (picked && picked.kind === 'company') {
      label = 'Every filing by ' + picked.value;
    } else if (picked && picked.kind === 'category') {
      label = 'Category: ' + picked.value;
    } else if (picked && picked.kind === 'group') {
      label = 'Group: ' + picked.head;
    } else if (state.q) {
      label = 'Searching for ' + state.q;
    }

    if (label === null) {
      note.hidden = true;
      return;
    }

    // textContent, like everything else: a category is NSE's text and the query
    // is the reader's, and neither is markup.
    note.appendChild(document.createTextNode(label));
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'clearq';
    undo.textContent = 'clear';
    undo.addEventListener('click', clearSearch);
    note.appendChild(undo);
    note.hidden = false;
  }

  el('symbol').addEventListener('input', function () {
    // Typing invalidates a pick. A reader editing 'BRITANNIA' back down to
    // 'BRIT' has stopped asking for Britannia specifically, and leaving the
    // exact symbol filter on would show them Britannia's filings for a word
    // that no longer says Britannia.
    if (state.picked) {
      undoPicked();
      renderSearchNote();
    }
    scheduleSuggestions();
  });

  el('symbol').addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Reopens a list the reader dismissed, rather than doing nothing. Escape
      // is for getting the list out of the way; ArrowDown is for asking it back.
      if (!suggestState.open) requestSuggestions();
      else moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Escape') {
      // preventDefault ONLY while the list is open. A type=search input clears
      // itself on Escape in some browsers, and that is the right behaviour for
      // an empty-handed Escape - it just must not also happen on the press that
      // was meant to dismiss the list.
      if (suggestState.open) {
        event.preventDefault();
        closeSuggest();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestState.open && suggestState.active >= 0) {
        applySuggestion(suggestState.active);
      } else {
        submitSearch();
      }
      return;
    }
    if (event.key === 'Tab') closeSuggest();
  });

  // Closing on blur is what makes a click anywhere else dismiss the list. The
  // mousedown handler below is what stops it dismissing the list before a click
  // ON the list has landed.
  el('symbol').addEventListener('blur', closeSuggest);

  function optionIndexAt(node, root) {
    while (node && node !== root) {
      if (node.getAttribute && node.getAttribute('data-index') !== null) {
        return Number(node.getAttribute('data-index'));
      }
      node = node.parentNode;
    }
    return -1;
  }

  el('suggest').addEventListener('mousedown', function (event) {
    // Without this the input blurs first, the blur handler closes the list, and
    // the click lands on nothing. A suggestion you can see and cannot click is
    // worse than no suggestion.
    event.preventDefault();
  });

  el('suggest').addEventListener('click', function (event) {
    var index = optionIndexAt(event.target, event.currentTarget);
    if (index >= 0) applySuggestion(index);
  });

  // The pointer moves the SAME highlight the arrow keys move, so there is only
  // ever one row claiming to be what Enter will pick.
  el('suggest').addEventListener('mouseover', function (event) {
    var index = optionIndexAt(event.target, event.currentTarget);
    if (index >= 0 && index !== suggestState.active) highlight(index);
  });

`;
