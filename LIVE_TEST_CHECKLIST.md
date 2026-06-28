# Parkar & Associates Task App — Live Test Checklist v2.6.1

Backend Web App URL connected in `app.js`:

```text
https://script.google.com/macros/s/AKfycbzIOC31eWS8NNq0jFUnfMyV0JaF2CxE0lcgJlo60UZv-gmbioNzvPnGA5DNFwdRQdBZ/exec
```

## Before testing

1. Paste the full `apps-script-api-starter-v2_6_1-timeout-fixed.gs` code into Apps Script.
2. Add Script Properties:
   - `INITIAL_OWNER_PIN` = `1235`
   - `INITIAL_ALI_PIN` = `1234`
   - `INITIAL_GITANJALI_PIN` = `1234`
3. Run `setupInitialSheets()` once.
4. Deploy as Web App: Execute as `Me`, access `Anyone`.
5. Upload this v2.6.1 frontend to GitHub Pages.

## Day-one login test

| User | Login Code / Email | PIN | Expected Role |
|---|---:|---:|---|
| Demo Owner | `O001` or `owner@example.com` | demo PIN only | Owner |
| Demo Manager | `M001` | demo PIN only | Manager |
| Demo Staff | `S001` | demo PIN only | Staff |

Note: public frontend files use demo identities only. Use real live PINs only in Apps Script / Sheet backend setup.

## Functional live tests

- Owner login
- Manager login
- Staff login
- Bootstrap data read from Google Sheet
- Owner adds task for Demo Staff
- Manager adds/reviews own-team task
- Staff adds self-task
- Staff updates task to Ready for Check
- Manager/Owner reviews task to Completed or Revision Required
- Owner soft-deletes a task
- Owner restores a task
- Owner exports backup
- Check rows in `BE_Task Database` and `BE_Audit Log`

## Pass condition

The app is live-ready only after changes appear in the Google Sheet after browser actions.


## v2.6.1 extra checks

- Leave app open, invalidate/expire session or use an old token, then confirm the app returns to login instead of staying in a broken logged-in view.
- Add a new person from two browsers close together and confirm backend gives unique codes.
- Log in as staff and confirm Edit is hidden for Ready for Check and Completed tasks.
- Click backup export once and confirm the button shows a busy state.
- Double-click Add Task / Save Person and confirm only one request is submitted.


## v2.6.1 branding asset note
Upload the full `assets/` folder with the frontend files. Required branding files:
- `assets/parkar-logo.png`
- `assets/parkar-icon.png`

Do not rename these asset files unless you also update `index.html`.


## v2.6.1 navigation/role checks
- Owner: sidebar shows Dashboard, Tasks, Team, Admin, and Logout.
- Manager: sidebar shows Dashboard, Tasks, Team, Admin, and Logout; owner-only Admin tabs are hidden.
- Staff: sidebar shows Dashboard, Tasks, Team, and Logout; Admin is hidden.
- Dashboard stays summary-focused.
- Top navigation dropdown is removed; left sidebar remains the navigation source.

## v2.6.1 login security checks
- Login as Owner, Manager, and Staff.
- Open Admin → Login Security as Owner and confirm login/security audit events show when available.
- If there is no live login audit data yet, confirm a clean empty state appears.
- Do not test IP change or GPS/geolocation capture; this frontend package does not collect that data.
