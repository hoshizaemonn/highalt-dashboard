// 人件費（payroll_data）の「会社負担8項目」を、クラウド給与の支給控除一覧表CSVから取り直す。
//
// 既定は dry-run（SELECT だけ。セッションを読み取り専用にして接続する）。--apply を付けない限り書き込まない。
// 再取込（deleteMany→createMany）はしない。会社負担8項目だけを「行IDで UPDATE」するので、
// 店舗割当・按分率（兼務）・月別調整（payroll_monthly_split）・基本給・総支給は構造的に変わらない。
//
// 実行（dry-run）:
//   DATABASE_URL=... node --experimental-strip-types scripts/payroll-recompute-company.ts \
//     --csv-dir ~/Backups/highalt-dashboard-payroll/<日時> --months 2026-01..2026-08
//   CSV は <csv-dir>/pay_YYYYMM.csv（YYYYMM＝クラウド給与の「支給月」）。
//   ダッシュボードの N 月 ← 支給 N+1 月（--offset 1 が既定・勤務月計上）。
// 適用（フェーズB・鈴木さん承認後のみ）:
//   上記に --apply --backup-dir ~/Backups/highalt-dashboard/<日時> を足す。
//   backup-dir に payroll_data.csv があり、行数が現在の表と一致しないと適用しない。
//
// 出力は集計のみ（月×項目の差額・人数）。氏名・個別金額は出さない。DATABASE_URL は表示しない。

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { PAYROLL_COMPANY_FIELDS, planCompanyColumnCorrection } from "../src/lib/payroll-ingest.ts";
// @ts-expect-error 同上（.ts 拡張子の import）
import { decodeFileBuffer, parseCSV, safeFloat } from "../src/lib/csv-utils.ts";

type Field = (typeof PAYROLL_COMPANY_FIELDS)[number];

const COLUMN: Record<Field, string> = {
  healthInsuranceCo: "health_insurance_co",
  careInsuranceCo: "care_insurance_co",
  pensionCo: "pension_co",
  childContributionCo: "child_contribution_co",
  pensionFundCo: "pension_fund_co",
  employmentInsuranceCo: "employment_insurance_co",
  workersCompCo: "workers_comp_co",
  generalContributionCo: "general_contribution_co",
};

/** 暫定コピーで据え置く月。このスクリプトは絶対に触らない（松尾さん承認 2026-10-28） */
const FROZEN_FROM = { year: 2026, month: 9 };

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const expand = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

