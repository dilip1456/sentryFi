import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-6">
        <div className="absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.15)_0%,transparent_70%)] blur-[24px]" />
        <img src="/logo.png" alt="SentryFi" className="relative h-16 w-16 opacity-40 drop-shadow-[0_4px_14px_hsl(var(--primary)/0.4)]" />
      </div>
      <h1 className="font-display text-5xl text-foreground">404</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">This page doesn't exist.</p>
      <button
        onClick={() => navigate("/")}
        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[hsl(var(--primary))] text-background text-[13px] font-medium hover:opacity-90 transition-opacity"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to SentryFi
      </button>
    </div>
  );
};

export default NotFound;
