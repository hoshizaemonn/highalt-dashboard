import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        <img
          src="/logo.png"
          alt="ハイアルチ"
          className="mx-auto w-32 rounded-lg mb-6"
        />
        <h1 className="text-6xl font-bold text-gray-300 mb-2">404</h1>
        <p className="text-lg text-gray-600 mb-6">
          ページが見つかりません
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          ダッシュボードに戻る
        </Link>
      </div>
    </div>
  );
}
