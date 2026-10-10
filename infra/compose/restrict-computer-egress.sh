#!/usr/bin/env bash
# Egress policy for BobBot bot computers.
#
# The mode comes from SANDBOX_COMPUTER_EGRESS (the variable the supervisor reads) and
#
#   restricted (default)
#     Computers keep full public-internet egress (browsing, DNS, apt, git over SSH)
#     but can no longer reach:
#       - the Docker host itself (INPUT drop; replies to host-initiated connections
#         stay open so supervisor control and published screen ports keep working),
#       - RFC1918 / CGNAT / link-local destinations, including cloud metadata at
#         169.254.169.254 (and AWS's IPv6 fd00:ec2::254),
#       - multicast and reserved space.
#
#   allowlist
#     Everything is dropped except the destinations in SANDBOX_COMPUTER_EGRESS_ALLOW
#     (IPs and CIDR blocks, comma- or space-separated) and DNS on port 53, so names
#     still resolve. An allowlist of names is not possible: that would need a
#     filtering resolver, which this deployment does not ship.
#
#   offline
#     No egress at all: every forwarded destination is dropped, including DNS.
#
# Rules key on the deterministic bridge names the supervisor assigns outside of
# `open` mode (rakazo-c<hash>), never on Docker's dynamic subnets — so computer churn,
# network recreate, and subnet reuse need no firewall changes.
#
# Same-bridge peers stay reachable: the supervisor and web screen proxy join the
# computer's bridge. Docker loads br_netfilter with bridge-nf-call-iptables, so
# same-bridge frames DO traverse FORWARD/DOCKER-USER — the first rule below
# returns traffic whose in- and out-interface are the same bridge family before
# any drop applies. On hosts where bridged frames skip iptables entirely, that
# rule is simply never matched.
#
# Requires Linux Docker Engine with the iptables firewall backend (the
# DOCKER-USER chain). Docker Desktop, rootless Docker, and the nftables
# backend are not supported.
#
#   sudo bash restrict-computer-egress.sh          # apply now + persist via systemd
#   bash restrict-computer-egress.sh --print       # show the rules, change nothing
#   sudo bash restrict-computer-egress.sh --remove # uninstall

set -Eeuo pipefail

IPTABLES="${BOBBOT_IPTABLES:-${RAKAZO_IPTABLES:-iptables}}"
IP6TABLES="${BOBBOT_IP6TABLES:-${RAKAZO_IP6TABLES:-ip6tables}}"
SYSTEMCTL="${BOBBOT_SYSTEMCTL:-${RAKAZO_SYSTEMCTL:-systemctl}}"
IF_INET6="${BOBBOT_IF_INET6:-${RAKAZO_IF_INET6:-/proc/net/if_inet6}}"
BRIDGE_PREFIX="rakazo-c"
# The supervisor reads SANDBOX_COMPUTER_EGRESS / _ALLOW from its environment; the host
# script reads the same names so one setting describes the deployment. The BOBBOT_ and
# RAKAZO_ spellings stay accepted for scripts that already export them.
EGRESS_MODE="${SANDBOX_COMPUTER_EGRESS:-${BOBBOT_COMPUTER_EGRESS_MODE:-${RAKAZO_COMPUTER_EGRESS_MODE:-restricted}}}"
EGRESS_ALLOW="${SANDBOX_COMPUTER_EGRESS_ALLOW:-${BOBBOT_COMPUTER_EGRESS_ALLOW:-${RAKAZO_COMPUTER_EGRESS_ALLOW:-}}}"
INSTALLED_PATH=/usr/local/sbin/rakazo-computer-egress
UNIT_PATH=/etc/systemd/system/rakazo-computer-egress.service
# The rules this script installed, exactly as they were written. A mode switch or an
# edited allowlist has to take its own previous rules back out, and the current
# environment cannot describe them once the list changed.
STATE_FILE="${SANDBOX_COMPUTER_EGRESS_STATE:-${BOBBOT_EGRESS_STATE:-/var/lib/rakazo-computer-egress/rules}}"
IPTABLES_NAME="${IPTABLES##*/}"
IP6TABLES_NAME="${IP6TABLES##*/}"

# Every entry of BOBBOT_COMPUTER_EGRESS_ALLOW on its own line, for the rule builders.
allowlist_entries() {
  printf '%s' "$EGRESS_ALLOW" | tr ',' '\n' | tr -s '[:space:]' '\n' | grep -v '^$' || true
}

