import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isNative } from "@/lib/capacitor-oauth";

export const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) => {
  const { user, loading, isAdmin } = useAuth();
  // Always show spinner while loading — prevents flash of wrong content
  if (loading) return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!user) return isNative() ? <Navigate to="/auth" replace /> : <Navigate to="/welcome" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};
