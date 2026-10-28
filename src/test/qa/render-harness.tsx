/**
 * Renders the real LivePlaidDashboard in demo mode with QA fixtures swapped
 * in for the demo data (see the vi.mock calls each test file declares).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { LivePlaidDashboard } from "@/components/finance/LivePlaidDashboard";

export type View = "overall" | "spending" | "myfinances" | "moneymap" | "benefits";

export function renderDashboard(view: View) {
  cleanup();
  return render(<LivePlaidDashboard demo hasItems={false} onAddAccount={() => {}} view={view} />);
}

/** Value element rendered right after a label (e.g. "Spent this month" → "$590"). */
export async function valueAfterLabel(label: RegExp): Promise<string[]> {
  const els = await screen.findAllByText(label);
  return els.map(e => (e.nextElementSibling?.textContent ?? "").trim());
}

export const parseUSD = (s: string): number => {
  const neg = /^[−-]/.test(s.trim());
  const v = Number(s.replace(/[^0-9.]/g, ""));
  return neg ? -v : v;
};
