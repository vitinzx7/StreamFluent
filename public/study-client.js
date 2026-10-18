/* Shared local-only protocol for the unbundled extension pages. */
async function studyRequest(action, payload = {}) {
  const requestId = crypto.randomUUID();
  const response = await chrome.runtime.sendMessage({ type: `sf:study:${action}`, requestId, payload });
  if (!response || response.requestId !== requestId || response.ok !== true || !Number.isSafeInteger(response.revision) || response.revision < 0 || !("data" in response)) {
    throw new Error(response?.error || "Não foi possível acessar os dados de estudo.");
  }
  return response.data;
}
