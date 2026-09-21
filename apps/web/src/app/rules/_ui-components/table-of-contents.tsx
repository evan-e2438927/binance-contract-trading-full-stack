import { RULE_SECTIONS } from "../_lib/sections";

/**
 * R-01 目录。纯 `<a href="#...">`，不带 JS——
 * 这一页的价值是内容，不值得为了「当前段落高亮」把整页变成客户端组件。
 */
export function TableOfContents() {
  return (
    <nav className="sticky top-6 flex flex-col gap-2 text-[13px]">
      <p className="pb-1 font-semibold text-[12px] text-muted-foreground">目录</p>
      {RULE_SECTIONS.map((section) => (
        <div key={section.id} className="flex flex-col gap-1.5">
          <a href={`#${section.id}`} className="text-foreground transition-colors hover:text-brand">
            {section.title}
          </a>
          {section.children?.map((child) => (
            <a
              key={child.id}
              href={`#${child.id}`}
              className="pl-3 text-[12px] text-muted-foreground transition-colors hover:text-brand"
            >
              {child.title}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
