/* =========================================================
   Tint Master Inc — site scripts
   ========================================================= */

// Settings come from js/config.js
const CONFIG = window.TINT_CONFIG || {};
const BOOKING_EMAIL = CONFIG.BOOKING_EMAIL || "tintmasterpro@gmail.com";

// Supabase connection (null until js/config.js is filled in)
const db =
  CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase
    ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
    : null;

/* ---------- Mobile menu ---------- */
(function mobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
})();

/* ---------- Shade preview ---------- */
(function shadePicker() {
  const buttons = document.querySelectorAll(".shade-picker button");
  const overlay = document.getElementById("shade-overlay");
  const badge = document.getElementById("shade-badge");
  const desc = document.getElementById("shade-desc");
  if (!buttons.length || !overlay) return;

  // Overlay darkness tuned by eye so each step looks clearly different.
  const shades = {
    5:   { dark: 0.90, text: "Limo tint. Maximum privacy, very hard to see in from outside. Usually only legal on rear windows." },
    15:  { dark: 0.80, text: "Very dark. Strong privacy and heat control with a sleek blacked-out look." },
    20:  { dark: 0.72, text: "Our most popular shade. Dark and private while still easy to see out of at night." },
    30:  { dark: 0.60, text: "A balanced look. Noticeable privacy without going too dark." },
    35:  { dark: 0.54, text: "A classic factory-plus look. Front windows are legal at this shade in many states." },
    50:  { dark: 0.38, text: "Light tint. Cuts heat and glare while keeping the glass close to clear." },
    100: { dark: 0.00, text: "Untinted glass, for comparison." },
  };

  const select = (btn) => {
    const vlt = Number(btn.dataset.vlt);
    const s = shades[vlt];
    buttons.forEach((b) => {
      const on = b === btn;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    overlay.style.opacity = s.dark;
    badge.textContent = vlt === 100 ? "No tint" : `${vlt}% VLT`;
    desc.textContent = s.text;
  };

  buttons.forEach((btn, i) => {
    btn.addEventListener("click", () => select(btn));
    // Arrow-key support for the radio group
    btn.addEventListener("keydown", (e) => {
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = buttons[(i + 1) % buttons.length];
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = buttons[(i - 1 + buttons.length) % buttons.length];
      if (next) { e.preventDefault(); select(next); next.focus(); }
    });
  });

  select(document.querySelector('.shade-picker [aria-checked="true"]') || buttons[0]);
})();

/* ---------- Appointment form ---------- */
(function bookingForm() {
  const form = document.getElementById("booking-form");
  const status = document.getElementById("form-status");
  if (!form) return;

  const dateInput = form.querySelector("#date");
  const timeSelect = form.querySelector("#time");
  const serviceSelect = form.querySelector("#service");
  const addonBoxes = form.querySelectorAll('input[name="addons"]');
  const SATURDAY_CLOSE = 15; // 3pm

  // A main service is only required if no add-on is checked,
  // so someone can book just a light tint or windshield strip.
  const syncServiceRequired = () => {
    const anyAddon = [...addonBoxes].some((b) => b.checked);
    serviceSelect.required = !anyAddon;
    if (anyAddon) serviceSelect.closest(".field").classList.remove("invalid");
  };
  addonBoxes.forEach((b) => b.addEventListener("change", syncServiceRequired));

  /* ----- Shop vs. mobile service ----- */
  const SHOP_ADDRESS = "1703 Marion Graves Court, North Chicago, IL 60064";
  const locationRadios = form.querySelectorAll('input[name="location"]');
  const mobileField = document.getElementById("mobile-address-field");
  const mobileInput = document.getElementById("mobile-address");
  const isMobile = () => form.querySelector('input[name="location"]:checked')?.value === "mobile";

  // A building can't come to the shop, so commercial tint locks the
  // booking to mobile service until a different service is chosen.
  const shopRadio = form.querySelector('input[name="location"][value="shop"]');
  const mobileRadio = form.querySelector('input[name="location"][value="mobile"]');

  // Only show (and require) the address box when mobile service is picked.
  const syncLocation = () => {
    const commercial = serviceSelect.value === "Commercial building tint";
    shopRadio.disabled = commercial;
    if (commercial) mobileRadio.checked = true;
    const mobile = isMobile();
    mobileField.hidden = !mobile;
    mobileInput.required = mobile;
    if (!mobile) mobileField.classList.remove("invalid");
  };
  locationRadios.forEach((r) => r.addEventListener("change", () => {
    syncLocation();
    if (isMobile()) mobileInput.focus();
  }));
  serviceSelect.addEventListener("change", syncLocation);
  syncLocation();

  /* ----- Date rules (browser's built-in date picker) ----- */
  const dateHint = document.getElementById("date-hint");
  const HINT_TEXT = dateHint.textContent; // "No same-day · Closed Sundays · Sat until 3pm"
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayOf = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).getDay(); // 0 = Sunday, 6 = Saturday
  };

  // Earliest bookable day is tomorrow; latest is 90 days out.
  const now = new Date();
  dateInput.min = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  dateInput.max = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));

  // ISO dates compare correctly as strings, so a typed-in date
  // outside min/max gets a clear message instead of a generic one.
  const dateError = () => {
    const v = dateInput.value;
    if (!v) return "";
    if (v < dateInput.min) return "We don't do same-day appointments. Please pick tomorrow or later.";
    if (v > dateInput.max) return "We book up to 90 days ahead. Please pick an earlier date.";
    if (dayOf(v) === 0) return "We're closed on Sundays. Please pick another day.";
    return "";
  };

  let takenSlots = new Set(); // start hours already confirmed on the picked date
  let takenFor = null;        // the date takenSlots belongs to

  // The built-in calendar can't grey out weekdays, so a Sunday is
  // rejected as soon as it's picked, Saturday hides slots from 3pm on,
  // and slots already confirmed for someone else show as "(booked)".
  const checkDate = () => {
    const day = dayOf(dateInput.value);
    const err = dateError();
    dateInput.setCustomValidity(err);
    dateHint.textContent = err || HINT_TEXT;
    dateHint.classList.toggle("err", !!err);
    dateInput.closest(".field").classList.toggle("invalid", !!err);

    [...timeSelect.options].forEach((opt) => {
      if (!opt.dataset.start) return;
      const closed = day === 6 && Number(opt.dataset.start) >= SATURDAY_CLOSE;
      opt.hidden = closed;
      opt.disabled = closed || takenSlots.has(Number(opt.dataset.start));
      // Pin the value to the original text so adding "(booked)" never changes what's saved.
      if (!opt.dataset.label) { opt.dataset.label = opt.textContent; opt.value = opt.textContent; }
      opt.textContent = opt.dataset.label + (opt.disabled && !closed ? " (booked)" : "");
      if (opt.disabled && opt.selected) timeSelect.value = "";
    });
  };

  // Slots already confirmed for someone else can't be booked again.
  // The database enforces this too; this just greys them out ahead of time.
  const loadTakenSlots = async () => {
    const date = dateInput.value;
    if (takenFor !== date) { takenSlots = new Set(); takenFor = date; }
    if (!db || !date || dateError()) { checkDate(); return; }
    checkDate();
    const { data, error } = await db.rpc("taken_slots", { p_date: date });
    if (dateInput.value !== date) return; // the date changed while waiting
    if (error) { console.error("Couldn't load booked slots:", error); return; }
    takenSlots = new Set(data.map(Number));
    checkDate();
  };
  dateInput.addEventListener("change", loadTakenSlots);
  dateInput.addEventListener("input", loadTakenSlots);

  const setStatus = (msg, type) => {
    status.textContent = msg;
    status.className = "form-status " + (type || "");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    checkDate();
    syncServiceRequired();
    syncLocation();

    // Validate required fields
    let firstBad = null;
    form.querySelectorAll("[required]").forEach((el) => {
      const ok = el.checkValidity();
      el.closest(".field").classList.toggle("invalid", !ok);
      if (!ok && !firstBad) firstBad = el;
    });
    if (firstBad) {
      setStatus(
        dateError()
          ? dateError()
          : isMobile() && !mobileInput.value.trim()
            ? "Please enter the address where you'd like the mobile service."
            : "Please fill in your name, phone, a valid email, a service or add-on, and a date and time.",
        "err"
      );
      firstBad.focus();
      return;
    }

    const fd = new FormData(form);
    const data = Object.fromEntries(fd);
    const addonList = fd.getAll("addons");
    data.addons = addonList.join(", "); // keep every checked box, not just the last
    data.location = isMobile()
      ? `Mobile service at ${data.mobile_address.trim()}`
      : `At the shop (${SHOP_ADDRESS})`;
    const jobs = [data.service, data.addons].filter(Boolean).join(" + ");

    // Option A: save straight to the Supabase database (shows up on the owner page)
    if (db) {
      const submitBtn = form.querySelector('button[type="submit"]');
      const clean = (v) => (v && v.trim() ? v.trim() : null);
      const row = {
        name: data.name.trim(),
        phone: data.phone.trim(),
        email: data.email.trim(),
        location: isMobile() ? "mobile" : "shop",
        mobile_address: isMobile() ? clean(data.mobile_address) : null,
        service: clean(data.service),
        film: clean(data.film),
        shade: clean(data.shade),
        addons: addonList,
        details: clean(data.details),
        message: clean(data.message),
        appt_date: data.date,
        start_hour: Number(timeSelect.selectedOptions[0].dataset.start),
        time_slot: data.time,
      };

      setStatus("Sending…");
      submitBtn.disabled = true;
      // No .select() after insert: the public isn't allowed to read appointments back.
      const { error } = await db.from("appointments").insert(row);
      submitBtn.disabled = false;

      if (error) {
        console.error("Booking failed:", error);
        // The slot may have been confirmed for someone else since the page loaded.
        await loadTakenSlots();
        if (takenSlots.has(row.start_hour)) {
          timeSelect.closest(".field").classList.add("invalid");
          timeSelect.focus();
          setStatus("Sorry, that time was just booked. Please choose another time.", "err");
          return;
        }
        setStatus("Sorry, something went wrong. Please call us at (773) 289-8367.", "err");
        return;
      }
      form.reset();
      takenSlots = new Set();
      syncServiceRequired();
      syncLocation();
      checkDate();
      setStatus("Thanks! We got your appointment request and will call or text to confirm.", "ok");
      return;
    }

    // Option B (until Supabase is set up): open the visitor's email app with the details filled in
    const niceDate = new Date(data.date + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    const body = [
      `Name: ${data.name}`,
      `Phone: ${data.phone}`,
      `Email: ${data.email}`,
      `Location: ${data.location}`,
      `Service: ${data.service || "-"}`,
      `Type of tint: ${data.film || "Not sure, help me choose"}`,
      `Tint percentage: ${data.shade || "Not sure, help me choose"}`,
      `Add-ons: ${data.addons || "-"}`,
      `Details: ${data.details || "-"}`,
      `Preferred date: ${niceDate}`,
      `Preferred time: ${data.time}`,
      "",
      data.message || "",
    ].join("\n");
    const where = isMobile() ? " (MOBILE)" : "";
    const subject = `Appointment request${where}: ${niceDate}, ${data.time} – ${jobs}`;
    window.location.href =
      `mailto:${BOOKING_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus("Your email app should open with your appointment request ready to send.", "ok");
  });

  // Clear the red outline as soon as a field is fixed
  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.checkValidity()) field.classList.remove("invalid");
  });
})();

/* ---------- Footer year ---------- */
document.getElementById("year").textContent = new Date().getFullYear();
