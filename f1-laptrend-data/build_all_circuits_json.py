import pandas as pd
import json
from pathlib import Path

# ==== ここを自分の環境に合わせて変更してください ====
# KaggleのF1データを解凍したフォルダへの「絶対パス」
DATA_DIR = Path("../public/data/f1-kaggle")  # ←あなたの環境に合わせて！
# JSONの出力先ディレクトリ（このスクリプトと同じフォルダの中に作ります）
OUTPUT_DIR = Path("circuit_json")
# ====================================================

def load_data():
    races = pd.read_csv(DATA_DIR / "races.csv")
    circuits = pd.read_csv(DATA_DIR / "circuits.csv")
    results = pd.read_csv(DATA_DIR / "results.csv")
    lap_times = pd.read_csv(DATA_DIR / "lap_times.csv")
    qualifying = pd.read_csv(DATA_DIR / "qualifying.csv")
    return races, circuits, results, lap_times, qualifying

def time_str_to_seconds(t: str):
    """
    '1:45.345' のようなフォーマットを秒に変換する簡易関数。
    想定外やNaNは None を返す。
    """
    if pd.isna(t):
        return None
    try:
        parts = str(t).split(":")
        if len(parts) == 2:
            minutes = int(parts[0])
            seconds = float(parts[1])
            return minutes * 60 + seconds
        else:
            return None
    except Exception:
        return None

def prepare_qualifying_with_best_lap(qualifying: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    """
    qualifying.csv から、各行ごとに best_qual_sec（そのドライバーの最速予選タイム）を計算して、
    races から year, circuitId を持ってきたテーブルを返す。
    Q1/Q2/Q3 or q1/q2/q3 どちらでも対応。
    """
    q = qualifying.copy()

    candidate_cols = ["Q1", "Q2", "Q3", "q1", "q2", "q3"]
    qual_time_cols = [c for c in candidate_cols if c in q.columns]

    if not qual_time_cols:
        raise ValueError(
            f"Could not find Q1/Q2/Q3 (or q1/q2/q3) columns in qualifying.csv. "
            f"Available columns: {list(q.columns)}"
        )

    sec_cols = []
    for col in qual_time_cols:
        sec_col = col + "_sec"
        q[sec_col] = q[col].apply(time_str_to_seconds)
        sec_cols.append(sec_col)

    q["best_qual_sec"] = q[sec_cols].min(axis=1, skipna=True)

    # racesから year, circuitId をjoin
    q = q.merge(races[["raceId", "year", "circuitId"]], on="raceId", how="inner")

    return q

def prepare_laps_with_best_lap(lap_times: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    """
    lap_times.csv から lap_sec（1ラップの秒数）を計算し、
    races から year, circuitId を持ってきたテーブルを返す。
    """
    lap = lap_times.copy()

    if "milliseconds" in lap.columns:
        lap["lap_sec"] = lap["milliseconds"] / 1000.0
    else:
        lap["lap_sec"] = lap["time"].apply(time_str_to_seconds)

    lap = lap.merge(races[["raceId", "year", "circuitId"]], on="raceId", how="inner")

    return lap

def build_laptrend_for_circuit(
    circuit_id: int,
    circuit_ref: str,
    q_with_best: pd.DataFrame,
    laps_with_best: pd.DataFrame,
) -> list[dict]:
    """
    ある1つのサーキット（circuit_id）について、
    年ごとの pole / fastest を計算して JSON用のリストを返す。
    足りない年が多かったり、1年しかデータがない場合は空リストを返す。
    """
    q_circuit = q_with_best[q_with_best["circuitId"] == circuit_id].copy()
    lap_circuit = laps_with_best[laps_with_best["circuitId"] == circuit_id].copy()

    if q_circuit.empty or lap_circuit.empty:
        return []

    pole_by_year = (
        q_circuit.dropna(subset=["best_qual_sec"])
        .groupby("year")["best_qual_sec"]
        .min()
        .reset_index()
        .rename(columns={"best_qual_sec": "pole"})
    )

    fastest_by_year = (
        lap_circuit.dropna(subset=["lap_sec"])
        .groupby("year")["lap_sec"]
        .min()
        .reset_index()
        .rename(columns={"lap_sec": "fastest"})
    )

    merged = pole_by_year.merge(fastest_by_year, on="year", how="inner")

    # データが1年分だけだと「進化」が見えないのでスキップする
    if len(merged) < 2:
        return []

    merged = merged.sort_values("year")

    records: list[dict] = []
    for _, row in merged.iterrows():
        records.append(
            {
                "year": int(row["year"]),
                "pole": float(row["pole"]),
                "fastest": float(row["fastest"]),
            }
        )

    return records

def slug_from_circuit(row: pd.Series) -> str:
    """
    circuits.csv の1行から、ファイル名に使いやすい "slug" を作る。
    例: circuitRef が 'spa' → 'spa'
        ない場合は name を小文字＋アンダースコアで整形
    """
    if "circuitRef" in row and isinstance(row["circuitRef"], str):
        base = row["circuitRef"]
    else:
        base = str(row["name"])

    slug = base.strip().lower().replace(" ", "_")
    slug = slug.replace("/", "_").replace("'", "")
    return slug

def build_all_circuits_json():
    # 出力ディレクトリを作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    races, circuits, results, lap_times, qualifying = load_data()

    # 予選・決勝の「ベストラップ付きテーブル」を一度だけ用意
    q_with_best = prepare_qualifying_with_best_lap(qualifying, races)
    laps_with_best = prepare_laps_with_best_lap(lap_times, races)

    generated = 0
    skipped = 0

    for _, row in circuits.iterrows():
        cid = int(row["circuitId"])
        slug = slug_from_circuit(row)
        name = row["name"]

        records = build_laptrend_for_circuit(
            circuit_id=cid,
            circuit_ref=slug,
            q_with_best=q_with_best,
            laps_with_best=laps_with_best,
        )

        if not records:
            print(f"[SKIP] {name} (circuitId={cid}) -> データ不足のためスキップ")
            skipped += 1
            continue

        out_path = OUTPUT_DIR / f"{slug}_lap_times.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)

        print(f"[OK] {name} (circuitId={cid}) -> {out_path} に {len(records)} レコードを書き込み")
        generated += 1

    print("===================================")
    print(f"[SUMMARY] 生成されたサーキット数: {generated}")
    print(f"[SUMMARY] スキップされたサーキット数: {skipped}")

if __name__ == "__main__":
    build_all_circuits_json()
