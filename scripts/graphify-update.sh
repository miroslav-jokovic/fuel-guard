#!/bin/sh
# Rebuild the graphify knowledge graph, with the binary that can actually read this repo.
#
# ⚠ WHY THIS SCRIPT EXISTS RATHER THAN A BARE `graphify update .`
# There can be two graphify installs on one machine, and they are not equivalent. The `tree_sitter_sql`
# grammar is an optional extra, and without it graphify silently drops every `.sql` file — which in
# THIS repo means all 351 migrations and 1,144 nodes, and the migrations are the single source of
# schema truth (`supabase/CLAUDE.md`). The failure is a warning on stderr and a quietly smaller
# graph, so nobody notices they are querying a map with the database missing.
#
# So: prefer a pipx install (isolated, and where `pipx inject graphifyy tree_sitter_sql` puts the
# grammar) and fall back to whatever is on PATH. One implementation, used by `pnpm graph:update`
# and by .git/hooks/post-commit, so the two can never disagree about which binary is right.
set -e
cd "$(dirname "$0")/.."

GRAPHIFY="$HOME/.local/bin/graphify"
[ -x "$GRAPHIFY" ] || GRAPHIFY="$(command -v graphify 2>/dev/null || true)"
if [ -z "$GRAPHIFY" ]; then
  echo "graphify is not installed — skipping the graph rebuild." >&2
  exit 0
fi

OUT="$("$GRAPHIFY" update . 2>&1)" || { echo "$OUT" >&2; exit 1; }
echo "$OUT" | grep -vE '^  (AST extraction|Semantic)' || true

# The warning worth failing loudly on: a graph built without the schema is a graph that will answer
# questions about this repo wrongly rather than not at all.
if echo "$OUT" | grep -q 'tree_sitter_sql not installed'; then
  echo "" >&2
  echo "⚠ The migrations were NOT indexed — this graph has no schema in it." >&2
  echo "  Fix: pipx inject graphifyy tree_sitter_sql   (then re-run)" >&2
  exit 1
fi
