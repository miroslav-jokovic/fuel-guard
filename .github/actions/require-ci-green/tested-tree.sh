#!/usr/bin/env bash
# Was this exact code already proven green by a pull request's CI run?
#
#   GITHUB_REPOSITORY=owner/repo GH_TOKEN=… tested-tree.sh <commit-sha>
#
# Exit 0 and print "<parent-sha> <run-url>" when a parent of <commit-sha> carries a `ci/tested-tree`
# success status whose description is <commit-sha>'s own tree. Exit 1 for anything else, including
# every API error: the caller then waits for main's CI exactly as it did before this existed, so the
# only thing a bug here can cost is time, never a deploy of untested code.
#
# WHY (2026-09-30, docs/plans/ci/HANDOFF-2026-09-30-CI-SPEED.md, Fix 2). A PR's CI tests
# refs/pull/N/merge, GitHub's synthetic merge of the head into the base as it stood. When the PR is
# merged with a merge commit and main has not moved since, main's merge commit has the IDENTICAL git
# tree — and a tree is the code, byte for byte, workflows included. Yet migrate.yml and the three
# driver release workflows waited for a second full CI run on main before shipping it, adding one
# whole CI run (6.5–11 min) to every merge that carried a migration.
#
# ci.yml's `build` job posts the status on the PR head only after every job has succeeded, with the
# tested tree as its description. The head is main's merge commit's second parent. Checks below:
#   · the status must be `success` and its description must equal THIS commit's tree — so if main
#     moved between the PR run and the merge, the trees differ and nothing is accepted;
#   · it must have been posted by github-actions[bot], i.e. by a workflow run using GITHUB_TOKEN,
#     not by a person with push access typing a tree SHA into the API.
set -uo pipefail

sha="${1:?usage: tested-tree.sh <commit-sha>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

commit=$(gh api "repos/${repo}/git/commits/${sha}" 2>/dev/null) || {
  echo "tested-tree: could not read commit ${sha::7}" >&2
  exit 1
}
tree=$(jq -r '.tree.sha // empty' <<<"$commit")
parents=$(jq -r '.parents[]?.sha' <<<"$commit")
if [ -z "$tree" ] || [ -z "$parents" ]; then
  echo "tested-tree: commit ${sha::7} has no tree or no parents" >&2
  exit 1
fi

for parent in $parents; do
  statuses=$(gh api --paginate "repos/${repo}/commits/${parent}/statuses?per_page=100" 2>/dev/null) || {
    echo "tested-tree: could not read statuses of ${parent::7}" >&2
    continue
  }
  # --paginate prints one JSON array per page; -s gathers them, .[][] flattens.
  url=$(jq -rs --arg tree "$tree" '
    [ .[][] | select(.context == "ci/tested-tree"
                   and .state == "success"
                   and .description == $tree
                   and .creator.login == "github-actions[bot]") ]
    | first | .target_url // empty' <<<"$statuses")
  if [ -n "$url" ]; then
    echo "${parent} ${url}"
    exit 0
  fi
  echo "tested-tree: ${parent::7} carries no green ci/tested-tree for tree ${tree::7}" >&2
done
exit 1
