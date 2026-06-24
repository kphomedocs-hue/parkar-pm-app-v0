# Parkar and Associates Task App v2.6.1 — Deployment Guide

## Deployment target
- Frontend hosting: GitHub Pages
- Backend database: fresh Google Sheet
- Backend API: Google Apps Script Web App
- Refresh mode: Manual or Every 4 Hours only
- Projects module: Removed

## Initial live records
The app is prepared for these starting records:

| Code | Name | Role | Email / Login | Manager |
|---|---|---|---|---|
| O001 | Ar. Kartik Verma | Owner | Ar.kartikverma@gmail.com | - |
| M001 | Gitanjali | Manager | Code login: M001 (email can be added later) | O001 |
| S001 | Ali | Staff | Staff Code: S001 / Email saved: Staff@parkar.associates | M001 |

Important: real PINs are not stored in frontend files or data.json. Enter PINs only inside Apps Script / Script Properties during backend setup.

## Before running setupInitialSheets()
In Apps Script, set these Script Properties:

- INITIAL_OWNER_PIN = your owner PIN
- INITIAL_ALI_PIN and INITIAL_GITANJALI_PIN = Ali's staff PIN

Gitanjali is seeded without a duplicate email. She can login with M001 + PIN; add a unique email later from Admin / People if needed.

## Apps Script setup steps
1. Create a fresh Google Sheet.
2. Open Extensions → Apps Script.
3. Paste `apps-script-api-starter-v2_6_1-timeout-fixed.gs`.
4. Set Script Properties:
   - INITIAL_OWNER_PIN
   - INITIAL_ALI_PIN and INITIAL_GITANJALI_PIN
5. Run `setupInitialSheets()` once.
6. Deploy → New deployment → Web app.
7. Execute as: Me.
8. Who has access: Anyone with the link, or your Workspace users if using Workspace.
9. Copy the Web App URL.
10. `API_URL` is already set in `app.js` to `https://script.google.com/macros/s/AKfycbzIOC31eWS8NNq0jFUnfMyV0JaF2CxE0lcgJlo60UZv-gmbioNzvPnGA5DNFwdRQdBZ/exec`. Update only if you redeploy to a different Web App URL.
11. Upload frontend files to GitHub Pages.

## GitHub Pages upload files
Upload only the frontend files:

- index.html
- styles.css
- app.js
- data.json

Do not upload private Apps Script setup values or screenshots unless needed.

## Live login rules
- Owner / Manager: Email or Code + PIN
- Staff: Staff Code + PIN
- Staff email is stored for reference but staff login is by Staff Code.

## v2.6.1 deployment/stability fixes included
- Demo login buttons removed.
- Task table now has Link column.
- Staff self-task workflow text updated to Requested.
- PIN is optional while editing an existing person.
- New person still requires PIN.
- Owner cannot deactivate/demote own owner login.
- Backend protects last active owner.
- Backend uses LockService for write actions.
- Person codes now use role-based codes: O001, M001, S001.
- Task IDs now use PA-T-001 format.
- Staff login is staff-code based.


## v2.6.1 stability note

For new people, live Apps Script assigns codes server-side inside the write lock. Do not manually pre-fill new staff codes in GitHub frontend code. Existing people still keep their existing code when edited.


## v2.6.1 branding asset note
Upload the full `assets/` folder with the frontend files. Required branding files:
- `assets/parkar-logo.png`
- `assets/parkar-icon.png`

Do not rename these asset files unless you also update `index.html`.


## v2.6.1 navigation note
The left sidebar is the main navigation. Dashboard office shortcuts are role-aware and separate from the task page.

## v2.6.1 login security tracking
This build adds a `BE_Login Sessions` sheet for login security tracking.

During Apps Script setup or upgrade, run `setupInitialSheets()` once again. It will add missing sheets/headers without deleting existing data.

Login tracking fields include:
- Login time
- Logout time
- Session duration in minutes when the user logs out normally
- Public IP address when available
- IP changed flag
- Browser/device label
- Time zone
- Browser location status or GPS coordinates if the user allows browser location permission

Optional email alert:
Set Script Property `SECURITY_ALERT_EMAIL` to the owner/security email address. When a user logs in from a different detected public IP, Apps Script will create an `IP_CHANGED` audit log and try to email that address.

Important: Google Apps Script web apps do not reliably expose the visitor IP directly to server code. The frontend asks the browser to read public IP through `api.ipify.org`. If that request is blocked, IP will show as unavailable.
