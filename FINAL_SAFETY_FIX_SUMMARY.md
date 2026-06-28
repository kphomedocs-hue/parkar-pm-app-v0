# Parkar PM App — Final Safety Fix Summary

Applied after final audit:

- Restored a compact reachable task View control so Completed, Cancelled, Waiting Approval, Needs Correction, and Deleted / Archive views are accessible.
- Kept Sort hidden with Due Date as default to avoid repeated information.
- Added visible focus styles for keyboard/accessibility.
- Replaced public preview names/emails in `data.json` with demo-only values.
- Added CSV formula-injection safety for exports.
- Added 25-second API request timeout to prevent stuck Saving states.
- Removed inline onclick from the People form Clear button.
- Changed new Person ID display to “Assigned automatically” in live/API mode.
- Corrected Login Security documentation: this frontend shows audit/security events only and does not collect IP/GPS/geolocation.
- Added 32×32 favicon asset.

Daily quota limit remains intentionally excluded by instruction.
