# 自定义 Skills

把项目专属 skill 放到本目录：`.claude/skills/<name>/SKILL.md`
（frontmatter 需含 `name` 与 `description`）。

SDLC pipeline 会自动发现并在与当前阶段相关时优先调用。
详见项目根 `.claude/CLAUDE.md` 的「自定义 Skills」小节。
