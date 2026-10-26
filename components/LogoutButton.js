"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <button className="toolbar-button" type="button" onClick={signOut} disabled={isSigningOut}>
      {isSigningOut ? "Signing out..." : "Sign out"}
    </button>
  );
}
