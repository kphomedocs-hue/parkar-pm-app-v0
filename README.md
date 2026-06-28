# Parkar and Associates — Staff Task Management App v2.6.1

Deployment-ready patch for the Parkar and Associates internal task system.

## What this version is
This version prepares the app for GitHub Pages + Google Apps Script + fresh Google Sheet backend deployment.

## Key limits
- Maximum active people: 30
- Maximum active owners: 2
- Managers and staff are flexible inside the 30-person cap
- Inactive people stay in history

## Login
- Owner / Manager: Email or Code + PIN
- Staff: Staff Code + PIN

## Security
- Real PINs should only be entered in Apps Script / backend setup.
- Frontend data.json uses demo-only values only; real users/PINs stay in Apps Script/Google Sheet setup.
- Backend Apps Script stores salted SHA-256 PIN hashes.
- Session tokens are signed and checked on every write action.
- Failed login lockout is included.

See `DEPLOYMENT_GUIDE.md` for step-by-step setup.


## v2.6.1 live backend URL

`app.js` is already connected to:

```text
https://script.google.com/macros/s/AKfycbzIOC31eWS8NNq0jFUnfMyV0JaF2CxE0lcgJlo60UZv-gmbioNzvPnGA5DNFwdRQdBZ/exec
```

Internal `archeng` folder/storage references were cleaned to Parkar naming in this package.


## v2.6.1 stability patch

This package adds central session-expiry logout, backend-only new person code generation, staff edit visibility alignment, export busy states, and double-submit protection. Core architecture is unchanged.


## v2.6.1 Branding Patch
- Official Parkar & Associates logo added.
- Bronze/cream Parkar visual identity incorporated into login, sidebar, buttons, highlights, and dashboard header.
- Core architecture remains unchanged from v2.6.1.


## v2.6.1 final deployment patch

Included before GitHub upload: request integrity enforcement, duplicate submit fix, v2.6.1 labels, stronger PIN checklist, branded Change PIN modal, owner System Status check, safer dropdown escaping, and cleaner login wording.


## v2.6.1 navigation cleanup
- Top navigation dropdown removed because the left sidebar is the primary navigation.
- Dashboard Office Controls shortcuts removed; Admin and Audit/Backup are accessed through the Admin section, role-controlled.
- Dashboard task preview rows remain linked directly to Update / Review for that task.


## v2.6.1 dashboard/review workflow cleanup
- Staff/Manager dashboard hides Total Tasks, Completed, and Current Task Status.
- Staff/Manager dashboard shows Sent for Approval count and list.
- Staff sends existing task to Ready for Check; Owner/Manager reviews same Task ID as Completed or Revision Required.

## v2.6.1 Login security tracking
- Admin → Login Security shows login/security audit events when the backend/audit log provides them.
- This frontend does not collect IP address, GPS/geolocation, or browser location permission data.
- IP-change email alerts are not part of this final frontend package.

## v2.6.1 final workflow update
- Staff cannot see completed tasks.
- Staff can cancel their own Requested task.
- Owner/Manager dashboards include Review Summary for Ready for Check, Requested, Revision Required, No Update 3 Days and Overdue.
- Dashboard task rows open Update / Review for the same Task ID; correction/review never creates a new Task ID.
