"use client";

import { useSyncExternalStore } from "react";
import {
  subscribeIdentity,
  getMyIdentitySnapshot,
  saveMyIdentity,
} from "@/lib/shooter-identity";
import type { MyShooterIdentity } from "@/lib/types";

export function useMyIdentity() {
  const identity = useSyncExternalStore(
    subscribeIdentity,
    getMyIdentitySnapshot,
    (): MyShooterIdentity | null => null,
  );
  return {
    identity,
    setIdentity: saveMyIdentity,
    clearIdentity: () => saveMyIdentity(null),
  };
}
