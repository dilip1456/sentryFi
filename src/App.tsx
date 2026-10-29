import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DemoProvider } from "@/contexts/DemoContext";
import { AppUpdateProvider } from "@/contexts/AppUpdateContext";
import { AppUpdatePrompt } from "@/components/app-update/AppUpdatePrompt";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Light auth/marketing pages stay eager; the heavy dashboard and demo are
// code-split so the first paint (auth/welcome) doesn't pull in the whole app.
import Auth from "./pages/Auth.tsx";
import Welcome from "./pages/Welcome.tsx";
import Pricing from "./pages/Pricing.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import NotFound from "./pages/NotFound.tsx";
const Index = lazy(() => import("./pages/Index.tsx"));
const Demo = lazy(() => import("./pages/Demo.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    // Alt-tabbing back shouldn't trigger a wave of refetches / loading flicker.
    queries: { refetchOnWindowFocus: false },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen grid place-items-center bg-background">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
      <AppUpdateProvider>
        <Toaster />
        <Sonner />
        <AppUpdatePrompt />
        <BrowserRouter>
          <AuthProvider>
            <DemoProvider>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/demo" element={<Demo />} />
                  <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </DemoProvider>
          </AuthProvider>
        </BrowserRouter>
        <SpeedInsights />
      </AppUpdateProvider>
      </TooltipProvider>
    </ThemeProvider>
    <Analytics />
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
