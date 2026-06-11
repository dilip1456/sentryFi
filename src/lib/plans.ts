export type PlanKey = "free" | "pro" | "premium";

export interface Plan {
  key: PlanKey;
  name: string;
  price: number;
  blurb: string;
  features: string[];
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    price: 0,
    blurb: "The basics to track your money.",
    features: [
      "Link up to 3 accounts",
      "Net worth dashboard",
      "Monthly maintenance view",
      "Email support",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: 9,
    blurb: "Everything an active household needs.",
    features: [
      "Unlimited linked accounts",
      "Card benefits & deals tracking",
      "Upcoming transactions & alerts",
      "Spending insights",
      "Priority support",
    ],
    highlight: true,
  },
  {
    key: "premium",
    name: "Premium",
    price: 29,
    blurb: "Pro tools for serious optimizers.",
    features: [
      "Everything in Pro",
      "AI-powered insights & opportunities",
      "Refinance & cash-flow forecasting",
      "Tax-aware account allocation",
      "1:1 onboarding session",
    ],
  },
];
