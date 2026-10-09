import { isAttachmentImageMimeType } from "@bobbot/contracts";

/**
 * The one table that decides how an artifact's bytes are shown, from its mime type. The
 * thread's file card and the Artifacts tab both read it, so the two surfaces cannot disagree
 * about what is readable in place — and anything absent here stays download-only on purpose,
 * because the client has no decoder for it.
 */
export type ArtifactPreviewKind = "html" | "pdf" | "image" | "markdown" | "text" | "none";

/** Text types that have no structure to render, so they stay literal rather than parsed. */
const PLAIN_TEXT_MIME_TYPES = new Set(["text/plain", "text/csv", "application/json"]);

export function artifactPreviewKind(mimeType: string): ArtifactPreviewKind {
  if (mimeType === "text/html") return "html";
  if (mimeType === "application/pdf") return "pdf";
  if (isAttachmentImageMimeType(mimeType)) return "image";
  if (mimeType === "text/markdown") return "markdown";
  if (PLAIN_TEXT_MIME_TYPES.has(mimeType)) return "text";
  return "none";
}

/** True when the preview decodes the bytes as UTF-8 text rather than parsing them. */
export function artifactPreviewIsText(kind: ArtifactPreviewKind): boolean {
  return kind === "markdown" || kind === "text";
}
