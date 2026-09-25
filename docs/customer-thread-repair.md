# Customer thread repair

The inbox identity is `(organization_id, normalized contact phone)`. Model B
retains account conversations as subthreads and projects them through the
security-invoker `customer_threads` view. Its stable ID is the contact ID.
Never merge by name, remove a country code, or guess an unknown legacy route.

## Production evidence, 2026-09-25

Before repair: 8 contacts, 10 account conversations, 196 messages. Two contacts
had two account conversations each. No duplicate normalized contact phones,
duplicate Meta message IDs, or NULL-account conversations were found. A second
similarly named contact had a different phone and must stay separate.

Migration `20260925122622_customer_threads.sql` preserves physical IDs and all
foreign keys. It backfills message account/phone-number snapshots using their
existing conversation, adds the logical view, route/identity guards, shared
transactional ingestion, clear markers, and private durable n8n handoff records.
It is rerunnable; tests exercise historical data and all migrations.

After applying it to production: 8 logical threads, 10 preserved subthreads,
196 routed messages. Original-column checksums for messages, conversations,
contacts and notifications remained identical. No historical rows were deleted.

## Behaviour

- Meta and n8n share transaction-level locks, contact/account uniqueness and the
  global Meta ID constraint. Duplicate events cannot increment unread twice.
- Latest inbound chooses the default reply route. Explicit selection pins that
  account. A disabled route is rejected, never silently replaced with another.
- History, read, assignment, clear and takeover operate on the customer thread.
  Existing modes and assignments remain on their original subthreads until an
  explicit action changes them. Clear hides history while retaining audit and
  Meta replay protection; it is not a permanent erasure operation.
- API pagination uses timestamp plus UUID, preserving database microseconds.
  Realtime invalidates serialized snapshots; replay/reconnect/focus refreshes
  use the same database projection. Contacts are also published to Realtime.
- Dispatch is claimed and committed before network I/O. Unknown send outcomes
  are not retried automatically. An external workflow still needs its own
  per-event deduplication and final human-mode/version check before Meta send.

## Verification

Run `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
and `npm run test:e2e`. Playwright covers desktop and mobile. Set
`BROWSER_EXECUTABLE_PATH` when using a locally installed Chromium browser.

Set `TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:55432/postgres` to include
the actual PostgreSQL handler/concurrency tests. The harness refuses nonlocal
hosts, creates a uniquely named `open_chet_test_*` database, runs migrations and
fixtures, and drops only that test database afterward. Without this variable,
those tests are explicitly skipped; PGlite tests are not a substitute for
independent PostgreSQL connections. Actual Meta sends are mocked in tests.

Read-only production checks:

```sql
select organization_id, count(*) from customer_threads group by organization_id;
select organization_id, contact_id, count(*) from conversations
group by organization_id, contact_id having count(*) > 1;
select meta_message_id, count(*) from messages where meta_message_id is not null
group by meta_message_id having count(*) > 1;
select status, count(*) from n8n_deliveries group by status;
select m.phone_number_id, e.error_code, count(*)
from message_status_events e join messages m on m.meta_message_id=e.meta_message_id
and m.organization_id=e.organization_id where e.status='failed'
group by m.phone_number_id,e.error_code;
```

Production had 28 failed outgoing messages on the new business number with
Meta code 131031. Its live Meta health later reported AVAILABLE / VERIFIED /
GREEN. This is evidence of historical delivery failures, not proof of a current
account lock or successful delivery. Confirm with an authorized test recipient
and inspect the matching n8n execution, route, credentials and Meta receipt.

## Deployment and recovery

Apply the additive migration before deploying the application commit. Keep
the migration if rolling back application code: the old app remains compatible,
but its duplicate-row behaviour returns. Do not drop new columns, delete
subthreads or resend unknown-outcome messages as a rollback step.

The private `n8n_deliveries` table intentionally has no browser RLS policy.
Only the server role may access its payload. The Supabase advisor's corresponding
INFO is expected; do not add public policies to silence it.
