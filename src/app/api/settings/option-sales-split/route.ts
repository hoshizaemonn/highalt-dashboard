import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { STORES } from "@/lib/constants";
import { memoCacheDeletePrefix } from "@/lib/memo-cache";
import {
  OPTION_SPLIT_CACHE_PREFIX,
  OPTION_SPLIT_MIN_START,
  loadUnsplittableCounts,
} from "@/lib/option-sales-split-loader";
import {
  normalizeForMatch,
  parseTargetsJson,
  validateTargets,
  type SplitTarget,
} from "@/lib/option-sales-split";

// オプション売上の店舗按分ルール（星崎さん指示 2026-10-02 / 何件でも追加・編集・無効化・削除できる形に 2026-10-04）。
// 変更はシステム管理者（DB上の生ロール rawRole === "admin"）のみ。
// 按分は金額に直結するため、マネージャー（rawRole=manager）は閲覧も不可。

// 按分の結果を含む画面キャッシュ（保存時に即時失効させる）
const SPLIT_AFFECTED_CACHE_PREFIXES = ["dashboard:", "annual:", "storeCompare:"];
const MAX_RULES = 50;
const MIN_NAME_LENGTH = 3; // 正規化後の最小文字数（短すぎる名前は他の商品まで拾うため）

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.rawRole !== "admin") return null;
  return session;
}

function invalidateCaches() {
  for (const p of [OPTION_SPLIT_CACHE_PREFIX, ...SPLIT_AFFECTED_CACHE_PREFIXES]) memoCacheDeletePrefix(p);
}

interface RuleInput {
  matchName: string;
  targets: SplitTarget[];
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
}

/** 入力の検証と正規化。問題があれば { error } を返す */
function parseInput(body: unknown): { value: RuleInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const matchName = typeof b.matchName === "string" ? b.matchName.trim() : "";
  if (matchName.length > 100 || /[\u0000-\u001f]/.test(matchName)) {
    return { error: "商品名は100文字以内で、改行などを含めないでください" };
  }
  if (normalizeForMatch(matchName).length < MIN_NAME_LENGTH) {
    return { error: `商品名を${MIN_NAME_LENGTH}文字以上で入力してください（短すぎると他の商品まで按分されます）` };
  }
  const rawTargets = Array.isArray(b.targets) ? b.targets : [];
  const targets: SplitTarget[] = rawTargets.map((t) => {
    const x = (t ?? {}) as Record<string, unknown>;
    return { store: typeof x.store === "string" ? x.store.trim() : "", ratio: Number(x.ratio) };
  });
  for (const t of targets) {
    if (t.store && !(STORES as readonly string[]).includes(t.store)) return { error: `按分先の店舗が不正です（${t.store}）` };
  }
  if (targets.length > 7) return { error: "按分先は7店舗までです" };
  const tErr = validateTargets(targets);
  if (tErr) return { error: tErr };

  const sy = b.startYear == null || b.startYear === "" ? null : Number(b.startYear);
  const sm = b.startMonth == null || b.startMonth === "" ? null : Number(b.startMonth);
  if ((sy == null) !== (sm == null)) return { error: "開始年月は年と月の両方を指定してください" };
  if (sy != null && sm != null) {
    if (!Number.isInteger(sy) || !Number.isInteger(sm) || sm < 1 || sm > 12) return { error: "開始年月が不正です" };
    if (sy * 12 + sm < OPTION_SPLIT_MIN_START.year * 12 + OPTION_SPLIT_MIN_START.month) {
      return {
        error: `開始年月は${OPTION_SPLIT_MIN_START.year}年${OPTION_SPLIT_MIN_START.month}月以降を指定してください（それ以前の実績は変更しない仕様です）`,
      };
    }
  }
  const enabled = b.enabled === true;
  if (enabled && (sy == null || sm == null)) return { error: "有効にするには開始年月の指定が必要です" };
  return { value: { matchName, targets, startYear: sy, startMonth: sm, enabled } };
}

