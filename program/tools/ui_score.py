"""改良案の評価関数（開発用。決め方は CLAUDE.md の「改良するときは、別のエージェントが現物を撮って採点し、合格点以上の案に決める」）。

    python program/tools/ui_score.py program/tools/proposals/比較.json

採点は、案を作った者ではない別のエージェントが付ける。採点する者は自分で画面を撮り（ui-variants.mjs・ui-check.mjs）、
画像を直接見てから付ける（画面に出ない改良は、動かして測った数を見てから）。採点のファイル（JSON）:

    {"title": "…", "rule": "2026-10-17", "evaluator": "だれが・どう撮って採点したか",
     "rounds": [
      {"name": "1 回目", "images": "撮った画像のフォルダ",
       "self_check": "案を作った者が、採点に渡す前に自分で画像を見て確かめたこと（直した所）",
       "proposals": {"A 案の名前": {"score": {"order": 8, …（11 項目。0〜10）},
                                     "minus": [{"kind": "cut", "where": "どの画像のどこで"}],
                                     "seen": "画像で見えたこと（良い所・悪い所）"}, …},
       "baseline": {"今": {同じ形}}},
      {"name": "2 回目", …}],
     "built": {"name": "作った後", "images": "…", "result": {同じ形}}}

    "baseline" は比べるための今の画面（案ではないので順位に入れない。どれだけ良くなるかを見る）。
    "built" は、決めた案を作った後の本物の画面を、同じ物差しで採点した結果（作る前の画像の再現と本物の差を見る）。
    "applies": "決めた採点のファイル名" … ほかの比較で決めた形を、別の画面にそろえて当てただけのとき（案出しの回は持たず、
    "rounds" は空）。決めたファイルの判定を引き、"baseline"（今）と "built"（作った後）だけを同じ物差しで採点する。

点の付け方: 100 点満点の加点（4 分類・11 項目を 0〜10 で付け、重みを掛けて足す）から、減点（見つけた数だけ引く）を引く。
決め方: 1 回の案は 5 案以上。1 位が合格点以上なら 1 位に決める（同じ点なら、重い分類の点が高い方）。
  合格点は回によらず 80 点（利用者が決めた。2026-10-17。"rule": "2026-10-17"）。案を作った者は、採点に渡す前に自分で画像を見て確かめ、
  確かめたことを回の "self_check" に書く（無ければ判定しない）。
  "rule" が無いファイルは受け付けない（決まりの日付を書く）。
  合格点に届かなければ決めず、案出しからやり直す（前の回で効いた所は持ち越してよいが、新しい案を 3 案以上入れる）。
  3 回やり直しても届かなければ、いちばん高い案に決め、足りない点とその理由を利用者に伝える。
"""

import json
import sys

# 加点（4 分類・11 項目。重みの合計 100）。並びは重い分類の順（同じ点のとき、前の分類の点が高い方を上にする）
CRITERIA = [  # (分類, 鍵, 名前, 重み)
    ("わかりやすさ", "order", "順序（目と手が使う順に流れる）", 8),
    ("わかりやすさ", "chunk", "チャンク（まとまりが一目で分かれる）", 8),
    ("わかりやすさ", "hierarchy", "階層化（最初に見る物が 1 つ・主と従の差）", 8),
    ("わかりやすさ", "visual", "視覚化（数・状態を形・色・位置で見せる）", 8),
    ("使いやすさ", "steps", "ステップ数（目的までの手が少ない）", 10),
    ("使いやすさ", "effortless", "考えさせない（探させない・思い出させない・推測させない）", 10),
    ("使いやすさ", "intuitive", "直感的（見た目どおりに動く・慣れた型）", 10),
    ("統一感", "form", "形と色（同じ物は同じ形・同じ色）", 10),
    ("統一感", "place", "言葉と置き場（同じ物は同じ言葉・同じ場所）", 10),
    ("美しさ", "layout", "整列・余白・釣り合い", 9),
    ("美しさ", "tone", "色と文字の調子（色数・強弱・読みやすさ）", 9),
]
KEYS = [k for _, k, _, _ in CRITERIA]
WEIGHT = {k: w for _, k, _, w in CRITERIA}
GROUPS = list(dict.fromkeys(g for g, _, _, _ in CRITERIA))  # 重い順

