"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail } from "lucide-react";

// 管理者問い合わせ先（パスワードリセット用）
// 受付メールボックスは星崎さん運用 → 鈴木さんへ連携の流れ
const ADMIN_CONTACT_EMAIL = "system@high-alti.com";
const PASSWORD_HELP_SUBJECT = "[ハイアルチ業績ダッシュボード] ログインに関するお問い合わせ";
const PASSWORD_HELP_BODY = `ハイアルチ業績ダッシュボードの管理者ご担当者様

ログインができないため、お手数ですがアカウント情報を確認いただけますでしょうか。

【店舗名】
（例：東日本橋）

【ユーザー名（分かる範囲で）】


【困っている内容】
（例：パスワードを忘れてしまった / ユーザー名が分からない / ログイン画面でエラーが出る など）


お忙しいところ恐れ入りますが、ご対応のほどよろしくお願いいたします。
`;

function buildHelpMailto(): string {
  const subject = encodeURIComponent(PASSWORD_HELP_SUBJECT);
  const body = encodeURIComponent(PASSWORD_HELP_BODY);
  return `mailto:${ADMIN_CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "ログインに失敗しました");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="ハイアルチ 駅前高地™トレーニング"
              className="mx-auto w-40 rounded-lg mb-4"
            />
            <h2 className="text-xl font-bold text-gray-800 mt-4">
              業績ダッシュボード
            </h2>
            <p className="text-sm text-gray-500 mt-1">ログイン</p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-4 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                ユーザー名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#567FC0] focus:border-transparent"
                placeholder="ユーザー名を入力"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                パスワード
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#567FC0] focus:border-transparent"
                  placeholder="パスワードを入力"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#567FC0] text-white py-2 px-4 rounded-md hover:bg-[#4a6da8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>

          {/* パスワード忘れ・困った時の連絡先 */}
          <div className="mt-6 pt-5 border-t border-gray-100 text-xs text-gray-500 space-y-3">
            <div>
              <p className="font-medium text-gray-600 mb-1">ログインできない場合</p>
              <p>
                パスワードを忘れた・アカウントが分からない場合は、下記ボタンから管理者へお問い合わせください。
              </p>
            </div>
            <a
              href={buildHelpMailto()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors text-sm font-medium"
            >
              <Mail size={14} />
              管理者にメールで問い合わせる
            </a>
            <p className="text-[11px] text-gray-400">
              送信先：{ADMIN_CONTACT_EMAIL}
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          High-Alti 業績ダッシュボード
        </p>
      </div>
    </div>
  );
}
