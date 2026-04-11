# Explorer Page Design

## Understanding Summary

- Build a new authenticated page called `Explorer`.
- The first version uses mock data, but the structure should be ready for real API data and explicit `loading`, `empty`, and `error` states.
- The page is a deep-analysis workspace for one ad creative at a time, not a broad comparison dashboard.
- The reading hierarchy is: qualify the ad quickly, reveal bottlenecks, then recommend next actions.
- Primary users are media buyers and analysts, while still remaining understandable for generalists.
- The page should follow the validated sketch closely and remain visually native to the Hookify design system.

## Assumptions

- The route will be `/explorer`.
- The menu and page header will use the label `Explorer`.
- The page should reuse the existing authenticated shell and topbar filters from the app.
- The primary status taxonomy is `Gold`, `Otimizável`, `Lição`, and `Descartável`.
- The final score is displayed on a `0-10` scale.
- Desktop and tablet are the primary targets in v1, while mobile remains functional through responsive stacking.

## Decision Log

- Chosen: deep-analysis page instead of a comparison-first page.
  - Alternatives considered: comparison-first workspace, tabbed analysis flow.
  - Reason: the main goal is to understand one creative deeply and decide what to do next.
- Chosen: first release focuses on diagnosis and explained scoring only.
  - Alternatives considered: favorites, saved lists, related-variation navigation.
  - Reason: the first value is clarity, not management workflow.
- Chosen: the internal breakdown uses one horizontal content wrapper.
  - Alternatives considered: stacked sections, tabbed content.
  - Reason: it keeps preview, insights, and actions visible in the same scan path.
- Chosen: the score explanation appears below the first row, with the final score separated at the bottom.
  - Alternatives considered: score-first hero, score embedded inside the flow row.
  - Reason: the page should explain the score before emphasizing the final number.

## Final Design

### Page shell

- Use the existing authenticated app shell with `Sidebar`, `Topbar`, and `PageContainer`.
- The page title is `Explorer`.
- The intro block includes a section heading `Breakdown` and helper text `Veja onde melhorar e o que fazer`.

### Main layout

- Main content uses a horizontal wrapper.
- Left column: a fixed-width, scrollable ad list with compact ad cards and a selected state.
- Right column: a full-width vertical breakdown wrapper.

### Breakdown column

#### First row

- A three-area grid places all core analysis in the same line:
  - ad preview in `9:16`;
  - insights list;
  - actions list.
- The preview should visually echo the existing ad detail modal language.
- Insights are short diagnostic statements.
- Actions are direct, practical recommendations linked to the detected bottlenecks.

#### Flow section

- Below the first row, a score-composition section explains how the ad is evaluated.
- It includes metric chips and intermediate score blocks such as retention and funnel quality.
- The goal is to make the score feel understandable rather than opaque.

#### Final score

- The final score appears on its own line at the bottom of the breakdown.
- It uses a `0-10` scale and is paired with the status taxonomy:
  - `Gold`
  - `Otimizável`
  - `Lição`
  - `Descartável`

### Data and implementation notes

- Mock data should feel realistic and already match the final UI shape as much as possible.
- Components should be split so the data layer can later swap mocks for API hooks with minimal UI changes.
- The page should explicitly support `loading`, `empty`, and `error` rendering paths even if v1 uses local mocks.
