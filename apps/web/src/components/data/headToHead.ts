export interface HeadToHeadRow {
  label: string;
  v1: number;
  v2: number;
  lowerBetter?: boolean;
  fmt?: (value: number) => string;
}
