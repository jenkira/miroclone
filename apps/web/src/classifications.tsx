import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { defaultClassifications } from "@miroclone/shared";
import { api, type ClassificationConfig, type Marking } from "./api.js";

const fallback: ClassificationConfig = { list: [...defaultClassifications], default: "OFFICIAL" };
const Ctx = createContext<ClassificationConfig>(fallback);

/** Loads the markings an administrator configured (PMK-1), so banners and pickers follow them. */
export function ClassificationsProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<ClassificationConfig>(fallback);
  useEffect(() => { api.classifications().then(setCfg).catch(() => {}); }, []);
  return <Ctx.Provider value={cfg}>{children}</Ctx.Provider>;
}

export const useClassifications = () => useContext(Ctx);

/** A marking by key. A marking that has since been removed shows its key in grey, and never stops the page. */
export function markingFor(list: readonly Marking[], key: string): Marking {
  return list.find((m) => m.key === key) ?? { key, label: key, level: -1, colour: "#616161" };
}
