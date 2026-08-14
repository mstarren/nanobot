import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MermaidDiagram } from "@/components/MermaidDiagram";

// No vi.mock here: this exercises the real mermaid renderer's failure path
// (mermaid throws on unparseable input) end to end.
describe("MermaidDiagram error", () => {
  it("shows the source code when rendering fails", async () => {
    render(<MermaidDiagram code="graph bad syntax" />);

    const error = await screen.findByTestId("mermaid-diagram-error");
    expect(error).toHaveTextContent("graph bad syntax");
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
  });
});
