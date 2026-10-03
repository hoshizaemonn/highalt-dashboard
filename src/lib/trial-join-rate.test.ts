// 実行: node --experimental-strip-types src/lib/trial-join-rate.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { summarizeTrialJoin, trialJoinRatePercent, formatTrialJoinRate, trialWarnings } from "./trial-join-rate.ts";
import assert from "node:assert/strict";

const row = (storeName: string, resultType: string) => ({ storeName, resultType });

// 分子は 即日+後日 のみ。検討中・入会しないは分母のみ
{
  const s = summarizeTrialJoin([row("A", "即日入会"), row("A", "後日入会"), row("A", "検討中"), row("A", "入会しない")]);
  assert.deepEqual(s, { sheetCount: 4, joinedCount: 2 });
  assert.equal(trialJoinRatePercent(s), 50);
  assert.equal(formatTrialJoinRate(s), "50.0%");
}
// 体験シートなし → "-"
{
  const s = summarizeTrialJoin([]);
  assert.equal(trialJoinRatePercent(s), null);
  assert.equal(formatTrialJoinRate(s), "-");
}
// 全体合算は店舗ごとの集計の和（体験シートのある店舗だけが分母に入る）
{
  const s = summarizeTrialJoin([row("巣鴨", "入会しない"), row("巣鴨", "入会しない"), row("巣鴨", "入会しない"), row("中目黒", "後日入会"), row("中目黒", "検討中"), row("下北沢", "即日入会")]);
  assert.deepEqual(s, { sheetCount: 6, joinedCount: 2 });
  assert.equal(formatTrialJoinRate(s), "33.3%");
}
// 100%を超えない（無作為1000回）
{
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const kinds = ["即日入会", "後日入会", "検討中", "入会しない", "想定外"];
  for (let t = 0; t < 1000; t++) {
    const rows = Array.from({ length: Math.floor(rnd() * 30) }, () => row(["a", "b", "c"][Math.floor(rnd() * 3)], kinds[Math.floor(rnd() * 5)]));
    const p = trialJoinRatePercent(summarizeTrialJoin(rows));
    assert.ok(p === null || (p >= 0 && p <= 100), String(p));
  }
}
// 警告: 差
assert.equal(trialWarnings({ sheetCount: 3, manualRaw: 5, autoCount: 0 }).diff, "差があります（体験シート3人／手入力5人）");
assert.equal(trialWarnings({ sheetCount: 3, manualRaw: 3, autoCount: 0 }).diff, null);       // 同じ → 出さない
assert.equal(trialWarnings({ sheetCount: 3, manualRaw: 0, autoCount: 0 }).diff, null);       // 手入力なし → 出さない
assert.equal(trialWarnings({ sheetCount: 0, manualRaw: 5, autoCount: 0 }).diff, null);       // 体験シートなし → 出さない
// 警告: 記入漏れ
assert.equal(trialWarnings({ sheetCount: 2, manualRaw: 0, autoCount: 4 }).missing, "体験シートの記入漏れの可能性があります（体験シート2人／hacomono4人）");
assert.equal(trialWarnings({ sheetCount: 4, manualRaw: 0, autoCount: 4 }).missing, null);    // 同数 → 出さない
assert.equal(trialWarnings({ sheetCount: 5, manualRaw: 0, autoCount: 4 }).missing, null);    // 体験シートの方が多い → 出さない
assert.equal(trialWarnings({ sheetCount: 0, manualRaw: 0, autoCount: 4 }).missing, null);    // 体験シートなし → 出さない
console.log("TRIAL-JOIN TESTS PASSED");