# 減点（1 か所ごとに引く）。どの画像のどこで見たかを "where" に書く
DEDUCTIONS = {
    "lost": ("機能が消える・届かなくなる", 10),
    "cut": ("見切れ・はみ出し（字・ボタンが切れる、枠から出る）", 5),
    "overlap": ("重なり（部品・字が被る）", 5),
    "wrap": ("想定外の折り返し（1 段のはずが 2 段、ボタンの字が折れる）", 3),
    "unreadable": ("読みにくい字（11px 未満・コントラスト 4.5 未満の本文）", 3),
    "scroll": ("要らないスクロール（横に送る・二重のスクロール）", 3),
    "hidden_state": ("状態が見えない（何が効いているか・待っているか）", 3),
    "more_steps": ("前より手が増える（1 手ごと）", 2),
    "color_only": ("色だけで区別している", 2),
}

# 決めてよい点の下限（回ごと。最後の値が以降も続く）と、採点に渡す前の自分の確かめが要るか。決まりの名前ごと
RULES = {
    "2026-10-17": {"pass": (80,), "self_check": True},  # いまの決まり: 回によらず 80 点・渡す前に自分で画像を見る
}
CURRENT_RULE = "2026-10-17"
PASS_BY_ROUND = RULES[CURRENT_RULE]["pass"]
PASS = PASS_BY_ROUND[0]
MIN_PROPOSALS = 5  # 1 回に出す案の数の下限
MIN_NEW = 3  # やり直しの回に入れる新しい案の数の下限
MAX_ROUNDS = 3  # 届かなくても、この回で決める（足りない点を利用者に伝える）

def plus(entry):
    """加点（100 点満点）"""
    score = entry["score"]
    missing = [k for k in KEYS if k not in score]
    if missing or not all(0 <= score[k] <= 10 for k in KEYS):
        raise ValueError(f"加点は {len(KEYS)} 項目を 0〜10 で（足りない: {missing}）: {score}")
    return sum(WEIGHT[k] * score[k] / 10 for k in KEYS)


def minus(entry):
    """減点（見つけた所ごと）"""
    total = 0
    for m in entry.get("minus", []):
        if m.get("kind") not in DEDUCTIONS:
            raise ValueError(f"減点の種類が無い: {m.get('kind')}（{'・'.join(DEDUCTIONS)} のどれか）")
        if not m.get("where"):
            raise ValueError(f"減点「{DEDUCTIONS[m['kind']][0]}」に、どの画像のどこで見たか（where）が無い")
        total += DEDUCTIONS[m["kind"]][1]
    return total


def total(entry):
    """加点 − 減点（0〜100 点）"""
    return round(max(0.0, plus(entry) - minus(entry)), 1)


def group_points(entry):
    """分類ごとの加点（重い分類の順）。同じ点のときの並べ替えに使う"""
    return [sum(WEIGHT[k] * entry["score"][k] / 10 for g, k, _, _ in CRITERIA if g == group) for group in GROUPS]


def rank(proposals):
    """[(合計, 名前, 案)] を高い順に（同じ点なら、重い分類の点が高い方）"""
    return sorted(((total(e), name, e) for name, e in proposals.items()), key=lambda r: (-r[0], [-v for v in group_points(r[2])], r[1]))


def rule_of(data):
    """ファイルの決まり（"rule" が無ければ前の決まり）"""
    name = data.get("rule")
    if name not in RULES:
        raise ValueError(f"決まりの名前が無い: {name}（{'・'.join(RULES)} のどれか）")
    return RULES[name]


