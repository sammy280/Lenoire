import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('erp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      // Clear BOTH sources of truth. Previously this only removed the raw
      // localStorage keys, leaving Zustand's persisted 'erp-auth' store
      // (isAuthenticated + token) stale. On reload, ProtectedRoute trusted
      // the stale Zustand state, rendered a protected page, that page's API
      // call found no erp_token, got another 401, and redirected again —
      // infinite loop. logout() clears both localStorage AND Zustand state.
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || err);
  }
);

export default api;