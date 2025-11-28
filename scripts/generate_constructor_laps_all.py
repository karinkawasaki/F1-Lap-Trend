import json
from pathlib import Path

import pandas as pd

# プロジェクトのルート（scripts フォルダの一個上）
ROOT = Path(__file__).resolve().parents[1]

# Kaggle の CSV を置いているフォルダ（必要に応じて変えてOK）
RAW_DIR = ROOT / "public" / "data" / "f1-kaggle"

# 出力先：Next.js から参照する JSON
OUT_DIR = ROOT / "public" / "data" / "constructors"
OUT_DIR.mkdir(parents=True, exist_ok=True)

print("ROOT   :", ROOT)
print("RAW_DIR:", RAW_DIR)
print("OUT_DIR:", OUT_DIR)


# ---------------------------------------------------
#  予選のタイム文字列を「秒」に変換するヘルパー
#   "1:23.456" -> 83.456
#   "59.123"   -> 59.123
#   "\\N" や NaN -> None
# ---------------------------------------------------
def parse_lap_time_to_sec(s):
    if pd.isna(s):
        return None
    if isinstance(s, float) or isinstance(s, int):
        # すでに数値ならそのまま秒として扱う（ほぼ来ない）
        return float(s)
    s = str(s).strip()
    if s == r"\N" or s == "":
        return None

    # "M:SS.mmm" or "SS.mmm"
    try:
        if ":" in s:
            minute_str, sec_str = s.split(":", 1)
            minutes = float(minute_str)
            seconds = float(sec_str)
            return minutes * 60.0 + seconds
        else:
            return float(s)
    except Exception:
        return None


# === CSV 読み込み ===
lap_times = pd.read_csv(RAW_DIR / "lap_times.csv")
races = pd.read_csv(RAW_DIR / "races.csv")
circuits = pd.read_csv(RAW_DIR / "circuits.csv")
results = pd.read_csv(RAW_DIR / "results.csv")
constructors = pd.read_csv(RAW_DIR / "constructors.csv")
qualifying = pd.read_csv(RAW_DIR / "qualifying.csv")

# races: raceId -> year, circuitId
races = races[["raceId", "year", "circuitId"]]

# circuits: circuitId -> circuitRef（"spa", "suzuka", "americas" など）
circuits = circuits[["circuitId", "circuitRef"]]

# races + circuits -> year, circuitRef
races = races.merge(circuits, on="circuitId", how="left")

# constructors: constructorId -> name
constructors = constructors[["constructorId", "name"]]

# results: raceId, driverId, constructorId
results = results[["raceId", "driverId", "constructorId"]]

# lap_times: raceId, driverId, lap, milliseconds
lap_times = lap_times[["raceId", "driverId", "lap", "milliseconds"]]

# ---------------------------------------------------
#  Race（決勝）: lap_times からコンストラクターベストラップ
# ---------------------------------------------------
lt_with_team = lap_times.merge(results, on=["raceId", "driverId"], how="left")
lt_with_team = lt_with_team.merge(constructors, on="constructorId", how="left")
lt_with_team = lt_with_team.merge(races, on="raceId", how="left")

lt_with_team = lt_with_team.dropna(
    subset=["constructorId", "name", "year", "circuitRef", "milliseconds"]
)

lt_with_team["lapTimeSec"] = lt_with_team["milliseconds"] / 1000.0

race_agg = (
    lt_with_team.groupby(
        ["year", "circuitRef", "name"], as_index=False
    )["lapTimeSec"]
    .min()
    .rename(columns={"circuitRef": "circuitKey", "name": "constructorName"})
)
race_agg["session"] = "R"  # Race

print("Race rows:", len(race_agg))


# ---------------------------------------------------
#  Qualifying（予選）: qualifying.csv からベストラップ
# ---------------------------------------------------

# qualifying: raceId, driverId, constructorId, q1, q2, q3
qualifying = qualifying[
    ["raceId", "driverId", "constructorId", "q1", "q2", "q3"]
]

# 予選と races(year,circuitRef) を結合
qualifying = qualifying.merge(races, on="raceId", how="left")
qualifying = qualifying.merge(constructors, on="constructorId", how="left")

# 文字列タイムを秒に変換
for col in ["q1", "q2", "q3"]:
    qualifying[col + "_sec"] = qualifying[col].apply(parse_lap_time_to_sec)

# q1〜q3 の中で最も速いラップをとる
qualifying["lapTimeSec"] = qualifying[["q1_sec", "q2_sec", "q3_sec"]].min(axis=1)

# 必要な情報が揃っている行だけに絞る
qualifying = qualifying.dropna(
    subset=["lapTimeSec", "name", "year", "circuitRef"]
)

quali_agg = (
    qualifying.groupby(
        ["year", "circuitRef", "name"], as_index=False
    )["lapTimeSec"]
    .min()
    .rename(columns={"circuitRef": "circuitKey", "name": "constructorName"})
)
quali_agg["session"] = "Q"  # Qualifying

print("Qualifying rows:", len(quali_agg))


# ---------------------------------------------------
#  Q + R をまとめる
# ---------------------------------------------------
agg_all = pd.concat([race_agg, quali_agg], ignore_index=True)
agg_all = agg_all.sort_values(
    ["circuitKey", "year", "session", "constructorName"]
).reset_index(drop=True)

print("Total rows (Q+R):", len(agg_all))


# === サーキットごとに JSON 出力 ===
for circuit_key, sub in agg_all.groupby("circuitKey"):
    records = []
    for _, row in sub.iterrows():
        records.append(
            {
                "year": int(row["year"]),
                "session": row["session"],  # "Q" or "R"
                "constructorName": str(row["constructorName"]),
                "lapTime": float(row["lapTimeSec"]),  # 秒
            }
        )

    out_path = OUT_DIR / f"{circuit_key}.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Written: {out_path}")
