# StallCheck — Stall Profiling System

A responsive local web app for stall-owner accounts, daily attendance records, dispute review, and attendance-based rental estimates.

## Start the app

Install Node.js 22.13 or newer. The app uses Node's built-in SQLite support and has no npm packages to install.

In PowerShell, open this folder and run:

```powershell
npm.cmd start
```

Then open <http://localhost:3000> in your browser. Leave the terminal window running while you use the app. Press **Ctrl+C** in that window to stop it.

## First sign-in

Choose **Administrator** and sign in with the development account:

- Username: `admin`
- Password: `admin123`

The app creates this administrator the first time it initializes its local database. It is a development-only password; change it before deploying the application anywhere other people can reach.

For the renter experience, the app also creates a demo stall-owner account when it starts:

- Username: `renter`
- Password: `renter123`

Choose **Renter** on the sign-in screen to use this account. The requested `admin` / `admin123` credentials remain assigned to the administrator role.

## What works

- Administrator home page with renter, check-in, dispute, and estimated-rent totals.
- Manage renters, search accounts, and approve self-registration requests.
- Register renter accounts, assign a stall and daily rate, and set a temporary password.
- Transparency report with weekly estimated rent by stall owner and CSV export.
- Renter account requests, login, attendance history, check-in records, rent estimate, and dispute submission.
- SQLite storage in `data/stallcheck.sqlite3`. Accounts and records remain on this computer after the server stops.

Renter accounts created by administrators are active immediately. Self-registration requests remain pending until an administrator approves them from **Manage renters**.

## Database and account notes

Passwords are stored as salted scrypt hashes. The administrator password is only seeded when the database is first created. To choose a different first-run password, set `STALLCHECK_ADMIN_PASSWORD` before the first start. To replace an existing local demo database, stop the server and remove the SQLite files in `data`; this deletes its users and records.

The database is local to this server. Friends who clone the GitHub repository will get their own separate database. To share live records between different computers, deploy the app and database to a hosted service with secure account settings; do not expose the development server directly to the internet.

## Biometric limitation

Face and fingerprint options are demo labels only. The prototype does not connect to a biometric device, capture biometrics, or verify a person's identity. Check-in records are explicitly marked as demo records. Real biometric verification needs compatible hardware, an approved provider, and a properly secured production backend.

## GitHub Desktop

This folder is already initialized as a local Git repository. In GitHub Desktop, choose **File → Add Local Repository…**, select this folder, commit the changes, then choose **Publish repository**. Select a private repository if you want to control who can see the project. Friends can clone the published repository in GitHub Desktop, but their databases will remain separate until you deploy a shared backend.
