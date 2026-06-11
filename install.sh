#!/usr/bin/env bash
# Understand-Anything installer (macOS / Linux)
#
# Usage:
#   ./install.sh                       Prompt for platform
#   ./install.sh <platform>            Install for <platform>
#   ./install.sh --uninstall <plat>    Remove links for <plat>
#   ./install.sh --help
#
# Installs from THIS local repository (no network access, no git clone).
# Run from the repository root or any subdirectory — the script resolves its
# own location automatically.

set -euo pipefail

# Resolve this repo's root (directory containing this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
PLUGIN_LINK="$HOME/.understand-anything-plugin"

# Platform table — id|skills-target-dir|style
# style "per-skill": one symlink per skill into the target dir
# style "folder":    one symlink for the whole skills/ dir into the target,
#                    named "understand-anything"
platforms_table() {
  cat <<EOF
gemini|$HOME/.agents/skills|per-skill
codex|$HOME/.agents/skills|per-skill
opencode|$HOME/.agents/skills|per-skill
pi|$HOME/.agents/skills|per-skill
openclaw|$HOME/.openclaw/skills|folder
antigravity|$HOME/.gemini/antigravity/skills|folder
vibe|$HOME/.vibe/skills|per-skill
vscode|$HOME/.copilot/skills|per-skill
hermes|$HOME/.hermes/skills|folder
cline|$HOME/.cline/skills|folder
kimi|$HOME/.kimi/skills|folder
EOF
}

platform_ids() { platforms_table | cut -d'|' -f1; }

resolve_platform() {
  local id="$1"
  local row
  row="$(platforms_table | awk -F'|' -v id="$id" '$1==id {print; exit}')"
  if [[ -z "$row" ]]; then
    printf 'Unknown platform: %s\n' "$id" >&2
    printf 'Supported: %s\n' "$(platform_ids | tr '\n' ' ')" >&2
    exit 1
  fi
  printf '%s\n' "$row"
}

prompt_platform() {
  local ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(platform_ids)

  printf 'Which platform are you installing for?\n' >&2
  local i=1
  for id in "${ids[@]}"; do
    printf '  %d) %s\n' "$i" "$id" >&2
    i=$((i+1))
  done
  printf 'Choose [1-%d]: ' "${#ids[@]}" >&2

  local choice=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r choice <&3 || true
    exec 3<&-
  else
    read -r choice || true
  fi
  if [[ -z "$choice" ]]; then
    printf '\nNo input received. Pass the platform as an argument instead, e.g.:\n' >&2
    printf '  install.sh codex\n' >&2
    exit 1
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#ids[@]} )); then
    printf 'Invalid choice: %s\n' "$choice" >&2
    exit 1
  fi
  printf '%s\n' "${ids[$((choice-1))]}"
}

skills_root() { printf '%s\n' "$REPO_DIR/understand-anything-plugin/skills"; }

list_skills() {
  local root
  root="$(skills_root)"
  if [[ ! -d "$root" ]]; then
    printf 'Skills directory not found: %s\n' "$root" >&2
    exit 1
  fi
  local d
  for d in "$root"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

link_skills() {
  local target="$1" style="$2"
  local root
  root="$(skills_root)"
  mkdir -p "$target"
  case "$style" in
    per-skill)
      local skill
      while IFS= read -r skill; do
        ln -sfn "$root/$skill" "$target/$skill"
        printf '  ✓ %s → %s\n' "$target/$skill" "$root/$skill"
      done < <(list_skills)
      ;;
    folder)
      ln -sfn "$root" "$target/understand-anything"
      printf '  ✓ %s → %s\n' "$target/understand-anything" "$root"
      ;;
    *)
      printf 'Unknown style: %s\n' "$style" >&2
      exit 1
      ;;
  esac
}

unlink_skills() {
  local target="$1" style="$2"
  [[ -d "$target" ]] || return 0
  case "$style" in
    per-skill)
      if [[ -d "$(skills_root)" ]]; then
        local skill
        while IFS= read -r skill; do
          [[ -L "$target/$skill" ]] && rm -f "$target/$skill"
        done < <(list_skills)
      else
        local link resolved
        for link in "$target"/*; do
          [[ -L "$link" ]] || continue
          resolved="$(readlink "$link" 2>/dev/null || true)"
          [[ "$resolved" == *"/understand-anything-plugin/skills/"* ]] || continue
          rm -f "$link"
        done
      fi
      ;;
    folder)
      [[ -L "$target/understand-anything" ]] && rm -f "$target/understand-anything"
      ;;
  esac
}

link_plugin_root() {
  local src="$REPO_DIR/understand-anything-plugin"
  if [[ -L "$PLUGIN_LINK" ]]; then
    # Replace existing symlink (may point to an old location)
    rm -f "$PLUGIN_LINK"
    ln -s "$src" "$PLUGIN_LINK"
    printf '  ✓ %s → %s (updated)\n' "$PLUGIN_LINK" "$src"
  elif [[ -e "$PLUGIN_LINK" ]]; then
    printf '  • %s already exists and is not a symlink, leaving as-is\n' "$PLUGIN_LINK"
  else
    ln -s "$src" "$PLUGIN_LINK"
    printf '  ✓ %s → %s\n' "$PLUGIN_LINK" "$src"
  fi
}

cmd_install() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"

  printf -- '→ Installing from local repo: %s\n' "$REPO_DIR"
  printf -- '→ Linking skills for %s (%s → %s)\n' "$id" "$style" "$target"
  link_skills "$target" "$style"
  printf -- '→ Linking universal plugin root\n'
  link_plugin_root

  printf '\n✓ Installed Understand-Anything for %s\n' "$id"
  printf '  Restart your CLI or IDE to pick up the skills.\n'
  printf '  Skills are symlinked from this repo — code changes take effect immediately.\n'
}

cmd_uninstall() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"

  printf -- '→ Removing skill links for %s\n' "$id"
  unlink_skills "$target" "$style"
  if [[ -L "$PLUGIN_LINK" ]]; then
    rm -f "$PLUGIN_LINK"
    printf '  ✓ removed %s\n' "$PLUGIN_LINK"
  fi
}

usage() {
  cat <<USAGE
Understand-Anything installer (local)

Installs from: $REPO_DIR

Usage:
  install.sh [<platform>]            Install for <platform> (or prompt if omitted)
  install.sh --uninstall <platform>  Remove links for <platform>
  install.sh --help

Supported platforms:
$(platform_ids | sed 's/^/  - /')
USAGE
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --uninstall)
      shift
      if [[ -z "${1:-}" ]]; then
        printf '%s\n' '--uninstall requires a platform argument' >&2
        usage >&2
        exit 1
      fi
      cmd_uninstall "$1"
      ;;
    "")
      local id
      id="$(prompt_platform)"
      cmd_install "$id"
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      cmd_install "$1"
      ;;
  esac
}

main "$@"
