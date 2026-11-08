# RackTrail

RackTrail is a clothing rental and reservation app for Bebeth’s Tailor Shop. The public pages and the customer, staff, and admin portals follow the rose-and-maroon prototype embedded in RackTrail_Final-1.docx. The requirements table and system flowchart guide account access, booking, payment review, and returns.

## Run locally

Use Node.js 24 or newer. In this folder, run:

```powershell
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3001. Node serves both the React app and the Express API. SQLite creates `data/racktrail.sqlite` on first startup when `DATABASE_URL` is unset. For development with hot reload, use `npm run server` and `npm run dev` in separate terminals and open the Vite URL. Run `npm test` for the SQLite integration test. Set `TEST_DATABASE_URL` to an empty, disposable PostgreSQL database to run the same workflow against PostgreSQL.

All three local demo accounts use the password `RackTrail123!`. Choose the matching role on the login screen.

| Role | Email |
| --- | --- |
| Customer | customer@racktrail.test |
| Staff | staff@racktrail.test |
| Admin | admin@racktrail.test |

## Rental workflow

1. Sign in as a customer, choose an item, select **Rent** or **Reserve**, and enter the dates. The first and last date both count toward the total. A pending request holds one copy for the selected dates.
2. Choose Cash on Pickup or, if configured, submit a GCash reference and receipt. GCash verification is a manual staff action.
3. Sign in as staff. Open **Transaction** to review the request, confirm a reservation, record payment, and release the item on a booked date. An item still checked out counts against available stock. Record the return, inspection, and any penalty to release that stock.
4. View the customer’s booking status, history, in-app notifications, or messages. Staff and admin can generate reports and use the browser’s **Save as PDF** option.

Reports count bookings by submission date and revenue by payment verification date in Asia/Manila. Return penalties are recorded separately from rental revenue.

## Shop configuration

Set variables in a local `.env` file. Keep it and the database private.

| Variable | Purpose |
| --- | --- |
| `GCASH_QR_URL` | Trusted HTTPS image URL or app-relative path for the shop’s real GCash QR. Leave unset to disable GCash. |
| `SMTP_URL`, `MAIL_FROM`, `APP_URL` | Enable emailed password reset links. `APP_URL` is the app’s public origin. |
| `BACKUP_DIR` | Enables daily SQLite snapshots while the server is running. Keeps 14 snapshots. |
| `DB_FILE` | SQLite file path. Defaults to `data/racktrail.sqlite`. |
| `DATABASE_URL` | PostgreSQL connection URL. When set, all application records use PostgreSQL instead of the local SQLite file. |
| `HOST`, `PORT` | Bind address and port. Defaults to `127.0.0.1:3001`. |
| `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initialize a fresh shop database with an administrator and without demo data. Use a dedicated database file. |
| `COOKIE_SECURE=1` | Sends session cookies only over HTTPS. Enable behind the shop’s HTTPS host. |

To restore a snapshot, stop the server and point `DB_FILE` at a private copy of the snapshot, then restart. Password recovery requires SMTP credentials and GCash requires the shop’s real QR. The local demo has neither configured.

## Deploy on Render

Use the repository’s `render.yaml` as a Render Blueprint. It provisions a free Node web service and a separate free PostgreSQL database in the current workspace. The web service connects over Render’s private network and uses secure session cookies. The database health endpoint is `/api/health`.

The first administrator uses `admin@racktrail.example`. Render generates its private `ADMIN_PASSWORD` environment variable. Retrieve that value from the service’s Environment page. Hosted setup starts with an empty catalog and creates no local demo accounts. Add shop inventory and staff through the administrator portal.

The free web service sleeps after 15 minutes of inactivity. PostgreSQL records survive application restarts, but Render’s free database expires after 30 days. Export a PostgreSQL backup before expiration. SQLite’s `BACKUP_DIR` setting applies only to local SQLite databases. Free Render services block common SMTP ports, so password-recovery email requires a supported mail delivery setup.

See [Render’s free service limits](https://render.com/docs/free).
