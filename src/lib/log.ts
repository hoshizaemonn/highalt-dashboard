/**
 * APIルート用の安全なエラーロガー（セキュリティ強化 2026-07）。
 *
 * エラーオブジェクトをそのまま console.error に渡すと、スタックトレースや
 * クエリ内容（会員氏名・給与額などPIIを含み得る）が Vercel のログに残る。
 * ここではエラー種別とメッセージのみに絞って記録する。
 */
export function logError(context: string, error: unknown): void {
  const summary =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`${context} ${summary}`);
}
