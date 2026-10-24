# Registration and owner approval

One Cloudflare site, repository and Supabase project serve all users. Friends need an
app account only; do not invite them to GitHub, Cloudflare or the Supabase organization.
Each approved user starts with their own onboarding and no inherited financial records.
Approval through Settings has no expiry. The owner can suspend access without deleting
the user's history, and later approve them again.

Settings also offers an email change on the existing Supabase Auth user. It uses
`auth.updateUser` and the configured confirmation flow, never creates a replacement
user or rewrites financial ownership. Keep Secure Email Change enabled and have the
account owner enter/confirm the change themselves. An email delivery failure leaves
the current login intact.

## Deployment order

The frontend was published on 2026-10-24. The production database/owner activation and
the legacy-helper hardening below were applied earlier that day after explicit owner approval.
Custom SMTP has been saved and the owner has selected self-registration from the
website as the tester workflow instead of an administrator-sent invitation. Publish
the prepared frontend for that signup test, keep email confirmation and approval
required, and do not report email delivery as verified until a tester receives and
confirms the message. The frontend fails closed when the access RPC is unavailable.

1. Confirm the owner's **FreelanceHub login email**, not an infrastructure account.
2. Configure email delivery before public signup. The project keeps email confirmation
   enabled. Custom SMTP is now saved; delivery still needs verification. Supabase's built-in mail service
   only sends to organization team addresses. Configure a sender/SMTP provider and
   check Auth → URL Configuration for the production site and its allowed redirect.
   Never put SMTP credentials in source code, browser JavaScript or chat.
   Disabling email confirmation requires an explicit product/security decision; it
   has not been done as part of this implementation.
3. Apply `supabase/migrations/20261024034124_trial_access_approval.sql` on the existing
   upgraded schema. It runs transactionally, locks signups during backfill/trigger
   replacement, and preserves deployed financial RPC bodies. It intentionally fails
   if any of the 13 required tables or RPCs is absent.
4. Prepare `supabase/admin/bootstrap_trial_owner.sql` with the confirmed app email,
   review the matching verified user, and execute once as the database owner. It
   refuses a missing/unverified/ambiguous user or an already configured different admin.
   No client path assigns admin privileges; signup metadata cannot request them.
   Apply `supabase/migrations/20261024040756_harden_legacy_auth_helpers.sql` afterwards.
   It revokes API execution on the retired signup helper and pins the legacy wallet
   resolver's search path without changing either function's body or financial data.
5. Verify the owner can call `get_my_app_access` with `allowed=true,is_admin=true`.
   Review Security/Performance Advisors and the table/function grants. Supabase MCP
   access in this workstation currently does not include this project; use the
   dashboard for these checks. See the production verification record below.
6. Run `npm test` and `npm run build`. Commit/push the reviewed changes, then deploy
   through `npm run deploy` and verify the existing production hostname.
7. With a separate tester's consent, verify signup → email confirmation → pending
   page → owner approval → empty onboarding → suspend → blocked access → reapprove.
   A real external email delivery/signup test has not yet been performed.

## Tester and admin workflow

1. The tester opens the production website and chooses **สมัครขอทดลองใช้**, then
   enters their own name, email and password. The admin does not create their password.
2. The tester confirms the email and signs in. Until approved, the app shows a
   pending page and cannot load financial records.
3. The owner opens **ตั้งค่า → คำขอทดลองใช้**, checks the applicant's email and
   email-confirmation badge, and chooses **อนุมัติ**.
4. The tester chooses **ตรวจสอบสถานะ** on the waiting page (or signs in again),
   then completes their own onboarding. No other user's financial records are copied.
5. Approval has no expiry. The owner can suspend or restore access from the same panel.

No test invitation or synthetic production account was created. The first real
self-registration is still needed to verify mail delivery and the complete live flow.

## Access boundaries

- `private.app_access` stores current status and role. New auth users are pending.
  Existing users retain their previous access; reruns do not approve pending users.
- All 13 public data tables retain their owner policies plus a restrictive approval
  policy. Admin status does not grant access to another user's financial rows.
