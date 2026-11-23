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
          el("a", { href: phoneHref }, r.phone),
          r.email && [" · ", el("a", { href: "mailto:" + r.email }, r.email)]),
        el("dl", { class: "appt-meta" },
          meta.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))))),
      el("div", { class: "appt-actions" },
        el("label", {}, el("span", {}, "Status"), select),
        confirmationNote(r),
        el("small", { class: "muted" }, "Requested " + requested))
    );
  }

  // Confirmed appointments show whether the confirmation email went out,
  // with a button to (re)try if it didn't.
  function confirmationNote(r) {
    if (r.status !== "confirmed") return null;
    if (r.confirmation_sent_at) {
      const sent = new Date(r.confirmation_sent_at).toLocaleString("en-US",
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return el("small", { class: "confirm-sent" }, "✓ Confirmation emailed " + sent);
    }
    const btn = el("button", { type: "button", class: "confirm-send" }, "Send confirmation email");
    btn.addEventListener("click", () => sendConfirmation(r, btn));
    return btn;
  }

  const rerender = () => (mode === "calendar" ? renderCalendar() : render());

  // Ask the send-confirmation Edge Function (supabase/functions) to email the
  // customer and the shop. It only sends once per appointment.
  async function sendConfirmation(r, btn) {
    if (btn) btn.disabled = true;
    message.textContent = `Sending confirmation email for ${r.name}…`;
    const { data, error } = await db.functions.invoke("send-confirmation", { body: { id: r.id } });
    if (btn) btn.disabled = false;
    if (error || !data?.sent) {
      let reason = data?.reason || "";
      if (error) {
        console.error("Confirmation email failed:", error);
        // The function's own error message, when it sent one back
        try { reason = (await error.context.json()).error; } catch { reason = ""; }
      }
      rerender();
      message.textContent = data && !data.sent
        ? `No email sent for ${r.name}: ${reason}.`
        : `${r.name} is confirmed, but the confirmation email didn't send. ` +
          (reason || "Is the send-confirmation function set up in Supabase (see SETUP.md)?") +
          " Use “Send confirmation email” on the appointment to try again.";
      return;
    }
    r.confirmation_sent_at = new Date().toISOString();
    rerender();
    message.textContent = data.customer
      ? `Confirmation emailed to ${data.customer} and the shop.`
      : `${r.name} has no email, so only the shop's copy was sent.`;
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
    rerender();
    if (next === "confirmed" && !r.confirmation_sent_at) sendConfirmation(r);
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
    const sunday = fromISO(selectedDay).getDay() === 0;

    const addBtn = el("button", { type: "button", class: "btn btn-primary btn-sm", disabled: sunday || addOpen },
      "+ Add appointment");
    addBtn.addEventListener("click", () => openAddForm());
    calDay.append(el("div", { class: "cal-day-head" },
      el("h2", { class: "day-title" }, nice, el("span", { class: "day-count" }, ` ${items.length}`)),
      sunday ? el("span", { class: "muted cal-closed-note" }, "Closed Sundays") : addBtn));

    // The add form follows the selected day; Sundays can't be booked.
    if (addOpen && sunday) closeAddForm();
    if (addOpen) {
      if (addForm.dataset.date !== selectedDay) setAddFormDay(selectedDay);
      calDay.append(addForm);
    }

    if (!items.length) calDay.append(el("p", { class: "muted" }, "No appointments matching this filter on this day."));
    else items.forEach((r) => calDay.append(card(r)));
  }

  /* ---------- Add an appointment by hand (calendar day panel) ---------- */
  // For phone calls and walk-ins. Owners can book any non-Sunday date,
  // including today and past days (to log work already done).
  const addForm = $("add-form");
  const addTime = $("add-time");
  const addService = $("add-service");
  const addLocation = $("add-location");
  const addAddressField = $("add-address-field");
  const addMsg = $("add-status-msg");
  const SATURDAY_CLOSE = 15; // 3pm
  let addOpen = false;
  let addTaken = new Set(); // start hours already confirmed on the form's day

  const setAddMsg = (msg, type) => { addMsg.textContent = msg; addMsg.className = "form-status " + (type || ""); };

  // Commercial building tint is always mobile (matches the public form and the database).
  const syncAddLocation = () => {
    const commercial = addService.value === "Commercial building tint";
    addLocation.querySelector('[value="shop"]').disabled = commercial;
    if (commercial) addLocation.value = "mobile";
    const mobile = addLocation.value === "mobile";
    addAddressField.hidden = !mobile;
    $("add-address").required = mobile;
  };
  addService.addEventListener("change", syncAddLocation);
  addLocation.addEventListener("change", () => {
    syncAddLocation();
    if (addLocation.value === "mobile") $("add-address").focus();
  });

  // Saturday hides the 3pm slot; a slot confirmed for someone else can only
  // be added as "new" (the database allows one confirmed booking per slot).
  const syncAddSlots = () => {
    const saturday = fromISO(addForm.dataset.date).getDay() === 6;
    const confirming = $("add-status").value === "confirmed";
    [...addTime.options].forEach((opt) => {
      if (!opt.dataset.start) return;
      const start = Number(opt.dataset.start);
      const closed = saturday && start >= SATURDAY_CLOSE;
      const taken = addTaken.has(start);
      opt.hidden = closed;
      opt.disabled = closed || (taken && confirming);
      opt.textContent = opt.value + (taken && !closed ? " (already confirmed)" : "");
      if (opt.disabled && opt.selected) addTime.value = "";
    });
  };
  $("add-status").addEventListener("change", syncAddSlots);

  async function setAddFormDay(iso) {
    addForm.dataset.date = iso;
    addTaken = new Set();
    $("add-title").textContent = "New appointment · " +
      fromISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    setAddMsg("");
    syncAddSlots();
    const { data, error } = await db.rpc("taken_slots", { p_date: iso });
    if (addForm.dataset.date !== iso) return; // day changed while loading
    if (error) { console.error("Couldn't load booked slots:", error); return; }
    addTaken = new Set(data.map(Number));
    syncAddSlots();
  }

  function openAddForm() {
    addOpen = true;
    addForm.hidden = false;
    renderCalendar(); // places the form in the day panel and sets its day
    $("add-name").focus();
  }

  function closeAddForm() {
    addOpen = false;
    addForm.hidden = true;
    addForm.reset();
    addForm.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
    delete addForm.dataset.date;
    setAddMsg("");
    syncAddLocation();
    if (addForm.parentNode === calDay) $("cal").append(addForm); // park it outside the panel
  }

  const closeAndRender = () => { closeAddForm(); renderCalendar(); };
  $("add-close").addEventListener("click", closeAndRender);
  $("add-cancel").addEventListener("click", closeAndRender);

  addForm.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.checkValidity()) field.classList.remove("invalid");
  });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncAddLocation();
    const addons = [...addForm.querySelectorAll('input[name="add-addons"]:checked')].map((b) => b.value);
    addService.required = !addons.length; // a service or at least one add-on

    let firstBad = null;
    addForm.querySelectorAll("input, select, textarea").forEach((input) => {
      const ok = input.checkValidity();
      input.closest(".field")?.classList.toggle("invalid", !ok);
      if (!ok && !firstBad) firstBad = input;
    });
    if (firstBad) {
      setAddMsg(firstBad === addService
        ? "Pick a service or check at least one add-on."
        : "Fill in the time, name, phone" + (addLocation.value === "mobile" ? ", mobile address" : "") +
          " and a valid email (or leave email blank).", "err");
      firstBad.focus();
      return;
    }

    const clean = (v) => (v && v.trim() ? v.trim() : null);
    const mobile = addLocation.value === "mobile";
    const row = {
      name: $("add-name").value.trim(),
      phone: $("add-phone").value.trim(),
      email: clean($("add-email").value),
      location: mobile ? "mobile" : "shop",
      mobile_address: mobile ? clean($("add-address").value) : null,
      service: clean(addService.value),
      film: clean($("add-film").value),
      shade: clean($("add-shade").value),
      addons,
      details: clean($("add-details").value),
      message: clean($("add-notes").value),
      appt_date: addForm.dataset.date,
      start_hour: Number(addTime.selectedOptions[0].dataset.start),
      time_slot: addTime.value,
      status: $("add-status").value,
    };

    const submitBtn = addForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setAddMsg("Saving…");
    // Owners can read appointments, so get the new id back for the confirmation email.
    const { data: added, error } = await db.from("appointments").insert(row).select("id").single();
    submitBtn.disabled = false;
    if (error) {
      console.error("Couldn't add appointment:", error);
      if (error.code === "23505") {
        // 23505 = unique index: the slot was confirmed for someone else meanwhile.
        await setAddFormDay(row.appt_date);
        setAddMsg("Another appointment is already confirmed for that time. Pick another time or save it as New.", "err");
      } else if (error.code === "42501") {
        setAddMsg("The database won't accept this yet. Re-run supabase/schema.sql in Supabase (see SETUP.md).", "err");
      } else {
        setAddMsg("Couldn't save the appointment. Check the details and try again.", "err");
      }
      return;
    }

    // Make sure the new appointment is visible under the current "Show" filter.
    if (!shownStatuses().includes(row.status)) statusFilter.value = row.status === "completed" ? "completed" : "active";
    closeAddForm();
    await loadCalendar();
    if (row.status === "confirmed") {
      // Send from the freshly loaded row, so its card updates when the email goes out.
      const fresh = calRows.find((x) => x.id === added.id) || { ...row, id: added.id };
      await sendConfirmation(fresh);
      message.textContent = `Added ${row.name}, ${row.time_slot}. ` + message.textContent;
    } else {
      message.textContent = `Added ${row.name}, ${row.time_slot}. · ` + message.textContent;
    }
  });
  syncAddLocation();

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
