import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { RespondPage } from './pages/RespondPage';
import './App.css';

export type SidePanelTab = 'dashboard' | 'events' | 'meetings' | 'tracker' | 'contacts' | 'settings';

function AppShell() {
  const [sideTab, setSideTab] = useState<SidePanelTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
        <Route path="/respond/:requestId" element={<RespondPage />} />
      </Routes>
    </AuthProvider>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default App
