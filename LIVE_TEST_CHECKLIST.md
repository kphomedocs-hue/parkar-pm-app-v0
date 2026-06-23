# Parkar & Associates Task App — Live Test Checklist v2.6.0

Backend Web App URL connected in `app.js`:

```text
https://script.google.com/macros/s/AKfycbzDgToyS03oSW7ooHJEup3Bm1ycmlf6dTckJGsD-XkhOIv-JcesXqc4JBUuOT9PdiQ/exec
```

## Before testing

1. Paste the full `apps-script-api-starter.gs` code into Apps Script.
2. Add Script Properties:
   - `INITIAL_OWNER_PIN` = `1235`
   - `INITIAL_ALI_PIN` = `1234`
   - `INITIAL_GITANJALI_PIN` = `1234`
3. Run `setupInitialSheets()` once.
4. Deploy as Web App: Execute as `Me`, access `Anyone`.
5. Upload this v2.6.0 frontend to GitHub Pages.

## Day-one login test

| User | Login Code / Email | PIN | Expected Role |
|---|---:|---:|---|
| Ar. Kartik Verma | `O001` or `Ar.kartikverma@gmail.com` | `1235` | Owner |
| Gitanjali | `M001` or `Staff@parkar.associates` | `1234` | Manager |
| Ali | `S001` | `1234` | Staff |

Note: Gitanjali and Ali share the same email and PIN in this starter setup. Staff/manager code login keeps them separate, but change one PIN later for better security.

## Functional live tests

- Owner login
- Manager login
- Staff login
- Bootstrap data read from Google Sheet
- Owner adds task for Ali
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


## v2.6.0 extra checks

- Leave app open, invalidate/expire session or use an old token, then confirm the app returns to login instead of staying in a broken logged-in view.
- Add a new person from two browsers close together and confirm backend gives unique codes.
- Log in as staff and confirm Edit is hidden for Ready for Check and Completed tasks.
- Click backup export once and confirm the button shows a busy state.
- Double-click Add Task / Save Person and confirm only one request is submitted.


## v2.6.0 branding asset note
Upload the full `assets/` folder with the frontend files. Required branding files:
- `assets/parkar-logo.png`
- `assets/parkar-icon.png`

Do not rename these asset files unless you also update `index.html`.
