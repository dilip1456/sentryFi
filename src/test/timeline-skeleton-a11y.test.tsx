/** Timeline loading placeholder is announced once and its shapes are hidden from AT (docs/ui-style.md). */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeletons } from "@/components/timeline/timeline-ui";

describe("Timeline Skeletons", () => {
  it("is one labelled status with hidden shapes", () => {
    render(<Skeletons n={3} />);
    const st = screen.getByRole("status", { name: "Loading timeline" });
    expect(st.querySelectorAll('[aria-hidden="true"], [aria-hidden=""]').length).toBeGreaterThanOrEqual(2);
  });
});