validate_allow_entry() {
  local entry="$1" addr="${1%%/*}" prefix="" bits=0
  if [[ "$entry" == */* ]]; then prefix="${entry#*/}"; fi
  if [[ -n "$prefix" && ! "$prefix" =~ ^[0-9]{1,3}$ ]]; then
    echo "Invalid prefix length in SANDBOX_COMPUTER_EGRESS_ALLOW: $entry" >&2
    exit 2
  fi
  bits=${prefix:-0}
  if [[ "$addr" == *:* ]]; then
    if [[ ! "$addr" =~ ^[0-9A-Fa-f:]+$ ]]; then
      echo "Invalid address in SANDBOX_COMPUTER_EGRESS_ALLOW: $entry" >&2
      exit 2
    fi
    if ((bits > 128)); then
      echo "Invalid prefix length in SANDBOX_COMPUTER_EGRESS_ALLOW: $entry" >&2
      exit 2
    fi
    return 0
  fi
  if [[ ! "$addr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "Invalid address in SANDBOX_COMPUTER_EGRESS_ALLOW: $entry" >&2
    exit 2
  fi
  if ((bits > 32)); then
    echo "Invalid prefix length in SANDBOX_COMPUTER_EGRESS_ALLOW: $entry" >&2
    exit 2
  fi
}

# The mode and the list have to agree with each other and with the supervisor.
# A mismatch would look enforced while the computers keep more access than the
# operator asked for, so every path except --remove refuses to guess.
validate_config() {
  case "$EGRESS_MODE" in
    restricted | allowlist | offline) ;;
    open)
      echo "SANDBOX_COMPUTER_EGRESS=open leaves egress open; nothing to enforce. Run --remove to delete installed rules." >&2
      exit 2
      ;;
    *)
      echo "Unsupported SANDBOX_COMPUTER_EGRESS value: $EGRESS_MODE (expected restricted, allowlist, or offline)" >&2
      exit 2
      ;;
  esac
  if [[ "$EGRESS_MODE" == allowlist && -z "$(allowlist_entries)" ]]; then
    echo "SANDBOX_COMPUTER_EGRESS=allowlist needs SANDBOX_COMPUTER_EGRESS_ALLOW with at least one IP address or CIDR block." >&2
    exit 2
  fi
  if [[ "$EGRESS_MODE" != allowlist && -n "$(allowlist_entries)" ]]; then
    echo "SANDBOX_COMPUTER_EGRESS_ALLOW is set but the mode is $EGRESS_MODE; switch to allowlist or drop the list." >&2
    exit 2
  fi
  local entry
  while IFS= read -r entry; do validate_allow_entry "$entry"; done < <(allowlist_entries)
}

usage() {
  cat <<'EOF'
Usage: restrict-computer-egress.sh [--install|--apply|--remove|--print]
  (default)   apply the rules now and persist them across reboots via systemd
  --apply     apply the rules now only (used by the systemd unit)
  --remove    delete the rules and the systemd unit
  --print     show the iptables commands without changing anything

Mode comes from SANDBOX_COMPUTER_EGRESS: restricted (default), allowlist
(with SANDBOX_COMPUTER_EGRESS_ALLOW), or offline.
EOF
}

# Forwarded destinations a computer may never reach: every non-public IPv4 block.
blocked_destinations_v4() {
  cat <<'EOF'
0.0.0.0/8
10.0.0.0/8
100.64.0.0/10
127.0.0.0/8
169.254.0.0/16
172.16.0.0/12
192.0.0.0/24
192.168.0.0/16
198.18.0.0/15
224.0.0.0/4
240.0.0.0/4
EOF
}

blocked_destinations_v6() {
  cat <<'EOF'
::1/128
fc00::/7
fe80::/10
ff00::/8
EOF
}

