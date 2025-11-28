import pandas as pd
from pathlib import Path
import json

# プロジェクトルート（F1-lap-trend）
ROOT = Path(__file__).resolve().parents[1]

# CSV の場所（いまの構成に合わせている）
RAW_DIR = ROOT / "public" / "data" / "f1-kaggle"
OUT_DIR = ROOT / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

print("ROOT   :", ROOT)
print("RAW_DIR:", RAW_DIR, "exists?", RAW_DIR.exists())

# === 1. CSV を読み込み ===
races = pd.read_csv(RAW_DIR / "races.csv")
circuits = pd.read_csv(RAW_DIR / "circuits.csv")
drivers = pd.read_csv(RAW_DIR / "drivers.csv")
qualifying = pd.read_csv(RAW_DIR / "qualifying.csv")

print("Loaded races:", races.shape)
print("Loaded circuits:", circuits.shape)

# === 2. Spa の circuitId を特定（柔らかく探す）===

# まず全部のサーキット名と circuitRef を軽く確認（デバッグ用）
print("\n--- circuits sample ---")
print(circuits.head())

# name / circuitRef カラムがある前提（無い場合はここで KeyError が出る）
name_col = "name"
ref_col = "circuitRef" if "circuitRef" in circuits.columns else None

# 「Spa を含む名前」か「circuitRef が spa を含む」サーキットを候補にする
mask = pd.Series(False, index=circuits.index)

if name_col in circuits.columns:
  mask = mask | circuits[name_col].astype(str).str.contains("spa", case=False, na=False)

if ref_col:
  mask = mask | circuits[ref_col].astype(str).str.contains("spa", case=False, na=False)

candidates = circuits[mask]

print("\n--- Spa-like circuits candidates ---")
print(candidates[[col for col in ["circuitId", name_col, ref_col] if col in circuits.columns]])

if candidates.empty:
  raise RuntimeError("『Spa』を含むサーキットが circuits.csv に見つかりませんでした")

# とりあえず最初の1件を Spa とみなす
spa_row = candidates.iloc[0]
spa_circuit_id = int(spa_row["circuitId"])
print(f"\nUse circuitId={spa_circuit_id} as Spa ({spa_row.get(name_col)} / {spa_row.get(ref_col)})")

# === 3. Spa のレースだけを races から抽出 ===
spa_races = races[races["circuitId"] == spa_circuit_id][["raceId", "year"]]
print("Spa races:", spa_races.shape)

# === 4. Spa の予選データだけ抽出（qualifying と join）===
spa_qualifying = qualifying.merge(spa_races, on="raceId", how="inner")
print("Spa qualifying rows:", spa_qualifying.shape)

def time_str_to_seconds(t):
  """
  '1:42.123' → 62.123（秒）
  NaN や不正値は None
  """
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

# q1, q2, q3 から最速タイムを作る
for col in ["q1", "q2", "q3"]:
  if col in spa_qualifying.columns:
    spa_qualifying[col + "_sec"] = spa_qualifying[col].apply(time_str_to_seconds)
  else:
    spa_qualifying[col + "_sec"] = None

spa_qualifying["best_sec"] = spa_qualifying[["q1_sec", "q2_sec", "q3_sec"]].min(axis=1)

# === 5. drivers と結合して driverCode を作る ===
spa_qualifying = spa_qualifying.merge(
  drivers[["driverId", "code", "surname"]],
  on="driverId",
  how="left",
  suffixes=("", "_drv"),
)

def normalize_driver_code(row):
  code = row.get("code")
  if isinstance(code, str) and code.strip():
    return code.strip().upper()
  surname = row.get("surname")
  if isinstance(surname, str) and surname:
    return surname[:3].upper()
  return "DRV"

spa_qualifying["driverCode"] = spa_qualifying.apply(normalize_driver_code, axis=1)

# === 6. 年×ドライバーごとのベストタイム ===
grouped = (
  spa_qualifying.dropna(subset=["best_sec"])
  .groupby(["year", "driverCode"], as_index=False)["best_sec"]
  .min()
)

print("Grouped driver laps:", grouped.shape)

# === 7. JSON 用に整形 ===
records = []
for _, row in grouped.sort_values(["year", "driverCode"]).iterrows():
  records.append(
    {
      "year": int(row["year"]),
      "session": "Q",
      "driverId": row["driverCode"],
      "lapTime": round(float(row["best_sec"]), 3),
    }
  )

out_path = OUT_DIR / "spa_driver_laps.json"
with out_path.open("w", encoding="utf-8") as f:
  json.dump(records, f, ensure_ascii=False, indent=2)

print(f"\n✅ Generated {out_path} ({len(records)} records)")
