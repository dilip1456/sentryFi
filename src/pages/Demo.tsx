import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDemo } from "@/contexts/DemoContext";
import { useAuth } from "@/contexts/AuthContext";
import Index from "./Index";

// Public demo route — no auth required.
// Forces demo mode and renders the full app with sample data.
// Redirects to main app if the user is already signed in.
export default function Demo() {
  const { demo, setDemo } = useDemo();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) { navigate("/", { replace: true }); return; }
    setDemo(true);
  }, [user, navigate, setDemo]);

  if (!demo) return null;

  return <Index guestDemo />;
}
