#!/usr/bin/env bash
# #2945 — o FIM da instalação volta a PROVAR que a rota PÚBLICA `/auth/v1/*`
# chega ao GoTrue do Supabase no modo `REVERSE_PROXY=traefik`.
#
# O QUE ESTÁ SOB PROVA
#
# O #2933 mandou o `v_sb_key()` do install.sh perguntar ao gateway INTERNO
# (`SUPABASE_INTERNAL_URL`) — o certo atrás de Cloudflare laranja, o padrão do
# kit. De efeito colateral, a instalação perdeu a única coisa que provava, sem
# querer, que a rota pública `/auth/v1/*` chega ao Envoy do Supabase (#2099):
# sem as etiquetas do Traefik, ela terminava verde e o erro só aparecia no
# primeiro login. A sonda `sondar_rota_publica_do_supabase` (`_common.sh`)
# devolve essa prova: bate em `https://DOMINIO/auth/v1/settings` com a anon key
# e reprova quando quem responde é o app (404), citando o #2099.
#
# DOIS BLOCOS
#
#   (1) COMPORTAMENTO da sonda, com o `curl` dublado: 200 do GoTrue aprova;
#       404 do app REPROVA e a mensagem cita o #2099; falha transitória (000)
#       ganha nova tentativa; o 404 é DEFINITIVO (uma chamada só, não se insiste
#       contra quem já respondeu). O dublê registra a URL e o cabeçalho de cada
#       chamada, e é o que prova que a sonda usa a URL PÚBLICA com o sufixo
#       `/auth/v1/settings` e a anon key — não o gateway interno da VPS.
#
#   (2) A GUARDA, lida do install.sh e AVALIADA de verdade (não uma
#       reimplementação, que ficaria verde com o install.sh sabotado): a sonda
#       entra no modo traefik com o Supabase desta VPS, e NÃO entra em caddy —
#       nem num traefik com o Supabase na NUVEM, em que a URL pública não tem
#       as APIs e o 404 seria o mesmo falso alarme que o #2933 tirou da fase 2.
#
# Nada aqui toca Docker, rede ou a máquina de quem roda: o `curl` é dublê e
# nenhuma chamada HTTP acontece de verdade.
#
#   bash tests/shell/single-server-traefik-rota-publica.test.sh
set -uo pipefail
unset COMPOSE_PROJECT_NAME SINGLE_SERVER REVERSE_PROXY TRAEFIK_ENABLE \
  TRAEFIK_HOST TRAEFIK_NETWORK SUPABASE_INTERNAL_URL APP_SAUDAVEL 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
KIT="$ROOT/hostgator-setup-kit"
COMMON="$KIT/_common.sh"
INSTALL_SH="$KIT/install.sh"
INSTALADOR="$KIT/install-single-server.sh"
DOMINIO="https://crm.exemplo.com.br"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.assinatura-de-teste"
FAILS=0

