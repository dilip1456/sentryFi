/** Auth / Terms / Privacy UI checks (docs/ui-style.md): labelled fields, one title per page. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn() } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) } }));
vi.mock("@/lib/capacitor-oauth", () => ({ signInWithGoogle: vi.fn(), isNative: () => false }));
import Auth from "@/pages/Auth";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";

const r = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("Auth", () => {
  it("email and password inputs have programmatic labels", () => {
    r(<Auth />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });
});

describe.each([["Terms", Terms, "Terms of Service"], ["Privacy", Privacy, "Privacy Policy"]] as const)("%s", (_n, Page, title) => {
  it("shows its title once", () => {
    r(<Page />);
    expect(screen.getAllByText(title, { exact: true })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });
});