# One rule per line: "<chain> <args>". Order matters: same-bridge traffic
# (-i and -o both rakazo-c*) must be returned to Docker's own chains before the
# destination drops, and in INPUT the established accept must precede the
# catch-all drop so host- and supervisor-initiated connections to the computer
# (control endpoint, published screen port) keep working while the computer can
# no longer open connections to the host.
#
# allowlist returns the allowed destinations (and DNS) before its catch-all drop;
# offline drops DNS explicitly (the catch-all would cover it, but the rule says
# why name resolution stops) and then everything else.
egress_rules_v4() {
  local cidr entry
  printf 'DOCKER-USER -i %s+ -o %s+ -j RETURN\n' "$BRIDGE_PREFIX" "$BRIDGE_PREFIX"
  case "$EGRESS_MODE" in
    restricted)
      while IFS= read -r cidr; do
        printf 'DOCKER-USER -i %s+ -d %s -j DROP\n' "$BRIDGE_PREFIX" "$cidr"
      done < <(blocked_destinations_v4)
      ;;
    allowlist)
      while IFS= read -r entry; do
        [[ "$entry" == *:* ]] && continue
        printf 'DOCKER-USER -i %s+ -d %s -j RETURN\n' "$BRIDGE_PREFIX" "$entry"
      done < <(allowlist_entries)
      printf 'DOCKER-USER -i %s+ -p udp --dport 53 -j RETURN\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -p tcp --dport 53 -j RETURN\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
      ;;
    offline)
      printf 'DOCKER-USER -i %s+ -p udp --dport 53 -j DROP\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -p tcp --dport 53 -j DROP\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
      ;;
  esac
  printf 'INPUT -i %s+ -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n' "$BRIDGE_PREFIX"
  printf 'INPUT -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
}

egress_rules_v6() {
  local cidr entry
  printf 'DOCKER-USER -i %s+ -o %s+ -j RETURN\n' "$BRIDGE_PREFIX" "$BRIDGE_PREFIX"
  case "$EGRESS_MODE" in
    restricted)
      while IFS= read -r cidr; do
        printf 'DOCKER-USER -i %s+ -d %s -j DROP\n' "$BRIDGE_PREFIX" "$cidr"
      done < <(blocked_destinations_v6)
      ;;
    allowlist)
      while IFS= read -r entry; do
        [[ "$entry" == *:* ]] || continue
        printf 'DOCKER-USER -i %s+ -d %s -j RETURN\n' "$BRIDGE_PREFIX" "$entry"
      done < <(allowlist_entries)
      printf 'DOCKER-USER -i %s+ -p udp --dport 53 -j RETURN\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -p tcp --dport 53 -j RETURN\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
      ;;
    offline)
      printf 'DOCKER-USER -i %s+ -p udp --dport 53 -j DROP\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -p tcp --dport 53 -j DROP\n' "$BRIDGE_PREFIX"
      printf 'DOCKER-USER -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
      ;;
  esac
  printf 'INPUT -i %s+ -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n' "$BRIDGE_PREFIX"
  printf 'INPUT -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
}

# Every rule this script can install, for any mode, deduplicated. Switching modes
# or removing the rules has to clean up policies the operator no longer runs, while
# leaving rules this script never wrote alone.
# Recorded rules for one firewall command and chain, in spec form ("<chain> <args>").
recorded_rules() {
  local cmd_name="$1" chain="$2"
  [[ -f "$STATE_FILE" ]] || return 0
  awk -v cmd="$cmd_name" -v chain="$chain" '$1 == cmd && $2 == chain { $1 = ""; $2 = ""; sub(/^  /, ""); print }' \
    "$STATE_FILE"
}

record_state() {
  local dir file tmp
  dir="$(dirname "$STATE_FILE")"
  file="$STATE_FILE"
  tmp="$file.tmp"
  if [[ ! -d "$dir" ]] && ! mkdir -p "$dir" 2>/dev/null; then
    echo "Note: cannot write $STATE_FILE, so a later mode change cannot take these rules back out." >&2
    return 0
  fi
  : >"$tmp"
  while IFS= read -r line; do printf '%s %s\n' "$IPTABLES_NAME" "$line" >>"$tmp"; done < <(egress_rules_v4)
  while IFS= read -r line; do printf '%s %s\n' "$IP6TABLES_NAME" "$line" >>"$tmp"; done < <(egress_rules_v6)
  mv "$tmp" "$file"
}

egress_rules_all_v4() {
  local mode line saved="$EGRESS_MODE" seen=" "
  for mode in restricted allowlist offline; do
    EGRESS_MODE="$mode"
    while IFS= read -r line; do
      [[ "$seen" != *" $line "* ]] || continue
      seen+="$line "
      printf '%s\n' "$line"
    done < <(egress_rules_v4)
  done
  EGRESS_MODE="$saved"
}

egress_rules_all_v6() {
  local mode line saved="$EGRESS_MODE" seen=" "
  for mode in restricted allowlist offline; do
    EGRESS_MODE="$mode"
    while IFS= read -r line; do
      [[ "$seen" != *" $line "* ]] || continue
      seen+="$line "
      printf '%s\n' "$line"
    done < <(egress_rules_v6)
  done
  EGRESS_MODE="$saved"
}

