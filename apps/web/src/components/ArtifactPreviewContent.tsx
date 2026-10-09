import { ChatMarkdown } from "@bobbot/chat-ui/web";
import { Trans } from "@lingui/react/macro";
import { artifactPreviewKind } from "../lib/artifact-preview";
import { useObjectUrl } from "../lib/use-object-url";
import { PdfViewer } from "./PdfViewer";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

/**
 * The viewer body an artifact preview renders, sized by its parent. Which viewer runs is
 * decided by `artifactPreviewKind`, so both the thread card and the Artifacts tab render the
 * same file the same way.
 */
export function ArtifactPreviewContent({
  name,
  mimeType,
  bytes,
  text,
}: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Text decoded by the caller, so it can report invalid UTF-8 before rendering. */
  text?: string;
}) {
  const kind = artifactPreviewKind(mimeType);
  const decoded = text ?? new TextDecoder("utf-8").decode(bytes);

  if (kind === "image") {
    return <ArtifactImageView name={name} mimeType={mimeType} bytes={bytes} />;
  }

  if (kind === "html") {
    return <SandboxedHtmlViewer html={decoded} title={name} />;
  }

  if (kind === "pdf") {
    return <PdfViewer bytes={bytes} title={name} />;
  }

  if (kind === "markdown") {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-foreground">
          <ChatMarkdown>{decoded}</ChatMarkdown>
        </article>
      </div>
    );
  }

  if (kind === "text") {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <pre className="mx-auto w-full max-w-[760px] px-8 py-10 font-mono text-[13px] leading-[1.7] whitespace-pre-wrap break-words text-foreground">
          {decoded}
        </pre>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80">
      <Trans>Preview isn't available for this file type — download it to view it.</Trans>
    </div>
  );
}

/** Separate so only an image preview builds an object URL. */
function ArtifactImageView({
  name,
  mimeType,
  bytes,
}: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto bg-muted/40 p-4">
      <img src={url} alt={name} className="max-h-full max-w-full rounded-lg shadow-sm" />
    </div>
  );
}
