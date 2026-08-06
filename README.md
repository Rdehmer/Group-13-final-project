# Equipment Service Manager

Local web app for **EquipmentIQ** to manage customers, commercial equipment, service contracts, work orders, technicians, parts, billing, simulated payments, and profitability.

Built with Next.js, React, Tailwind CSS, daisyUI, Supabase, and Recharts.

## Environment variables (`.env.local`)

1. Open [Supabase](https://supabase.com) and select project **ACCY628-Final-Project-G13**.
2. Open **Connect**, or go to **Settings → API Keys**.
3. Copy the **Project URL**.
4. Copy the **publishable** key. If you only see an older **anon public** key, use that instead.
5. Put them in `.env.local` like this:

```env
NEXT_PUBLIC_SUPABASE_URL=https://bpiqnmjntlmruswzazlj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-public-key
```

Do **not** put a service-role key or secret key in this file.

After you create or edit `.env.local`, **stop** the local server (`Ctrl+C`) and run `npm run dev` again so Next.js reloads the new values.

A template is also in `.env.local.example`.

## Start the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo logins

Password for all demo users: **`DemoPass123!`**

| Email | Role | Where you land |
|-------|------|----------------|
| admin@equipmentiq-demo.test | Administrator | Management dashboard |
| manager@equipmentiq-demo.test | Service Manager | Management dashboard |
| tech1@equipmentiq-demo.test | Technician | Technician schedule |
| billing@equipmentiq-demo.test | Billing Employee | Billing |
| customer1@equipmentiq-demo.test | Customer | Customer portal (Northwind Cold Storage) |

Extra technicians: tech2–tech5@equipmentiq-demo.test

## What to click to test (quick tour)

1. **Login / logout / theme** — use the login page theme selector, sign in as admin, use header Log out.
2. **Dashboard** — admin/manager: stats, charts, action lists.
3. **Customers** — add/view customers; open a customer for detail + activity.
4. **Equipment** — add equipment linked to a customer.
5. **Contracts** — view structured contracts and profitability summaries.
6. **Work Orders** — create/assign; open a Critical/Emergency WO (highlighted).
7. **Technician** — sign in as tech1; start job, enter labor, add parts, request additional work, mark ready for review.
8. **Manager approval** — sign in as manager; open Ready for Review WO and Approve & Complete.
9. **Parts** — confirm low-stock parts show a warning (reorder level).
10. **Billing** — sign in as billing; create invoice from approved work; check statuses.
11. **Payments** — record a simulated payment; confirm remaining balance updates.
12. **Reports** — accounting summary (earned vs billed vs collected) and profitability.
13. **Customer portal** — sign in as customer1; only Northwind data; submit a service request.
14. **Users / Settings** — admin only: change roles and company settings.

## Seed data included

At least: 10 customers, 20 equipment, 10 contracts, 30 work orders, 5 technicians, 20 parts, 15 invoices, 10 payments, plus edge cases (unprofitable contract, emergency/critical, overdue PM, waiting on parts, warranty, partial/past-due/disputed invoices, expired/renewed contracts, pending additional work, completed-unbilled, low stock).

## Important limits (first version)

- Payments are **simulated** (no real card processor).
- Accounting is **summary-level**, not a full general ledger.
- The app is for **localhost**; it has not been deployed.
- New self-serve signups default to the **customer** role until an administrator changes the role.
- File uploads for technician photos are not required in this first version (notes/status fields cover supporting information).

## Scripts

- `npm run dev` — local development
- `npm run build` — production build check
- `npm run start` — run a production build locally
- `npm run lint` — lint
