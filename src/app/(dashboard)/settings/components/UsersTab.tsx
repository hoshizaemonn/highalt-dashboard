"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Constants (duplicated client-side to avoid server import) ──────
const STORES = [
  "東日本橋",
  "春日",
  "船橋",
  "巣鴨",
  "祖師ヶ谷大蔵",
  "下北沢",
  "中目黒",
];
const HQ_STORE = "本部（除外）";
const ALL_STORES = [...STORES, HQ_STORE];

// ─── Types ──────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  username: string;
  role: string;
  storeName: string | null;
  displayName: string | null;
  createdAt: string;
}

// ─── Component ──────────────────────────────────────────────────────

export default function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Edit user form
  const [editId, setEditId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  // New user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newStoreName, setNewStoreName] = useState(STORES[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getRoleLabel(role: string) {
    switch (role) {
      case "admin":
        return "管理者";
      case "store_manager":
        return "店舗マネージャー";
      case "viewer":
        return "閲覧者";
      default:
        return role;
    }
  }

  async function handleDeleteUser() {
    if (!deleteId) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/settings/users?id=${deleteId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "削除に失敗しました");
      } else {
        setDeleteId(null);
        await fetchData();
        setMessage("ユーザーを削除しました");
      }
    } catch {
      setMessage("削除に失敗しました");
    }
    setSaving(false);
  }

  async function handleCreateUser() {
    if (!newUsername || !newPassword) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || null,
          storeName: newStoreName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "作成に失敗しました");
      } else {
        setNewUsername("");
        setNewPassword("");
        setNewDisplayName("");
        setNewStoreName(STORES[0]);
        await fetchData();
        setMessage("ユーザーを作成しました");
      }
    } catch {
      setMessage("作成に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div>
      {message && (
        <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 rounded text-sm">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <>
          {/* User list */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    ID
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    ユーザー名
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    表示名
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    権限
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    担当店舗
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-3 py-2">{u.id}</td>
                    <td className="px-3 py-2">{u.username}</td>
                    <td className="px-3 py-2">{u.displayName || "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {getRoleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{u.storeName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Change password / display name */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              パスワード・表示名の変更
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={editId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value, 10) : null;
                  setEditId(id);
                  setEditPassword("");
                  const u = users.find((u) => u.id === id);
                  setEditDisplayName(u?.displayName || "");
                }}
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                <option value="">ユーザーを選択</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.displayName || getRoleLabel(u.role)})
                  </option>
                ))}
              </select>
              {editId && (
                <>
                  <input
                    type="text"
                    placeholder="新しい表示名"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <input
                    type="password"
                    placeholder="新しいパスワード（変更時のみ）"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <button
                    onClick={async () => {
                      setSaving(true);
                      setMessage("");
                      try {
                        const res = await fetch("/api/settings/users", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: editId,
                            password: editPassword || undefined,
                            displayName: editDisplayName,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          setMessage(data.error || "変更に失敗しました");
                        } else {
                          setEditId(null);
                          setEditPassword("");
                          setEditDisplayName("");
                          await fetchData();
                          setMessage("ユーザー情報を更新しました");
                        }
                      } catch {
                        setMessage("変更に失敗しました");
                      }
                      setSaving(false);
                    }}
                    disabled={saving}
                    className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    変更を保存
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Delete user */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              ユーザー削除
            </p>
            <div className="flex items-center gap-3">
              <select
                value={deleteId ?? ""}
                onChange={(e) =>
                  setDeleteId(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {users
                  .filter((u) => u.role !== "admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.displayName || u.storeName || "-"})
                    </option>
                  ))}
              </select>
              <button
                onClick={handleDeleteUser}
                disabled={saving || !deleteId}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                削除
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              ※管理者ユーザーは削除できません
            </p>
          </div>

          {/* Add store manager */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              店舗マネージャーを追加
            </p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="ユーザー名"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <input
                  type="password"
                  placeholder="パスワード"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <input
                  type="text"
                  placeholder="表示名"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <select
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-2 text-sm"
                >
                  {ALL_STORES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateUser}
                  disabled={saving || !newUsername || !newPassword}
                  className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  作成
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
