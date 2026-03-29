**Project Context – Engine Defect Investigation Tool**

I am designing the UI/UX for an internal engineering web application used to investigate historical defects on aircraft engines. The tool is used by engineers when a new defect is reported to help them find similar past issues and understand how they were resolved.

The application displays a very large engine diagram with fitting positions. Defects are assigned to fittings. The diagram is pannable and zoomable, and defect clusters are shown on top of the diagram.

The UI has three main panels:

Left panel – Defect search and results
Center – Engine diagram with clusters
Right panel – Defect detail

**Primary user workflow**

When a new defect comes in, engineers typically investigate by:

1. Looking for previous defects on the same fitting for that engine.
2. Looking for defects on the same installed item on that engine.
3. Looking for defects on the same fitting or installed item across the fleet.
4. Searching free text to find similar defects using fuzzy search.

The search matches across narrative fields like:

- defect nature
- defect solution
- engineer appraisal

**Defect Mode (investigation mode)**

The left panel currently contains:

- A scope toggle: **On Engine / On Fleet**
- A free text search box with fuzzy matching across text fields
- A flat list of defect results

Each result item shows:

- defect_id
- date_raised
- first ~80 characters of defect nature
- up to 3 keyword chips
- highlighted text matches
- contextual snippet if the match occurs in another field (e.g. engineer appraisal)

Clicking a result:

- pans the diagram to the fitting
- highlights the cluster
- opens the defect in the right panel

Clusters on the diagram represent grouped defects spatially. Cluster size indicates number of defects (no colour coding). Clicking a cluster opens a popover listing the defects in that cluster.

The tool is **not for live monitoring or health dashboards**. It is purely for **historical investigation and precedent finding**.

**Inspect Mode**

There is also a separate “Inspect” mode where engineers explore the engine diagram directly. In that mode:

- Each fitting has a marker
- Clicking a fitting opens asset information
- The right panel includes a **Defects tab** showing defects on that fitting
- There is a **By Fitting / By Asset** toggle there that changes whether defects are shown for the fitting location or the installed asset.

**Current design question**

I’m trying to determine the best UX structure for **Defect Mode**, especially around:

- Whether the left panel should include a **“By Fitting / By Asset” control**
- How search results should be structured
- How the diagram clusters should interact with the results list
- How engineers should navigate historical defects efficiently

The goal is to design a UI that supports **fast investigation of historical defects and similar issues**, not spatial exploration or monitoring.
