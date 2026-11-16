#!/usr/bin/env bash
# Runs Codex jobs A, B, C at the same time in separate git worktrees, then one integration run
# in the main checkout once task 7 (already running there) has finished.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
log="$root/codex-parallel.log"

run() { # name, workdir, brief
	( cd "$2" && echo "Read $3 and do exactly that job. Work only in this folder. Commit on the current branch when done, then stop." \
		| codex exec -s workspace-write -c sandbox_workspace_write.network_access=true -o "$root/briefs/codex-$1-out.md" - > "$root/codex-$1.log" 2>&1 )
	echo "$(date +%H:%M) $1 finished (exit $?)" >> "$log"
}

link() { # junction so worktrees share the big folders instead of copying them
	[ -e "$2" ] || cmd //c mklink /J "$(cygpath -w "$2")" "$(cygpath -w "$1")" > /dev/null
}

echo "$(date +%H:%M) starting A, B, C" >> "$log"
for job in A-team-ui:team-ui B-login:login C-two-users:two-users; do
	brief="${job%%:*}"
	name="${job##*:}"
	wt="$root/../codeler-wt-$name"
	[ -d "$wt" ] || git worktree add -q -b "codex/$name" "$wt" HEAD
	link "$root/vscodium" "$wt/vscodium"
	link "$root/extensions/codeler/node_modules" "$wt/extensions/codeler/node_modules"
	run "$name" "$wt" "briefs/parallel/$brief.md" &
done
wait

echo "$(date +%H:%M) waiting for task 7" >> "$log"
until [ -f "$root/briefs/codex-task7-out.md" ]; do sleep 30; done
run integrate "$root" "briefs/parallel/Z-integrate.md"
echo "$(date +%H:%M) all done" >> "$log"