function parseMonths(spec: string): Array<{ year: number; month: number }> {
  const m = /^(\d{4})-(\d{2})\.\.(\d{4})-(\d{2})$/.exec(spec);
  if (!m) throw new Error("--months は 2026-01..2026-08 の形式");
  const out: Array<{ year: number; month: number }> = [];
  let y = +m[1], mo = +m[2];
  while (y < +m[3] || (y === +m[3] && mo <= +m[4])) {
    out.push({ year: y, month: mo });
    mo++;
    if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

const yen = (n: number) => (n >= 0 ? "+" : "") + Math.round(n).toLocaleString("en-US");

async function main() {
  const apply = flag("apply");
  const csvDir = expand(arg("csv-dir", "") ?? "");
  const offset = parseInt(arg("offset", "1") ?? "1", 10);
  const months = parseMonths(arg("months", "") ?? "");
  const url = process.env.DATABASE_URL;
  if (!url || !csvDir) throw new Error("DATABASE_URL（環境変数）と --csv-dir が必要");
  for (const t of months) {
    if (t.year * 12 + t.month >= FROZEN_FROM.year * 12 + FROZEN_FROM.month) {
      throw new Error(`${t.year}-${t.month} は据え置きの月（9月以降）。対象に含められない`);
    }
  }

  const backupDir = arg("backup-dir") ? expand(arg("backup-dir")!) : null;
  // 接続の作法は src/lib/prisma.ts と同じ（sslmode を URL から外し ssl オプションに一本化。Supabase の証明書はチェーン検証できない）。
  // セッション単位で読み取り専用にするため、transaction pooler(6543) ではなく session で繋ぐ（URL のポートをそのまま使う）。
  const u = new URL(url);
  for (const k of ["sslmode", "pgbouncer", "connection_limit"]) u.searchParams.delete(k);
  const client = new pg.Client({ connectionString: u.toString(), ssl: /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    // 適用しないときはセッションごと読み取り専用にする（書き込み文は DB が拒否する）
    if (!apply) await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");

    if (apply) {
      if (!backupDir) throw new Error("--apply には --backup-dir（\\copy 済みのバックアップ）が必要");
      const bf = join(backupDir, "payroll_data.csv");
      if (!existsSync(bf)) throw new Error("backup-dir に payroll_data.csv が無い");
      const lines = readFileSync(bf, "utf8").split("\n").filter((l) => l.length > 0).length - 1; // 見出し分
      const { rows } = await client.query("select count(*)::int as n from payroll_data");
      if (lines !== rows[0].n) throw new Error(`バックアップ行数(${lines})が現在の表(${rows[0].n})と違う`);
    }

    const results: Array<{ year: number; month: number; plan: ReturnType<typeof planCompanyColumnCorrection> }> = [];
    for (const t of months) {
      const pay = new Date(Date.UTC(t.year, t.month - 1 + offset, 1));
      const ym = `${pay.getUTCFullYear()}${String(pay.getUTCMonth() + 1).padStart(2, "0")}`;
      const file = join(csvDir, `pay_${ym}.csv`);
      if (!existsSync(file)) throw new Error(`CSV が無い: pay_${ym}.csv`);
      const buf = readFileSync(file);
      const allRows: string[][] = parseCSV(decodeFileBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "shift_jis"));
      const { rows } = await client.query(
        `select id, employee_id, ratio, base_salary, gross_total, ${PAYROLL_COMPANY_FIELDS.map((f: Field) => COLUMN[f] + ` as "${f}"`).join(", ")}
           from payroll_data where year = $1 and month = $2 order by id`,
        [t.year, t.month],
      );
      const existing: Parameters<typeof planCompanyColumnCorrection>[1] = rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id), employeeId: String(r.employee_id), ratio: Number(r.ratio),
        baseSalary: Number(r.base_salary), grossTotal: Number(r.gross_total),
        ...(Object.fromEntries(PAYROLL_COMPANY_FIELDS.map((f: Field) => [f, Number(r[f])])) as Record<Field, number>),
      }));
      results.push({ ...t, plan: planCompanyColumnCorrection(allRows, existing, safeFloat) });
    }

    // ── 集計の表示（氏名・個別金額なし）
    console.log(`モード: ${apply ? "APPLY（書き込み）" : "dry-run（読み取り専用）"} / offset=${offset}`);
    const grand = Object.fromEntries(PAYROLL_COMPANY_FIELDS.map((f: Field) => [f, 0])) as Record<Field, number>;
    for (const { year, month, plan } of results) {
      console.log(
        `\n${year}-${String(month).padStart(2, "0")}  DB ${plan.dbRows}行/${plan.dbEmployees}名  変わる ${plan.changedRows}行/${plan.changedEmployees}名` +
          `  CSVのみ(参考) ${plan.csvOnlyEmployees}名  除外(役員) ${plan.excludedCount}名`,
      );
      console.log("  " + PAYROLL_COMPANY_FIELDS.map((f: Field) => `${f.replace(/Co$/, "")}:${yen(plan.diffByField[f])}(${plan.changedEmployeesByField[f]}名)`).join("  "));
      console.log(`  法定福利費の増減(ratio按分後): ${yen(plan.diffTotal)}円/月`);
      if (plan.blockers.length) console.log("  BLOCK: " + plan.blockers.join(" / "));
      for (const f of PAYROLL_COMPANY_FIELDS as readonly Field[]) grand[f] += plan.diffByField[f];
    }
    const total = (Object.values(grand) as number[]).reduce((a, b) => a + b, 0);
    console.log(`\n合計(全月): ` + PAYROLL_COMPANY_FIELDS.map((f: Field) => `${f.replace(/Co$/, "")}:${yen(grand[f])}`).join("  ") + `  → ${yen(total)}円`);

    const blocked = results.filter((r) => r.plan.blockers.length > 0);
    if (!apply) {
      console.log(blocked.length ? `\n適用不可の月あり（${blocked.length}か月）` : "\n適用可（全月ブロックなし）。dry-run のため書き込みなし。");
      return;
    }
    if (blocked.length) throw new Error("ブロック理由がある月があるため適用しない");

    // ── 適用: 1トランザクション・行IDで会社負担8項目だけ UPDATE。検算してから COMMIT
    await client.query("BEGIN");
    try {
      const before = await client.query(
        "select count(*)::int n, coalesce(sum(round((base_salary * ratio)::numeric, 2)),0)::text b, coalesce(sum(round((gross_total * ratio)::numeric, 2)),0)::text g, count(distinct (year, month, employee_id, store_name))::int k from payroll_data",
      );
      let updated = 0;
      for (const { plan } of results) {
        for (const u of plan.updates) {
          const vals = PAYROLL_COMPANY_FIELDS.map((f: Field) => u.values[f]);
          const set = PAYROLL_COMPANY_FIELDS.map((f: Field, i: number) => `${COLUMN[f]} = $${i + 2}`).join(", ");
          const r = await client.query(`update payroll_data set ${set} where id = $1`, [u.id, ...vals]);
          updated += r.rowCount ?? 0;
        }
      }
      const expectedRows = results.reduce((a, r) => a + r.plan.changedRows, 0);
      const after = await client.query(
        "select count(*)::int n, coalesce(sum(round((base_salary * ratio)::numeric, 2)),0)::text b, coalesce(sum(round((gross_total * ratio)::numeric, 2)),0)::text g, count(distinct (year, month, employee_id, store_name))::int k from payroll_data",
      );
      const same = before.rows[0].n === after.rows[0].n && before.rows[0].k === after.rows[0].k &&
        before.rows[0].b === after.rows[0].b && before.rows[0].g === after.rows[0].g;
      if (updated !== expectedRows || !same) throw new Error(`検算NG（更新${updated}/予定${expectedRows}・行数/基本給/総支給の不変=${same}）→ ROLLBACK`);
      await client.query("COMMIT");
      console.log(`\nCOMMIT: ${updated}行を更新（行数・基本給・総支給は不変を確認）`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
