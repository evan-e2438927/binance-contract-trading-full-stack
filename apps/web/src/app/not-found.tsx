import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      <p>页面不存在</p>
      <Link href="/" className="text-brand">
        返回首页
      </Link>
    </div>
  );
}
