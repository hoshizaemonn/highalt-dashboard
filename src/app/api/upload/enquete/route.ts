import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  decodeFileBuffer,
  parseCSV,
  buildHeaderMap,
  getCell,
  parseDateLoose,
} from "@/lib/csv-utils";

/**
 * hacomono アンケート回答 (enquete_answer) CSV を取り込む。
 *
 * - 入会・体験アンケートを想定（退会アンケートは取り込まない）
 * - CSV ヘッダから「認知経路」「目的」「頻度」3カテゴリを動的検出して正規化
 *   - 認知経路: 「知ったきっかけ」を含む列
 *   - 目的:     「達成したい」「来店の目的」を含む列
 *   - 頻度:     「体を動かす頻度」を含む列
 * - 各カテゴリは複数選択をカンマ区切りで保持
 * - 同じ enqueteCode + memberId のレコードは最新で上書き（複数CSVを順に上げてもOK）
 *
 * 権限: admin のみ
 */

// アンケート名やスタジオ選択列から店舗名を推定
const STORE_KEYWORDS: Record<string, string> = {
  東日本橋: "東日本橋",
  春日: "春日",
  船橋: "船橋",
  巣鴨: "巣鴨",
  祖師ヶ谷大蔵: "祖師ヶ谷大蔵",
  下北沢: "下北沢",
  中目黒: "中目黒",
  東陽町: "東陽町",
  東洋町: "東陽町",
  日本橋: "東日本橋",
  春日町: "春日",
};

function detectStoreFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const k of Object.keys(STORE_KEYWORDS)) {
    if (text.includes(k)) return STORE_KEYWORDS[k];
  }
  return null;
}

// 退会アンケート判定（取り込みスキップ）
function isWithdrawEnquete(code: string, name: string, scene: string): boolean {
  const merged = `${code} ${name} ${scene}`;
  return /退会|WITHDRAW/i.test(merged);
}

interface Header {
  index: number;
  name: string;
}

interface CategorizedColumns {
  awareness: Header[]; // 認知経路
  purposes: Header[]; // 目的
  frequency: Header[]; // 頻度
  storeSelect?: Header; // ご入会されるスタジオを選択
}

function categorizeColumns(headers: string[]): CategorizedColumns {
  const out: CategorizedColumns = {
    awareness: [],
    purposes: [],
    frequency: [],
  };
  headers.forEach((h, i) => {
    if (!h) return;
    // 認知経路: 「知ったきっかけ」または「ご来店のきっかけ」
    if (/知ったきっかけ|来店のきっかけ|認知経路/.test(h)) {
      out.awareness.push({ index: i, name: h });
      return;
    }
    // 目的: 「達成したい」「来店の目的」
    if (/達成したい|来店の目的|ご来店の目的/.test(h)) {
      out.purposes.push({ index: i, name: h });
      return;
    }
    // 頻度: 「体を動かす頻度」「運動頻度」
    if (/体を動かす頻度|運動頻度/.test(h)) {
      out.frequency.push({ index: i, name: h });
      return;
    }
    // スタジオ選択
    if (/(入会されるスタジオ|スタジオを選択|店舗.*選択)/.test(h)) {
      out.storeSelect = { index: i, name: h };
    }
  });
  return out;
}

// 列名から「選択肢のラベル」を抽出する。
// 形式: "質問文_選択肢" の場合は「選択肢」を返す。アンダースコアが無ければ列名そのまま。
function extractChoice(columnName: string): string {
  const lastUnderscore = columnName.lastIndexOf("_");
  if (lastUnderscore < 0) return columnName.trim();
  return columnName.slice(lastUnderscore + 1).trim();
}

// セル値が「該当する」を意味するかどうか
function isTruthyCell(v: string): boolean {
  if (!v) return false;
  const s = v.trim();
  if (!s) return false;
  // hacomono は通常 "選択肢ラベル" がそのまま入る or "1" / "true" / "○"
  if (s === "0" || s === "false" || s === "FALSE" || s === "✕" || s === "×")
    return false;
  return true;
}

