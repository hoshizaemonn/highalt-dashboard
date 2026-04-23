# 本番データ保全ルール（必読）

> **このリポジトリの本番 DB には、既にクライアント運用データが入っています。**
> 開発・改修を行う前に必ず本ドキュメントを読んでください。

## 本番 DB の現況（2026-04-23 時点）

| 期 | 期間 | 保有データ |
|---|---|---|
| **8期** | 2024-10 〜 2025-09 | 東日本橋ほか、過去1年分の実績を投入済み |
| **9期** | 2025-10 〜 2026-09 | 運用中（毎月更新） |

**消失すると再取得に時間がかかるため、以下のルールを厳守してください。**

## 絶対にやってはいけない操作

### 1. Prisma の強制リセット系

```bash
# ❌ 絶対に実行しない
npx prisma db push --force-reset
npx prisma migrate reset
npx prisma db push --accept-data-loss   # スキーマ変更が破壊的な場合
```

Vercel 本番の `DATABASE_URL` が設定された環境でこれらを実行すると、**全テーブルが drop され 8期・9期の全データが消失**します。

### 2. Supabase ダッシュボード直打ち SQL

`TRUNCATE`, `DROP TABLE`, `DELETE FROM xxx WHERE ...`（スコープなし）は禁止。

必要な場合は事前に `pg_dump` でバックアップを取得してから。

### 3. 空 CSV のアップロード

- ML001 / PL001 / MA002 / 予算 / 経費 / 人件費 いずれもアップロード時に対象スコープの既存レコードを `deleteMany` → 新規 `createMany` する仕様
- 誤って **空ファイル or 1行だけのテストファイル** をアップロードすると、その店舗・年月のデータが消えるリスクがある
- PR #9 で上書き警告が追加されているので、警告ダイアログが出たら中身を必ず確認してから「はい」を押す

## 安全にスキーマ変更する手順

1. ローカルで `prisma/schema.prisma` を編集
2. **マイグレーションを作成**（`db push` ではなく `migrate dev`）

   ```bash
   npx prisma migrate dev --name <変更内容>
   ```

3. 生成された `prisma/migrations/*/migration.sql` を開いて **破壊的 SQL（DROP / ALTER ... DROP / TRUNCATE）が含まれていないか確認**
4. 破壊的な場合は、データ移行 SQL を手動で追記する（既存レコードを保持するように UPDATE / INSERT を挟む）
5. PR → レビュー → マージ → 本番適用は `npx prisma migrate deploy`（`db push` は使わない）

破壊的マイグレーションを本番適用する前に、**必ず Supabase のダッシュボードから DB バックアップ（PITR または手動スナップショット）を取得**してください。

## アップロード API の削除スコープ（参考）

| API | deleteMany スコープ | 備考 |
|---|---|---|
| `/api/upload/hacomono?type=ml001` | `storeName` | 店舗全体の会員データ差し替え |
| `/api/upload/hacomono?type=pl001` | `year, month, storeName` | 月・店舗単位 |
| `/api/upload/hacomono?type=ma002` | `year, month, storeName` (各行ごと) | 対象月・店舗単位 |
| `/api/upload/budget` | `year, storeName`（`客単価` を除く） | 年度・店舗単位。客単価予算は別 API で保持 |
| `/api/upload/payroll` | `year, month` | ⚠️ 店舗横断で月単位。全店舗分一括の CSV 前提 |
| `/api/upload/expense` | `year, month, storeName` | 月・店舗単位 |
| `/api/budget/unit-price` | `category="客単価", storeName, year` | 年度・店舗単位、全12ヶ月に一括適用 |

PR #9 で ML001 / PL001 / MA002 / 客単価予算の上書き前に確認ダイアログが出るようになっています。

## バックアップ方針

- Supabase の Point-in-Time Recovery（PITR）を有効化しておく
- 重要な変更（スキーマ変更・大量投入）前に、Supabase Dashboard から手動スナップショット取得

## 困ったら

- **データ欠損が疑われる場合**、Supabase Dashboard → Backups から PITR で復旧可能
- スキーマ変更で迷ったら、**この DATA_SAFETY.md を確認してから**手を動かす
