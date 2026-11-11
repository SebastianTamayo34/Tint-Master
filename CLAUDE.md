# CLAUDE.md

This file gives Claude Code the context it needs to work on this project.

## The business

**Tint Master Inc** is a window tint company based at 1703 Marion Graves Court, North Chicago, IL 60064. Its phone number is (773) 289-8367. It offers:

- **Automotive window tint** for cars, trucks and SUVs
- **Commercial building tint** for storefronts and offices
- **Large vehicle and fleet tint** for buses, RVs and work trucks
- **Headlight and taillight tint**
- **Front windshield strips**

Customers can bring a vehicle **to the shop** or book **mobile service** at their own address. The shop sells two films, **CXP™ Nano-Hybrid Carbon** and **Ceramic**, in shades from 5% (darkest/limo) to 50% (lightest).

Hours: Monday to Saturday. Saturday closes at 3pm, and the shop is closed on Sundays.

## The problem

The business started with a Framer template site that couldn't do what the shop needs:

- Customers could only "Get a Quote". There was no way to request a specific day and time, choose shop or mobile service, or say which film and shade they wanted.
- Booking requests didn't go anywhere the owner could manage. There was no single list of upcoming jobs and no way to track each one from request to confirmed to done.
- The site was locked into Framer's export, which made it hard to edit or host somewhere else.

## What we're building

A fast, standalone website with online appointment booking and a private owner dashboard.

1. **Public site** (`index.html`): services, films, an interactive shade picker, a gallery, contact details with a map, and a **Schedule Appointment** form. The form collects:
   - name, phone and email
   - shop or mobile service (mobile asks for an address)
   - service, type of tint and tint percentage
   - add-ons: headlight/taillight tint and windshield strip
   - vehicle or building details
   - a date, plus one of four 2-hour time slots (9–11, 11–1, 1–3, 3–5)
2. **Booking storage**: each submission is saved to Supabase with status `new`.
3. **Owner dashboard** (`owner.html`, served at `/owner`): an email and password login, then today and next-7-days stats and an Upcoming/Past list grouped by day. Each appointment's status can be set to New, Confirmed, Completed or Cancelled.

## Tech stack

- **Plain HTML, CSS and vanilla JS.** There's no framework, no bundler and no build step, and none should be added without asking.
- **Supabase** provides the Postgres database, Row Level Security and Auth. The client is `@supabase/supabase-js@2.49.4`, loaded as a UMD script from jsDelivr.
- **Vercel** hosts the static files (`vercel.json`: clean URLs, security headers, noindex on `/owner`).
- **GitHub** holds the source. Every push to `main` redeploys on Vercel.

## Project layout

```
index.html            Public site + booking form
owner.html            Owner login + dashboard
css/styles.css        Site styles; color/font tokens are at the top
css/owner.css         Dashboard styles (builds on styles.css)
js/config.js          Supabase URL + publishable key, fallback booking email
js/main.js            Mobile nav, shade picker, booking form logic + insert
js/owner.js           Auth, owner check, appointment list, status updates
supabase/schema.sql   Tables, constraints, RLS policies; safe to re-run
vercel.json           Hosting config
images/               Placeholder stock photos (to be replaced with real work)
```

## Rules and conventions

### Security (must not break)

- `js/config.js` holds only the **public** values: the Project URL and the **publishable/anon** key. **Never** add the `service_role`/`sb_secret_` key to any file.
- Security lives in the database, not the front end. The public (`anon`) role can only **INSERT** appointments with `status = 'new'` and can never read them. Only users listed in the `owners` table can SELECT, UPDATE or DELETE them, which is checked with `public.is_owner()`.
- Public sign-ups are turned off in Supabase. Owner accounts are created by hand and added to `owners`.
- In the dashboard, render customer-entered text only through the `el()` helper in `owner.js`, which uses textContent. Never use `innerHTML` with appointment data.

### Booking rules (enforced in both `main.js` and `schema.sql`)

Keep the two in sync whenever either one changes:

- no Sundays
- on Saturdays, only slots that start before 3pm
- dates from tomorrow up to 90 days out
- `start_hour` must be 9, 11, 13 or 15
- mobile bookings must include an address
- each booking needs either a service or at least one add-on

### Style

- Brand colors:
  - ink `#0b0e11`
  - orange `#ff6b18`
  - sky `#bce8fa`
  - sky-deep `#1a84bd`
  - sky-soft `#e8f5fb`
- Fonts: **Racing Sans One** for headings, **Inter** for body text.
- Use the CSS custom properties in `styles.css` instead of hard-coding colors.
- Pages must work at phone width (about 390px) with no horizontal scroll.
- Use the browser's native date picker. The owner chose it over a custom calendar.

### Schema changes

Edit `supabase/schema.sql` so it stays **idempotent** and can be safely re-run (`if not exists`, `drop policy if exists`, `create or replace`). Then run the change in the Supabase SQL Editor.

## Running locally

Open `index.html` directly, or for sign-in to work reliably, serve the folder (`npx serve .`) and visit `/owner.html`. Setup and deployment steps are in `README.md`.

## Open items / next steps

- Replace the placeholder `BOOKING_EMAIL` (`hello@tintmaster.example`) and the stock photos with real ones.
- Notify the owner of new bookings by email or SMS, using a Supabase webhook or Edge Function.
- Prevent double-booking of the same slot.
- Add a CAPTCHA (e.g. Cloudflare Turnstile) if spam submissions appear.
