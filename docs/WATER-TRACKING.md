# Water Tracking Design

## Goal

Design a private water-tracking feature for `todu-fit` that works across the shared core, CLI, and web surfaces in this repo.

This document records the product and architecture decisions already made in conversation so future implementation work can proceed without rediscovering the original intent.

## Scope

In scope for this design:
- shared/core data model and business logic
- private document ownership and sync implications
- web product and UX guidance
- CLI feature shape and command design
- follow-up implementation task decomposition for this repo

Out of scope for this design:
- iOS implementation details
- non-water beverage tracking
- reminders and notifications
- Apple Health integration
- widgets
- smart insights or coaching

## Source Decisions From Conversation

These decisions are considered settled inputs for the design:
- The feature is for tracking **water only**.
- The main product value is **daily tracking** plus **history**.
- The feature should be **private per user**.
- The feature must support both **ounces** and **milliliters**.
- The recommended product shape is a **private daily water tracker** with:
  - fast entry for today
  - per-entry logging
  - daily total plus goal progress
  - simple history views
  - support for both oz and mL
- Water should be stored as **entries**, not just a single daily total.
- The canonical internal unit should be **mL**, with conversion at input/output boundaries.
- The feature should **not** be modeled as a shared household/group feature.
- The feature should **not** be forced into meal logging.
- Business rules and durable models should live in shared/core so CLI and web agree on behavior.
- This repo covers **core, CLI, and web** only. iOS is a separate project and is out of scope here.

## Product Recommendation

The recommended v1 is a **private hydration tracker** focused on fast entry and daily visibility.

Why this shape is recommended:
- Water logging is a high-frequency action and needs low-friction input.
- Water is not a meal, so reusing meal logging would add friction and create the wrong mental model.
- Daily totals and history are naturally derived from timestamped entries.
- A private feature maps well to current `todu-fit` concepts where some data is personal rather than group-shared.
- Entry-based logging keeps the design extensible for future edits, deletes, streaks, averages, and time-of-day reporting.

## V1 Experience Summary

Users should be able to:
- quickly add water to today using one-tap presets
- enter a custom amount in either oz or mL
- see how much water they have had today
- compare today against a daily goal
- review recent entries for correction and confidence
- view simple history such as recent daily totals, streaks, and average intake

## User Experience

### Today View

The today view should be the primary surface.

It should show:
- today's total water consumed
- daily goal
- progress bar and/or percentage toward the goal
- quick-add buttons
- recent entries with timestamps
- delete entry action
- optional edit or undo for recent/custom entries if implementation cost is low

Example information hierarchy:
1. `54 / 80 oz today`
2. progress bar
3. quick-add controls
4. recent entries list

### Quick-Add Flows

The core success criterion for adoption is low-friction logging.

Recommended default quick-add amounts:
- `+8 oz`
- `+12 oz`
- `+16 oz`
- `+500 mL`
- `+750 mL`
- `Custom`

Guidance:
- quick-add should be one interaction from the main water surface
- quick-add should immediately create an entry with a timestamp
- unit labels should be explicit
- future settings may allow editing these presets, but v1 can ship with sensible defaults

### Custom Entry Flow

The custom flow should support:
- amount input
- unit selection (`oz` or `mL`)
- save action
- immediate conversion to canonical storage in mL

Guidance:
- custom entry is for amounts not covered by presets
- validation should reject zero or negative values
- if editing is supported, the same amount + unit pattern should be reused

### History View

History is a primary use case for v1 and should not be deferred entirely.

Recommended history views:
- 7-day daily totals
- 30-day summary list or equivalent recent-history range
- streak count for goal-met days
- average daily intake over a recent window

The history UX can begin as a simple list if charting is too expensive for the first pass.

### Settings

Recommended water settings:
- daily goal
- preferred display unit (`oz` or `mL`)
- quick-add presets

The display unit should affect UI presentation and entry forms, not canonical storage.

## Data Model Recommendation

### Core Principle: Store Entries, Not Only Totals

The source of truth should be a collection of water entries.

Do not store only a single daily total as the primary durable representation.

Why:
- better undo/delete/edit behavior
- better sync/conflict handling
- preserves timestamps
- enables history and future reporting
- avoids lossy aggregation

### Canonical Unit

All durable amounts should be stored in **mL**.

Why:
- one canonical unit keeps aggregation simple
- avoids cumulative rounding drift
- supports both oz and mL cleanly across clients
- keeps business logic consistent in shared/core

### Proposed Shared/Core Types

#### `WaterEntry`

Suggested fields:
- `id: Uuid`
- `consumed_at: DateTime<Utc>`
- `amount_ml: i32` or `f64`
- `created_at: DateTime<Utc>`
- `updated_at: DateTime<Utc>`

Notes:
- `consumed_at` should be the business timestamp used for day grouping and history.
- `created_at` and `updated_at` support editing/debugging consistency.
- Integer milliliters are preferable if all supported UI inputs can be rounded cleanly.
- If conversion precision becomes awkward, `f64` remains acceptable, but integer mL is preferred for simplicity.

#### `HydrationSettings`

Suggested fields:
- `daily_goal_ml: i32`
- `preferred_unit: HydrationUnit`
- `quick_add_presets_ml: Vec<i32>`

#### `HydrationUnit`

Suggested enum values:
- `ml`
- `oz`

### Derived Values

Derived values should be computed from entries rather than stored independently as source-of-truth state.

Recommended derived values:
- daily total for a selected date
- goal progress for a selected date
- streak count for days meeting goal
- average daily intake over 7-day and/or 30-day windows
- recent-history summaries grouped by local day

