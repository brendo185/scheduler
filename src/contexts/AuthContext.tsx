import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import * as auth from '../auth';

interface AuthContextValue {
  currentUser: string | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<string | null>(() => auth.getSessionUser());

  useEffect(() => {
    const user = auth.getSessionUser();
    setCurrentUser(user);
  }, []);

  const login = useCallback((username: string, password: string) => {
    if (!auth.validateUser(username, password)) return false;
    auth.setSessionUser(username);
    setCurrentUser(username);
    return true;
  }, []);

  const logout = useCallback(() => {
    auth.setSessionUser(null);
    setCurrentUser(null);
  }, []);

  const value: AuthContextValue = {
    currentUser,
    login,
    logout,
    isAuthenticated: currentUser != null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
