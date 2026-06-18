import React, { createContext, useContext, useEffect, useState } from "react";
import { getMe } from "../api/auth";

const AuthContext = createContext({ org: null, loading: true, refreshOrg: () => {} });

const MAX_RETRIES = 5;

export function AuthProvider({ children }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const retryRef = React.useRef(null);
  const retryCountRef = React.useRef(0);

  const loadOrg = async (resetRetries = false) => {
    if (resetRetries) retryCountRef.current = 0;
    try {
      const { data } = await getMe();
      retryCountRef.current = 0;
      setOrg(data);
    } catch {
      setOrg(null);
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
        retryCountRef.current += 1;
        clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => loadOrg(), delay);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrg(true);
    return () => clearTimeout(retryRef.current);
  }, []);

  return (
    <AuthContext.Provider value={{ org, loading, refreshOrg: () => loadOrg(true) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
