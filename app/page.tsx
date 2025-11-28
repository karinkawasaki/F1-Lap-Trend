"use client";

import { useEffect, useState } from "react";
import { DRIVERS } from "../src/constants/drivers";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type LapPoint = {
  year: number;
  pole: number;
  fastest: number;
};

type LapSummary = {
  startYear: number;
  endYear: number;
  startTime: number;
  endTime: number;
  totalDelta: number;
  yearlyDelta: number;
};

// 🔹 ドライバー別ラップ用（JSON と合わせている）
type DriverLap = {
  year: number;
  session: "Q" | "R";
  driverId: string; // "VER" など
  lapTime: number;  // 秒
};
type DriverMetric = "time" | "gap"; // ラップタイム or ポールとの差

// 🔹 コンストラクター別ラップ用
// JSON もこの形に合わせてください（year, session, constructorName, lapTime）
type ConstructorLap = {
  year: number;
  session: "Q" | "R";
  constructorName: string;
  lapTime: number; // 秒
};

type Mode = "driver" | "constructor";

// 全サーキット一覧（slug: 表示名）
const CIRCUITS: Record<string, string> = {
  albert_park: "Albert Park（オーストラリア）",
  americas: "Circuit of the Americas（COTA）",
  bahrain: "Bahrain International Circuit",
  baku: "Baku City Circuit",
  buddh: "Buddh International Circuit",
  catalunya: "Circuit de Barcelona-Catalunya",
  fuji: "Fuji Speedway（日本）",
  galvez: "Autódromo Juan y Oscar Gálvez（アルゼンチン）",
  hockenheimring: "Hockenheimring（ドイツ）",
  hungaroring: "Hungaroring（ハンガリー）",
  imola: "Imola（エミリア・ロマーニャGP）",
  indianapolis: "Indianapolis Motor Speedway（アメリカ）",
  interlagos: "Interlagos（ブラジル）",
  istanbul: "Istanbul Park（トルコ）",
  jeddah: "Jeddah Corniche Circuit（サウジアラビア）",
  losail: "Losail International Circuit（カタール）",
  magny_cours: "Magny-Cours（フランス）",
  monaco: "Circuit de Monaco（モナコ）",
  monza: "Monza（イタリア）",
  nurburgring: "Nürburgring（ドイツ）",
  portimao: "Portimão（ポルトガル）",
  red_bull_ring: "Red Bull Ring（オーストリア）",
  ricard: "Circuit Paul Ricard",
  rodriguez: "Autódromo Hermanos Rodríguez（メキシコ）",
  sepang: "Sepang International Circuit（マレーシア）",
  shanghai: "Shanghai International Circuit（中国）",
  silverstone: "Silverstone（イギリス）",
  sochi: "Sochi Autodrom（ロシア）",
  spa: "Spa-Francorchamps（ベルギー）",
  suzuka: "Suzuka（鈴鹿、日本）",
  valencia: "Valencia Street Circuit（ヨーロッパGP）",
  vegas: "Las Vegas Strip Circuit（アメリカ）",
  villeneuve: "Circuit Gilles Villeneuve（カナダ）",
  yas_marina: "Yas Marina Circuit（アブダビ）",
};

function calculateSummary(data: LapPoint[]): LapSummary | null {
  if (!data || data.length < 2) return null;

  const sorted = [...data].sort((a, b) => a.year - b.year);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const yearsDiff = last.year - first.year;
  if (yearsDiff <= 0) return null;

  const totalDelta = first.pole - last.pole;
  const yearlyDelta = totalDelta / yearsDiff;

  return {
    startYear: first.year,
    endYear: last.year,
    startTime: first.pole,
    endTime: last.pole,
    totalDelta,
    yearlyDelta,
  };
}

