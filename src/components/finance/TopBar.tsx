import { Bell, Search, Settings } from "lucide-react";

export const TopBar = () => {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="max-w-[1280px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-foreground text-background grid place-items-center font-display text-lg font-semibold">
            A
          </div>
          <div className="font-display text-lg tracking-tight text-foreground">
            Atlas <span className="text-muted-foreground font-normal">/ Finance</span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {["Overview", "Accounts", "Insights", "Spending", "Goals"].map((item, i) => (
            <a
              key={item}
              href="#"
              className={`px-3 py-1.5 rounded-full transition-colors ${
                i === 0 ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Search className="h-4 w-4" />
          </button>
          <button className="relative h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-positive" />
          </button>
          <button className="h-9 w-9 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-4 w-4" />
          </button>
          <div className="ml-2 h-9 w-9 rounded-full bg-gradient-to-br from-positive/40 to-info/40 border border-border-strong" />
        </div>
      </div>
    </header>
  );
};
