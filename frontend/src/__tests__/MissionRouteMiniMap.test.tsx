import React from "react";
import { render, screen } from "@testing-library/react";
import MissionRouteMiniMap from "../views/MissionRouteMiniMap";

describe("MissionRouteMiniMap", () => {
  it("shows the whole route, traveled section and rover progress", () => {
    render(
      <MissionRouteMiniMap
        path={[
          [-133.8, 18.65],
          [-131.2, 18.8],
          [-128.4, 19.1],
          [-125.7, 19.5],
        ]}
        current={[-128.4, 19.1]}
        progress={2 / 3}
      />
    );

    expect(
      screen.getByRole("img", { name: "Mission route overview" })
    ).toBeInTheDocument();
    expect(screen.getByText("Local route")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByTestId("mission-route-full-path")).toHaveAttribute(
      "d",
      expect.stringContaining("L")
    );
    expect(screen.getByTestId("mission-route-traveled-path")).toHaveAttribute(
      "d",
      expect.stringContaining("L")
    );
  });

  it("plots raw source elevations and marks the rover position", () => {
    render(
      <MissionRouteMiniMap
        path={[
          [77.35, 18.5],
          [77.39, 18.52],
        ]}
        current={[77.37, 18.51]}
        progress={0.5}
        elevationProfile={[-2198.94, -2300, -2488.06]}
        elevationSource="CTX DTM · areoid"
      />
    );

    expect(
      screen.getByRole("img", { name: "Elevation profile from CTX DTM · areoid" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("mission-elevation-path")).toHaveAttribute(
      "d",
      expect.stringContaining("L")
    );
    expect(screen.getByText("289 m range")).toBeInTheDocument();
    expect(screen.getByText("Start -2,199 m")).toBeInTheDocument();
    expect(screen.getByText("End -2,488 m")).toBeInTheDocument();
  });

  it("unwraps a route crossing the Mars dateline along the short arc", () => {
    render(
      <MissionRouteMiniMap
        path={[
          [179, 10],
          [-179, 11],
        ]}
        current={[-179, 11]}
        progress={0.5}
      />
    );

    const path = screen.getByTestId("mission-route-full-path");
    const coordinates =
      path
        .getAttribute("d")
        ?.match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number) ?? [];
    const yValues = coordinates.filter((_, index) => index % 2 === 1);
    expect(Math.abs(yValues[1] - yValues[0])).toBeGreaterThan(30);
  });
});