def pass_mark(i, rule=None):
    """i 回目（0 から）の合格点"""
    marks = (rule or RULES[CURRENT_RULE])["pass"]
    return marks[min(i, len(marks) - 1)]


def check_round(i, rnd, before, rule=None):
    """回の組み方が決まりどおりか（違えば理由の文）。before: 前の回までに出た案の名前"""
    proposals = rnd["proposals"]
    if len(proposals) < MIN_PROPOSALS:
        return f"案は {MIN_PROPOSALS} 案以上（いま {len(proposals)} 案）"
    blind = [name for name, e in proposals.items() if not e.get("seen")]
    if blind:
        return f"画像で見えたこと（seen）が無い案: {'・'.join(blind)}"
    if (rule or RULES[CURRENT_RULE])["self_check"] and not str(rnd.get("self_check", "")).strip():
        return "採点に渡す前に、案を作った者が自分で画像を見て確かめたこと（self_check）が無い"
    new = [name for name in proposals if name not in before]
    if i > 0 and len(new) < MIN_NEW:
        return f"やり直しの回は、案出しからやり直す（新しい案を {MIN_NEW} 案以上。いま {len(new)} 案）"
    return None


def decide(data):
    """回を順に判定する。返り値: ("選ぶ" | "届かずに選ぶ" | "出し直す" | "当てた" | "直す", 名前, 順位)"""
    if data.get("applies"):           # ほかの比較で決めた形を当てた記録: 作った後が合格点以上か
        built = data.get("built") or {}
        t = total(built["result"]) if built.get("result") else 0
        return ("当てた" if t >= rule_of(data)["pass"][-1] else "直す"), data["applies"], [(t, built.get("name", ""), built.get("result"))]
    rounds = data["rounds"]
    if not data.get("evaluator"):
        raise ValueError("採点した者（evaluator）が無い。採点は、案を作った者ではない別のエージェントが、自分で撮った画像を見て付ける")
    if len(rounds) > MAX_ROUNDS:
        raise ValueError(f"回は {MAX_ROUNDS} 回まで（{MAX_ROUNDS} 回目で必ず決める。いま {len(rounds)} 回）")
    rule, before = rule_of(data), set()
    for i, rnd in enumerate(rounds):
        problem = check_round(i, rnd, before, rule)
        if problem:
            raise ValueError(f"{rnd['name']}: {problem}")
        rows = rank(rnd["proposals"])
        if rows[0][0] >= pass_mark(i, rule):
            if i < len(rounds) - 1:
                raise ValueError(f"{rnd['name']} で {pass_mark(i, rule)} 点に届いて決まっているのに、後の回がある")
            return "選ぶ", rows[0][1], rows
        if i == MAX_ROUNDS - 1:
            return "届かずに選ぶ", rows[0][1], rows
        before |= set(rnd["proposals"])
    return "出し直す", rows[0][1], rows


def describe(entry):
    """1 案の点の内訳（分類ごとの加点と減点）"""
    parts = [f"{g} {p:.1f}" for g, p in zip(GROUPS, group_points(entry))]
    cuts = [f"{DEDUCTIONS[m['kind']][0].split('（')[0]} −{DEDUCTIONS[m['kind']][1]}（{m['where']}）" for m in entry.get("minus", [])]
    return "・".join(parts) + (f"／減点: {'、'.join(cuts)}" if cuts else "")


