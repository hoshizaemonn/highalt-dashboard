"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
            <div className="inline-block bg-[#567FC0] text-white px-6 py-3 rounded-lg mb-4">
              <h1 className="text-lg font-bold">ハイアルチ</h1>
              <p className="text-sm opacity-90">駅前高地トレーニング</p>
            </div>
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
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#567FC0] focus:border-transparent"
                placeholder="パスワードを入力"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#567FC0] text-white py-2 px-4 rounded-md hover:bg-[#4a6da8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          High-Alti 業績ダッシュボード v2.0
        </p>
      </div>
    </div>
  );
}
