import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <p className="text-lg text-gray-600 mb-6">ページが見つかりません</p>
        <Link
          href="/dashboard"
          className="bg-[#567FC0] text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-[#4a6fa8] transition-colors"
        >
          ダッシュボードに戻る
        </Link>
      </div>
    </div>
  );
}
