/** UI card + export delivery types (r7-export skill). */
export type DeliverAction = "download" | "paste_text" | "paste" | "share_link" | "open";

export interface DeliverableCard {
  id: string;
  kind: "inline" | "vfs" | "share";
  fileName: string;
  label?: string;
  mimeType?: string;
  content?: string;
  fileId?: string;
  shareUrl?: string;
  actions: DeliverAction[];
  importAs?: "paste_text" | "paste_html" | null;
}

/** Trigger browser file download from a Blob. */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
