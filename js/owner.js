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

  $("forgot-btn").addEventListener("click", async () => {
    const email = $("login-email").value.trim();
    if (!email) { setLoginStatus("Type your email above first, then click “Forgot password?”.", "err"); return; }
    const redirectTo = window.location.href.split("#")[0].split("?")[0];
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    setLoginStatus(error
      ? "Couldn't send the reset email. Try again in a minute."
      : "If that email belongs to an owner account, a reset link is on its way.", error ? "err" : "ok");
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

  /* ---------- Loading appointments ---------- */
  let range = "upcoming";
  let rows = [];
  const list = $("appt-list");
  const message = $("dash-message");
  const statusFilter = $("status-filter");

  async function load() {
    message.textContent = "Loading…";
    const today = toISO(todayDate());
    let query = db.from("appointments").select("*");
    query = range === "upcoming"
      ? query.gte("appt_date", today).order("appt_date", { ascending: true }).order("start_hour", { ascending: true })
      : query.lt("appt_date", today).order("appt_date", { ascending: false }).order("start_hour", { ascending: true }).limit(300);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      message.textContent = "Couldn't load appointments. Check your connection and press Refresh.";
      return;
    }
    rows = data || [];
    render();
  }

  function updateStats() {
    const stats = $("stats");
    stats.hidden = range !== "upcoming";
    if (range !== "upcoming") return;
    const today = toISO(todayDate());
    const weekEnd = toISO(addDays(todayDate(), 6));
    const active = rows.filter((r) => r.status === "new" || r.status === "confirmed");
    $("stat-today").textContent = active.filter((r) => r.appt_date === today).length;
    $("stat-week").textContent = active.filter((r) => r.appt_date <= weekEnd).length;
    $("stat-new").textContent = rows.filter((r) => r.status === "new").length;
  }

  function render() {
    updateStats();
    const f = statusFilter.value;
    const shown = rows.filter((r) =>
      f === "all" ? true : f === "active" ? (r.status === "new" || r.status === "confirmed") : r.status === f);

    list.replaceChildren();
    if (!shown.length) {
      message.textContent = range === "upcoming"
        ? "No upcoming appointments match this filter."
        : "No past appointments match this filter.";
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
      message.textContent = "Couldn't update that appointment. Please try again.";
      return;
    }
    r.status = next;
    render();
  }

  /* ---------- Controls ---------- */
  document.querySelectorAll(".tabs [data-range]").forEach((tab) => {
    tab.addEventListener("click", () => {
      range = tab.dataset.range;
      document.querySelectorAll(".tabs [data-range]").forEach((t) =>
        t.setAttribute("aria-selected", String(t === tab)));
      load();
    });
  });
  statusFilter.addEventListener("change", render);
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
