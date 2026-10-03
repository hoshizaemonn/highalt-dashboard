// 簡易インメモリキャッシュ（TTL付き）。
//
// 用途: ダッシュボードAPIなど、複数の同時ユーザーが同じパラメータでアクセスする
// 場面で、DB往復を省略してレスポンスを高速化する。
//
// 注意:
//   - Vercel サーバーレスはインスタンスが分散するため、キャッシュは同一ウォーム
//     インスタンスでのみ共有される。それでも 5人同時アクセスで1番目以外はほぼ
//     キャッシュヒットになるケースが多く、十分効果がある。
//   - 認証チェックはキャッシュしない（ルートハンドラ側で別途呼ぶ）。
//   - データの最大鮮度は ttlMs 秒。PL分析用途で許容される。

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export async function memoCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }
  const value = await fetcher();
  store.set(key, { value, expiresAt: now + ttlMs });

  // 期限切れエントリを軽くクリーンアップ（メモリ肥大防止）
  if (store.size > 200) {
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
  }
  return value;
}

/**
 * 指定プレフィックスのキャッシュを即時削除する（設定変更の反映用）。
 * 例: 按分ルール保存時に "dashboard:" "annual:" "storeCompare:" を消す。
 * 同一インスタンス内のみ有効。他インスタンスは ttlMs 以内に自然失効する。
 */
export function memoCacheDeletePrefix(prefix: string): number {
  let n = 0;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n += 1;
    }
  }
  return n;
}
