#!/usr/bin/env bash
# Claude Code status line
# Format: model | ctx% | sess  user@host:cwd (branch indicators)
input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // ""')

# git branch + status indicators (skip optional locks to avoid blocking)
git_info=""
if git_branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null); then
    dirty=""
    staged=""
    untracked=""
    stash=""
    upstream=""

    git_status=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" status --porcelain -b 2>/dev/null)

    # upstream divergence from first line (## branch...origin/branch [ahead N, behind M])
    first_line=$(echo "$git_status" | head -1)
    ahead=$(echo "$first_line" | grep -o 'ahead [0-9]*' | grep -o '[0-9]*')
    behind=$(echo "$first_line" | grep -o 'behind [0-9]*' | grep -o '[0-9]*')
    if [ -n "$ahead" ] && [ -n "$behind" ]; then
        upstream="<>"
    elif [ -n "$ahead" ]; then
        upstream=">"
    elif [ -n "$behind" ]; then
        upstream="<"
    else
        upstream="="
    fi

    # file status
    rest=$(echo "$git_status" | tail -n +2)
    echo "$rest" | grep -q '^.[^ ?]' && dirty="*"
    echo "$rest" | grep -q '^[^ ?].' && staged="+"
    echo "$rest" | grep -q '^??' && untracked="%"
    GIT_OPTIONAL_LOCKS=0 git -C "$cwd" stash list 2>/dev/null | grep -q . && stash='$'

    indicators="${dirty}${staged}${untracked}${stash}${upstream}"
    [ -n "$indicators" ] && git_info=" ($git_branch $indicators)" || git_info=" ($git_branch)"
fi

model=$(echo "$input" | jq -r '.model.display_name // ""')
# A session on the local server shows "vllm" here; the local row below names the model
case "$(echo "$input" | jq -r '.model.id // ""')" in claude-*|"") ;; *) model=vllm;; esac
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used" ]; then
    used_int=$(printf "%.0f" "$used")
    ctx_info=" | ctx:${used_int}%"
else
    ctx_info=""
fi

# session token total — rough proxy for 5h rolling usage (not directly available via any API/file)
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
if [ "$total_in" -gt 0 ] 2>/dev/null || [ "$total_out" -gt 0 ] 2>/dev/null; then
    total_k=$(( (total_in + total_out) / 1000 ))
    sess_info=" | sess:${total_k}k"
else
    sess_info=""
fi

[ -n "$model" ] && model_prefix="${model}" || model_prefix=""

printf "\033[0;33m%s%s%s\033[0m \033[0;32m%s@%s\033[0m:\033[0;34m%s\033[0m%s" \
    "${model_prefix}" "${ctx_info}" "${sess_info}" "$(whoami)" "$(hostname -s)" "$cwd" "$git_info"

# dp-fan-out-subagents rows: Claude (session cost, subagents, reviews), then local (server, GPU, VRAM, vLLM queue, runs)
fanout=$(printf '%s' "$input" | python3 /home/dev/work/dippe/skills-agents/skills/dp-fan-out-subagents/scripts/statusline.py 2>/dev/null)
while IFS= read -r row; do
    if [ -n "$row" ]; then printf "\n\033[0;36m%s\033[0m" "$row"; fi
done <<<"$fanout"
