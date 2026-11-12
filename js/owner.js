/* =========================================================
   Tint Master Inc — owner dashboard
   Sign-in and appointment data come from Supabase.
   Security is enforced by the database (supabase/schema.sql):
   only accounts listed in the "owners" table can read appointments.
   ========================================================= */
(function ownerDashboard() {
  const CONFIG = window.TINT_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const views = ["setup", "login", "reset", "denied", "dash"];
  const signOutBtn = $("sign-out");
  const show = (name) => {
    views.forEach((v) => { $("view-" + v).hidden = v !== name; });
    signOutBtn.hidden = !(name === "dash" || name === "denied");
  };

  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY || !window.supabase) {
    show("setup");
    return;
  }
  const db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  /* ---------- Small helpers ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const todayDate = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  // Build elements with textContent only, so customer-typed text can never inject HTML.
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    });
    kids.flat().forEach((kid) => {
      if (kid == null || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  };

  const STATUS_LABELS = { new: "New", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };
  const SHOP_ADDRESS = "1703 Marion Graves Court, North Chicago, IL 60064";

  /* ---------- Sign in / out ---------- */
  const loginForm = $("login-form");
  const loginStatus = $("login-status");
  const setLoginStatus = (msg, type) => { loginStatus.textContent = msg; loginStatus.className = "form-status " + (type || ""); };

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) { setLoginStatus("Enter your email and password.", "err"); return; }
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    setLoginStatus("Signing in…");
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { setLoginStatus("That email and password didn't match. Try again.", "err"); return; }
    setLoginStatus("");
    $("login-password").value = "";
  });

  $("reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("new-password").value;
    const status = $("reset-status");
    if (pw.length < 8) { status.textContent = "Use at least 8 characters."; status.className = "form-status err"; return; }
    const { error } = await db.auth.updateUser({ password: pw });
    if (error) { status.textContent = "Couldn't save the password: " + error.message; status.className = "form-status err"; return; }
    status.textContent = "";
    $("new-password").value = "";
    inRecovery = false;
    currentUserId = undefined;
    const { data } = await db.auth.getSession();
    enter(data.session);
  });

  signOutBtn.addEventListener("click", () => db.auth.signOut());

  /* ---------- Who's signed in? ---------- */
  let currentUserId;      // undefined = not checked yet
  let inRecovery = false; // true while setting a new password

  async function enter(session) {
    if (inRecovery) { show("reset"); return; }
    const uid = session?.user?.id ?? null;
    if (uid === currentUserId) return; // nothing changed (e.g. token refresh)
    currentUserId = uid;

    if (!session) { stopAutoRefresh(); show("login"); return; }

    const { data: isOwner, error } = await db.rpc("is_owner");
    if (error || !isOwner) {
      $("denied-email").textContent = session.user.email;
      show("denied");
      return;
    }
    $("owner-email").textContent = session.user.email;
    show("dash");
    load();
    startAutoRefresh();
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") inRecovery = true;
    // Run outside the callback: Supabase recommends not awaiting its calls in here.
    setTimeout(() => enter(session), 0);
  });

  /* ---------- Loading appointments (list: today onward) ---------- */
  let rows = [];
  const list = $("appt-list");
  const message = $("dash-message");
  const statusFilter = $("status-filter");

  // The "Show" filter applies to both the list and the calendar.
  const FILTER_STATUSES = {
    active: ["new", "confirmed"],
    new: ["new"],
    confirmed: ["confirmed"],
    completed: ["completed"],
    cancelled: ["cancelled"],
    done: ["completed", "cancelled"],
  };
  const shownStatuses = () => FILTER_STATUSES[statusFilter.value] || FILTER_STATUSES.active;
  const matchesFilter = (r) => shownStatuses().includes(r.status);

  async function load() {
    if (mode === "calendar") return loadCalendar();
    message.textContent = "Loading…";
    const today = toISO(todayDate());
    const { data, error } = await db.from("appointments").select("*")
      .gte("appt_date", today)
      .order("appt_date", { ascending: true }).order("start_hour", { ascending: true });
    if (mode !== "list") return; // switched to the calendar while loading
    if (error) {
      console.error(error);
      message.textContent = "Couldn't load appointments. Check your connection and press Refresh.";
      return;
    }
    rows = data || [];
    render();
  }

  function updateStats() {
    const today = toISO(todayDate());
    const weekEnd = toISO(addDays(todayDate(), 6));
    const active = rows.filter((r) => r.status === "new" || r.status === "confirmed");
    $("stat-today").textContent = active.filter((r) => r.appt_date === today).length;
    $("stat-week").textContent = active.filter((r) => r.appt_date <= weekEnd).length;
    $("stat-new").textContent = rows.filter((r) => r.status === "new").length;
  }

  function render() {
    updateStats();
    const shown = rows.filter(matchesFilter);

    list.replaceChildren();
    if (!shown.length) {
      message.textContent = "No upcoming appointments match this filter.";
      return;
    }
    message.textContent = `${shown.length} appointment${shown.length === 1 ? "" : "s"}`;

    // Group by date
    const groups = new Map();
    shown.forEach((r) => {
      if (!groups.has(r.appt_date)) groups.set(r.appt_date, []);
      groups.get(r.appt_date).push(r);
    });

    const today = toISO(todayDate());
    const tomorrow = toISO(addDays(todayDate(), 1));
    groups.forEach((items, iso) => {
      const nice = fromISO(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const prefix = iso === today ? "Today · " : iso === tomorrow ? "Tomorrow · " : "";
      list.append(
        el("section", { class: "day-group" },
          el("h2", { class: "day-title" }, prefix + nice,
            el("span", { class: "day-count" }, ` ${items.length}`)),
          items.map(card))
      );
    });
  }

  function card(r) {
    const phoneHref = "tel:" + String(r.phone).replace(/[^\d+]/g, "");
    const where = r.location === "mobile"
      ? el("span", {}, el("span", { class: "tag-mobile" }, "Mobile"), " ",
          el("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(r.mobile_address || ""),
                    target: "_blank", rel: "noopener" }, r.mobile_address || "(no address)"))
      : el("span", {}, "At the shop");

    const meta = [
      ["Where", where],
      ["Service", r.service || "Add-ons only"],
      ["Type of tint", r.film || "Not sure, help choose"],
      ["Percentage", r.shade || "Not sure, help choose"],
      ["Add-ons", r.addons && r.addons.length ? r.addons.join(", ") : null],
      ["Vehicle / building", r.details],
      ["Notes", r.message],
    ].filter(([, v]) => v);

    const select = el("select", { "aria-label": `Status for ${r.name}` },
      Object.entries(STATUS_LABELS).map(([value, label]) =>
        el("option", { value, ...(value === r.status ? { selected: "selected" } : {}) }, label)));
    select.addEventListener("change", () => changeStatus(r, select));

    const requested = new Date(r.created_at).toLocaleString("en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    return el("article", { class: `appt status-${r.status}` },
      el("div", { class: "appt-time" }, r.time_slot),
      el("div", { class: "appt-main" },
        el("div", { class: "appt-top" },
          el("h3", {}, r.name),
          el("span", { class: `pill pill-${r.status}` }, STATUS_LABELS[r.status] || r.status)),
        el("p", { class: "appt-contact" },
          el("a", { href: phoneHref }, r.phone), " · ",
          el("a", { href: "mailto:" + r.email }, r.email)),
        el("dl", { class: "appt-meta" },
          meta.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))))),
      el("div", { class: "appt-actions" },
        el("label", {}, el("span", {}, "Status"), select),
        el("small", { class: "muted" }, "Requested " + requested))
    );
  }

  async function changeStatus(r, select) {
    const previous = r.status;
    const next = select.value;
    select.disabled = true;
    const { error } = await db.from("appointments").update({ status: next }).eq("id", r.id);
    select.disabled = false;
    if (error) {
      console.error(error);
      select.value = previous;
      // 23505 = unique index: another appointment is already confirmed for this slot.
      message.textContent = error.code === "23505"
        ? "Another appointment is already confirmed for that day and time. Change or cancel it first."
        : "Couldn't update that appointment. Please try again.";
      return;
    }
    r.status = next;
    if (mode === "calendar") renderCalendar(); else render();
  }

  /* ---------- Calendar view ---------- */
  // A month grid of new + confirmed appointments. Clicking a day shows
  // that day's full cards (with the status dropdown) under the grid.
  let mode = "calendar"; // the dashboard always opens on the calendar
  let calMonth = new Date(todayDate().getFullYear(), todayDate().getMonth(), 1);
  let calRows = [];
  let selectedDay = null;
  const calGrid = $("cal-grid");
  const calDay = $("cal-day");
  const HOUR_SHORT = { 9: "9a", 11: "11a", 13: "1p", 15: "3p" };
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // The grid starts on the Sunday on or before the 1st and runs whole weeks.
  const calRange = () => {
    const start = addDays(calMonth, -calMonth.getDay());
    const last = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
    const end = addDays(last, 6 - last.getDay());
    return { start, end };
  };

  async function loadCalendar() {
    const { start, end } = calRange();
    const month = calMonth.getMonth();
    const filter = statusFilter.value;
    message.textContent = "Loading…";
    const { data, error } = await db.from("appointments").select("*")
      .gte("appt_date", toISO(start)).lte("appt_date", toISO(end))
      .in("status", shownStatuses())
      .order("appt_date", { ascending: true }).order("start_hour", { ascending: true });
    // Moved on while loading (other view, month or filter)
    if (mode !== "calendar" || calMonth.getMonth() !== month || statusFilter.value !== filter) return;
    if (error) {
      console.error(error);
      message.textContent = "Couldn't load the calendar. Check your connection and press Refresh.";
      return;
    }
    calRows = data || [];
    renderCalendar();
  }

  function renderCalendar() {
    const { start, end } = calRange();
    const today = toISO(todayDate());
    const month = calMonth.getMonth();
    $("cal-title").textContent = calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const byDay = new Map();
    calRows.forEach((r) => {
      if (!byDay.has(r.appt_date)) byDay.set(r.appt_date, []);
      byDay.get(r.appt_date).push(r);
    });

    const statuses = shownStatuses();
    const countText = (items) => statuses
      .map((s) => `${items.filter((r) => r.status === s).length} ${STATUS_LABELS[s].toLowerCase()}`).join(", ");
    const inMonth = calRows.filter((r) => matchesFilter(r) && fromISO(r.appt_date).getMonth() === month);
    message.textContent = "This month: " + countText(inMonth).replace(/, /g, " · ");
    document.querySelectorAll(".cal-legend [data-status]").forEach((s) => {
      s.hidden = !statuses.includes(s.dataset.status);
    });

    const cells = WEEKDAYS.map((d) => el("div", { class: "cal-weekday", "aria-hidden": "true" }, d));
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const iso = toISO(d);
      const items = (byDay.get(iso) || []).filter(matchesFilter);
      const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) +
        (items.length ? `: ${items.length} appointment${items.length === 1 ? "" : "s"} (${countText(items)})` : ": none");
      const classes = ["cal-cell",
        d.getMonth() !== month && "other-month",
        d.getDay() === 0 && "closed",
        iso < today && "past",
        iso === today && "today",
        iso === selectedDay && "selected"].filter(Boolean).join(" ");

      const btn = el("button", { type: "button", class: classes, "aria-label": label,
                                 "aria-pressed": String(iso === selectedDay) },
        el("span", { class: "cal-date" }, d.getDate()),
        el("span", { class: "cal-chips" },
          items.map((r) => el("span", { class: `cal-chip status-${r.status}` },
            el("b", {}, HOUR_SHORT[r.start_hour] || ""), " ", el("span", { class: "cal-chip-name" }, r.name)))));
      btn.addEventListener("click", () => {
        selectedDay = selectedDay === iso ? null : iso;
        renderCalendar();
        if (selectedDay) calDay.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      cells.push(btn);
    }
    calGrid.replaceChildren(...cells);
    renderSelectedDay(byDay);
  }

  function renderSelectedDay(byDay) {
    calDay.replaceChildren();
    if (!selectedDay) {
      calDay.append(el("p", { class: "muted cal-hint" }, "Click a day to see its appointments."));
      return;
    }
    const items = byDay.get(selectedDay) || [];
    const nice = fromISO(selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    calDay.append(el("h2", { class: "day-title" }, nice, el("span", { class: "day-count" }, ` ${items.length}`)));
    if (!items.length) calDay.append(el("p", { class: "muted" }, "No appointments matching this filter on this day."));
    else items.forEach((r) => calDay.append(card(r)));
  }

  const goMonth = (delta) => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    selectedDay = null;
    calRows = [];
    renderCalendar();
    loadCalendar();
  };
  $("cal-prev").addEventListener("click", () => goMonth(-1));
  $("cal-next").addEventListener("click", () => goMonth(1));
  $("cal-today").addEventListener("click", () => {
    const t = todayDate();
    calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    selectedDay = toISO(t);
    renderCalendar();
    loadCalendar();
  });

  // Show the parts of the dashboard that belong to the current view.
  // The stats only apply to the list.
  function applyMode() {
    const cal = mode === "calendar";
    document.querySelectorAll(".tabs [data-mode]").forEach((t) =>
      t.setAttribute("aria-selected", String(t.dataset.mode === mode)));
    $("cal").hidden = !cal;
    list.hidden = cal;
    $("stats").hidden = cal;
    if (cal && !selectedDay) selectedDay = toISO(todayDate());
  }
  document.querySelectorAll(".tabs [data-mode]").forEach((tab) =>
    tab.addEventListener("click", () => {
      if (tab.dataset.mode === mode) return;
      mode = tab.dataset.mode;
      applyMode();
      load();
    }));
  applyMode();

  /* ---------- Controls ---------- */
  // The calendar only loads the statuses it shows, so a filter change reloads it.
  statusFilter.addEventListener("change", () => (mode === "calendar" ? loadCalendar() : render()));
  $("refresh-btn").addEventListener("click", load);

  // Quietly refresh every 2 minutes while the dashboard is open and visible.
  let timer = null;
  function startAutoRefresh() {
    stopAutoRefresh();
    timer = setInterval(() => {
      if (document.visibilityState === "visible" && !$("view-dash").hidden) load();
    }, 120000);
  }
  function stopAutoRefresh() { if (timer) clearInterval(timer); timer = null; }
})();
