import { waitForModelOAuthCompletion } from "@bobbot/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@bobbot/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@bobbot/core";

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
