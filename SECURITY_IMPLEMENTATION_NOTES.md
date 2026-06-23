# v2.2 Security Implementation Notes

## What is now moved server-side

The following rules are implemented inside `apps-script-api-starter.gs`, not only in browser JavaScript:

- Login with salted PIN hash verification
- Signed session token creation and validation
- Owner/Manager/Staff role checks on every write
- Owner-only task delete and restore
- Owner-only archive completed
- Manager team boundary checks
- Staff cannot complete tasks
- Staff cannot update a `Requested` self-task until approved
- Staff self-task starts as `Requested`
- Owner max = 2 active owners
- Total active people max = 30
- Wrong PIN attempt lockout
- Person delete becomes safe deactivation when task history exists
- Audit log written to `BE_Audit Log`

## What still needs live testing

These checks are implemented in code, but must be tested after Apps Script deployment:

- Login token returned correctly from Web App
- CORS/browser POST behavior with Apps Script deployment settings
- Sheet header mapping after setup
- Real add/edit/update/delete writes into Google Sheet
- Role-restricted bootstrap returns only visible data for Manager/Staff
- Wrong PIN lockout timing

## Important limitation

The app is now architecturally safer for live use, but it is still a Google Sheets + Apps Script system. For a 30-person internal office app this is acceptable. For hundreds of users, real database + proper auth would be better.
