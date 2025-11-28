import pandas as pd
from pathlib import Path
import json

# プロジェクトルート（F1-lap-trend）
ROOT = Path(__file__).resolve().parents[1]

# Kaggle CSV の置き場所（あなたの環境）
RAW_DIR = ROOT / "public" / "data" / "f1-kaggle"
OUT_DIR = ROOT / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

print("ROOT   :", ROOT)
print("RAW_DIR:", RAW_DIR, "exists?", RAW_DIR.exists())

# === 1. CSV 読み込み ===
races = pd.read_csv(RAW_DIR / "races.csv")
circuits = pd.read_csv(RAW_DIR / "circuits.csv")
drivers = pd.read_csv(RAW_DIR / "drivers.csv")
qualifying = pd.read_csv(RAW_DIR / "qualifying.csv")
results = pd.read_csv(RAW_DIR / "results.csv")  # 決勝リザルト

print("Loaded races:", races.shape)
print("Loaded circuits:", circuits.shape)
print("Loaded qualifying:", qualifying.shape)
print("Loaded results:", results.shape)
print("Loaded drivers:", drivers.shape)

# === 2. races に circuitRef を付ける（ファイル名に使う）===
races_with_circuit = races.merge(
    circuits[["circuitId", "circuitRef"]],
    on="circuitId",
    how="left",
)

# === 3. 予選テーブル作成（races + qualifying） ===
q = qualifying.merge(
    races_with_circuit[["raceId", "year", "circuitId", "circuitRef"]],
    on="raceId",
    how="left",
)

# === 4. 汎用: タイム文字列 → 秒 ===
def time_str_to_seconds(t):
    if pd.isna(t):
        return None
    s = str(t)
    if ":" not in s:
        try:
            return float(s)
        except ValueError:
            return None
    try:
        m, rest = s.split(":")
        return int(m) * 60 + float(rest)
    except Exception:
        return None

# q1, q2, q3 から最速タイム best_sec を作る（予選）
for col in ["q1", "q2", "q3"]:
    if col in q.columns:
        q[col + "_sec"] = q[col].apply(time_str_to_seconds)
    else:
        q[col + "_sec"] = None

q["best_sec"] = q[["q1_sec", "q2_sec", "q3_sec"]].min(axis=1)

# drivers と結合して driverCode を作成（共通）
def normalize_driver_code(row):
    code = row.get("code")
    if isinstance(code, str) and code.strip():
        return code.strip().upper()
    surname = row.get("surname")
    if isinstance(surname, str) and surname:
        return surname[:3].upper()
    return "DRV"

# 予選: driverCode 付与
q = q.merge(
    drivers[["driverId", "code", "surname"]],
    on="driverId",
    how="left",
)
q["driverCode"] = q.apply(normalize_driver_code, axis=1)

q_valid = q.dropna(subset=["best_sec"]).copy()
print("Valid qualifying rows:", q_valid.shape)

# === 5. 決勝テーブル作成（results + races） ===
r = results.merge(
    races_with_circuit[["raceId", "year", "circuitId", "circuitRef"]],
    on="raceId",
    how="left",
)

# fastestLapTime カラムを秒に変換
if "fastestLapTime" not in r.columns:
    raise RuntimeError("results.csv に fastestLapTime カラムがありません")

r["fastest_sec"] = r["fastestLapTime"].apply(time_str_to_seconds)

# drivers と結合して driverCode 付与
r = r.merge(
    drivers[["driverId", "code", "surname"]],
    on="driverId",
    how="left",
)
r["driverCode"] = r.apply(normalize_driver_code, axis=1)

r_valid = r.dropna(subset=["fastest_sec"]).copy()
print("Valid race fastest-lap rows:", r_valid.shape)

# === 6. circuitRef × year × driverCode ごとに Q/R を集約 ===

# Qualifying（Q）
q_grouped = (
    q_valid
    .groupby(["circuitRef", "year", "driverCode"], as_index=False)["best_sec"]
    .min()
    .rename(columns={"best_sec": "lap_sec"})
)
q_grouped["session"] = "Q"

# Race（R）
r_grouped = (
    r_valid
    .groupby(["circuitRef", "year", "driverCode"], as_index=False)["fastest_sec"]
    .min()
    .rename(columns={"fastest_sec": "lap_sec"})
)
r_grouped["session"] = "R"

print("Grouped Q rows:", q_grouped.shape)
print("Grouped R rows:", r_grouped.shape)

# === 7. 両方を結合して、サーキットごとに JSON 出力 ===
all_grouped = pd.concat([q_grouped, r_grouped], ignore_index=True)

count_files = 0
for circuit_ref, sub in all_grouped.groupby("circuitRef"):
    if pd.isna(circuit_ref):
        continue

    records = []
    sub_sorted = sub.sort_values(["year", "session", "driverCode"])

    for _, row in sub_sorted.iterrows():
        records.append(
            {
                "year": int(row["year"]),
                "session": row["session"],              # "Q" または "R"
                "driverId": row["driverCode"],
                "lapTime": round(float(row["lap_sec"]), 3),
            }
        )

    filename = f"{circuit_ref}_driver_laps.json"
    out_path = OUT_DIR / filename

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    count_files += 1
    print(f"  - wrote {filename} ({len(records)} records)")

print(f"\n✅ Done. Generated {count_files} driver_laps files in {OUT_DIR}")
