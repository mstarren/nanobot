import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(() => Promise.resolve({ svg: "<svg>x</svg>" })),
  },
}));

import { MermaidDiagram } from "@/components/MermaidDiagram";

describe("MermaidDiagram", () => {
  it("renders the diagram SVG", async () => {
    render(<MermaidDiagram code="flowchart TD\nA-->B" />);

    const diagram = await screen.findByTestId("mermaid-diagram");
    await new Promise((r) => setTimeout(r, 50));
    expect(diagram).toHaveTextContent("x");
  });
});
