# Parkar & Associates Task App — v2.6.0 GitHub Ready Final

## Included fixes

- Request timestamp/nonce integrity is now enforced in Apps Script after token validation.
- Duplicate `submitUpdate` listener removed.
- Visible version labels updated to v2.6.0.
- Login screen copy simplified: no technical security/backend wording for staff.
- Mobile login placeholder shortened and input overflow reduced.
- Forced PIN change now uses a branded modal instead of browser prompt boxes.
- Visible Change PIN button added after login.
- Owner-only System Status check added for version, logged-in user, sheet connection, and write permission.
- Dropdown/person option rendering improved with HTML escaping.
- Checklist updated for stronger initial PIN/change-PIN flow.

## Before GitHub upload

Paste your Google Apps Script Web App URL into `app.js`:

```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

If `API_URL` is left blank, the app opens in preview mode only and will not save team data to the Google Sheet.

## Visual QA note

Static file checks and JavaScript syntax checks were completed. Live GitHub Pages browser QA must be done after upload because the real deployed URL is required for the final connection and login test.
