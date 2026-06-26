import { useState } from "react";

const KEY = "sentryfi_custom_categories";

export type CustomCategory = {
  name: string;
  type: "income" | "expense";
};

export const useCustomCategories = () => {
  const [custom, setCustomState] = useState<CustomCategory[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); }
    catch { return []; }
  });

  const addCategory = (name: string, type: "income" | "expense") => {
    if (custom.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
    const next = [...custom, { name, type }];
    setCustomState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const removeCategory = (name: string) => {
    const next = custom.filter(c => c.name !== name);
    setCustomState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  return { custom, addCategory, removeCategory };
};
