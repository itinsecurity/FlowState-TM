#!/usr/bin/env bash
#
# Install the FlowState-TM threat-model prompt as a user-level Claude Code skill.
#
# Reads .github/prompts/threat-model.prompt.md from the repo, strips the
# VS Code prompt frontmatter, prepends Claude Code skill frontmatter, and
# writes the result to ~/.claude/skills/flowstate-tm/SKILL.md.
#
# Usage:
#   ./scripts/install-claude-skill.sh
#
# After running, restart Claude Code and invoke the skill with /flowstate-tm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_FILE="$REPO_ROOT/.github/prompts/threat-model.prompt.md"
SKILL_NAME="flowstate-tm"
SKILL_DIR="$HOME/.claude/skills/$SKILL_NAME"
SKILL_FILE="$SKILL_DIR/SKILL.md"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Error: source prompt not found at $SOURCE_FILE" >&2
  echo "Run this script from a FlowState-TM checkout." >&2
  exit 1
fi

mkdir -p "$SKILL_DIR"

# Compose SKILL.md: new frontmatter + body of the source prompt (frontmatter stripped).
# The awk filter prints every line after the second `---`, which removes the
# original VS Code prompt frontmatter while leaving the markdown body intact.
{
  cat <<'EOF'
---
name: flowstate-tm
description: Create a threat model using the FlowState-TM YAML format. Use when the user asks to generate, create, or update a threat model, security model, or STRIDE analysis, or asks for FlowState-TM YAML output.
---
EOF
  awk 'BEGIN{p=0} /^---$/{c++; if(c==2){p=1; next}} p' "$SOURCE_FILE"
} > "$SKILL_FILE"

echo "Installed FlowState-TM skill to: $SKILL_FILE"
echo "Restart Claude Code, then invoke with /$SKILL_NAME (or just ask for a threat model)."
