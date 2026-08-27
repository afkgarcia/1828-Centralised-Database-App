# Pre-client smoke pass (~20 min, run on the deployed instance)

The agreed order is: **you → Ernest → employees**. Run this once on the live
URL before sending Ernest the link. Every step should pass; anything that
doesn't is a stop-ship.

## Accounts & session
- [ ] Log in with the bootstrap owner account (from `/etc/1828-tracker.env`).
- [ ] Reload the page — still logged in (persistent session).
- [ ] Change the owner password via 🔑; log out; log in with the new one.
- [ ] Wrong password → "Wachtwoord onjuist"; a **non-existent** email → the
      same message (no account hint).
- [ ] 11 rapid failed logins → "RATE_LIMITED" style refusal (429).
- [ ] Signup as a fake colleague (e.g. `test@vivout.nl`, role PM) → "wacht op
      goedkeuring"; approve them under 👥 Gebruikers; log in as them in a
      private window.
- [ ] Password reset for that test account: request code → **check the email
      arrives** (SMTP!) → complete the reset → log in.

## Core flow (as the owner)
- [ ] Create a test city (+ Stad), open it — 26 Gemeenteontwikkeling tasks.
- [ ] Check tasks off, attach a Drive link to one (chip appears, opens in a
      new tab), mark one N.v.t.
- [ ] Submit with open tasks → two-step dialog → "markeer als n.v.t." →
      submitted banner; approve as owner → city unlocked note.
- [ ] Create a project under the city (+ Project) → 9 phases, Acquisitiefase
      unlocked (city approved), phase 2 locked.
- [ ] Submit Acquisitiefase with open tasks → **move to next phase** → WIP rows
      sit atop Haalbaarheidsfase; approve → phase 2 unlocks.
- [ ] Admin mode (⚙ Admin): add a custom row, reorder it, delete it. Toggle
      admin off — controls disappear.

## Access control (as the test PM, private window)
- [ ] Without a city grant: empty dashboard with the "geen toegang" notice.
- [ ] Grant the test city (👥 → stadsknoppen): city appears; other cities absent.
- [ ] The pending-approvals tile and approve/reject buttons are absent for the PM.

## Notifications & exports
- [ ] ✉ Meldingen shows the actions from above; the "Van/Aan" lines are right.
- [ ] Checking off a deliverable emails the owner (real inbox, via SMTP).
- [ ] Excel export, one project → workbook downloads, sheets match the original
      layout. Portfolio scope: available to the owner, absent for the PM.
- [ ] PDF button is absent on the web (desktop-only for now) — expected.
- [ ] If `google-oauth.json` is installed (DEPLOY §7b): connect Google Drive
      from the export dialog, export one project → file appears in the "1828
      Fasedocument Tracker" Drive folder and opens from the alert link. The
      Drive buttons are absent for non-owner users.

## Housekeeping
- [ ] `journalctl -u 1828-tracker -n 50` — no errors during the pass.
- [ ] Run the backup script once; a `tracker-….sqlite` file appears in backups.
- [ ] Delete the test city/project + test account (👥 remove-with-handover)
      so Ernest starts clean, or reset the DB entirely
      (`rm /var/lib/1828-tracker/tracker.sqlite*` + restart + re-bootstrap).
- [ ] `BOOTSTRAP_OWNER_PASSWORD` removed from `/etc/1828-tracker.env`.

## Then
Send Ernest the URL + his owner credentials (separate channels for URL and
password), with the NL/EN toggle and 🔍 zoom pointed out.
