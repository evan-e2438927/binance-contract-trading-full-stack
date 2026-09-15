"use client";

import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
import { Input } from "@binance-contract-trading-full-stack/ui/components/input";
import { Label } from "@binance-contract-trading-full-stack/ui/components/label";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { SERVER_URL } from "@/lib/api";

type Book = {
  id: string;
  title: string;
  author: string;
  createdAt: string;
};

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  // 进页面先拉一次列表
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${SERVER_URL}/books`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Book[] = await res.json();
        if (!cancelled) setBooks(data);
      } catch (error) {
        if (!cancelled) toast.error(`加载失败：${(error as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !author.trim()) {
      toast.error("书名和作者都要填");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // 后端 returning() 把新行带回来了，直接插到列表最前面
      setBooks((prev) => [data as Book, ...prev]);
      setTitle("");
      setAuthor("");
      toast.success("添加成功");
    } catch (error) {
      toast.error(`添加失败：${(error as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 font-semibold text-2xl">Books</h1>

      <form onSubmit={handleSubmit} className="mb-8 grid gap-4 rounded-lg border p-4">
        <div className="grid gap-2">
          <Label htmlFor="title">书名</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="人月神话"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="author">作者</Label>
          <Input
            id="author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Frederick P. Brooks Jr."
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "提交中…" : "添加"}
        </Button>
      </form>

      <section>
        <h2 className="mb-3 font-medium">书单（{books.length}）</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">加载中…</p>
        ) : books.length === 0 ? (
          <p className="text-muted-foreground text-sm">还没有书，上面添加一本试试。</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {books.map((book) => (
              <li key={book.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{book.title}</span>
                <span className="text-muted-foreground text-sm">{book.author}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}