/** The parts of the Miro REST API v2 that the tool reads. Fields the tool doesn't use are left out. */
export interface MiroItem {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
  position?: { x?: number; y?: number; origin?: string; relativeTo?: string };
  geometry?: { width?: number; height?: number; rotation?: number };
  parent?: { id?: string };
}

export interface MiroConnector {
  id: string;
  type?: string;
  startItem?: { id?: string };
  endItem?: { id?: string };
  shape?: string;
  captions?: { content?: string }[];
}

export interface MiroBoardInfo { id: string; name: string; description?: string; owner?: { id?: string; name?: string; email?: string } }
export interface MiroMember { id: string; name?: string; email?: string; role?: string }

/** Everything the tool reads for one board. */
export interface MiroBoard {
  info: MiroBoardInfo;
  items: MiroItem[];
  connectors: MiroConnector[];
  members: MiroMember[];
}