wait_for_docker_user() {
  local cmd="$1" deadline=$((SECONDS + 30))
  until "$cmd" -L DOCKER-USER -n >/dev/null 2>&1; do
    if ((SECONDS > deadline)); then
      echo "DOCKER-USER chain not present — is Docker running with the iptables backend?" >&2
      return 1
    fi
    sleep 1
  done
}

# Canonical form so iptables -S reordering (-d before -i, ctstate sorted) still
# matches the spec. Every other token (protocol, ports, source, match modules)
# stays in the identity, so a narrower rule is not treated as a managed copy.
normalize_rule() {
  local spec="$1"
  local -a toks
  read -ra toks <<<"$spec"
  local in="" out="" dest="" jump="" ct="" extra="" i=0
  while ((i < ${#toks[@]})); do
    case "${toks[i]}" in
      -i) in="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -o) out="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -d) dest="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -j) jump="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      --ctstate) ct="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      *) extra+="${toks[i]} "; i=$((i + 1)) ;;
    esac
  done
  if [[ -n $ct ]]; then
    ct="$(printf '%s\n' "$ct" | tr ',' '\n' | LC_ALL=C sort | paste -sd, -)"
  fi
  printf 'in=%s out=%s dest=%s ct=%s jump=%s extra=%s' \
    "$in" "$out" "$dest" "$ct" "$jump" "${extra%" "}"
}

