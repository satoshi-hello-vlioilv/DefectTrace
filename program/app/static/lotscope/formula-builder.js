"use strict";
/* =========================================================================
   式ビルダー（式の書き方に慣れていない人のための、組み立てて作る入口）
   - 表示列の「この列の作り方」の窓（lotlist-rules.js）の「式を書く」の「部品から作る」で、文のように選んで組み立て、
     「式にする」で式の欄へ入れる（条件で分ける式は、同じ窓の「組み立てる」＝表示ルールと同じ組み立てで作る。ここでは出さない: opts.kinds）。組み立てた物は式の字（list-formula.js の書き方）に変えるだけで、式の決まりは増やさない
     （計算・確かめは今までどおり list-formula.js の 1 か所。WaveLog と同じ書き方・同じ答え）。
   - 組み立ての形（KINDS）: 計算する・条件で分ける・文字をつなぐ・文字を取り出す・空なら別の値・数を丸める・文字を数える・時間の差（版 3.46.0）
   - 値の欄（項）は「列」か「数・文字を打つ」。打った字は数に読めれば数、読めなければ '文字'（' は '' にする）
   - build(spec) は DOM を使わない（評価関数 program/tools/formula-builder-check.mjs が node で確かめる）
   ========================================================================= */
(function (root) {
  const KINDS = [
    ["calc", "計算する", "列や数を ＋ − × ÷ でつなぎます（例: 重量 ÷ 板幅）"],
    ["if", "条件で分ける", "条件に合うかで、出す値を分けます（例: 重量が 1000 以上なら「重」）"],
    ["join", "文字をつなぐ", "列や文字を、区切りを挟んでつなぎます（例: 合金-調質）"],
    ["cut", "文字を取り出す", "左から・右から・途中から、何文字かを取り出します"],
    ["fill", "空なら別の値", "空欄のときだけ、別の列や文字を出します"],
    ["round", "数を丸める", "小数の桁を決めて四捨五入します"],
    // 版 3.46.0（利用者の要望 2026-10-21 の 5: 文字列のカウント）
    ["count", "文字を数える", "文字数・ある字が何回出てくるか・バイト数（全角 2・半角 1）を数えます"],
    ["span", "時間の差", "2 つの日時の差を、分・時間・日で出します（例: 作業開始から作業終了までの分）"],
  ];
  const OPS = [["+", "＋"], ["-", "−"], ["*", "×"], ["/", "÷"]];
  const CMPS = [["=", "と同じ"], ["<>", "と違う"], [">", "より大きい"], [">=", "以上"], ["<", "より小さい"], ["<=", "以下"],
    ["contains", "を含む"], ["startswith", "で始まる"], ["endswith", "で終わる"], ["empty", "が空欄"], ["notempty", "が空欄でない"]];
  const CUTS = [["left", "左から"], ["right", "右から"], ["mid", "途中（何文字目から）"]];
  const COUNTS = [["len", "の文字数"], ["count", "の中の字の数"], ["lenb", "のバイト数"]];
  const SPANS = [["m", "分"], ["h", "時間"], ["d", "日"]];

  /** 文字 → 式の文字の書き方。式の決まりは '…' か "…" で、中で引用符を重ねる書き方は無い（list-formula.js の lex）。
      ' を含めば "…"、両方を含めば ' の所で分けて concat でつなぐ */
  function quote(v) {
    if (!v.includes("'")) return `'${v}'`;
    if (!v.includes('"')) return `"${v}"`;
    return `concat(${v.split("'").map((x) => `'${x}'`).join(`, "'", `)})`;
  }
  /** 項 {col} か {val} → 式の字。列は [名前]。値は数に読めれば数、ほかは文字 */
  function term(t) {
    if (!t) return "''";
    if (t.col) return `[${String(t.col)}]`;
    const v = String(t.val ?? "").trim();
    if (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) return v;
    return quote(String(t.val ?? ""));
  }
  /** 組み立て → 式の字（足りなければ ""） */
  function build(s) {
    if (!s || !s.kind) return "";
    if (s.kind === "calc") {
      const ts = (s.terms || []).filter(Boolean);
      if (!ts.length) return "";
      const body = ts.map((t, i) => (i ? ` ${OPS.some((o) => o[0] === t.op) ? t.op : "+"} ` : "") + term(t)).join("");
      return s.decimals !== "" && s.decimals != null ? `round(${body}, ${Math.max(0, Math.min(8, +s.decimals || 0))})` : body;
    }
    if (s.kind === "if") {
      const a = term(s.left), op = s.cmp || "=", b = term(s.right);
      const cond = op === "empty" ? `trim(text(${a})) = ''` : op === "notempty" ? `trim(text(${a})) <> ''`
        : ["contains", "startswith", "endswith"].includes(op) ? `${op}(${a}, ${b})` : `${a} ${op} ${b}`;
      return `if(${cond}, ${term(s.then)}, ${term(s.else)})`;
    }
    if (s.kind === "join") {
      const ts = (s.terms || []).filter(Boolean);
      if (!ts.length) return "";
      const sep = String(s.sep ?? "");
      const parts = sep ? ts.flatMap((t, i) => (i ? [term({ val: sep }), term(t)] : [term(t)])) : ts.map(term);
      return parts.length === 1 ? `text(${parts[0]})` : `concat(${parts.join(", ")})`;
    }
    if (s.kind === "cut") {
      const x = term(s.from), n = Math.max(0, +s.count || 0);
      if (s.how === "right") return `right(${x}, ${n})`;
      if (s.how === "mid") return `mid(${x}, ${Math.max(1, +s.start || 1)}, ${n})`;
      return `left(${x}, ${n})`;
    }
    if (s.kind === "fill") return `coalesce(${term(s.from)}, ${term(s.alt)})`;
    if (s.kind === "round") return `round(${term(s.from)}, ${Math.max(0, Math.min(8, +s.decimals || 0))})`;
    if (s.kind === "count") return s.how === "count" ? `count(${term(s.from)}, ${term(s.what)})` : `${s.how === "lenb" ? "lenb" : "len"}(${term(s.from)})`;
    if (s.kind === "span") return `datediff(${term(s.from)}, ${term(s.to)}, '${SPANS.some((x) => x[0] === s.unit) ? s.unit : "m"}')`;
    return "";
  }
  /** 形ごとの最初の組み立て（列は 1 つ目・2 つ目の列で埋める＝何も選ばなくても式の形が見える） */
  function blank(kind, cols) {
    const a = { col: cols[0] || "" }, b = cols[1] ? { col: cols[1] } : { val: "" };
    return {
      calc: { kind, terms: [a, { ...b, op: "+" }], decimals: "" },
      if: { kind, left: a, cmp: "=", right: { val: "" }, then: { val: "○" }, else: { val: "" } },
      join: { kind, terms: [a, b], sep: "-" },
      cut: { kind, from: a, how: "left", count: 2, start: 1 },
      fill: { kind, from: a, alt: { val: "-" } },
      round: { kind, from: a, decimals: 1 },
      count: { kind, from: a, how: "len", what: { val: "、" } },
      span: { kind, from: a, to: b, unit: "m" },
    }[kind];
  }

  /* ---------------- 画面（DOM がある所だけ） ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  /** 項の欄: 列の選択（「数・文字を打つ」で打つ欄に替わる） */
  function termHtml(t, cols, path, { label = "", allowEmpty = false } = {}) {
    const typed = !t || !t.col;
    return `<span class="fb-term${typed ? " is-typed" : ""}" data-path="${path}">${label ? `<small>${esc(label)}</small>` : ""}<select data-k="col" aria-label="${esc(label || "列")}">`
      + `<option value="__val"${typed ? " selected" : ""}>値を打つ…</option>`
      + cols.map((c) => `<option value="${esc(c)}"${!typed && t.col === c ? " selected" : ""}>${esc(c)}</option>`).join("") + "</select>"
      + (typed ? `<input data-k="val" value="${esc(t ? t.val ?? "" : "")}" placeholder="${allowEmpty ? "空のまま＝空欄" : "数か文字"}" aria-label="数・文字">` : "") + "</span>";
  }
  const sel = (k, list, v, label) => `<select data-k="${k}" aria-label="${esc(label)}">${list.map(([x, n]) => `<option value="${esc(x)}"${String(v) === String(x) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  function sentenceHtml(s, cols) {
    if (s.kind === "calc") return s.terms.map((t, i) => (i ? sel(`op.${i}`, OPS, t.op || "+", "計算") : "") + termHtml(t, cols, `terms.${i}`)
      + (i > 1 ? `<button type="button" class="fb-x" data-drop="${i}" title="この項を外します">×</button>` : "")).join("")
      + '<button type="button" class="fb-add" data-add="terms" title="項を足します">＋ 項を足す</button>'
      + `<span class="fb-opt">小数${sel("decimals", [["", "そのまま"], ...[0, 1, 2, 3, 4].map((n) => [n, `${n}桁に丸める`])], s.decimals ?? "", "小数")}</span>`;
    if (s.kind === "if") return `<span class="fb-w">もし</span>${termHtml(s.left, cols, "left")}<span class="fb-w">が</span>`
      + (["empty", "notempty"].includes(s.cmp) ? "" : termHtml(s.right, cols, "right")) + sel("cmp", CMPS, s.cmp, "比べ方")
      + `<span class="fb-w">なら</span>${termHtml(s.then, cols, "then", { allowEmpty: true })}<span class="fb-w">そうでなければ</span>${termHtml(s.else, cols, "else", { allowEmpty: true })}`;
    if (s.kind === "join") return s.terms.map((t, i) => (i ? '<span class="fb-w">と</span>' : "") + termHtml(t, cols, `terms.${i}`)
      + (i > 1 ? `<button type="button" class="fb-x" data-drop="${i}" title="この項を外します">×</button>` : "")).join("")
      + '<button type="button" class="fb-add" data-add="terms">＋ 足す</button>'
      + `<span class="fb-opt">区切り<input data-k="sep" value="${esc(s.sep)}" size="3" placeholder="なし" aria-label="区切り"></span>`;
    if (s.kind === "cut") return `${termHtml(s.from, cols, "from")}<span class="fb-w">の</span>${sel("how", CUTS, s.how, "取り出し方")}`
      + (s.how === "mid" ? `<input data-k="start" type="number" min="1" value="${esc(s.start)}" class="fb-num" aria-label="何文字目から"><span class="fb-w">文字目から</span>` : "")
      + `<input data-k="count" type="number" min="0" value="${esc(s.count)}" class="fb-num" aria-label="文字数"><span class="fb-w">文字</span>`;
    if (s.kind === "fill") return `${termHtml(s.from, cols, "from")}<span class="fb-w">が空なら</span>${termHtml(s.alt, cols, "alt")}<span class="fb-w">を出す</span>`;
    if (s.kind === "round") return `${termHtml(s.from, cols, "from")}<span class="fb-w">を小数</span>${sel("decimals", [0, 1, 2, 3, 4, 5].map((n) => [n, `${n}桁`]), s.decimals, "小数")}<span class="fb-w">に丸める</span>`;
    if (s.kind === "count") return `${termHtml(s.from, cols, "from")}${sel("how", COUNTS, s.how, "数え方")}`
      + (s.how === "count" ? `<span class="fb-w">（数える字</span>${termHtml(s.what, cols, "what")}<span class="fb-w">）</span>` : "");
    if (s.kind === "span") return `${termHtml(s.from, cols, "from")}<span class="fb-w">から</span>${termHtml(s.to, cols, "to")}<span class="fb-w">までを</span>${sel("unit", SPANS, s.unit, "単位")}<span class="fb-w">で</span>`;
    return "";
  }
  /* 欄の値 → 組み立て（path は "terms.1"・"left" など） */
  function setAt(s, path, k, v) {
    const [a, i] = path.split(".");
    const t = i == null ? s[a] : s[a][+i];
    if (k === "col") { if (v === "__val") { delete t.col; t.val = t.val ?? ""; } else { t.col = v; delete t.val; } }
    else t[k] = v;
  }
  /**
   * 置いた所（el）にビルダーを描く。opts: columns()（列の表示名）・preview(式) → 先頭の結果の字の並び・apply(式, how)（how: replace|insert）
   *   ・kinds（出す形の名前の並び。省くと全部）・kind（最初の形）
   */
  function mount(el, opts) {
    let s = null;
    const cols = () => opts.columns();
    const kinds = opts.kinds ? KINDS.filter(([k]) => opts.kinds.includes(k)) : KINDS;
    function paint() {
      if (!s) s = blank(opts.kind || "calc", cols());
      const f = build(s), chk = f && root.WL ? root.WL.formula.check(f) : null, pv = chk && chk.ok ? opts.preview(f) : [];
      el.innerHTML = `<div class="fb-kinds" role="radiogroup" aria-label="作る形">${kinds.map(([k, n, tip]) =>
        `<button type="button" role="radio" aria-checked="${s.kind === k}" data-kind="${k}" title="${esc(tip)}">${n}</button>`).join("")}</div>`
        + `<div class="fb-sentence">${sentenceHtml(s, cols())}</div>`
        + `<div class="fb-out"><span class="fb-lab">できる式</span><code class="fb-code${chk && !chk.ok ? " is-ng" : ""}">${esc(f || "（まだ組み立てていません）")}</code>`
        + (chk && !chk.ok ? `<small class="fb-ng">${esc(chk.error)}</small>` : pv.length ? `<span class="fb-pv"><span class="fb-lab">先頭の結果</span>${pv.map((v) => `<code>${esc(v) || "（空欄）"}</code>`).join("")}</span>` : "")
        + `</div><div class="fb-acts"><button type="button" class="fb-apply" data-apply="replace"${chk && chk.ok ? "" : " disabled"} title="組み立てた式で、式の欄を置き換えます">式にする</button>`
        + `<button type="button" data-apply="insert"${chk && chk.ok ? "" : " disabled"} title="式の欄のカーソルの所へ足します（いまの式に組み込むとき）">式の欄に足す</button></div>`;
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.kind) { s = blank(b.dataset.kind, cols()); paint(); return; }
      if (b.dataset.add) { s.terms.push(s.kind === "calc" ? { val: "", op: "+" } : { val: "" }); paint(); return; }
      if (b.dataset.drop) { s.terms.splice(+b.dataset.drop, 1); paint(); return; }
      if (b.dataset.apply) opts.apply(build(s), b.dataset.apply);
    });
    const onEdit = (e) => {
      const x = e.target, k = x.dataset.k; if (!k) return;
      const t = x.closest(".fb-term");
      if (t) setAt(s, t.dataset.path, k, x.value);
      else if (k.startsWith("op.")) s.terms[+k.slice(3)].op = x.value;
      else s[k] = x.value;
      if (e.type === "change") paint();
      else { const f = build(s), code = el.querySelector(".fb-code"); if (code) code.textContent = f; }   // 打っている間は式だけ（欄は作り直さない）
    };
    el.addEventListener("change", onEdit);
    el.addEventListener("input", (e) => { if (e.target.matches("input")) onEdit(e); });
    paint();
    return { refresh: paint };
  }

  root.FormulaBuilder = { KINDS, build, blank, term, mount };
})(typeof window !== "undefined" ? window : globalThis);