check() {
  local descricao="$1"
  shift
  if "$@"; then
    printf '  ✓ %s\n' "$descricao"
  else
    printf '  ✗ %s\n' "$descricao"
    FAILS=$((FAILS + 1))
  fi
}
igual() { [ "$1" = "$2" ] || { printf '    esperado [%s], veio [%s]\n' "$2" "$1"; return 1; }; }
contem() { case "$1" in *"$2"*) return 0 ;; *) printf '    [%s] não está em [%s]\n' "$2" "$1"; return 1 ;; esac; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ════════════════════════════════════════════════════════════════════════════
# (1) A sonda — o `_common.sh` DE VERDADE, com o `curl` dublado
# ════════════════════════════════════════════════════════════════════════════
# O dublê devolve os códigos na ordem dada (o último repete quando a lista
# acaba) e REGISTRA a URL e o cabeçalho de cada chamada. É a mesma forma que o
# test-validators.sh usa para os validadores do install.sh: a função real, sob
# um `curl` que não sai da máquina.
sonda_roda() {  # sonda_roda <casa> <códigos, um por linha> [anon key] → "rc|saída"
  local casa="$1" codigos="$2" anon="${3-$ANON}" rc saida
  mkdir -p "$casa"
  saida="$(CODIGOS="$codigos" CONTADOR="$casa/contador" REGISTRO="$casa/registro" \
    bash -c '
      set -uo pipefail
      curl() {
        local prev="" url="" fmt="" so_codigo=0 hdr=""
        for a in "$@"; do
          case "$prev" in
            -w) fmt="$a";;
            -o) so_codigo=1;;
            -H) hdr="$a";;
          esac
          case "$a" in http://*|https://*) url="$a";; esac
          prev="$a"
        done
        printf "%s\t%s\n" "$url" "$hdr" >> "$REGISTRO"
        local n; n="$(cat "$CONTADOR" 2>/dev/null || printf 0)"; n=$((n + 1)); printf "%s" "$n" > "$CONTADOR"
        local code; code="$(printf "%s\n" "$CODIGOS" | sed -n "${n}p")"
        [ -n "$code" ] || code="$(printf "%s\n" "$CODIGOS" | tail -1)"
        [ "$so_codigo" = 1 ] || printf "%s" "{}"
        [ -z "$fmt" ] || { fmt="${fmt//%\{http_code\}/$code}"; printf "%s" "$fmt"; }
        return 0
      }
      . "$1/_common.sh"
      set +e
      sondar_rota_publica_do_supabase "$2" "$3" 3 1
    ' _ "$KIT" "$DOMINIO" "$anon" 2>&1)" && rc=0 || rc=$?
  printf '%s|%s' "$rc" "$saida"
}
chamadas() { [ -f "$1/registro" ] && wc -l < "$1/registro" | tr -d '[:space:]' || printf 0; }

echo "a sonda (#2945): 200 do GoTrue aprova, 404 do app reprova"

c200="$WORK/caso-200"
check "200 do GoTrue: a sonda APROVA a instalação" \
  igual "$(sonda_roda "$c200" 200)" '0|'
check "a sonda pergunta à URL PÚBLICA, com o sufixo /auth/v1/settings" \
  contem "$(cat "$c200/registro")" "${DOMINIO}/auth/v1/settings"
check "a sonda manda a anon key no cabeçalho apikey" \
  contem "$(cat "$c200/registro")" "apikey: ${ANON}"

c404="$WORK/caso-404"
saida404="$(sonda_roda "$c404" 404)"
check "404 do app: a sonda REPROVA a instalação" igual "${saida404%%|*}" '1'
check "404 do app: a mensagem diz que a rota do Supabase no Traefik não pegou" \
  contem "$saida404" "não pegou no Traefik"
check "404 do app: a mensagem cita a issue #2099" \
  contem "$saida404" "#2099"
check "404 do app: a mensagem diz que quem respondeu foi o CRM" \
  contem "$saida404" "quem respondeu foi o CRM"
check "404 é DEFINITIVO: uma única chamada (não se insiste contra o app)" \
  igual "$(chamadas "$c404")" '1'

c000200="$WORK/caso-000-200"
check "falha transitória (000) seguida de 200: aprova na segunda tentativa" \
  igual "$(sonda_roda "$c000200" "$(printf '000\n200')")" '0|'
check "…e foram mesmo duas chamadas" igual "$(chamadas "$c000200")" '2'

c000="$WORK/caso-000"
saida000="$(sonda_roda "$c000" "$(printf '000\n000\n000')")"
check "esgotadas as tentativas sem 2xx: a sonda REPROVA" igual "${saida000%%|*}" '1'
check "…e a mensagem também cita o #2099" contem "$saida000" "#2099"
check "…depois das 3 tentativas" igual "$(chamadas "$c000")" '3'

csem="$WORK/caso-sem-chave"
saidasem="$(sonda_roda "$csem" 200 "")"
check "sem a anon key a sonda reprova com o diagnóstico certo (não faz um pedido cego)" \
  igual "${saidasem%%|*}" '1'
check "…e diz qual variável falta" contem "$saidasem" "NEXT_PUBLIC_SUPABASE_ANON_KEY"
check "…sem tocar a rede (nenhuma chamada registrada)" igual "$(chamadas "$csem")" '0'

# ════════════════════════════════════════════════════════════════════════════
# (2) A guarda — lida do install.sh e AVALIADA
# ════════════════════════════════════════════════════════════════════════════
echo
echo "a guarda (#2945): a sonda só entra no traefik, com o Supabase desta VPS"

