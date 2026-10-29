#!/usr/bin/env bash
# Полная проверка сайта в браузере.
#   bash tests/browser/run.sh            — собрать сайт и проверить локально (все проверки)
#   bash tests/browser/run.sh 04 07      — только выбранные проверки
#   bash tests/browser/run.sh --live     — проверить живой сайт (без 08: там подменяется версия)
# Снимки и полный вывод — в _proverka/ (в репозиторий не попадает).
set -u
cd "$(dirname "$0")/../.."
OUT=_proverka; mkdir -p "$OUT"
LIVE=0; ONLY=()
for a in "$@"; do [ "$a" = "--live" ] && LIVE=1 || ONLY+=("$a"); done

if [ $LIVE = 1 ]; then
  URL=https://raspisanie-utgt.github.io/
else
  python3 build_site.py >/dev/null || { echo "сборка сайта упала"; exit 1; }
  PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
  (cd _site && exec python3 -m http.server "$PORT" >/dev/null 2>&1) &
  SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
  sleep 1; URL=http://localhost:$PORT/
fi
echo "Проверяю $URL"

TOTAL=0; SUMMARY=""
for f in tests/browser/[0-9][0-9]_*.js; do
  n=$(basename "$f" | cut -c1-2)
  if [ ${#ONLY[@]} -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then continue; fi
  if [ $LIVE = 1 ] && [ "$n" = 08 ]; then continue; fi
  start=$(date +%s)
  SHOTS="$OUT" node "$f" "$URL" > "$OUT/$(basename "$f" .js).txt" 2>&1
  k=$(grep -o 'ИТОГ: проблем [0-9]*' "$OUT/$(basename "$f" .js).txt" | grep -o '[0-9]*$')
  [ -z "$k" ] && { k=1; echo "  (проверка $f упала — см. $OUT/$(basename "$f" .js).txt)"; }
  TOTAL=$((TOTAL + k))
  line="$(printf '%-28s проблем: %-4s %4s с' "$(basename "$f" .js)" "$k" "$(( $(date +%s) - start ))")"
  echo "$line"; SUMMARY+="$line"$'\n'
done
echo "ВСЕГО ПРОБЛЕМ: $TOTAL"
printf '%s' "$SUMMARY" > "$OUT/svodka.txt"
[ $TOTAL = 0 ]