export default function Home() {
  // サーキット別 Pole/Fastest 用
  const [selectedCircuit, setSelectedCircuit] = useState<string>("spa");
  const [data, setData] = useState<LapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Driver / Constructor モード
  const [mode, setMode] = useState<Mode>("driver");

  // ドライバー選択 UI 用
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>(["VER", "HAM"]);
  const toggleDriver = (id: string) => {
    setSelectedDrivers((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  // コンストラクター選択 UI 用
  const [selectedConstructors, setSelectedConstructors] = useState<string[]>([]);
  const toggleConstructor = (name: string) => {
    setSelectedConstructors((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  // Pole / Fastest 表示切り替え（グラフB用）
  const [showPole, setShowPole] = useState<boolean>(true);
  const [showFastest, setShowFastest] = useState<boolean>(true);

  // 🔹 ドライバー別ラップ（本物のJSONを読む）
  const [driverLaps, setDriverLaps] = useState<DriverLap[]>([]);
  const [driverLapsLoading, setDriverLapsLoading] = useState(false);
  const [driverLapsError, setDriverLapsError] = useState<string | null>(null);

  // 🔹 コンストラクター別ラップ
  const [constructorLaps, setConstructorLaps] = useState<ConstructorLap[]>([]);
  const [constructorLapsLoading, setConstructorLapsLoading] = useState(false);
  const [constructorLapsError, setConstructorLapsError] = useState<string | null>(
    null
  );

  // Q / R 切り替え（ドライバー＆コンストラクター共通）
  const [driverSession, setDriverSession] = useState<"Q" | "R">("Q");

  // Lap time / Δ表示（ドライバー＆コンストラクター共通）
  const [driverMetric, setDriverMetric] = useState<DriverMetric>("time");

  // 旧グラフ用データ読み込み
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/data/${selectedCircuit}_lap_times.json`);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        if (!Array.isArray(json)) {
          throw new Error("Unexpected data format");
        }

        setData(json as LapPoint[]);
      } catch (err: any) {
        console.error(err);
        setError(err.message ?? "データの読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedCircuit]);

  // 🔹 ドライバー別ラップ用 JSON 読み込み（全サーキット対応）
  useEffect(() => {
    const fetchDriverLaps = async () => {
      try {
        setDriverLapsLoading(true);
        setDriverLapsError(null);

        const url = `/data/${selectedCircuit}_driver_laps.json`;
        const res = await fetch(url);

        if (!res.ok) {
          if (res.status === 404) {
            setDriverLaps([]);
            return;
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        if (!Array.isArray(json)) {
          throw new Error("Unexpected driver laps format");
        }

        setDriverLaps(json as DriverLap[]);
      } catch (err: any) {
        console.error(err);
        setDriverLapsError(
          err.message ?? "ドライバーラップの読み込みに失敗しました"
        );
      } finally {
        setDriverLapsLoading(false);
      }
    };

    fetchDriverLaps();
  }, [selectedCircuit]);

  // 🔹 コンストラクター別ラップ用 JSON 読み込み（/data/constructors/{circuit}.json）
  useEffect(() => {
    const fetchConstructorLaps = async () => {
      try {
        setConstructorLapsLoading(true);
        setConstructorLapsError(null);

        const url = `/data/constructors/${selectedCircuit}.json`;
        const res = await fetch(url);

        if (!res.ok) {
          if (res.status === 404) {
            setConstructorLaps([]);
            setSelectedConstructors([]);
            return;
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        if (!Array.isArray(json)) {
          throw new Error("Unexpected constructor laps format");
        }

        const laps = json as ConstructorLap[];
        setConstructorLaps(laps);

        // 初期選択：そのサーキットで出てくる上位数チームだけ
        const names = Array.from(
          new Set(laps.map((lap) => lap.constructorName))
        ).sort();
        setSelectedConstructors(names.slice(0, 4));
      } catch (err: any) {
        console.error(err);
        setConstructorLapsError(
          err.message ?? "コンストラクターラップの読み込みに失敗しました"
        );
      } finally {
        setConstructorLapsLoading(false);
      }
    };

    fetchConstructorLaps();
  }, [selectedCircuit]);

  const hasData = data && data.length > 0;
  const summary =
    !loading && !error && hasData ? calculateSummary(data) : null;

  // 年ごとのポール / レースファステストを Map にしておく
  const poleByYear = new Map<number, number>();
  const fastestByYear = new Map<number, number>();
  data.forEach((d) => {
    if (typeof d.pole === "number") {
      poleByYear.set(d.year, d.pole);
    }
    if (typeof d.fastest === "number") {
      fastestByYear.set(d.year, d.fastest);
    }
  });

  const circuitLabel = CIRCUITS[selectedCircuit] ?? selectedCircuit;

  const years = hasData ? data.map((d) => d.year) : [];
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;

  // 🔹 ドライバー用のチャートデータ構築
  const driverChartBase = driverLaps.filter(
    (lap) => lap.session === driverSession
  );

  const activeDriverIds = Array.from(
    new Set(
      driverChartBase
        .filter((lap) => selectedDrivers.includes(lap.driverId))
        .map((lap) => lap.driverId)
    )
  );

  const driverYearsSet = new Set(driverChartBase.map((lap) => lap.year));
  const driverChartData = Array.from(driverYearsSet)
    .sort((a, b) => a - b)
    .map((year) => {
      const row: Record<string, any> = { year };

      const base =
        driverSession === "Q"
          ? poleByYear.get(year) ?? null
          : fastestByYear.get(year) ?? null;

      const lapsThisYear = driverChartBase.filter(
        (lap) => lap.year === year
      );

      for (const lap of lapsThisYear) {
        row[lap.driverId] = lap.lapTime;
        if (base != null) {
          row[`${lap.driverId}_gap`] = lap.lapTime - base;
        }
      }

      return row;
    });

  // 🔹 コンストラクター用のチャートデータ構築
  const constructorChartBase = constructorLaps.filter(
    (lap) => lap.session === driverSession
  );

  const constructorNames = Array.from(
    new Set(constructorChartBase.map((lap) => lap.constructorName))
  ).sort();

  const activeConstructorNames = constructorNames.filter((name) =>
    selectedConstructors.includes(name)
  );

  const constructorYearsSet = new Set(
    constructorChartBase.map((lap) => lap.year)
  );
  const constructorChartData = Array.from(constructorYearsSet)
    .sort((a, b) => a - b)
    .map((year) => {
      const row: Record<string, any> = { year };

      const base =
        driverSession === "Q"
          ? poleByYear.get(year) ?? null
          : fastestByYear.get(year) ?? null;

      const lapsThisYear = constructorChartBase.filter(
        (lap) => lap.year === year
      );

      for (const lap of lapsThisYear) {
        row[lap.constructorName] = lap.lapTime;
        if (base != null) {
          row[`${lap.constructorName}_gap`] = lap.lapTime - base;
        }
      }

      return row;
    });

  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white flex flex-col items-center py-8 px-4">
      {/* ヘッダー */}
      <header className="w-full max-w-5xl mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            F1LapTrend
          </h1>
          <p className="text-sm md:text-base text-gray-300 mt-1">
            F1ラップタイムのトレンドと進化を、サーキット別に可視化するアプリ
          </p>
        </div>

        {/* サーキット選択 */}
        <div className="flex flex-col items-start md:items-end gap-1">
          <label className="text-xs text-gray-400">サーキットを選択</label>
          <select
            value={selectedCircuit}
            onChange={(e) => setSelectedCircuit(e.target.value)}
            className="bg-zinc-900/80 text-white px-3 py-2 rounded-lg border border-zinc-700 text-sm outline-none focus:ring-2 focus:ring-zinc-500"
          >
            {Object.entries(CIRCUITS).map(([slug, label]) => (
              <option key={slug} value={slug}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* インフォカード */}
      <section className="w-full max-w-5xl mb-4 grid gap-3 md:grid-cols-3">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
            Circuit
          </p>
          <p className="text-sm md:text-base font-semibold">{circuitLabel}</p>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
            Years Covered
          </p>
          {minYear && maxYear ? (
            <p className="text-sm md:text-base">
              {minYear} — {maxYear}
            </p>
          ) : (
            <p className="text-sm text-gray-500">データなし</p>
          )}
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
            Trend (Pole)
          </p>
          {summary ? (
            <p className="text-sm md:text-base">
              {summary.totalDelta >= 0 ? "▲" : "▼"}
              {Math.abs(summary.totalDelta).toFixed(3)}s total
            </p>
          ) : (
            <p className="text-sm text-gray-500">計算中 / データ不足</p>
          )}
        </div>
      </section>

      {/* モード切り替え + ドライバー選択 UI */}
      <section className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/60 p-4 mb-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-slate-300">
            Comparison Mode
          </h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setMode("driver")}
              className={[
                "rounded-full border px-3 py-1 transition",
                mode === "driver"
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-400",
              ].join(" ")}
            >
              Driver
            </button>
            <button
              onClick={() => setMode("constructor")}
              className={[
                "rounded-full border px-3 py-1 transition",
                mode === "constructor"
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-400",
              ].join(" ")}
            >
              Constructor
            </button>
          </div>
        </div>

        {/* ドライバー選択（Driver モードのときだけ表示） */}
        {mode === "driver" && (
          <>
            <h3 className="text-xs font-semibold text-slate-300 mb-2">
              Drivers
            </h3>
            <div className="flex flex-wrap gap-2">
              {DRIVERS.map((driver) => {
                const isActive = selectedDrivers.includes(driver.id);
                return (
                  <button
                    key={driver.id}
                    onClick={() => toggleDriver(driver.id)}
                    className={[
                      "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition",
                      isActive
                        ? "border-slate-300 bg-slate-100 text-slate-900"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-400",
                    ].join(" ")}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: driver.color }}
                    />
                    <span>{driver.shortName}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* コンストラクター選択（Constructor モードのときだけ表示） */}
        {mode === "constructor" && (
          <>
            <h3 className="text-xs font-semibold text-slate-300 mb-2">
              Constructors
            </h3>
            <div className="flex flex-wrap gap-2">
              {constructorNames.map((name) => {
                const isActive = selectedConstructors.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleConstructor(name)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs transition",
                      isActive
                        ? "border-slate-300 bg-slate-100 text-slate-900"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-400",
                    ].join(" ")}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* グラフA：Driver / Constructor 比較 */}
      <section className="w-full max-w-5xl bg-zinc-900/80 rounded-2xl p-4 md:p-6 shadow-lg border border-zinc-800 mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-2">
          <h2 className="text-lg md:text-xl font-semibold">
            {mode === "driver"
              ? "ドライバー別ラップタイム"
              : "コンストラクター別ラップタイム"}
          </h2>

          <div className="flex flex-wrap gap-2 text-xs">
            {/* Q / R 切り替え */}
            <button
              onClick={() => setDriverSession("Q")}
              className={[
                "rounded-full border px-3 py-1 transition",
                driverSession === "Q"
                  ? "border-emerald-400 bg-emerald-400/10 text-emerald-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Qualifying
            </button>
            <button
              onClick={() => setDriverSession("R")}
              className={[
                "rounded-full border px-3 py-1 transition",
                driverSession === "R"
                  ? "border-amber-400 bg-amber-400/10 text-amber-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Race
            </button>

            {/* ラップタイム / Δ 切り替え */}
            <button
              onClick={() => setDriverMetric("time")}
              className={[
                "rounded-full border px-3 py-1 transition",
                driverMetric === "time"
                  ? "border-sky-400 bg-sky-400/10 text-sky-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Lap Time
            </button>
            <button
              onClick={() => setDriverMetric("gap")}
              className={[
                "rounded-full border px-3 py-1 transition",
                driverMetric === "gap"
                  ? "border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Δ to Best
            </button>
          </div>
        </div>

        <p className="text-xs md:text-sm text-gray-400 mb-4">
          モードで「Driver / Constructor」を切り替え。
          Qualifying / Race ボタンでセッションを選択し、Lap Time / Δ to Best で
          絶対タイムとポール（またはレース最速）との差を切り替えられます。
        </p>

        {/* Driver モードのグラフ */}
        {mode === "driver" && (
          <>
            {driverLapsLoading && (
              <div className="w-full h-32 flex items-center justify-center text-gray-400 text-sm">
                Loading driver laps...
              </div>
            )}

            {driverLapsError && !driverLapsLoading && (
              <div className="w-full h-32 flex items-center justify-center text-red-400 text-sm">
                ドライバーラップの読み込みエラー: {driverLapsError}
              </div>
            )}

            {!driverLapsLoading &&
              !driverLapsError &&
              driverChartBase.length > 0 && (
                <div className="w-full min-h-[260px] md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={driverChartData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis
                        label={{
                          value:
                            driverMetric === "time"
                              ? "Lap Time (seconds)"
                              : "Gap to best (seconds)",
                          angle: -90,
                          position: "insideLeft",
                        }}
                      />

                      <Tooltip />
                      <Legend />

                      {activeDriverIds.map((driverId) => {
                        const meta = DRIVERS.find((d) => d.id === driverId);

                        const key =
                          driverMetric === "time"
                            ? driverId
                            : `${driverId}_gap`;

                        const labelName =
                          driverMetric === "time"
                            ? meta?.shortName ?? driverId
                            : `${meta?.shortName ?? driverId} (Δ)`;

                        return (
                          <Line
                            key={driverId}
                            type="monotone"
                            dataKey={key}
                            name={labelName}
                            stroke={meta?.color ?? "#aaaaaa"}
                            dot={true}
                            strokeWidth={2}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

            {!driverLapsLoading &&
              !driverLapsError &&
              driverChartBase.length === 0 && (
                <div className="w-full h-32 flex items-center justify-center text-gray-400 text-sm">
                  このサーキットにはまだドライバー別ラップデータがありません。
                  （現在は Spa など一部のみ対応）
                </div>
              )}
          </>
        )}

        {/* Constructor モードのグラフ */}
        {mode === "constructor" && (
          <>
            {constructorLapsLoading && (
              <div className="w-full h-32 flex items-center justify-center text-gray-400 text-sm">
                Loading constructor laps...
              </div>
            )}

            {constructorLapsError && !constructorLapsLoading && (
              <div className="w-full h-32 flex items-center justify-center text-red-400 text-sm">
                コンストラクターラップの読み込みエラー:{" "}
                {constructorLapsError}
              </div>
            )}

            {!constructorLapsLoading &&
              !constructorLapsError &&
              constructorChartBase.length > 0 && (
                <div className="w-full min-h-[260px] md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={constructorChartData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis
                        label={{
                          value:
                            driverMetric === "time"
                              ? "Lap Time (seconds)"
                              : "Gap to best (seconds)",
                          angle: -90,
                          position: "insideLeft",
                        }}
                      />

                      <Tooltip />
                      <Legend />

                      {activeConstructorNames.map((name) => {
                        const key =
                          driverMetric === "time"
                            ? name
                            : `${name}_gap`;
                        const labelName =
                          driverMetric === "time"
                            ? name
                            : `${name} (Δ)`;
                        return (
                          <Line
                            key={name}
                            type="monotone"
                            dataKey={key}
                            name={labelName}
                            dot={true}
                            strokeWidth={2}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

            {!constructorLapsLoading &&
              !constructorLapsError &&
              constructorChartBase.length === 0 && (
                <div className="w-full h-32 flex items-center justify-center text-gray-400 text-sm">
                  このサーキットにはまだコンストラクター別ラップデータがありません。
                </div>
              )}
          </>
        )}
      </section>

      {/* グラフB：サーキット別 Pole & Fastest */}
      <section className="w-full max-w-5xl bg-zinc-900/70 rounded-2xl p-4 md:p-6 shadow-lg border border-zinc-800">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-2">
          <h2 className="text-lg md:text-xl font-semibold">
            ラップタイム推移（Pole & Fastest）
          </h2>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => setShowPole((v) => !v)}
              className={[
                "rounded-full border px-3 py-1 transition",
                showPole
                  ? "border-sky-400 bg-sky-400/10 text-sky-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Pole
            </button>

            <button
              onClick={() => setShowFastest((v) => !v)}
              className={[
                "rounded-full border px-3 py-1 transition",
                showFastest
                  ? "border-blue-400 bg-blue-400/10 text-blue-200"
                  : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:border-zinc-400",
              ].join(" ")}
            >
              Fastest
            </button>
          </div>
        </div>

        <p className="text-xs md:text-sm text-gray-400 mb-4">
          KaggleのF1 World Championshipデータセットから生成したJSON
          （{selectedCircuit}_lap_times.json）を元に描画しています。
        </p>

        {loading && (
          <div className="w-full h-40 flex items-center justify-center text-gray-400 text-sm">
            Loading lap data...
          </div>
        )}

        {error && !loading && (
          <div className="w-full h-40 flex items-center justify-center text-red-400 text-sm">
            データ読み込みエラー: {error}
          </div>
        )}

        {!loading && !error && hasData && (
          <div className="w-full min-h-[280px] md:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis
                  label={{
                    value: "Lap Time (seconds)",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip />
                <Legend />

                {showPole && (
                  <Line
                    type="monotone"
                    dataKey="pole"
                    name="Pole (Qualifying)"
                    dot={true}
                    stroke="#4cc9f0"
                    strokeWidth={2}
                  />
                )}

                {showFastest && (
                  <Line
                    type="monotone"
                    dataKey="fastest"
                    name="Fastest (Race)"
                    dot={true}
                    stroke="#4361ee"
                    strokeWidth={2}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="w-full h-40 flex items-center justify-center text-gray-400 text-sm">
            データがありません。
          </div>
        )}
      </section>

      {/* サマリー */}
      {summary && (
        <section className="w-full max-w-5xl mt-4 bg-zinc-900/80 rounded-2xl p-4 md:p-6 border border-zinc-800">
          <h3 className="text-md md:text-lg font-semibold mb-2">
            ラップタイム進化サマリー（Pole）
          </h3>
          <p className="text-sm text-gray-300 mb-1">
            対象期間：{summary.startYear} 年 → {summary.endYear} 年
          </p>
          <p className="text-sm text-gray-300 mb-1">
            ポールタイム：{summary.startTime.toFixed(3)} 秒 →{" "}
            {summary.endTime.toFixed(3)} 秒
          </p>

          {summary.totalDelta >= 0 ? (
            <p className="text-sm text-emerald-400 mt-2">
              この期間でポールタイムは合計{" "}
              <span className="font-semibold">
                {summary.totalDelta.toFixed(3)} 秒
              </span>
              短縮されています（1年あたり約{" "}
              <span className="font-semibold">
                {summary.yearlyDelta.toFixed(3)} 秒
              </span>
              速くなっています）。
            </p>
          ) : (
            <p className="text-sm text-amber-400 mt-2">
              この期間ではポールタイムは合計{" "}
              <span className="font-semibold">
                {Math.abs(summary.totalDelta).toFixed(3)} 秒
              </span>
              延びています（1年あたり約{" "}
              <span className="font-semibold">
                {Math.abs(summary.yearlyDelta).toFixed(3)} 秒
              </span>
              遅くなっています）。
            </p>
          )}
        </section>
      )}

      <p className="mt-6 text-[11px] md:text-xs text-gray-500">
        ※ サーキット別グラフ：Kaggle &rarr; Formula 1 World Championship dataset  
        ※ ドライバー別グラフ：{selectedCircuit}_driver_laps.json（自作スクリプトで生成）  
        ※ コンストラクター別グラフ：/data/constructors/{selectedCircuit}.json（自作スクリプトで生成）
      </p>
    </main>
  );
}
