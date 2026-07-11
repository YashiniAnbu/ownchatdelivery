import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../utils/api';
import { parseJwt } from '../utils/jwt';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff' | 'rider';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAccessToken = async (): Promise<string> => {
    try {
      const res = await api.post('/auth/refresh');
      const { accessToken } = res.data;
      localStorage.setItem('accessToken', accessToken);
      
      const decoded = parseJwt(accessToken);
      if (decoded) {
        const refreshedUser: User = {
          id: decoded.userId,
          name: decoded.name,
          email: decoded.email,
          role: decoded.role
        };
        localStorage.setItem('user', JSON.stringify(refreshedUser));
        setUser(refreshedUser);
      }
      return accessToken;
    } catch (err) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      setUser(null);
      window.dispatchEvent(new Event('auth-failed'));
      throw err;
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        try {
          // Just check if we can reach protected API, like /org/list
          await api.get('/org/list');
          
          // If successful (or refreshed silently), parse the current access token
          const latestToken = localStorage.getItem('accessToken');
          if (latestToken) {
            const decoded = parseJwt(latestToken);
            if (decoded) {
              const storedUser: User = {
                id: decoded.userId,
                name: decoded.name,
                email: decoded.email,
                role: decoded.role
              };
              localStorage.setItem('user', JSON.stringify(storedUser));
              setUser(storedUser);
            }
          }
        } catch (err) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('user');
          setUser(null);
        }
      }
      setLoading(false);
    };

    initAuth();

    const handleAuthFailed = () => {
      setUser(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    };

    window.addEventListener('auth-failed', handleAuthFailed);
    return () => window.removeEventListener('auth-failed', handleAuthFailed);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken } = res.data;
    localStorage.setItem('accessToken', accessToken);
    
    // Decode user details from the access token
    const decoded = parseJwt(accessToken);
    if (!decoded) {
      throw new Error('Failed to decode token payload on login');
    }
    
    const loggedUser: User = {
      id: decoded.userId,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role
    };
    
    localStorage.setItem('user', JSON.stringify(loggedUser));
    setUser(loggedUser);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
