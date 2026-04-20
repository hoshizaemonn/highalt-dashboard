"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        <img
          src="/logo.png"
          alt="ハイアルチ"
          className="mx-auto w-32 rounded-lg mb-6"
        />
        <h1 className="text-6xl font-bold text-gray-300 mb-2">500</h1>
        <p className="text-lg text-gray-600 mb-6">
          サーバーエラーが発生しました
        </p>
        <button
          onClick={reset}
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          もう一度試す
        </button>
      </div>
    </div>
  );
}
