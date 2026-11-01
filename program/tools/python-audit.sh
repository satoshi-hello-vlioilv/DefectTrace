#!/usr/bin/env bash
# Python に頼っている所を測る（評価関数。Rust への作り直し〈版 4.9.0〉の前と後を同じ物差しで比べる）。
#   bash program/tools/python-audit.sh            数えるだけ（速い）
#   bash program/tools/python-audit.sh --run      Python を隠して、作る・試験・試験のロット・配る ZIP を実際に流す（数分）
#
# 1. Python のファイル（役割ごとの数と行数）
# 2. Python を呼ぶ所（作る・試験・CI・撮影の道具で、python を起こしている行）
# 3. --run: PATH の python・python3 を「無い」にすり替え（DT_PYTHON も外す）、次が通るかを流す
#    a. 作る（cargo build。アイコンを消して描き直させる）  b. 正解データとの突き合わせ（cargo test --test golden）
#    c. 試験のロットを作る  d. 配る ZIP を作る
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

echo "## 1. Python のファイル"
printf '| 置き場 | 数 | 行 |\n|---|---|---|\n'
for d in program/app program/tests program/tools desktop/bundle program; do
  if [ "$d" = program ]; then files=$(git ls-files 'program/*.py' | grep -vE '^program/(app|tests|tools)/'); else files=$(git ls-files "$d/*.py"); fi
  n=$(printf '%s\n' "$files" | grep -c . || true)
  lines=$( [ "$n" -gt 0 ] && printf '%s\n' "$files" | xargs cat | wc -l || echo 0)
  printf '| %s | %s | %s |\n' "$d" "$n" "$lines"
done

echo
echo "## 2. Python を呼ぶ所（行の数）"
printf '| 場所 | 行 |\n|---|---|\n'
total=0
for f in desktop/build.rs desktop/tests/*.rs .github/workflows/*.yml program/tools/*.mjs; do
  [ -f "$f" ] || continue
  # 注釈（# と //）の行は数えない。python を起こす行・setup-python・DT_PYTHON を数える
  n=$(grep -vE '^\s*(#|//)' "$f" | grep -cE '(\bpython3?\b|setup-python|DT_PYTHON|sys\.executable)' || true)
  [ "$n" -gt 0 ] && { printf '| %s | %s |\n' "$f" "$n"; total=$((total + n)); }
done
printf '| 計 | %s |\n' "$total"

[ "${1:-}" = "--run" ] || exit 0

echo
echo "## 3. Python を隠して流す"
shim=$(mktemp -d)
for p in python python3 py; do printf '#!/bin/sh\necho "（測る道具が隠した）$0 は使えません" >&2\nexit 127\n' > "$shim/$p"; chmod +x "$shim/$p"; done
export PATH="$shim:$PATH"
unset DT_PYTHON
work=$(mktemp -d)
printf '| 工程 | 結果 | 時間 |\n|---|---|---|\n'
step() {  # 名前 コマンド…
  local name=$1; shift
  local t0=$SECONDS
  if "$@" >"$work/log" 2>&1; then r=通る; else r="**通らない**（$(grep -m1 -E 'error|panicked|使えません|No such|not found' "$work/log" | cut -c1-90)）"; fi
  printf '| %s | %s | %s 秒 |\n' "$name" "$r" $((SECONDS - t0))
}
# a. 作る: 描いたアイコンを退け、作る前の準備（build.rs）を流し直させる（DT_BUILD_COMMIT を変えると build.rs が流れ直す）
mkdir -p "$work/keep"
mv desktop/icons "$work/keep/icons" 2>/dev/null
mv desktop/splash/icon.png "$work/keep/splash-icon.png" 2>/dev/null
build() { (cd desktop && DT_BUILD_COMMIT="audit-$$" cargo build --locked -q); }
step "a. 作る（アイコンを描くところから）" build
[ -f desktop/icons/icon.ico ] || mv "$work/keep/icons" desktop/icons 2>/dev/null
[ -f desktop/splash/icon.png ] || mv "$work/keep/splash-icon.png" desktop/splash/icon.png 2>/dev/null
golden() { (cd desktop && cargo test --locked -q --test golden); }
step "b. 正解データとの突き合わせ" golden
# c・d は、いまの道具の入口（Rust に移っていれば cargo xtask、まだなら Python）で流す
if grep -q '^xtask' desktop/.cargo/config.toml 2>/dev/null; then
  fixture() { (cd desktop && cargo xtask fixture "$work/fx"); }
  bundle() { (cd desktop && cargo xtask bundle --exe target/debug/DefectTrace --out "$work/out"); }
else
  fixture() { python3 program/tests/fixture_lot.py "$work/fx"; }
  bundle() { python3 desktop/bundle/bundle.py build --exe desktop/target/debug/DefectTrace --out "$work/out"; }
fi
step "c. 試験のロットを作る" fixture
step "d. 配る ZIP を作る" bundle
rm -rf "$shim" "$work"
