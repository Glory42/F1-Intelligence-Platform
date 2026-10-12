export interface LeaderboardEntry {
  name: string;
  value: number;
  display?: string;
  detail?: string;
  nationality?: string | null;
  href?: string;
  active?: boolean;
}

export interface RecordHolder {
  name: string;
  nationality: string | null;
  href?: string;
  active?: boolean;
}

export interface RecordTileData {
  value: string;
  holders: RecordHolder[];
  detail?: string;
}
