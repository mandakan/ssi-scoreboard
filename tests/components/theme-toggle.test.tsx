import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/theme-toggle";

const mockSetTheme = vi.fn();
let mockTheme = "system";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    mockTheme = "system";
  });

  it("renders without error", () => {
    const { container } = render(<ThemeToggle />);
    expect(container).toBeTruthy();
  });

  it("shows aria-label pointing to next theme when system", () => {
    mockTheme = "system";
    render(<ThemeToggle />);
    // After mount, the button should be present
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Switch to light theme");
  });

  it("shows aria-label pointing to next theme when light", () => {
    mockTheme = "light";
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark theme");
  });

  it("shows aria-label pointing to next theme when dark", () => {
    mockTheme = "dark";
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Switch to system theme");
  });

  it("cycles system → light on click", () => {
    mockTheme = "system";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("cycles light → dark on click", () => {
    mockTheme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("cycles dark → system on click", () => {
    mockTheme = "dark";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });
});