- All 13 financial SECURITY DEFINER RPCs check approval before reading or writing.
  Authorization reads the database on each request, not user-editable metadata or a
  stale JWT role claim.
- Approval endpoints are public-schema SECURITY INVOKER wrappers over narrowly granted
  private functions with an empty search path. Anonymous callers cannot execute them.
- Review changes lock the target row, reject stale versions, protect admin accounts,
  and append an audit event. Self-approval and direct role-table updates are denied.
- The legacy signup trigger that claimed all unowned records is removed. The old
  account setup script now refuses to run after this feature is installed and never
  takes already-owned rows. The historical full baseline likewise refuses to reset
  an access-enabled database. The upgrade script preserves restrictive access policies
  and approval checks; use versioned migrations for future changes.
- The UI waits for a server approval check before restoring account snapshots, clears
  cached screens on denial, and discards responses from a previous account/session.
  Already downloaded data cannot be retroactively erased from a user's device;
  suspension blocks future database access immediately and clears the UI at its next
  access check.

## Verification

`tests/test_trial_access.js` executes the real migrations in disposable PGlite and
checks signup isolation, RLS, every financial RPC, privilege spoofing, admin-only review,
stale decisions, audit records, suspension, expiry, maintenance reruns and grants.
`tests/test_trial_access_ui.js` executes the real access module in a Node VM to check
cache gating, session races, failed requests, signup validation and escaped admin UI.

Browser checks use synthetic local data, including signup, pending and admin screens
at phone and desktop widths, with light/dark themes. These checks do not claim physical
iPhone testing or successful production email delivery. No real financial records are
created by the tests.

Official reference: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Production verification — 2026-10-24

- Migration and owner bootstrap committed together in one database transaction. The
  bootstrap also checked the previously verified owner's exact UUID before granting
  admin. The existing account, financial data ownership and login email are retained.
- Read-only catalog verification passed for the approved admin with no expiry, all 13
  restrictive data policies, all 13 financial RPC guards, the new pending-signup trigger,
  removal of the legacy claim trigger, private-table RLS and anonymous RPC denial.
- A read-only transaction using the owner's authenticated role returned
  `allowed=true`, `is_admin=true`, `status=approved`, `unlimited_access=true`.
- The helper follow-up was separately verified: neither API role can execute the
  retired helper, and the wallet resolver has an empty fixed search path.
- Auth Site URL was corrected from `http://localhost:3000` to
  `https://natthawit-studio.pages.dev/` so email confirmation returns to the app.
- Security Advisor: 0 errors, 14 warnings after hardening (down from 17). The remaining
  warnings are the 13 intentionally callable, owner/approval-checked financial
  SECURITY DEFINER RPCs and disabled leaked-password protection. No new approval
  function is SECURITY DEFINER in the exposed schema. Performance Advisor: 0 errors,
  13 pre-existing owner-policy initialization warnings; the new approval policies use
  a scalar SELECT to avoid per-row evaluation.
- Full `npm test` after hardening exited 0: 117 passing scenarios/checks, including
  16 backend-access and 9 access-UI tests. This is not a native multi-connection rerun.
- The owner enabled Google 2-Step Verification, created an App Password and saved it
  directly in Supabase. After reloading the dashboard, custom SMTP remained enabled
  with `smtp.gmail.com:465`, the selected school account, sender name `FreelanceHub`,
  and a stored hidden password. No SMTP secret has been placed in source.
  Saved configuration alone does not prove delivery. Real email delivery, the owner
  login-email change and external signup-to-approval verification are still pending.
- Published the frontend from commit `dfa13fc` through `npm run deploy`; the full test
  run passed 117 checks/scenarios and all 13 live public assets matched the upload.
  Deployment: `https://9ba0ec0a.natthawit-studio.pages.dev`, production hostname
  `https://natthawit-studio.pages.dev/`. Browser verification confirmed the signup
  button, editable signup form and email-confirmation/approval instructions. No signup
  was submitted and no email was sent during that UI check.
