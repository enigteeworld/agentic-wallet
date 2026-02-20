import fs from "fs";
import path from "path";

export type AgenticStateV1 = {
  version: 1;
  mint?: {
    address: string;
    decimals: number;
  };
  atas?: {
    [agentId: string]: string; // agentId -> ATA address (for the mint)
  };
};

const DEFAULT_STATE: AgenticStateV1 = {
  version: 1,
  mint: undefined,
  atas: {},
};

export class StateStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(process.cwd(), "keystore", "state.json");
  }

  getPath() {
    return this.filePath;
  }

  load(): AgenticStateV1 {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_STATE, atas: {} };
    }
    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw) as AgenticStateV1;
    if (parsed.version !== 1) throw new Error(`Unsupported state version: ${parsed.version}`);
    parsed.atas = parsed.atas ?? {};
    return parsed;
  }

  save(state: AgenticStateV1) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }
}
