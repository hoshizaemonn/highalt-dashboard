# Agent Rules for highalt-dashboard

## ⚠️ 本番データ保全（最優先・必読）

**このリポジトリの本番 DB には、クライアント（ハイアルチ）の 8期（2024/10〜2025/9）および 9期（2025/10〜2026/9）の運用データが入っています。**

コードを書く前に、必ず [`DATA_SAFETY.md`](./DATA_SAFETY.md) を読んでください。要点：

- `npx prisma db push --force-reset` / `prisma migrate reset` / `prisma db push --accept-data-loss` は**絶対に実行しない**（本番データが全消失します）
- スキーマ変更は `prisma migrate dev --name <変更内容>` でマイグレーションを生成し、破壊的 SQL が含まれていないか確認してから PR に含める
- アップロード API の `deleteMany` はすべてスコープ付き（店舗・年月単位）で実装する。スコープなしの削除を追加しない
- 新しい削除系 API を追加する場合は、上書き確認 UI（`OverwriteWarning` コンポーネント）を必ず併せて実装する

## Next.js

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
