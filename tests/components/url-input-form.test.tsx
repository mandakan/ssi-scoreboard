import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UrlInputForm } from "@/components/url-input-form";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("UrlInputForm", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders the input and submit button", () => {
    render(<UrlInputForm />);
    expect(screen.getByRole("textbox", { name: /match url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load match/i })).toBeInTheDocument();
  });

  it("navigates to the match page on valid URL", () => {
    render(<UrlInputForm />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, {
      target: { value: "https://shootnscoreit.com/event/22/26547/" },
    });
    fireEvent.submit(input.closest("form")!);
    expect(mockPush).toHaveBeenCalledWith("/match/22/26547");
  });

  it("shows error for invalid URL", () => {
    render(<UrlInputForm />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "https://example.com/event/22/26547/" } });
    fireEvent.submit(input.closest("form")!);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does nothing on empty submit", () => {
    render(<UrlInputForm />);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears error when user types again after error", () => {
    render(<UrlInputForm />);
    const input = screen.getByRole("textbox");
    // Trigger error
    fireEvent.change(input, { target: { value: "https://bad.example.com/" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Type again — error should clear
    fireEvent.change(input, { target: { value: "https://shootnscoreit.com/event/22/26547/" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
