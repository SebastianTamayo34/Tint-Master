# Tint Master Inc — website

A plain HTML/CSS/JS site with no build step. It is hosted on **Vercel** from a **GitHub** repo, and it uses **Supabase** for the appointment database and the owner login.

```
index.html            Public website + appointment form
owner.html            Owner login + appointments dashboard
css/styles.css        Site styles (colors/fonts at the top)
css/owner.css         Dashboard styles
js/config.js          Supabase URL + public key (fill these in)
js/main.js            Website scripts (menu, shade preview, booking form)
js/owner.js           Dashboard scripts (sign in, list, status updates)
supabase/schema.sql   Database tables + security rules (run once in Supabase)
vercel.json           Vercel settings (clean URLs, security headers)
```

## How it works

- A customer submits the booking form, and the request is saved in the Supabase `appointments` table with status **New**.
- The owner signs in at `/owner` and sees upcoming appointments grouped by day. Each one can be marked **Confirmed**, **Completed** or **Cancelled**.
- The database's security rules mean the public can **add** a request but can never **read** any. Only accounts listed in the `owners` table can view or change appointments.

---

## Setup

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste in the whole of `supabase/schema.sql`, and click **Run**. It should finish with "Success. No rows returned."

### 2. Lock down sign-ups

Only the owner should have an account, so turn off public sign-ups:

- **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Keep the **Email** provider enabled.

### 3. Create the owner login

1. **Authentication → Users → Add user → Create new user**. Enter the owner's email and a strong password, and tick **Auto Confirm User**.
2. Mark that account as an owner. In the **SQL Editor**, run the following with the real email:

   ```sql
   insert into public.owners (user_id)
   select id from auth.users where email = 'owner@example.com';
   ```

   For a second owner, create another user and run the same command with their email.

### 4. Connect the website

Open **Project Settings → API Keys** (on older projects this is called **API**) and copy:

- the **Project URL**
- the **anon public** key, or the newer **publishable** key

Paste them into `js/config.js`:

```js
SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

> These two values are meant to be public and are safe to commit to GitHub.
> **Never** put the `service_role` / **secret** key in any file in this project.

### 5. Put it on GitHub

```bash
cd tint-master
git init
git add .
git commit -m "Tint Master website"
```

Then create an empty repo on GitHub and follow its "push an existing repository" commands, or use GitHub Desktop.

### 6. Deploy on Vercel

1. In [vercel.com](https://vercel.com), choose **Add New → Project** and import the GitHub repo.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Click **Deploy**. Every later push to GitHub redeploys the site automatically.

### 7. Point password-reset emails at the live site

Back in Supabase, under **Authentication → URL Configuration**:

- **Site URL**: your live address, e.g. `https://tintmaster.vercel.app`
- **Redirect URLs**: add `https://tintmaster.vercel.app/owner` (and your custom domain later)

This makes "Forgot password?" on the owner page send a link that comes back to the dashboard.

---

## Testing locally

The pages work when opened straight from the folder, but sign-in works best through a local server:

```bash
npx serve .
```

Then open the address it prints (for example http://localhost:3000) and `/owner.html`.

## Notes and next steps

- **Notifications:** new requests show up on the dashboard, which refreshes every 2 minutes, but nobody is emailed or texted yet. That can be added later with a Supabase Database Webhook or Edge Function connected to an email or SMS service.
- **Double bookings:** the form doesn't yet check whether a time slot is already taken. The owner confirms or reschedules each request.
- **Spam:** the form is public. If junk submissions show up, add a CAPTCHA (e.g. Cloudflare Turnstile).
- **Fallback:** if `js/config.js` is left empty, the booking form opens the customer's email app addressed to `BOOKING_EMAIL` instead.
