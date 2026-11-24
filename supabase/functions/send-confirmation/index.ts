// =========================================================
// Tint Master Inc — "send-confirmation" Supabase Edge Function
//
// Emails the customer and the shop when an appointment is confirmed or
// cancelled. The owner dashboard (js/owner.js) calls it right after an
// appointment is set to Confirmed or Cancelled, or added as Confirmed.
// Request body: { id, kind: "confirmed" | "cancelled" } (kind defaults to "confirmed").
//
// Security: it runs as the signed-in person who called it (their login
// token is passed through), so the database rules decide what it can
// see. Only owners can read appointments, so only owners can send.
// Each email goes out once (confirmation_sent_at / cancellation_sent_at);
// a database trigger clears those when the status changes, so re-confirming
// or re-cancelling later sends again.
//
// Secrets (Supabase → Edge Functions → Secrets), see SETUP.md:
//   GMAIL_USER          the Gmail address that sends, e.g. tintmasterpro@gmail.com
//   GMAIL_APP_PASSWORD  a Google "App Password" for that account (not the normal password)
//   OWNER_EMAIL         optional: where the shop's copy goes (defaults to GMAIL_USER)
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import nodemailer from "npm:nodemailer@6.9.16";

const SHOP = {
  name: "Tint Master Inc",
  address: "1703 Marion Graves Court, North Chicago, IL 60064",
  phone: "(773) 289-8367",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Customer-typed text goes into the HTML emails, so escape it.
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// appt_date is a plain date ("2026-11-24"); format it without shifting the day.
const niceDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

type Appt = {
  id: string; name: string; phone: string; email: string | null;
  location: "shop" | "mobile"; mobile_address: string | null;
  service: string | null; film: string | null; shade: string | null; addons: string[];
  details: string | null; message: string | null;
  appt_date: string; time_slot: string; status: string;
};

// [label, value] rows shared by both emails; empty values are left out.
function detailRows(a: Appt, forOwner: boolean): [string, string][] {
  const rows: [string, string | null][] = [
    ["Date", niceDate(a.appt_date)],
    ["Time", a.time_slot],
    ["Where", a.location === "mobile" ? `Mobile service at ${a.mobile_address}` : `Our shop, ${SHOP.address}`],
    ["Service", a.service || "Add-ons only"],
    ["Type of tint", a.film],
    ["Percentage", a.shade],
    ["Add-ons", a.addons?.length ? a.addons.join(", ") : null],
    ["Vehicle / building", a.details],
  ];
  if (forOwner) {
    rows.push(["Customer", a.name], ["Phone", a.phone], ["Email", a.email || "(none given)"], ["Notes", a.message]);
  }
  return rows.filter((r): r is [string, string] => !!r[1]);
}

const asText = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");
const asHtml = (rows: [string, string][]) =>
  `<table cellpadding="6" style="border-collapse:collapse;font:15px/1.4 Arial,sans-serif">` +
  rows.map(([k, v]) =>
    `<tr><td style="color:#5b6470;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
    `<td style="color:#0b0e11;white-space:pre-line">${esc(v)}</td></tr>`).join("") +
  `</table>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  const ownerEmail = Deno.env.get("OWNER_EMAIL") || gmailUser;
  if (!gmailUser || !gmailPass) return reply({ error: "Email isn't set up: add the GMAIL_USER and GMAIL_APP_PASSWORD secrets." }, 500);

  let id: string | undefined;
  let kind = "confirmed";
  try { ({ id, kind = "confirmed" } = await req.json()); } catch { /* handled below */ }
  if (!id) return reply({ error: "Missing appointment id." }, 400);
  if (kind !== "confirmed" && kind !== "cancelled") return reply({ error: "kind must be confirmed or cancelled." }, 400);
  const cancelled = kind === "cancelled";
  const marker = cancelled ? "cancellation_sent_at" : "confirmation_sent_at";

  // Act as the caller, so the database's owner-only rules apply.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

  const { data: isOwner } = await db.rpc("is_owner");
  if (!isOwner) return reply({ error: "Only owners can send these emails." }, 403);

  // Claim the appointment: mark it sent only if it has that status and this
  // email hasn't gone out yet. Doing this first (in one statement) means two
  // clicks can't send twice.
  const { data: claimed, error: claimError } = await db.from("appointments")
    .update({ [marker]: new Date().toISOString() })
    .eq("id", id).eq("status", kind).is(marker, null)
    .select("*");
  if (claimError) { console.error(claimError); return reply({ error: "Couldn't read the appointment." }, 500); }
  if (!claimed?.length) return reply({ sent: false, reason: `already sent, or not ${kind}` });
  const appt = claimed[0] as Appt;

  // Gmail over SSL on port 465 (Supabase blocks outgoing ports 25 and 587).
  const mail = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  });
  const from = `"${SHOP.name}" <${gmailUser}>`;
  const when = `${niceDate(appt.appt_date)}, ${appt.time_slot}`;

  // Wording for each kind of email
  const copy = cancelled
    ? {
      subject: `Your appointment has been cancelled: ${when}`,
      intro: `Your window tint appointment with ${SHOP.name} has been cancelled.`,
      introHtml: `Your window tint appointment with <strong>${SHOP.name}</strong> has been <strong>cancelled</strong>.`,
      closing: `Want to book another time? Call or text us at ${SHOP.phone}, or reply to this email.`,
      closingHtml: `Want to book another time? Call or text us at <a href="tel:+17732898367">${SHOP.phone}</a>, or reply to this email.`,
      shopWord: "Cancelled",
      sentWhat: "A cancellation notice",
    }
    : {
      subject: `Your appointment is confirmed: ${when}`,
      intro: `Your window tint appointment with ${SHOP.name} is confirmed.`,
      introHtml: `Your window tint appointment with <strong>${SHOP.name}</strong> is <strong>confirmed</strong>.`,
      closing: `Need to change or cancel? Call or text us at ${SHOP.phone}, or reply to this email.`,
      closingHtml: `Need to change or cancel? Call or text us at <a href="tel:+17732898367">${SHOP.phone}</a>, or reply to this email.`,
      shopWord: "Confirmed",
      sentWhat: "A confirmation",
    };
  const shopNote = appt.email
    ? `${copy.sentWhat} was emailed to ${appt.email}.`
    : `The customer has no email, so only you got this.`;

  try {
    if (appt.email) {
      const rows = detailRows(appt, false);
      await mail.sendMail({
        from, to: appt.email, replyTo: ownerEmail,
        subject: copy.subject,
        text: `Hi ${appt.name},\n\n${copy.intro}\n\n` + asText(rows) + `\n\n${copy.closing}\n\n${SHOP.name}`,
        html: `<div style="font:15px/1.5 Arial,sans-serif;color:#0b0e11">` +
          `<p>Hi ${esc(appt.name)},</p><p>${copy.introHtml}</p>` + asHtml(rows) +
          `<p>${copy.closingHtml}</p>` +
          `<p>${SHOP.name}<br><span style="color:#5b6470">${SHOP.address}</span></p></div>`,
      });
    }

    const rows = detailRows(appt, true);
    await mail.sendMail({
      from, to: ownerEmail,
      subject: `${copy.shopWord}: ${appt.name}, ${when}`,
      text: `This appointment is ${kind}. ${shopNote}\n\n` + asText(rows),
      html: `<div style="font:15px/1.5 Arial,sans-serif;color:#0b0e11"><p>This appointment is ${kind}. ` +
        esc(shopNote) + `</p>` + asHtml(rows) + `</div>`,
    });
  } catch (err) {
    console.error("Sending failed:", err);
    // Un-mark it so the owner can try again from the dashboard.
    await db.from("appointments").update({ [marker]: null }).eq("id", id);
    return reply({ error: "The email couldn't be sent. Check the Gmail secrets in Supabase." }, 502);
  }

  return reply({ sent: true, customer: appt.email, owner: ownerEmail });
});
