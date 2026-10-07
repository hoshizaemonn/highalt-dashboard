Plan/role regression tests

node scripts/tests/plan-contracts.mjs
  No database. Validates all 35 allowed plans, normalization, exclusions,
  inactive rows, zero matches, historical/store isolation and suspension handling.

node scripts/tests/roles-http.mjs
  Integration test strictly bound to http://127.0.0.1:3108 and local PostgreSQL
  127.0.0.1:55437/pl_roles. Never run against production.
  Requires the synthetic fixture documented below and the built application started
  with DATABASE_URL=postgresql://<local-user>@127.0.0.1:55437/pl_roles,
  SESSION_SECRET=pl-local-roles-test-only. The app DB adapter uses SSL.
  The test client uses local PostgreSQL user hoshizaki.

Fixture:
- Empty local DB populated from prisma/schema.prisma, no production migration/data.
- Users: test-admin (admin), test-manager (manager), test-store (store_manager/巣鴨),
  test-multi (store_manager/巣鴨,船橋), test-unassigned (store_manager/no store).
- Each of 巣鴨/船橋/下北沢: MA002 2026/9=10 subscribers, 2026/8=20,
  suspensions=2 in each month.
- Each store has six ML001 rows in 2026/9:
  デイ会員 active, デイＳ会員 active, 対象外テストプラン active, 休会 inactive,
  ★ペア　デイ会員 active, デイ会員 inactive.
- Test temporarily downgrades test-manager and restores it in finally to check
  that an existing legacy cookie obeys the latest DB permissions.

Expected: 189 HTTP assertions, including 37 mutation handlers x 4 read-only scopes;
no write request from manager/store roles reaches the mutation handler.
