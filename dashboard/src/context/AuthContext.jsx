import React, { createContext, useContext, useEffect, useState } from "react";
import { getMe } from "../api/auth";

const AuthContext = createContext({ org: null, loading: true, refreshOrg: () => {} });

export function AuthProvider({ children }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const retryRef = React.useRef(null);

  const loadOrg = async () => {
    try {
      const { data } = await getMe();
      setOrg(data);
    } catch {
      setOrg(null);
      clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => loadOrg(), 4000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrg();
    return () => clearTimeout(retryRef.current);
  }, []);

  return (
    <AuthContext.Provider value={{ org, loading, refreshOrg: loadOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
