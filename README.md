# Open Chet

Business messaging MVP built with Next.js, React, TypeScript, Supabase and the official WhatsApp Cloud API. This repository preserves the existing implementation from the interrupted development session.

## Implemented

- Responsive team inbox, conversation filters and search, message composer, internal notes and contact details.
- Contact CRM, configurable tags, CSV import preview and duplicate detection.
- AI on/pause, human takeover, resume AI, automatic pause on human reply and agent assignment.
- Templates, quick replies, catalogue, basic campaigns, analytics and settings screens.
- Explicit device-local demo mode; demo messages never reach WhatsApp.
- Supabase email/password authentication and workspace creation architecture.
- Organization-scoped server operations, role checks, normalized migration and read-only client RLS policies.
- Signed WhatsApp webhook ingestion, message deduplication, delivery-status processing, media and template service integration.
- Database-backed outbound queue and AI worker, version checks to invalidate stale AI responses.
- PWA manifest, icons and a service worker that does not cache customer records.

## Local development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. With no Supabase public configuration, the app opens in local demo mode. `/login` provides sign-in when Supabase is configured. `/?demo=1` explicitly opens demo mode.

## Live integration setup

Copy `.env.example` to `.env.local` and configure its documented values. Never commit credentials.

1. Use a dedicated Supabase project and apply `supabase/migrations/20260916044512_initial_open_chet.sql` through your normal migration workflow. The migration expects Supabase's `auth` and `storage` schemas. It creates a private media bucket and enables Realtime for messages, conversations, notes and notifications when the publication exists.
2. Set the Supabase public URL and publishable key, server-only service-role key and TLS PostgreSQL transaction-pooler `DATABASE_URL`. Configure email/password authentication and your application's allowed auth URLs.
3. Sign up, confirm your email if required, sign in and create a workspace. Record its organization ID for `WHATSAPP_ORGANIZATION_ID`.
4. Configure your official Meta business account, phone-number ID, business-account ID, access token, app secret, supported Graph API version and a random webhook verification token.
5. Register the HTTPS endpoint `/api/webhooks/whatsapp` with Meta. Subscribe to message and relevant template-status events. Sync approved templates from the Templates screen.
6. Configure an OpenAI-compatible AI provider using `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`. Enable AI in workspace settings only when ready.
7. Set a long random `CRON_SECRET`. A trusted scheduler must invoke `GET /api/worker` with `Authorization: Bearer <CRON_SECRET>`. No scheduler is enabled by this checkpoint. Choose frequency and execution limits appropriate to your deployment.

For Vercel, import this repository as a Next.js project and configure the environment variables in the deployment settings. Configure the worker scheduler separately. No production deployment or live account was created in this session.

## Architecture

- `components/workspace.tsx`: application screens and demo/live UI routing.
- `lib/demo.ts`: device-local development data and actions.
- `app/api/bootstrap`: authenticated workspace creation and reads.
- `app/api/action`: authenticated, role-checked mutations.
- `app/api/webhooks/whatsapp`: signature validation and durable inbound ingestion.
- `app/api/media`: authenticated media upload/download.
- `services/whatsapp.service.ts`: official Meta API calls.
- `services/ai.service.ts`: provider abstraction and structured output validation.
- `services/worker.ts`: campaign materialization, AI generation and outbound dispatch.
- `supabase/migrations`: tenant-scoped schema, constraints, indexes and RLS.

The initial deployment maps one WhatsApp account to one organization using server environment variables. The data model supports multiple organizations, but self-service multi-account onboarding is not implemented. Agents share their organization's inbox; manager/admin actions are restricted separately. Direct client writes are revoked.

Takeover invalidates pending AI work through conversation versions and serialization. An HTTP request already dispatched to Meta cannot be recalled. Uncertain outbound outcomes are marked `unknown` rather than blindly retried, avoiding duplicate messages.

## Verification of this checkpoint

The following commands passed after recovering the existing workspace:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

19 automated tests passed across domain/demo behavior and PostgreSQL migration/RLS tests. Migration tests use PGlite with local stubs for Supabase-owned schemas, not a live Supabase project.

Desktop/mobile browser interaction verification was interrupted and remains outstanding. Passing compilation and unit tests does not establish live integration or production readiness.

## Remaining work and limitations

- Live Supabase authentication, Realtime, Meta message delivery, storage and AI provider end-to-end verification require configured accounts and credentials.
- Browser interaction testing, broader integration/race tests and production hardening remain necessary before real customer use.
- Live media currently relies on Meta media identifiers for retrieval; durable incoming-media archival needs completion. Demo blob attachments are session-only.
- The current template composer supports body variables, not media headers or buttons.
- Web push has service-worker scaffolding; VAPID subscriptions and delivery are not implemented.
- Business hours are supplied as AI context, not enforced as a scheduling policy.
- Basic search/analytics include loaded records; complete server-side search, aggregate analytics, advanced segmentation and scalable pagination need expansion.
- Rate limiting, production monitoring, retention controls, account recovery and scalable queue scheduling require further work.
- Do not treat demo template statuses or simulated campaigns as Meta approval or actual delivery.

This is a preserved, buildable MVP checkpoint, not a claim that every requested production feature has been completed or verified.
