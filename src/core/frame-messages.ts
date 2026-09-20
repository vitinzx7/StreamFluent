export interface FrameLeaseRequest {
  type: "sf:frame-lease";
  active: boolean;
  token: string;
}

export interface FrameOffer {
  type: "sf:frame-offer";
  active: boolean;
  token: string;
  frameId: number;
  documentId: string;
}

export interface FrameLeaseReply {
  granted: boolean;
  sessionKey: string;
}

export interface FrameSessionUpdate {
  type: "sf:frame-session";
  token: string;
  sessionKey: string;
}

export interface FrameSessionRequest extends FrameSessionUpdate {
  frameId: number;
  documentId: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

export function isFrameId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isFrameDocumentId(value: unknown): value is string {
  return boundedText(value, 200);
}

function isHttpsHost(value: unknown, hosts: string[]): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    // Check the original authority too: URL normalizes an explicit :443 away.
    const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1].toLowerCase();
    return !!authority && hosts.includes(authority) && hosts.includes(url.hostname);
  } catch {
    return false;
  }
}

export function isCinetaroUrl(value: unknown): value is string {
  return isHttpsHost(value, ["cinetaro.to", "www.cinetaro.to"]);
}

export function isEmbeddedPlayerUrl(value: unknown): value is string {
  return isHttpsHost(value, ["cinextream.cc"]);
}

export function isFrameLeaseRequest(value: unknown): value is FrameLeaseRequest {
  return record(value) && value.type === "sf:frame-lease"
    && typeof value.active === "boolean" && boundedText(value.token, 100);
}

export function isFrameOffer(value: unknown): value is FrameOffer {
  return record(value) && value.type === "sf:frame-offer"
    && typeof value.active === "boolean" && boundedText(value.token, 100)
    && isFrameId(value.frameId) && isFrameDocumentId(value.documentId);
}

export function isFrameLeaseReply(value: unknown): value is FrameLeaseReply {
  return record(value) && typeof value.granted === "boolean"
    && typeof value.sessionKey === "string" && value.sessionKey.length <= 200
    && (!value.granted || value.sessionKey.trim().length > 0);
}

export function isFrameSessionUpdate(value: unknown): value is FrameSessionUpdate {
  return record(value) && value.type === "sf:frame-session"
    && boundedText(value.token, 100) && boundedText(value.sessionKey, 200);
}

export function isFrameSessionRequest(value: unknown): value is FrameSessionRequest {
  return isFrameSessionUpdate(value) && record(value)
    && isFrameId(value.frameId) && isFrameDocumentId(value.documentId);
}
