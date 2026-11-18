import { io, type Socket } from "socket.io-client";
import { API_URL } from "./config";

export function createSocket(): Socket {
  return io(API_URL, {
    withCredentials: true, // sends the httpOnly auth cookie
    transports: ["websocket"],
  });
}