# A linha `if` que abre o bloco, LIDA do arquivo e executada: a condição de
# verdade, não uma cópia. Se o install.sh deixar de exigir o modo traefik, é
# este caso que cai — reescrever a condição aqui ficaria verde com o fonte
# sabotado.
n_sonda="$(grep -n 'sondar_rota_publica_do_supabase' "$INSTALL_SH" | head -1 | cut -d: -f1)"
guarda=""
for ((i = n_sonda; i > 0; i--)); do
  linha="$(sed -n "${i}p" "$INSTALL_SH")"
  case "$linha" in
    if\ *then)
      guarda="${linha#if }"
      guarda="${guarda%then}"
      guarda="$(printf '%s' "$guarda" | sed 's/[[:space:];]*$//')"
      break
      ;;
  esac
done
check "li a guarda do install.sh (não é vacuidade — sem ela, o resto não mede nada)" \
  test -n "$guarda"

veredito_guarda() {  # veredito_guarda <REVERSE_PROXY> <SUPABASE_INTERNAL_URL> <APP_SAUDAVEL> → ENTRA|NAO
  REVERSE_PROXY="$1" SUPABASE_INTERNAL_URL="$2" APP_SAUDAVEL="$3" \
    bash -c "if $guarda; then printf ENTRA; else printf NAO; fi" 2>/dev/null
}
check "traefik + Supabase desta VPS + app saudável: a sonda ENTRA" \
  igual "$(veredito_guarda traefik http://127.0.0.1:8000 1)" ENTRA
check "CONTROLE Caddy: a sonda NÃO entra" \
  igual "$(veredito_guarda caddy http://127.0.0.1:8000 1)" NAO
check "CONTROLE sem REVERSE_PROXY no ambiente: o padrão caddy mantém a sonda fora" \
  igual "$(veredito_guarda '' http://127.0.0.1:8000 1)" NAO
check "CONTROLE Supabase na NUVEM (sem URL interna): a sonda NÃO entra" \
  igual "$(veredito_guarda traefik '' 1)" NAO
check "CONTROLE app não saudável: a sonda NÃO entra" \
  igual "$(veredito_guarda traefik http://127.0.0.1:8000 0)" NAO

# ════════════════════════════════════════════════════════════════════════════
# (3) As pontas: onde a sonda mora, onde ela é chamada, e o comentário do #2099
# ════════════════════════════════════════════════════════════════════════════
echo
echo "as pontas (#2945)"

check "a sonda está em _common.sh (a lib compartilhada pelo kit)" \
  grep -q '^sondar_rota_publica_do_supabase()' "$COMMON"
check "sintaxe Bash válida em _common.sh, install.sh e install-single-server.sh" \
  bash -c 'for f in "$@"; do bash -n "$f" || exit 1; done' _ "$COMMON" "$INSTALL_SH" "$INSTALADOR"
check "sintaxe Bash válida neste teste" bash -n "${BASH_SOURCE[0]}"

n_health="$(grep -n 'wait_app_healthy 30 3' "$INSTALL_SH" | head -1 | cut -d: -f1)"
check "a sonda é chamada DEPOIS do healthcheck do app" \
  test "${n_sonda:-0}" -gt "${n_health:-999999}"
n_banner="$(grep -n 'Instalação concluída!' "$INSTALL_SH" | tail -1 | cut -d: -f1)"
check "a sonda é chamada ANTES da tela final (a prova não chega depois do verde)" \
  test "${n_sonda:-0}" -lt "${n_banner:-0}"
check "a URL sondada é o domínio do .env (DOMAIN), e não a URL do Supabase da nuvem" \
  grep -q 'sondar_rota_publica_do_supabase "https://\${DOMAIN}"' "$INSTALL_SH"

# O pedido 2 do autor: o comentário do install-single-server.sh afirmava que
# `v_sb_key()` chama a rota pública — não chama mais desde o #2933.
check "o comentário não afirma mais que v_sb_key() chama a rota pública" \
  bash -c '! grep -q "v_sb_key() chama" "$1"' _ "$INSTALADOR"
check "…e aponta a sonda que passou a provar a rota pública" \
  grep -q 'sondar_rota_publica_do_supabase' "$INSTALADOR"

echo
if [ "$FAILS" -ne 0 ]; then
  printf '%d caso(s) reprovado(s)\n' "$FAILS"
  exit 1
fi
echo "todos os casos passaram"
