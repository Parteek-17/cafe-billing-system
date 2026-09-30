# Café Billing

Billing and sales records for a café. Next.js 14 + TypeScript + Tailwind on the
front, Supabase Postgres + Auth + Storage behind it.

Built against the existing database created by `cafe_billing_schema.sql`.
**No tables are created or altered by this application.**

---

## 1. Install

```bash
npm install
```

## 2. Configure

Copy the example file and fill in your own values:

```bash
cp .env.example .env.local
```

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page → `service_role` key — **server only** |
| `NEXT_PUBLIC_CAFE_TIMEZONE` | e.g. `Asia/Kolkata` |
| `CAFE_DAY_START_HOUR` | `5` — an order at 00:20 counts towards the previous day |

`.env.local` is git-ignored. The service-role key is only ever imported by
files that begin with `import "server-only"`, so the build fails if it is ever
pulled into browser code.

## 3. Create the first owner

The app never creates auth users. Do it once by hand:

1. Supabase → **Authentication → Users → Add user** (email + password).
2. Copy the new user's UUID.
3. Supabase → **SQL Editor**:

```sql
insert into public.profiles (id, name, role)
values ('PASTE-THE-UUID-HERE', 'Owner', 'admin');
```

Until this row exists `is_admin()` returns false for everyone and all
owner-only screens stay locked. Repeat with `'staff'` for each staff member.

## 4. Run

```bash
npm run dev
```

Open http://localhost:3000, sign in, then go to **Settings** and save the form
once — billing is blocked until an `app_settings` row exists.

---

## How it fits together

Reads go straight from the browser to Postgres and are filtered by Row Level
Security. Anything that must not be trusted to the browser runs in a route
handler under the service-role key, after checking the caller's role.

| Route | Responsibility |
|---|---|
| `POST /api/tabs` | Open a tab. Safe to retry — `local_uuid` is UNIQUE. |
| `POST /api/tabs/:id/items` | Add / change / remove a line. Copies name, price and GST onto the line. |
| `POST /api/tabs/:id/settle` | Recomputes every figure from the database, claims the bill number, marks it settled. |
| `POST /api/bills/:id/pdf` | Renders the receipt, stores it privately, returns a signed link. |
| `GET /api/bills/:id/whatsapp-link` | Builds the one-tap `wa.me` link from the saved template. |
| `POST /api/bills/:id/void` | Owner only, reason required, written to the audit log. |
| `POST /api/day-close` | Freezes a business date. |
| `POST /api/reports/register` | Date-range PDF register. |
| `GET /api/reports/csv` | The same range as a spreadsheet. |

## WhatsApp

The bill screen has a **Send on WhatsApp** button. It generates the receipt
PDF if it does not exist yet, then opens WhatsApp with the thanks note and a
private link to the bill already typed. Staff press send.

That is the whole feature. There is no API account, no per-message cost, no
24-hour session window and no template approval — all of which the WhatsApp
Business/Cloud API imposes and none of which a café counter needs.

Edit the wording in **Settings → WhatsApp thanks note**. Placeholders:

| Placeholder | Becomes |
|---|---|
| `{{customer_name}}` | the name on the bill |
| `{{cafe_name}}` | your café name |
| `{{bill_no}}` | e.g. `CAFE/2026-09-30/007` |
| `{{total}}` | e.g. `Rs. 336.00` |
| `{{bill_link}}` | signed link to the PDF |

Drop `{{bill_link}}` if you want a plain thanks with no link; the PDF is
still stored and still reachable from the Bills screen.

The link is a **signed Supabase URL** — unguessable and valid for seven days.
The `bills` bucket stays private throughout.

All of this lives behind `GET /api/bills/:id/whatsapp-link` and
`src/lib/whatsapp.ts`. Moving to an automated sender later means changing
those two files and nothing else.

## Testing

```bash
npm run typecheck     # no TypeScript errors
npm run build         # production build
```

Then, against your own Supabase project:

- **Money.** Settle a known basket and check `subtotal − discount + GST == total`
  to the paise, in both GST modes (Settings → GST mode).
- **Concurrency.** Settle several tabs quickly and confirm every `bill_no` is
  distinct.
- **Security.** Sign in as staff: Menu, Analytics, Day close and Settings
  disappear from the nav, and the Bills list shows only their own bills. That
  is Postgres refusing the rows, not the UI hiding them.
- **Day close.** Close a date, then try to void a bill from it — the database
  trigger refuses the write and the error surfaces in the UI.
- **Void.** A voided bill stays visible and is excluded from analytics.

## Deploying to Vercel

Push to GitHub, import the repo in Vercel, and add the same five environment
variables under Project → Settings → Environment Variables. No other setup:
the API routes deploy as serverless functions alongside the pages.

## Notes

- **Money** is stored and computed as whole paise everywhere. Rupees only exist
  as display strings.
- **Bill numbers** are claimed with a compare-and-swap on `bill_counters`, so
  two simultaneous settles can never collide. A number is claimed just before
  the order row is written, so a crash in that gap burns a number and leaves a
  gap. Numbers are always unique; they are gapless in normal operation. For
  strict gaplessness under crashes, move the claim and the bill write into one
  Postgres function so they share a transaction.
- **PDF receipts** use "Rs." rather than "₹" — the built-in PDF fonts have no
  rupee glyph, and embedding a font file for one character is not worth it. The
  on-screen bill and the printed page both use ₹.
- **Offline / PWA** is not implemented. See the section below.

## Not built

These are in the architecture but deliberately absent from this codebase:

- **Offline outbox and installable PWA** (milestone M10). A partial offline
  layer is worse than none — it silently loses bills. Everything it needs is in
  place: `orders.local_uuid` is UNIQUE and `POST /api/tabs` is already
  idempotent, so a queued replay cannot double-create a tab.
- **Nightly `pg_dump` backup, Sentry, keep-alive ping** (M11) — deployment
  infrastructure rather than application code.
- **WhatsApp Cloud API.** As the architecture intends, every WhatsApp concern
  lives behind the single `whatsapp-link` route, so switching later changes one
  file.
