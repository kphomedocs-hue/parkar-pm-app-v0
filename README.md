# Parkar and Associates — Staff Task Management App v2.6.0

Deployment-ready patch for the Parkar and Associates internal task system.

## What this version is
This version prepares the app for GitHub Pages + Google Apps Script + fresh Google Sheet backend deployment.

## Key limits
- Maximum active people: 30
- Maximum active owners: 2
- Managers and staff are flexible inside the 30-person cap
- Inactive people stay in history

## Login
- Owner / Manager: Email + PIN
- Staff: Staff Code + PIN

## Security
- Real PINs should only be entered in Apps Script / backend setup.
- Frontend data.json uses preview/demo values only.
- Backend Apps Script stores salted SHA-256 PIN hashes.
- Session tokens are signed and checked on every write action.
- Failed login lockout is included.

See `DEPLOYMENT_GUIDE.md` for step-by-step setup.


## v2.6.0 live backend URL

`app.js` is already connected to:

```text
https://script.google.com/macros/s/AKfycbzDgToyS03oSW7ooHJEup3Bm1ycmlf6dTckJGsD-XkhOIv-JcesXqc4JBUuOT9PdiQ/exec
```

Internal `archeng` folder/storage references were cleaned to Parkar naming in this package.


## v2.6.0 stability patch

This package adds central session-expiry logout, backend-only new person code generation, staff edit visibility alignment, export busy states, and double-submit protection. Core architecture is unchanged.


## v2.6.0 Branding Patch
- Official Parkar & Associates logo added.
- Bronze/cream Parkar visual identity incorporated into login, sidebar, buttons, highlights, and dashboard header.
- Core architecture remains unchanged from v2.6.0.


## v2.6.0 final deployment patch

Included before GitHub upload: request integrity enforcement, duplicate submit fix, v2.6.0 labels, stronger PIN checklist, branded Change PIN modal, owner System Status check, safer dropdown escaping, and cleaner login wording.
