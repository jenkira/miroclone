export type AuditAction =
  | "sign_in"
  | "board_access"
  | "board_create"
  | "share_change"
  | "classification_change"
  | "export"
  | "import"
  | "upload"
  | "settings_change"
  | "paste_downgrade"
  | "template_create"
  | "vote_start"
  | "vote_close"
  | "version_create"
  | "version_restore"
  | "delete";

export interface AuditEvent {
  action: AuditAction;
  actor: string;
  boardId?: string;
  detail?: Record<string, unknown>;
}

/** Writes audit events as JSON lines to standard output (ADM-2). */
export function audit(event: AuditEvent, write: (line: string) => void = (l) => process.stdout.write(l + "\n")) {
  write(JSON.stringify({ type: "audit", time: new Date().toISOString(), ...event }));
}