# True when this chain already begins with the managed rules, in order, above
# anything an operator or another firewall manager inserted later.
chain_has_prefix() {
  local cmd="$1" chain="$2"
  shift 2
  local -a wanted=("$@") current=()
  local line
  while IFS= read -r line; do
    [[ "$line" == "-A $chain "* ]] || continue
    current+=("${line#-A $chain }")
  done < <("$cmd" -S "$chain" 2>/dev/null || true)
  ((${#current[@]} >= ${#wanted[@]})) || return 1
  local i
  for ((i = 0; i < ${#wanted[@]}; i++)); do
    [[ "$(normalize_rule "${current[i]}")" == "$(normalize_rule "${wanted[i]}")" ]] || return 1
  done
}

# Rules below a managed prefix that duplicate it. The prefix itself is kept:
# replacements are inserted at the head first, and only later copies are removed.
# Delete managed rules that sit BELOW the freshly installed prefix: the prefix is
# the policy of the current mode, everything this script wrote for another mode is
# stale. Rules that were never ours are left alone. prefix_len counts the rows the
# new prefix occupies; the remaining arguments are every rule we manage.
delete_stale_below_prefix() {
  local cmd="$1" chain="$2" prefix_len="$3"
  shift 3
  local -a wanted=("$@") lines=() stale=()
  local line i j norm wanted_count=${#wanted[@]}
  while IFS= read -r line; do
    [[ "$line" == "-A $chain "* ]] || continue
    lines+=("${line#-A "$chain" }")
  done < <("$cmd" -S "$chain" 2>/dev/null || true)
  for ((i = prefix_len; i < ${#lines[@]}; i++)); do
    norm="$(normalize_rule "${lines[i]}")"
    for ((j = 0; j < wanted_count; j++)); do
      if [[ "$norm" == "$(normalize_rule "${wanted[j]}")" ]]; then
        stale+=("$((i + 1))")
        break
      fi
    done
  done
  # Highest number first so each delete leaves the remaining numbers valid.
  for ((i = ${#stale[@]} - 1; i >= 0; i--)); do
    "$cmd" -D "$chain" "${stale[i]}"
  done
}

# Insert each chain's rules at its head so a broader accept cannot shadow the
# drops. Same-bridge RETURN stays above the drops, and the INPUT established
# accept stays above the catch-all drop. A chain that already has that prefix
# is left alone.
apply_family() {
  local cmd="$1" rules=() all=() line chain
  command -v "$cmd" >/dev/null 2>&1 || return 0
  wait_for_docker_user "$cmd"
  while IFS= read -r line; do rules+=("$line"); done < <("$2")
  while IFS= read -r line; do all+=("$line"); done < <("$3")
  local -a chain_names=()
  local seen=" "
  for line in "${rules[@]}"; do
    chain="${line%% *}"
    if [[ "$seen" != *" $chain "* ]]; then
      seen+="$chain "
      chain_names+=("$chain")
    fi
  done
  local rewrite=" "
  local chain_needs=0
  for chain in "${chain_names[@]}"; do
    local -a wanted=()
    for line in "${rules[@]}"; do
      [[ "${line%% *}" == "$chain" ]] || continue
      wanted+=("${line#* }")
    done
    if chain_has_prefix "$cmd" "$chain" "${wanted[@]}"; then
      continue
    fi
    rewrite+="$chain "
    chain_needs=1
  done
  # Deletion still runs when the prefix already matches: a recorded rule from an
  # earlier mode can sit below a correct prefix (a mode switch, or an allowlist
  # that lost an entry, changes nothing above it).
  # Insert the new prefix before deleting the copies it replaces. Deleting
  # first would drop enforcement if a later iptables command failed or the
  # script were interrupted. Stale copies are removed only once the new rules
  # are already at the head, and by number so those new rules stay.
  # One reverse pass matches --print and real per-chain inserts: each -I 1
  # leaves the documented order at the head (RETURN above drops, established
  # accept above the INPUT drop).
  local i
  local -a args wanted=()
  for ((i = ${#rules[@]} - 1; i >= 0; i--)); do
    line="${rules[i]}"
    chain="${line%% *}"
    [[ "$rewrite" == *" $chain "* ]] || continue
    read -ra args <<<"${line#* }"
    "$cmd" -I "$chain" 1 "${args[@]}"
  done
  for chain in "${chain_names[@]}"; do
    wanted=()
    for line in "${rules[@]}"; do
      [[ "${line%% *}" == "$chain" ]] || continue
      wanted+=("${line#* }")
    done
    # Below the fresh prefix, delete every rule this script manages for ANY mode
    # plus everything it recorded installing earlier: a mode switch or an edited
    # allowlist must not leave the previous policy standing.
    local -a managed=()
    for line in "${all[@]}"; do
      [[ "${line%% *}" == "$chain" ]] || continue
      managed+=("${line#* }")
    done
    while IFS= read -r line; do managed+=("$line"); done < <(recorded_rules "${cmd##*/}" "$chain")
    delete_stale_below_prefix "$cmd" "$chain" "${#wanted[@]}" "${managed[@]}"
  done
}

# Delete exactly the rules recorded from earlier runs, so --remove is complete
# even when the mode or the allowlist changed since they were installed.
remove_recorded_rules() {
  [[ -f "$STATE_FILE" ]] || return 0
  local cmd_name chain spec
  local -a specs=()
  while IFS= read -r line; do
    cmd_name="${line%% *}"
    spec="${line#* }"
    [[ -n "$cmd_name" && -n "$spec" ]] || continue
    specs=()
    read -ra specs <<<"$spec"
    chain="${specs[0]}"
    local cmd="$IPTABLES"
    [[ "$cmd_name" == "$IP6TABLES_NAME" ]] && cmd="$IP6TABLES"
    command -v "$cmd" >/dev/null 2>&1 || continue
    local -a args=("${specs[@]:1}")
    while "$cmd" -C "$chain" "${args[@]}" 2>/dev/null; do
      "$cmd" -D "$chain" "${args[@]}"
    done
  done <"$STATE_FILE"
}

remove_family() {
  local cmd="$1" line
  command -v "$cmd" >/dev/null 2>&1 || return 0
  while IFS= read -r line; do
    local -a args
    read -ra args <<<"$line"
    while "$cmd" -C "${args[@]}" 2>/dev/null; do
      "$cmd" -D "${args[@]}"
    done
  done < <("$2")
}

apply_rules() {
  # Missing IPv4 iptables must be loud: otherwise this prints success having
  # installed nothing (e.g. hosts on the nftables backend without the shim).
  if ! command -v "$IPTABLES" >/dev/null 2>&1; then
    echo "$IPTABLES not found — restricted egress needs the iptables firewall backend." >&2
    exit 1
  fi
  apply_family "$IPTABLES" egress_rules_v4 egress_rules_all_v4
  if ! command -v "$IP6TABLES" >/dev/null 2>&1; then
    if host_has_ipv6; then
      echo "$IP6TABLES not found but the host has global IPv6 — computers would" >&2
      echo "keep unrestricted IPv6 egress. Install ip6tables or disable IPv6." >&2
      exit 1
    fi
  elif "$IP6TABLES" -L DOCKER-USER -n >/dev/null 2>&1 ||
    { host_has_ipv6 && wait_for_docker_user "$IP6TABLES"; }; then
    # The chain can lag dockerd startup; on dual-stack hosts it gets the same
    # grace window apply_family gives IPv4 before we reject the host.
    apply_family "$IP6TABLES" egress_rules_v6 egress_rules_all_v6
  elif host_has_ipv6; then
    echo "$IP6TABLES DOCKER-USER is unavailable but the host has global IPv6 —" >&2
    echo "computers would keep unrestricted IPv6 egress. Start Docker first (it" >&2
    echo "creates the chain) or disable IPv6, then re-run." >&2
    exit 1
  fi
  record_state
}

# Scope-00 (global) entries in if_inet6 mean the host routes IPv6.
host_has_ipv6() {
  [[ -f $IF_INET6 ]] && awk '$4 == "00" { found = 1 } END { exit !found }' "$IF_INET6"
}

# Emit the commands --apply runs, in execution order: every rule inserts at the
# top of its chain, so the documented order prints in reverse. Pasting the
# output verbatim reproduces the intended chain.
print_family() {
  local cmd="$1" rules=() line i
  command -v "$cmd" >/dev/null 2>&1 || return 0
  while IFS= read -r line; do rules+=("$line"); done < <("$2")
  for ((i = ${#rules[@]} - 1; i >= 0; i--)); do
    line="${rules[i]}"
    printf '%s -I %s 1 %s\n' "$cmd" "${line%% *}" "${line#* }"
  done
}

require_root() {
  if ((EUID == 0)); then return 0; fi
  if [[ "${BOBBOT_EGRESS_SUDOED:-${RAKAZO_EGRESS_SUDOED:-}}" == "1" ]]; then
    echo "root privileges required" >&2
    exit 1
  fi
  export BOBBOT_EGRESS_SUDOED=1
  exec sudo --preserve-env=BOBBOT_EGRESS_SUDOED bash "$0" "$@"
}

install_persistence() {
  if ! command -v "$SYSTEMCTL" >/dev/null 2>&1; then
    echo "systemd not found; rules apply until reboot — re-run this script after one." >&2
    return 0
  fi
  if [[ "$0" == "bash" || "$0" == "-bash" || ! -f "$0" ]]; then
    echo "Run from a saved file to enable reboot persistence; rules were applied anyway." >&2
    return 0
  fi
  if [[ "$(readlink -f "$0")" != "$INSTALLED_PATH" ]]; then
    install -m 0755 "$0" "$INSTALLED_PATH"
  fi
  # The mode and its allowlist are part of the policy, so the unit repeats them:
  # after a reboot, `--apply` would otherwise fall back to the default mode.
  local allow_list
  allow_list="$(allowlist_entries | paste -sd, -)"
  cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Enforce BobBot bot-computer egress ($EGRESS_MODE) on rakazo-c* bridges
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=SANDBOX_COMPUTER_EGRESS=$EGRESS_MODE
Environment=SANDBOX_COMPUTER_EGRESS_ALLOW=$allow_list
ExecStart=$INSTALLED_PATH --apply

[Install]
WantedBy=multi-user.target
EOF
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable rakazo-computer-egress.service
}

remove_persistence() {
  if command -v "$SYSTEMCTL" >/dev/null 2>&1 && [[ -f "$UNIT_PATH" ]]; then
    "$SYSTEMCTL" disable --now rakazo-computer-egress.service || true
    rm -f "$UNIT_PATH"
    "$SYSTEMCTL" daemon-reload
  fi
  rm -f "$INSTALLED_PATH"
}

mode="${1:---install}"
case "$mode" in
  --install)
    validate_config
    require_root "$@"
    apply_rules
    install_persistence
    case "$EGRESS_MODE" in
      restricted)
        echo "Computer egress restricted: rakazo-c* bridges drop non-public and host-bound traffic."
        ;;
      allowlist)
        echo "Computer egress allowlisted: rakazo-c* bridges reach only $(allowlist_entries | paste -sd, -) and DNS."
        ;;
      offline)
        echo "Computer egress offline: rakazo-c* bridges reach nothing, including DNS."
        ;;
    esac
    ;;
  --apply)
    validate_config
    apply_rules
    ;;
  --remove)
    require_root "$@"
    # Every mode the script can install is deleted, so removing works without
    # remembering which mode was active when the rules went in.
    remove_recorded_rules
    remove_family "$IPTABLES" egress_rules_all_v4
    remove_family "$IP6TABLES" egress_rules_all_v6
    rm -f "$STATE_FILE"
    remove_persistence
    echo "Computer egress rules and persistence removed."
    ;;
  --print)
    validate_config
    print_family "$IPTABLES" egress_rules_v4
    print_family "$IP6TABLES" egress_rules_v6
    ;;
  -h | --help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