// 認知経路のラベル統一マッピング
function normalizeAwareness(label: string): string {
  if (/Google|Yahoo|検索|WEB/.test(label)) return "Web検索";
  if (/SNS投稿/.test(label)) return "ハイアルチSNS投稿";
  if (/SNS広告/.test(label)) return "ハイアルチSNS広告";
  if (/Instagram|Facebook/.test(label)) return "SNS（Instagram/Facebook）";
  if (/Youtube/i.test(label)) return "YouTube";
  if (/紹介/.test(label)) return "紹介";
  if (/チラシ|看板|ポスト|駅前配布/.test(label)) return "チラシ・看板";
  if (/口コミ|評価/.test(label)) return "Web口コミ・評価";
  if (/移籍/.test(label)) return "移籍";
  if (/電柱/.test(label)) return "電柱広告";
  if (/イベント/.test(label)) return "外部イベント";
  if (/ビジョン/.test(label)) return "駅前大型ビジョン広告";
  if (/TEAM/.test(label)) return "TEAMハイアルチ";
  if (/その他/.test(label)) return "その他";
  return label;
}

// 目的のラベル統一マッピング
function normalizePurpose(label: string): string {
  if (/ダイエット|減量/.test(label)) return "ダイエット";
  if (/ボディメイク/.test(label)) return "ボディメイク";
  if (/健康/.test(label)) return "健康維持";
  if (/体力|筋力|パフォーマンス/.test(label)) return "体力・パフォーマンス向上";
  if (/アンチエイジング/.test(label)) return "アンチエイジング";
  if (/血糖値/.test(label)) return "血糖値コントロール";
  if (/疲れ/.test(label)) return "疲れにくい身体";
  if (/睡眠/.test(label)) return "睡眠の質改善";
  if (/登山/.test(label)) return "登山の準備";
  if (/心肺/.test(label)) return "心肺機能向上";
  if (/運動不足/.test(label)) return "運動不足解消";
  if (/タイム/.test(label)) return "タイム向上";
  if (/競技/.test(label)) return "競技力向上";
  if (/マラソン/.test(label)) return "マラソン";
  if (/その他/.test(label)) return "その他";
  return label;
}

