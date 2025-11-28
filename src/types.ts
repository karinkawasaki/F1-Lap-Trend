export type SessionType = "Q" | "R";

export interface ConstructorLapPoint {
  year: number;
  session: SessionType;
  constructorName: string;
  lapTimeMs: number;
  deltaToPoleMs?: number;
  deltaToWinnerMs?: number;
}
