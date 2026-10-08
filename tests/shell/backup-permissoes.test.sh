#!/usr/bin/env bash
# Prova de que o backup.sh guarda o que salva só para o dono: todo arquivo de
# backup 600 e a pasta backups/ 700, QUALQUER que seja o umask de quem chama.
#
#   bash tests/shell/backup-permissoes.test.sh
#
# O defeito, medido numa VPS (PR 4, #2524): com umask 022 o dump do banco saía
# 644 e a pasta 755; e a sessão do WhatsApp (waha-*.tgz) e os anexos dos
# clientes (storage-*.tgz) saíam 644 MESMO com umask 077 — o `tar` deles roda
# dentro de um contêiner alpine, que nasce com o umask PRÓPRIO (022) e não herda
# o do host. A sessão do WhatsApp é o pareamento do número inteiro: quem a lê
# fala em nome da empresa.
#
# O dublê de docker reproduz a semântica que importa: EXECUTA o comando do
# contêiner com umask 022 (o padrão de uma imagem alpine), com /data e /out
# trocados pelas pastas montadas. Assim o que decide o modo do arquivo é o
# comando que o backup.sh manda ao contêiner, como na VPS. Nada aqui toca o
# docker de verdade nem o stack do CRM.
set -uo pipefail
unset COMPOSE_PROJECT_NAME

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KIT_DIR="$ROOT/hostgator-setup-kit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
case "$WORK" in *"/out/"*|*"/data"*) echo "WORK ($WORK) colide com a troca de caminho do dublê" >&2; exit 2 ;; esac

FAILS=0
check() {  # check <descrição> <comando...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}
modo() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
modo_e() {  # modo_e <arquivo> <modo esperado>
  local m; m="$(modo "$1")"
  [ "$m" = "$2" ] || { printf '    %s: esperado %s, veio %s\n' "${1##*/}" "$2" "$m"; return 1; }
}

# ── Dublê de docker ──────────────────────────────────────────────────────────
export SESSOES="$WORK/volume-waha"
mkdir -p "$WORK/bin" "$SESSOES/noweb"
head -c 4096 /dev/urandom > "$SESSOES/noweb/waha.sqlite3"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
case " $* " in *" run "*) ;; *) exit 0 ;; esac          # compose ps/inspect: nada a dizer
case " $* " in *" pg_dump "*) echo "-- dump"; exit 0 ;; esac
shift                                                     # "run"
declare -A monta=()
while [ $# -gt 0 ]; do
  case "$1" in
    --rm|-i) shift ;;
    -e|--network) shift 2 ;;
    -v) m="${2%:ro}"; destino="${m##*:}"; origem="${m%:*}"
        case "$origem" in /*) ;; *) origem="$SESSOES" ;; esac   # volume nomeado
        monta["$destino"]="$origem"; shift 2 ;;
    *) break ;;
  esac
done
shift                                                     # a imagem
cmd=()
for a in "$@"; do
  for d in /data /out; do [ -n "${monta[$d]:-}" ] && a="${a//$d/${monta[$d]}}"; done
  cmd+=("$a")
done
# O contêiner nasce com o umask da imagem, não o de quem chamou o docker.
( umask 022; "${cmd[@]}" )
STUB
chmod +x "$WORK/bin/docker"
PATH="$WORK/bin:$PATH"

# Uma instalação single-server falsa: os três tipos de arquivo saem num backup só.
PROJ="$WORK/root/DeskcommCRM"
mkdir -p "$PROJ/.runtime/supabase/volumes/storage/stub"
printf 'foto' > "$PROJ/.runtime/supabase/volumes/storage/stub/anexo.jpg"
: > "$PROJ/docker-compose.prod.yml"
printf '%s\n' 'SINGLE_SERVER="1"' 'SUPABASE_DB_URL="postgresql://postgres:x@supabase-db:5432/postgres"' > "$PROJ/.env"

for mascara in 022 077; do
  echo "backup.sh chamado com umask $mascara:"
  rm -rf "$PROJ/backups"
  mkdir -p "$PROJ/backups"; chmod 755 "$PROJ/backups"   # a pasta que um backup antigo deixou
  ( umask "$mascara"; cd "$PROJ" && bash "$KIT_DIR/backup.sh" ) > "$WORK/saida-$mascara.txt" 2>&1; rc=$?
  check "o backup termina bem" test "$rc" -eq 0
  [ "$rc" -eq 0 ] || sed 's/^/    | /' "$WORK/saida-$mascara.txt"
  check "a pasta backups/ é 700" modo_e "$PROJ/backups" 700
  for tipo in db-'*'.sql.gz waha-'*'.tgz storage-'*'.tgz; do
    arq="$(ls "$PROJ"/backups/$tipo 2>/dev/null | head -1 || true)"
    if [ -z "$arq" ]; then check "$tipo existe" false; continue; fi
    check "${tipo%%-*} é 600" modo_e "$arq" 600
  done
done

[ "$FAILS" -eq 0 ] || { echo "✖ $FAILS falha(s)" >&2; exit 1; }
echo 'ok: o backup.sh guarda banco, sessão do WhatsApp e anexos só para o dono, qualquer que seja o umask'
