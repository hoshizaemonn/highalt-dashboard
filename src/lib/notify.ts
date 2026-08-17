/**
 * ChatWork 通知（監視用）。
 *
 * トークン等は Vercel の環境変数にのみ置く。
 * このリポジトリは public なので、通知先やトークンをコードに書かないこと。
 * 環境変数が未設定なら黙って何もしない（ローカル・プレビューで誤送信しない）。
 */
export async function notifyChatwork(body: string): Promise<void> {
  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;
  if (!token || !roomId) {
    console.log("ChatWork notify skipped (env not set)");
    return;
  }

  try {
    const res = await fetch(
      `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
      {
        method: "POST",
        headers: {
          "X-ChatWorkToken": token,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ body }),
      }
    );
    if (!res.ok) {
      console.error(`ChatWork notify failed: HTTP ${res.status}`);
    }
  } catch (e) {
    // 通知の失敗で呼び出し元を落とさない
    console.error(
      "ChatWork notify error:",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    );
  }
}
