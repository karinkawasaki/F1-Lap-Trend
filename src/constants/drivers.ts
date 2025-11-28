export type Driver = {
  id: string;
  name: string;
  shortName: string;
  color: string;
};

export const DRIVERS: Driver[] = [
  { id: "VER", name: "Max Verstappen", shortName: "VER", color: "#1f77b4" },
  { id: "PER", name: "Sergio Pérez", shortName: "PER", color: "#ff7f0e" },
  { id: "HAM", name: "Lewis Hamilton", shortName: "HAM", color: "#2ca02c" },
  { id: "NOR", name: "Lando Norris", shortName: "NOR", color: "#d62728" },
  { id: "LEC", name: "Charles Leclerc", shortName: "LEC", color: "#9467bd" },
];
