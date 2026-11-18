import { AccessToken } from "livekit-server-sdk";
import { config } from "./config";
import type { AuthUser } from "./auth";

export const callRoomName = (callId: string) => `call-${callId}`;

/** Short-lived token that only allows joining the one room belonging to a call. */
export async function createCallToken(callId: string, user: AuthUser): Promise<string> {
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: user.id,
    name: user.displayName,
    ttl: "1h",
  });
  token.addGrant({
    roomJoin: true,
    room: callRoomName(callId),
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return token.toJwt();
}

export const livekitPublicUrl = () => config.livekit.publicUrl;
