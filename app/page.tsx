"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import CallProvider from "@/components/CallProvider";
import ChatApp from "@/components/ChatApp";
import RealtimeProvider from "@/components/RealtimeProvider";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="loading-screen" role="status">
        <span className="spinner" aria-hidden="true" />
        Loading...
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <CallProvider>
        <ChatApp />
      </CallProvider>
    </RealtimeProvider>
  );
}
