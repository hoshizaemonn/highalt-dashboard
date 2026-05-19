"use client";

import { useEffect, useState } from "react";

/**
 * 店舗の内部名 → 表示名 マッピングを取得するフック。
 * 全コンポーネントで共通利用するため、グローバルなキャッシュを持つ。
 */

type Mapping = Record<string, string>;

let cachedMapping: Mapping | null = null;
let inflight: Promise<Mapping> | null = null;
const listeners = new Set<(m: Mapping) => void>();

async function fetchMapping(): Promise<Mapping> {
  if (cachedMapping) return cachedMapping;
  if (inflight) return inflight;
  inflight = fetch("/api/settings/store-display-names")
    .then((r) => (r.ok ? r.json() : { mapping: {} }))
    .then((d) => {
      cachedMapping = (d?.mapping ?? {}) as Mapping;
      inflight = null;
      for (const l of listeners) l(cachedMapping);
      return cachedMapping;
    })
    .catch(() => {
      inflight = null;
      return {};
    });
  return inflight;
}

/**
 * マッピングを再フェッチ（管理画面で更新した時に呼ぶ）
 */
export function invalidateStoreDisplayNames() {
  cachedMapping = null;
  void fetchMapping();
}

/**
 * 表示用に店舗名を変換する。マッピングが無ければ storeName をそのまま返す。
 */
export function useStoreDisplayName() {
  const [mapping, setMapping] = useState<Mapping>(cachedMapping ?? {});

  useEffect(() => {
    let mounted = true;
    fetchMapping().then((m) => {
      if (mounted) setMapping(m);
    });
    const listener = (m: Mapping) => {
      if (mounted) setMapping({ ...m });
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return {
    /** storeName を表示名に変換（マッピング無い場合は storeName をそのまま返す） */
    display: (storeName: string) => mapping[storeName] ?? storeName,
    mapping,
  };
}