## Architecture Fit

### Ownership Model

Water tracking should be modeled as a **private, user-owned feature**.

It should not live in shared group documents.

Why:
- water tracking is personal behavior, not household planning
- group sharing would create confusing ownership and privacy expectations
- the stated product decision is private per user
- this aligns better with personal-log style data than shared planning data

### Document Model Direction

The feature should use a private document path parallel to other user-owned data.

Recommended direction:
- add a private hydration document for water entries
- add private hydration settings owned by the user
- keep aggregation helpers in shared/core
- let web and CLI consume the same durable model and aggregation rules

The exact document placement can be finalized during implementation, but the design intent is clear: hydration is personal, durable, syncable, and separate from shared group documents.

### Why Not Meal Logs

Water should not be embedded into meal logs because:
- it is not conceptually a meal
- it increases logging friction
- it mixes unrelated concepts
- history and quick-add ergonomics are better with a dedicated hydration model

## Core Business Rules

Shared/core should define:
- unit conversion helpers between oz and mL
- day-bucketing rules based on local date derived from timestamps
- daily aggregation helpers
- streak and average calculations
- validation rules for entry creation and settings

Suggested validation rules:
- amount must be positive
- settings goal must be positive
- preset amounts must be positive and deduplicated
- display-unit preference must not affect stored amount values

## Web Implications

The web app is the recommended first implementation surface in this repo.

Why web-first is recommended over CLI-first:
- daily water logging is interaction-heavy and benefits from one-tap controls
- progress bars, recent entries, and history are much more legible in web UI
- quick-add flows are substantially more natural on web than in CLI
- the product value for v1 is primarily behavioral tracking, not automation or scripting

Recommended web MVP surfaces:
- dedicated Water page or Water card leading to a dedicated page
- today summary
- quick-add buttons
- custom entry form/dialog
- recent entries list with delete action
- history list for recent days
- settings for goal and preferred unit

## CLI Implications

CLI should still support the feature, but it is a secondary surface for v1.

Recommended CLI capabilities:
- add a water entry for now or for a specified timestamp/date
- list today's water entries and total
- show history for a date range
- show goal progress
- manage hydration settings

Possible command shape:
- `fit water add --amount 16 --unit oz`
- `fit water add --amount 500 --unit ml`
- `fit water today`
- `fit water history --from 2026-04-01 --to 2026-04-07`
- `fit water settings --goal 80 --unit oz`

CLI should use the same conversion and aggregation rules as web via shared/core.

## Suggested Storage and Query Behavior

Recommended durable model:
- hydration entries stored as individual records in a private hydration document
- hydration settings stored in the same private document or another private user-owned settings document, depending on existing conventions

Recommended query helpers:
- list entries for a local day
- summarize a local day
- summarize a date range
- compute goal status for a day
- compute streaks and averages

## Rollout Plan

### Phase 1: Shared/Core Design and Plumbing

Deliverables:
- hydration data types
- hydration document ownership design
- conversion helpers
- daily aggregation helpers
- settings model
- tests for conversion, aggregation, and serialization

Success criteria:
- shared/core can represent and summarize water data consistently for CLI and web

### Phase 2: Web MVP

Deliverables:
- today view
- quick-add buttons
- custom entry flow
- recent entries
- delete action
- settings for goal and preferred unit
- basic recent-history view

Success criteria:
- a user can use the web app as the primary daily water tracker

### Phase 3: CLI Support

Deliverables:
- commands to add entries
- commands to inspect today's total and recent history
- settings management

Success criteria:
- CLI can create and inspect hydration data using the same shared model

### Phase 4: History and Reporting Polish

Deliverables:
- better summaries for recent windows
- streak and average presentation improvements
- any additional reporting polish shared across clients where practical

Success criteria:
- history is useful, not just technically present

## Non-Goals for V1

Explicit non-goals:
- general beverage tracking
- reminders or push notifications
- Apple Health integration
- widgets
- smart insights or coaching
- hydration effects from coffee, tea, or other beverages
- group/shared hydration tracking

## Risks and Tradeoffs

### Entry-Level Storage Increases Record Count

Tradeoff:
- entry-based logging creates more records than a daily-total-only design

Why this is still preferred:
- preserves correctness and flexibility
- supports delete/edit/history cleanly
- aligns with future reporting needs

### Local-Day Aggregation Requires Clear Time Semantics

Risk:
- daily totals depend on how timestamps are interpreted across clients and time zones

Mitigation:
- document day-bucketing rules clearly during implementation
- centralize helper logic in shared/core where practical

### CLI May Lag Web Ergonomics

Tradeoff:
- CLI can support the feature, but it will not be as frictionless as web for frequent logging

Recommendation:
- accept this tradeoff and optimize v1 UX for web first

## Open Questions

These remain open enough to document, but they should not reopen the settled product decisions above:
- Should `amount_ml` be stored as integer mL or floating-point mL?
- Should hydration settings live in the same private hydration document as entries or in a separate personal settings document?
- Should web history v1 be a list, a chart, or a list first with charting deferred?
- Should edit support ship in the first entry-management pass, or should v1 support add + delete and defer edit?

## Follow-Up Implementation Task Shape

This design is intended to support follow-up tasks in this repo for:
- shared/core hydration models and document plumbing
- web hydration MVP
- CLI hydration support
- history/reporting polish

These tasks should reference this document directly instead of reconstructing requirements from chat history.

## Documentation Pointer

Future tasks and PRs implementing water tracking should reference:
- `docs/WATER-TRACKING.md`

This should be treated as the primary design source for the feature until implementation reveals a reason to revise it.
