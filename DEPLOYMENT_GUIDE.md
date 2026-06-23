# Parkar and Associates Task App v2.6.0 — Deployment Guide

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
| M001 | Gitanjali | Manager | Staff@parkar.associates | O001 |
| S001 | Ali | Staff | Staff Code: S001 / Email saved: Staff@parkar.associates | M001 |

Important: real PINs are not stored in frontend files or data.json. Enter PINs only inside Apps Script / Script Properties during backend setup.

## Before running setupInitialSheets()
In Apps Script, set these Script Properties:

- INITIAL_OWNER_PIN = your owner PIN
- INITIAL_ALI_PIN and INITIAL_GITANJALI_PIN = Ali's staff PIN

Gitanjali is seeded with email Staff@parkar.associates and the PIN from Script Property INITIAL_GITANJALI_PIN.

## Apps Script setup steps
1. Create a fresh Google Sheet.
2. Open Extensions → Apps Script.
3. Paste `apps-script-api-starter.gs`.
4. Set Script Properties:
   - INITIAL_OWNER_PIN
   - INITIAL_ALI_PIN and INITIAL_GITANJALI_PIN
5. Run `setupInitialSheets()` once.
6. Deploy → New deployment → Web app.
7. Execute as: Me.
8. Who has access: Anyone with the link, or your Workspace users if using Workspace.
9. Copy the Web App URL.
10. `API_URL` is already set in `app.js` to `https://script.google.com/macros/s/AKfycbzDgToyS03oSW7ooHJEup3Bm1ycmlf6dTckJGsD-XkhOIv-JcesXqc4JBUuOT9PdiQ/exec`. Update only if you redeploy to a different Web App URL.
11. Upload frontend files to GitHub Pages.

## GitHub Pages upload files
Upload only the frontend files:

- index.html
- styles.css
- app.js
- data.json

Do not upload private Apps Script setup values or screenshots unless needed.

## Live login rules
- Owner / Manager: Email + PIN
- Staff: Staff Code + PIN
- Staff email is stored for reference but staff login is by Staff Code.

## v2.6.0 deployment/stability fixes included
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


## v2.6.0 stability note

For new people, live Apps Script assigns codes server-side inside the write lock. Do not manually pre-fill new staff codes in GitHub frontend code. Existing people still keep their existing code when edited.


## v2.6.0 branding asset note
Upload the full `assets/` folder with the frontend files. Required branding files:
- `assets/parkar-logo.png`
- `assets/parkar-icon.png`

Do not rename these asset files unless you also update `index.html`.
