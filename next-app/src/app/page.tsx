/* Dashboard shell using existing Sidebar + Dashboard from the Vite app */
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../src/components/Sidebar";
import { Dashboard } from "../../src/components/Dashboard";
import type { SidePanelTab } from "../../src/App";
import { useAuth } from "../contexts/AuthContext";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [sideTab, setSideTab] = useState<SidePanelTab>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <Sidebar
        activeTab={sideTab}
        onSelectTab={setSideTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />
      <main className="app-main">
        <Dashboard sideTab={sideTab} />
      </main>
    </>
  );
}
