(() => {
  // Marks on the page an agent checks, for its screenshots: a frame around what is there or what
  // is wrong, a dashed frame where something is missing, a banner for what has no place on the
  // screen. They are drawn in the agent's own browser only: the app never sees them.
  //
  // Load it into the page (the shared contract → Marking what is wrong says how), then:
  //   qaMark.bad(target, "what is wrong")      red frame around an element
  //   qaMark.missing(anchor, "what", side)     red dashed frame next to `anchor`, where it should be
  //   qaMark.note("what is wrong")             red banner at the top (no place on the screen)
  //   qaMark.ok(target, "what is there")       green frame
  //   qaMark.clear()                           removes every mark
  // A target is a CSS selector or `text=<visible text>`, chained with ` >> ` as in Playwright
  // (`button >> text=New quiz`); `nth=<n>` picks one of several. Each call answers what it did:
  // {marked: false, reason} when it marked nothing.
  const COLORS = { ok: "#16a34a", bad: "#dc2626" };
  const LAYER_ID = "qa-mark-layer";
  const ON_TOP = "2147483647";
  const GAP = 12;
  const EDGE = 4;
  const MAIN = "main, [role=main]";
  const INTERACTIVE =
    "button, a, input, select, textarea, label, [role=button], [role=link], [role=tab], [role=menuitem]";

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  };

  const box = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  const rounded = (rect) => ({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });

  // The marks of this page; a page the app moved on from (a new URL) loses its old ones.
  const layer = () => {
    let element = document.getElementById(LAYER_ID);
    if (element !== null && element.dataset.href !== location.href) {
      element.remove();
      element = null;
    }
    if (element === null) {
      element = document.createElement("div");
      element.id = LAYER_ID;
      element.dataset.href = location.href;
      element.setAttribute("aria-hidden", "true");
      document.body.append(element);
    }
    return element;
  };

  const ownText = (element) => (element.innerText || "").trim().toLowerCase();

  const unique = (elements) => [...new Set(elements)];

  // The innermost visible elements with this text (the whole text first, then a part of it), the
  // scope itself included; a button or link around one stands for it.
  const textMatches = (text, scope) => {
    const wanted = text.trim().toLowerCase();
    if (wanted === "") {
      return [];
    }
    const candidates = [
      ...(scope === document.body ? [] : [scope]),
      ...scope.querySelectorAll("*"),
    ].filter(
      (element) =>
        element.closest("#" + LAYER_ID) === null &&
        (element.textContent || "").toLowerCase().includes(wanted) &&
        isVisible(element)
    );
    const whole = candidates.filter((element) => ownText(element) === wanted);
    const pool =
      whole.length > 0
        ? whole
        : candidates.filter((element) => ownText(element).includes(wanted));
    return unique(
      pool
        .filter(
          (element) =>
            !pool.some((other) => other !== element && element.contains(other))
        )
        .map((element) => {
          const control = element.closest(INTERACTIVE);
          return control !== null && isVisible(control) ? control : element;
        })
    );
  };

  // A CSS selector, or `text=…`; what no selector finds (or what does not read as one) is text.
  const partMatches = (part, scope) => {
    if (part.startsWith("text=")) {
      return textMatches(part.slice("text=".length), scope);
    }
    let bySelector = [];
    try {
      bySelector = [...scope.querySelectorAll(part)].filter(isVisible);
    } catch {
      bySelector = [];
    }
    return bySelector.length > 0 ? bySelector : textMatches(part, scope);
  };

  // What a target names, as Playwright reads one: parts chained with ` >> `, each looking inside
  // what the one before found (`button >> text=New quiz`), and `nth=<n>` picking one of them (0 is
  // the first, -1 the last). Without `nth`, text names one in the page's main content first.
  const find = (target) => {
    if (typeof target !== "string" || target.trim() === "") {
      return { element: null, count: 0 };
    }
    const parts = target.split(" >> ").map((part) => part.trim());
    let found = [document.body];
    let picked = false;
    for (const part of parts) {
      const nth = /^nth=(-?\d+)$/.exec(part);
      if (nth !== null) {
        const one = found.at(Number(nth[1]));
        found = one === undefined ? [] : [one];
        picked = true;
      } else {
        found = unique(found.flatMap((scope) => partMatches(part, scope)));
        picked = false;
      }
    }
    const inMain = picked
      ? undefined
      : found.find((candidate) => candidate.closest(MAIN) !== null);
    return { element: inMain ?? found[0] ?? null, count: found.length };
  };

  // What a call says beyond what it marked: other elements that matched, the page moving.
  const remarks = (target, count, moved, before) => ({
    ...(count > 1
      ? {
          matches: count,
          hint:
            count +
            " visible elements match: this marked one; '" +
            target +
            " >> nth=1' marks the second (0 is the first)",
        }
      : {}),
    ...(moved && before
      ? {
          warning:
            "the page scrolled to show it: earlier marks may no longer sit on their elements (screenshot them first, then clear)",
        }
      : {}),
  });

  // A heading or a line of text is framed around its words, not the whole width of its block.
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    const onlyText = [...element.children].every(
      (child) => getComputedStyle(child).display === "inline"
    );
    if (element.matches(INTERACTIVE) || !onlyText) {
      return rect;
    }
    const words = document.createRange();
    words.selectNodeContents(element);
    const tight = words.getBoundingClientRect();
    return tight.width > 0 && tight.height > 0 ? tight : rect;
  };

  const show = (element) => {
    const rect = rectOf(element);
    const inView =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= innerHeight &&
      rect.right <= innerWidth;
    if (!inView) {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    }
    return { rect: rectOf(element), moved: !inView };
  };

  const insideWindow = (rect) =>
    box(
      Math.min(Math.max(EDGE, rect.left), innerWidth - rect.width - EDGE),
      Math.min(Math.max(EDGE, rect.top), innerHeight - rect.height - EDGE),
      rect.width,
      rect.height
    );

  const frame = (rect, kind, dashed) => {
    const element = document.createElement("div");
    element.dataset.qaFrame = "";
    Object.assign(element.style, {
      position: "fixed",
      boxSizing: "border-box",
      left: rect.left - 5 + "px",
      top: rect.top - 5 + "px",
      width: rect.width + 10 + "px",
      height: rect.height + 10 + "px",
      border: "3px " + (dashed ? "dashed " : "solid ") + COLORS[kind],
      borderRadius: "10px",
      background: dashed ? "rgba(220, 38, 38, 0.08)" : "transparent",
      zIndex: ON_TOP,
      pointerEvents: "none",
    });
    layer().append(element);
  };

  const overlaps = (one, other) =>
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom;

  // Where a label may sit around its frame: above, below, beside it, then further out.
  const placesAround = (rect, size) => {
    const left = Math.min(
      Math.max(EDGE, rect.left - 5),
      innerWidth - size.width - EDGE
    );
    const step = size.height + EDGE;
    const above = rect.top - 5 - step;
    const below = rect.bottom + 5 + EDGE;
    const middle = rect.top + rect.height / 2 - size.height / 2;
    return [
      { left, top: above },
      { left, top: below },
      { left: rect.right + 5 + EDGE, top: middle },
      { left: rect.left - 5 - EDGE - size.width, top: middle },
      { left, top: above - step },
      { left, top: below + step },
    ].filter(
      (place) =>
        place.left >= EDGE &&
        place.left + size.width <= innerWidth - EDGE &&
        place.top >= EDGE &&
        place.top + size.height <= innerHeight - EDGE
    );
  };

  // Every label again, now that one more frame is drawn: each where it covers no frame, banner or
  // label placed before it (a label put down earlier knows nothing of the frames after it).
  const placeLabels = () => {
    const fixed = [
      ...layer().querySelectorAll("[data-qa-frame], [data-qa-banner]"),
    ].map((element) => element.getBoundingClientRect());
    const placed = [];
    for (const element of layer().querySelectorAll("[data-qa-label]")) {
      const size = element.getBoundingClientRect();
      const places = placesAround(element.qaRect, size);
      const free = (place) =>
        ![...fixed, ...placed].some((other) =>
          overlaps(box(place.left, place.top, size.width, size.height), other)
        );
      const place = places.find(free) ?? places[0] ?? { left: EDGE, top: EDGE };
      element.style.left = place.left + "px";
      element.style.top = place.top + "px";
      placed.push(box(place.left, place.top, size.width, size.height));
    }
  };

  const label = (rect, kind, text) => {
    const element = document.createElement("div");
    element.dataset.qaLabel = "";
    element.qaRect = rect;
    element.textContent = text;
    Object.assign(element.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      background: COLORS[kind],
      color: "#fff",
      font: "600 13px/20px system-ui, sans-serif",
      padding: "3px 8px",
      borderRadius: "6px",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)",
      zIndex: ON_TOP,
      pointerEvents: "none",
    });
    layer().append(element);
    placeLabels();
  };

  // Banners stack down from the top of the window.
  const banner = (kind, text) => {
    const last = [...layer().querySelectorAll("[data-qa-banner]")].pop();
    const element = document.createElement("div");
    element.dataset.qaBanner = "";
    element.textContent = text;
    Object.assign(element.style, {
      position: "fixed",
      left: "50%",
      transform: "translateX(-50%)",
      top:
        (last === undefined ? 12 : last.getBoundingClientRect().bottom + 8) +
        "px",
      maxWidth: "min(90vw, 900px)",
      background: COLORS[kind],
      color: "#fff",
      font: "600 15px/22px system-ui, sans-serif",
      textAlign: "center",
      padding: "6px 14px",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
      zIndex: ON_TOP,
      pointerEvents: "none",
    });
    layer().append(element);
  };

  const hadMarks = () => layer().childElementCount > 0;

  // The elements this page's marks frame: the same one twice is a target that needs nth=.
  const framed = () => {
    const current = layer();
    current.qaFramed ??= new Set();
    return current.qaFramed;
  };

  const around = (target, kind, text) => {
    const { element, count } = find(target);
    if (element === null) {
      return {
        marked: false,
        reason: "nothing visible matches " + JSON.stringify(target),
      };
    }
    if (framed().has(element)) {
      return {
        marked: false,
        reason:
          "it is an element marked already; pick another of the " +
          count +
          " that match: '" +
          target +
          " >> nth=1' is the second (0 is the first)",
      };
    }
    framed().add(element);
    const before = hadMarks();
    const { rect, moved } = show(element);
    frame(rect, kind, false);
    label(rect, kind, text);
    return {
      marked: true,
      at: rounded(rect),
      ...remarks(target, count, moved, before),
    };
  };

  const SIDES = {
    left: (near, width, height) =>
      box(near.left - GAP - width, near.top, width, height),
    right: (near, width, height) =>
      box(near.right + GAP, near.top, width, height),
    above: (near, width, height) =>
      box(near.left, near.top - GAP - height, width, height),
    below: (near, width, height) =>
      box(near.left, near.bottom + GAP, width, height),
  };

  window.qaMark = {
    ok: (target, what) => around(target, "ok", "✓ " + what),
    bad: (target, what) => around(target, "bad", "✗ " + what),
    // Where it should be: beside `anchor` (left, right, above, below; by default the side with
    // more room). With no anchor it is a banner; an anchor not found marks nothing.
    missing: (anchor, what, side) => {
      const text = "✗ Missing: " + what;
      if (anchor === undefined || anchor === null || anchor === "") {
        banner("bad", text);
        return { marked: true, as: "banner" };
      }
      const { element, count } = find(anchor);
      if (element === null) {
        return {
          marked: false,
          reason:
            "nothing visible matches the anchor " +
            JSON.stringify(anchor) +
            ": find it another way, or leave the anchor out for a banner",
        };
      }
      const before = hadMarks();
      const { rect: near, moved } = show(element);
      const chosen =
        SIDES[side] ??
        (near.left + near.width / 2 > innerWidth / 2
          ? SIDES.left
          : SIDES.right);
      const rect = insideWindow(
        chosen(near, Math.max(near.width, 160), Math.max(near.height, 36))
      );
      frame(rect, "bad", true);
      label(rect, "bad", text);
      return {
        marked: true,
        as: "frame",
        at: rounded(rect),
        ...remarks(anchor, count, moved, before),
      };
    },
    note: (what) => {
      banner("bad", "✗ " + what);
      return { marked: true, as: "banner" };
    },
    clear: () => {
      document.getElementById(LAYER_ID)?.remove();
      return { cleared: true };
    },
  };
  return "qaMark is ready: ok, bad, missing, note, clear";
})();
