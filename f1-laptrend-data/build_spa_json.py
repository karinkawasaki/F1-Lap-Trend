import pandas as pd
import json
from pathlib import Path

# ==== ここを自分の環境に合わせて変更してください ====
# KaggleのF1データを解凍したフォルダへの「絶対パス」
DATA_DIR = Path("../public/data/f1-kaggle")  # ←例。自分のパスに合わせてね！

# 出力先（F1LapTrendのpublic/dataに後でコピーする用）
OUTPUT_JSON = Path("spa_lap_times_from_kaggle.json")
# ====================================================

def load_data():
    races = pd.read_csv(DATA_DIR / "races.csv")
    circuits = pd.read_csv(DATA_DIR / "circuits.csv")
    results = pd.read_csv(DATA_DIR / "results.csv")
    lap_times = pd.read_csv(DATA_DIR / "lap_times.csv")
    qualifying = pd.read_csv(DATA_DIR / "qualifying.csv")
    return races, circuits, results, lap_times, qualifying

def get_spa_circuit_id(circuits: pd.DataFrame) -> int:
    """
    circuits.csv から「スパ・フランコルシャン」に該当する circuitId を探す。
    Kaggleでは 'Spa-Francorchamps' などの名前で登録されている想定。
    """
    spa_rows = circuits[circuits["name"].str.contains("Spa", case=False, na=False)]
    if spa_rows.empty:
        raise ValueError("Spa circuit not found in circuits.csv. Check dataset content.")
    spa_id = int(spa_rows.iloc[0]["circuitId"])
    print(f"[INFO] Detected Spa circuitId = {spa_id}")
    return spa_id

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

def build_spa_laptrend_json() -> None:
    races, circuits, results, lap_times, qualifying = load_data()

    spa_circuit_id = get_spa_circuit_id(circuits)

    # Spaで行われたレースだけに絞る
    spa_races = races[races["circuitId"] == spa_circuit_id].copy()

    # ===== ポールタイム（予選最速）を年ごとに取得 =====
    q = qualifying.copy()

    # データセットによって Q1/Q2/Q3 or q1/q2/q3 の場合があるので両方対応する
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

    # 各ドライバーごとに、持っている予選タイムの中で最も速いタイムを best_qual_sec とする
    q["best_qual_sec"] = q[sec_cols].min(axis=1, skipna=True)

    # races から year を持ってくる
    q = q.merge(spa_races[["raceId", "year"]], on="raceId", how="inner")

    # 各年ごとに最小の best_qual_sec をポールタイムとみなす
    pole_by_year = (
        q.dropna(subset=["best_qual_sec"])
        .groupby("year")["best_qual_sec"]
        .min()
        .reset_index()
        .rename(columns={"best_qual_sec": "pole"})
    )

    # ===== 決勝ファステストラップを年ごとに取得 =====
    spa_race_ids = spa_races["raceId"].unique().tolist()
    lap = lap_times[lap_times["raceId"].isin(spa_race_ids)].copy()

    # time か milliseconds から秒に変換
    if "milliseconds" in lap.columns:
        lap["lap_sec"] = lap["milliseconds"] / 1000.0
    else:
        lap["lap_sec"] = lap["time"].apply(time_str_to_seconds)

    lap = lap.merge(spa_races[["raceId", "year"]], on="raceId", how="inner")

    fastest_by_year = (
        lap.dropna(subset=["lap_sec"])
        .groupby("year")["lap_sec"]
        .min()
        .reset_index()
        .rename(columns={"lap_sec": "fastest"})
    )

    # ===== pole と fastest を年ごとにマージ =====
    merged = pole_by_year.merge(fastest_by_year, on="year", how="inner")

    # 年順にソート
    merged = merged.sort_values("year")

    # LapTrend用のシンプルな構造に変換
    records = []
    for _, row in merged.iterrows():
        records.append(
            {
                "year": int(row["year"]),
                "pole": float(row["pole"]),
                "fastest": float(row["fastest"]),
            }
        )

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"[INFO] Wrote {len(records)} records to {OUTPUT_JSON}")

if __name__ == "__main__":
    build_spa_laptrend_json()