function toRow(v: RuleInput, updatedByName: string | null) {
  return {
    matchName: v.matchName,
    targets: JSON.stringify(v.targets),
    // 旧コードとの互換: 先頭の按分先を写しておく
    targetStore: v.targets[0].store,
    ratioPercent: v.targets[0].ratio,
    startYear: v.startYear,
    startMonth: v.startMonth,
    enabled: v.enabled,
    updatedByName,
  };
}

function toApi(r: {
  id: number;
  productCode: string;
  matchName: string | null;
  targets: string | null;
  targetStore: string;
  ratioPercent: number;
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
  updatedByName: string | null;
}) {
  const t = parseTargetsJson(r.targets);
  return {
    id: r.id,
    matchName: r.matchName ?? "",
    // 旧形式の行（targets が無い）は、1件の按分先として返す
    targets: t && t.length ? t : r.targetStore ? [{ store: r.targetStore, ratio: r.ratioPercent }] : [],
    startYear: r.startYear,
    startMonth: r.startMonth,
    enabled: r.enabled,
    updatedByName: r.updatedByName,
    // 旧形式（商品名が空で hacomono の商品コードで照合）
    legacyCode: !r.matchName ? r.productCode : null,
  };
}

/** 同じ商品名（正規化後）のルールが既にあるか */
async function duplicateName(name: string, exceptId: number | null): Promise<boolean> {
  const all = await prisma.optionSalesSplitRule.findMany({ select: { id: true, matchName: true } });
  const n = normalizeForMatch(name);
  return all.some((r) => r.id !== exceptId && r.matchName && normalizeForMatch(r.matchName) === n);
}

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const [rules, unsplittable] = await Promise.all([
      prisma.optionSalesSplitRule.findMany({ orderBy: { id: "asc" } }),
      loadUnsplittableCounts(),
    ]);
    return NextResponse.json({
      rules: rules.map(toApi),
      stores: [...STORES],
      minStart: OPTION_SPLIT_MIN_START,
      maxRules: MAX_RULES,
      // 1行に複数商品がまとまっていて按分できなかった売上明細の件数（年月×店舗）
      unsplittable,
    });
  } catch (error) {
    logError("OptionSalesSplit GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** ルールの追加 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = parseInput(await request.json());
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if ((await prisma.optionSalesSplitRule.count()) >= MAX_RULES) {
      return NextResponse.json({ error: `ルールは${MAX_RULES}件までです` }, { status: 400 });
    }
    if (await duplicateName(parsed.value.matchName, null)) {
      return NextResponse.json({ error: "同じ商品名のルールが既にあります（編集してください）" }, { status: 409 });
    }
    // ルールの識別子は自動採番（商品コードの列を流用。コード変更なしで何件でも追加できる）
    const productCode = `R-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const saved = await prisma.optionSalesSplitRule.create({
      data: { productCode, ...toRow(parsed.value, session.displayName ?? null) },
    });
    invalidateCaches();
    return NextResponse.json({ success: true, rule: toApi(saved) }, { status: 201 });
  } catch (error) {
    logError("OptionSalesSplit POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** ルールの編集（有効/無効の切り替えを含む） */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
    const parsed = parseInput(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const existing = await prisma.optionSalesSplitRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "ルールが見つかりません" }, { status: 404 });
    if (await duplicateName(parsed.value.matchName, id)) {
      return NextResponse.json({ error: "同じ商品名のルールが既にあります" }, { status: 409 });
    }
    const saved = await prisma.optionSalesSplitRule.update({
      where: { id },
      data: toRow(parsed.value, session.displayName ?? null),
    });
    invalidateCaches();
    return NextResponse.json({ success: true, rule: toApi(saved) });
  } catch (error) {
    logError("OptionSalesSplit PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** ルールの削除（このルールだけ。売上明細などのデータは変更しない。集計は元の数値に戻る） */
export async function DELETE(request: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id が必要です" }, { status: 400 });
    const r = await prisma.optionSalesSplitRule.deleteMany({ where: { id } });
    if (r.count === 0) return NextResponse.json({ error: "ルールが見つかりません" }, { status: 404 });
    invalidateCaches();
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("OptionSalesSplit DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