def report(data):
    print(f"# {data['title']}")
    if data.get("applies"):
        return report_applied(data)
    kind, who, rows = decide(data)
    print(f"採点: {data['evaluator']}")
    rule = rule_of(data)
    marks = rule["pass"]
    when = f"回によらず {marks[0]}" if len(marks) == 1 else f"{'・'.join(f'{i + 1} 回目 {p}' for i, p in enumerate(marks))} 点（以降も {marks[-1]}）"
    print(f"決めてよい点 {when} 点・1 回 {MIN_PROPOSALS} 案以上・{MAX_ROUNDS} 回まで" + ("・渡す前に自分で画像を確かめる" if rule["self_check"] else "（前の決まり）"))
    mark = pass_mark(len(data["rounds"]) - 1, rule)
    for rnd in data["rounds"]:
        print(f"== {rnd['name']}（{len(rnd['proposals'])} 案）" + (f"  画像: {rnd['images']}" if rnd.get("images") else ""))
        if rnd.get("self_check"):
            print(f"  渡す前の自分の確かめ: {rnd['self_check']}")
        for t, name, e in rank(rnd["proposals"]):
            print(f"  {name}\n      {t:5.1f} 点  {describe(e)}\n      見えたこと: {e['seen']}")
        for name, e in rnd.get("baseline", {}).items():
            print(f"  （{name}）\n      {total(e):5.1f} 点  {describe(e)}\n      見えたこと: {e.get('seen', '')}")
    if kind == "選ぶ":
        print(f"→ 選ぶ: {who}（{rows[0][0]:.1f} 点）")
    elif kind == "届かずに選ぶ":
        print(f"→ {MAX_ROUNDS} 回で合格点 {mark} 点に届かなかった。いちばん高い {who}（{rows[0][0]:.1f} 点）に決め、"
              f"足りない {mark - rows[0][0]:.1f} 点とその理由（減点・低い項目）を利用者に伝える")
    else:
        print(f"→ まだ選ばない（1 位 {rows[0][0]:.1f} 点 < この回の合格点 {mark} 点。次の回は {pass_mark(len(data['rounds']), rule)} 点）。低い項目と減点を見直し、案出しからやり直す"
              f"（{MIN_PROPOSALS} 案以上・新しい案 {MIN_NEW} 案以上）。採点はまた別のエージェントが、撮り直した画像で付ける")
    built = data.get("built")
    if built:
        t = total(built["result"])
        print(f"== {built['name']}（作った後の本物の画面）  {t:.1f} 点  {describe(built['result'])}\n      見えたこと: {built['result'].get('seen', '')}")
        print("→ 作った後も " + (f"{mark} 点以上（決めた回の合格点）" if t >= mark else f"{mark} 点（決めた回の合格点）に届かない。減点の所を直して撮り直し、採点し直す"))
    return kind, who


def report_applied(data):
    """ほかの比較で決めた形を当てた記録: 決めたファイルの判定を引き、今と作った後だけを採点する"""
    import os
    if not data.get("evaluator"):
        raise ValueError("採点した者（evaluator）が無い")
    src = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), data["applies"])
    with open(src, encoding="utf-8") as f:
        kind, who, rows = decide(json.load(f))
    if kind not in ("選ぶ", "届かずに選ぶ"):
        raise ValueError(f"{data['applies']} はまだ決まっていない（{kind}）")
    print(f"採点: {data['evaluator']}\n当てた形: {data['applies']} で決めた {who}（{rows[0][0]:.1f} 点）")
    mark = rule_of(data)["pass"][-1]
    for name, e in data.get("baseline", {}).items():
        print(f"  （{name}）\n      {total(e):5.1f} 点  {describe(e)}\n      見えたこと: {e.get('seen', '')}")
    built = data.get("built")
    if not built:
        raise ValueError("作った後（built）が無い")
    t = total(built["result"])
    print(f"== {built['name']}（作った後の本物の画面）  {t:.1f} 点  {describe(built['result'])}\n      見えたこと: {built['result'].get('seen', '')}")
    print("→ 作った後も " + (f"{mark} 点以上" if t >= mark else f"{mark} 点に届かない。減点の所を直して撮り直し、採点し直す"))
    return ("当てた" if t >= mark else "直す"), who


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("使い方: python program/tools/ui_score.py 採点.json")
    with open(sys.argv[1], encoding="utf-8") as f:
        report(json.load(f))