// 頻度のラベル統一マッピング
function normalizeFrequency(label: string): string {
  if (/週.{0,2}3.*以上|週3以上/.test(label)) return "週3回以上";
  if (/週.{0,2}2/.test(label)) return "週2回";
  if (/週.{0,2}1/.test(label)) return "週1回";
  if (/月.*1|月.*2/.test(label)) return "月1-2回";
  if (/それ以下|少ない/.test(label)) return "それ以下";
  return label;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;
    if (auth.session.role !== "admin") {
      return NextResponse.json({ error: "admin only" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code") || "";
    const where = code ? { enqueteCode: code } : {};
    const count = await prisma.enqueteAnswer.count({ where });
    return NextResponse.json({ count });
  } catch (e) {
    console.error("Enquete check error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;
    if (auth.session.role !== "admin") {
      return NextResponse.json({ error: "admin only" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const dryRun = formData.get("dryRun") === "true";

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);
    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    const header = allRows[0];
    const hmap = buildHeaderMap(header);
    const dataRows = allRows.slice(1);

    const idxCode = hmap["コード"] ?? -1;
    const idxName = hmap["名称"] ?? -1;
    const idxScene = hmap["利用シーン"] ?? -1;
    const idxRegistered =
      hmap["登録日時"] ?? hmap["開始日時"] ?? -1;
    const idxMemberId = hmap["メンバー_ID"] ?? -1;
    const idxGender = hmap["メンバー_性別"] ?? -1;
    const idxBirth = hmap["メンバー_生年月日"] ?? -1;
    const idxAge = hmap["メンバー_年齢"] ?? -1;
    const idxStoreCode = hmap["店舗コード"] ?? -1;

    if (idxCode < 0 || idxMemberId < 0) {
      return NextResponse.json(
        { error: "想定外のCSV形式: コード or メンバー_ID 列が見つかりません" },
        { status: 400 },
      );
    }

    const cats = categorizeColumns(header);

    // dryRun: 検出された enqueteCode と既存件数を返す
    const codesInFile = new Set<string>();
    for (const row of dataRows) {
      const c = getCell(row, idxCode);
      if (c) codesInFile.add(c);
    }
    if (dryRun) {
      let existingCount = 0;
      for (const c of codesInFile) {
        existingCount += await prisma.enqueteAnswer.count({
          where: { enqueteCode: c },
        });
      }
      return NextResponse.json({
        dryRun: true,
        codes: Array.from(codesInFile),
        existingCount,
      });
    }

    interface Record {
      enqueteCode: string;
      enqueteName: string | null;
      scene: string | null;
      storeName: string | null;
      registeredAt: string | null;
      memberId: string;
      gender: string | null;
      birthdate: string | null;
      age: number | null;
      awarenessChannels: string | null;
      purposes: string | null;
      exerciseFrequency: string | null;
    }

    const records: Record[] = [];
    let skippedWithdraw = 0;
    let skippedNoMember = 0;

    for (const row of dataRows) {
      const code = getCell(row, idxCode);
      const name = idxName >= 0 ? getCell(row, idxName) : "";
      const scene = idxScene >= 0 ? getCell(row, idxScene) : "";
      if (!code) continue;
      if (isWithdrawEnquete(code, name, scene)) {
        skippedWithdraw++;
        continue;
      }
      const memberId = getCell(row, idxMemberId);
      if (!memberId) {
        skippedNoMember++;
        continue;
      }

      // 店舗名検出: enqueteName優先、次にスタジオ選択列、最後に店舗コード
      let storeName: string | null = detectStoreFromText(name);
      if (!storeName && cats.storeSelect) {
        storeName = detectStoreFromText(getCell(row, cats.storeSelect.index));
      }
      if (!storeName && idxStoreCode >= 0) {
        storeName = detectStoreFromText(getCell(row, idxStoreCode));
      }

      // 認知経路: 該当する選択肢ラベル群
      const awarenessSet = new Set<string>();
      for (const col of cats.awareness) {
        const v = getCell(row, col.index);
        if (isTruthyCell(v)) {
          awarenessSet.add(normalizeAwareness(extractChoice(col.name)));
        }
      }
      const purposesSet = new Set<string>();
      for (const col of cats.purposes) {
        const v = getCell(row, col.index);
        if (isTruthyCell(v)) {
          purposesSet.add(normalizePurpose(extractChoice(col.name)));
        }
      }
      // 頻度: 単一選択（複数該当した場合は最初の1つを採用）
      let frequency: string | null = null;
      for (const col of cats.frequency) {
        const v = getCell(row, col.index);
        if (isTruthyCell(v)) {
          frequency = normalizeFrequency(extractChoice(col.name));
          break;
        }
      }

      const ageStr = idxAge >= 0 ? getCell(row, idxAge) : "";
      const age = ageStr ? parseInt(ageStr, 10) : null;
      const registeredRaw =
        idxRegistered >= 0 ? getCell(row, idxRegistered) : "";

      records.push({
        enqueteCode: code,
        enqueteName: name || null,
        scene: scene || null,
        storeName,
        registeredAt: registeredRaw || null,
        memberId,
        gender:
          idxGender >= 0
            ? (() => {
                const g = getCell(row, idxGender);
                if (!g) return null;
                if (/^(男|M|male)/i.test(g)) return "男性";
                if (/^(女|F|female)/i.test(g)) return "女性";
                return "その他";
              })()
            : null,
        birthdate: idxBirth >= 0 ? getCell(row, idxBirth) || null : null,
        age: Number.isFinite(age) ? age : null,
        awarenessChannels:
          awarenessSet.size > 0 ? Array.from(awarenessSet).join(",") : null,
        purposes:
          purposesSet.size > 0 ? Array.from(purposesSet).join(",") : null,
        exerciseFrequency: frequency,
      });
    }

    // 既存データは enqueteCode 単位で全置換（CSVが最新スナップショット前提）
    await prisma.$transaction(async (tx) => {
      for (const code of codesInFile) {
        await tx.enqueteAnswer.deleteMany({
          where: { enqueteCode: code },
        });
      }
      if (records.length > 0) {
        // バルクインサート（大量行対策で分割）
        const chunkSize = 500;
        for (let i = 0; i < records.length; i += chunkSize) {
          await tx.enqueteAnswer.createMany({
            data: records.slice(i, i + chunkSize),
          });
        }
      }
      await tx.uploadLog.create({
        data: {
          userId: auth.session.userId,
          userName:
            auth.session.displayName || auth.session.storeName || "ユーザー",
          dataType: "hacomono_enquete_answer",
          storeName: null,
          year: null,
          month: null,
          fileName: file.name,
          recordCount: records.length,
        },
      });
    });

    return NextResponse.json({
      records: records.length,
      codes: Array.from(codesInFile),
      skippedWithdraw,
      skippedNoMember,
    });
  } catch (e) {
    console.error("Enquete upload error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
