# Apple Fitness data research

## Summary

There does not appear to be a public third-party API for an "Apple Fitness account" in the sense of a generic REST or account-level integration. The realistic documented access path is Apple platform APIs, primarily HealthKit, which expose health and fitness data from the user’s device-local Health data store with explicit per-type user authorization.

For `todu-fit`, that means Apple fitness ingestion is best treated as an Apple-platform boundary, most likely an iOS or watchOS companion app, with normalized data then synced into the shared `todu-fit` model for reporting. A secondary fallback path is manual import of the user’s Health export XML, which is less seamless but is more compatible with cross-platform reporting workflows.

## What it would take to access the data

### 1. Use an Apple-platform app, not the current cross-platform CLI/web surface

Apple documents HealthKit as the framework for accessing health and fitness data. HealthKit is available on Apple platforms, not as a general cross-platform API for Linux, Windows, or the browser. That makes direct Apple fitness ingestion a poor fit for the current `todu-fit` CLI and web app as they exist today.

A practical implementation would require a native Apple client that can:

- enable the HealthKit capability
- include `NSHealthShareUsageDescription` and, if writing is needed, `NSHealthUpdateUsageDescription`
- call `HKHealthStore.isHealthDataAvailable()`
- request authorization for the exact data types needed
- query HealthKit and transform the results into a `todu-fit`-owned reporting model
- sync that normalized data to other `todu-fit` clients

### 2. Request fine-grained user permission per data type

Apple requires per-type read/write authorization. Apps must explicitly request access to each data type they want to read, such as workouts, heart rate, active energy, or activity summaries.

A notable limitation is that apps cannot tell the difference between "the user denied read access" and "there is no data" for a type they were not allowed to read. From the app’s perspective, denied read access behaves like missing data.

### 3. Query HealthKit, not an Apple Fitness account endpoint

Apple documents several HealthKit query styles that matter for reporting:

- sample queries for raw records
- statistics queries for aggregates such as sums, averages, minimums, and maximums
- statistics collection queries for bucketed time-series reporting
- anchored and observer queries for incremental sync/update flows
- activity summary queries for ring-style daily summaries

These APIs are a good fit for building custom reports once the data is inside an Apple-native client.

### 4. Optional fallback: import Health export XML

Apple’s Health app lets the user export all health and fitness data in XML format. That creates a possible alternative ingestion path for `todu-fit`:

- user exports Health data manually from iPhone
- `todu-fit` imports the XML
- reports are generated cross-platform from imported records

This is much less seamless than HealthKit and would not support live background sync, but it could avoid building Apple-native ingestion first.

## What data appears to be available for custom reports

### Daily activity/rings data

`HKActivitySummary` exposes the daily activity summary for a day, including:

- active energy burned
- active energy goal
- exercise time and goal
- stand hours and goal
- move time fields on newer systems
- the day identifier

This is the closest documented equivalent to the Fitness app’s ring-level daily summary data and would support reports such as:

- daily/weekly/monthly ring completion trends
- missed-goal streaks
- move vs exercise vs stand comparisons
- goal attainment percentages over time

### Workout records

`HKWorkout` stores a single workout and can include or be associated with:

- workout activity type
- start and end timestamps
- duration
- total energy burned
- total distance
- workout events
- metadata
- associated samples that provide finer detail

Associated samples can include metrics such as heart rate, active energy burned, distance, and steps. `HKWorkoutActivity` can further partition a workout into sub-activities, which is useful for multisport events or interval training.

This would support reports such as:

- workouts per week/month
- training volume by workout type
- duration, distance, and calorie trends
- interval or multisport breakdowns
- personal bests and consistency reports

### Route/location data for workouts

`HKWorkoutRoute` stores route data for workouts as `CLLocation` arrays and can be read in batches through `HKWorkoutRouteQuery`.

This would support reports such as:

- route maps
- route distance verification
- elevation/location-based workout summaries
- repeated-route comparisons

### Broader HealthKit metrics relevant to fitness reporting

Apple’s HealthKit authorization examples and query docs show that apps can request and analyze data types such as:

- heart rate
- active energy burned
- cycling distance
- walking/running distance
- wheelchair distance
- step count

More broadly, HealthKit supports many other health and fitness record types that could be relevant depending on scope, such as sleep, body measurements, VO2 max, and other quantities or categories, provided the app requests authorization for them and the data exists on the user’s device.

This means custom reports could go beyond the Fitness rings and include:

- heart-rate trends during workouts
- weekly energy expenditure
- step-count trends
- sleep vs workout correlation
- source-based comparisons by device/app

## Important constraints and limitations

### No documented generic Apple Fitness account API

The public Apple documentation surfaced in this research points to HealthKit and related Apple-platform frameworks, not to a third-party account API for Apple Fitness or Fitness+ history. That means the likely answer is:

- there is no supported generic account-level API to connect from the current cross-platform product surface
- the supported path is device-local Apple framework access with user permission

This should be treated as a research conclusion, not a guaranteed negative statement about every internal Apple system. The practical takeaway is that third-party implementation should assume HealthKit, not an account API.

### Platform lock-in

Any first-class integration depends on Apple-native code. Even if `todu-fit` remains cross-platform overall, Apple data ingestion itself would be platform-specific.

### Privacy and distribution constraints

Apple’s HealthKit privacy rules are strict. Relevant documented constraints include:

- apps must clearly disclose how they use health data
- apps may not use HealthKit data for advertising or similar services
- apps may not sell HealthKit-derived data
- apps may not disclose HealthKit-derived data to third parties without express user permission, and then only in limited health/fitness-service contexts
- apps must provide a privacy policy
- App Store review guidance and Apple Developer Program terms must be followed

### Authorization gaps look like missing data

Because denied read access is indistinguishable from missing data, reports must be designed to tolerate partial datasets and explain that some categories may be unavailable due to permissions.

### Background access and device state

Apple notes that the HealthKit store is encrypted when the device is locked. Background reads may fail while the device is locked, though writes can be cached and persisted later. That affects any background sync or ingestion design.

### Manual export is coarse-grained

XML export is useful as a fallback, but it is user-driven and batch-oriented. It is not a drop-in replacement for HealthKit-based live ingestion.

## Recommendation for `todu-fit`

### Recommended architecture

Keep this research in `todu-fit`, but treat implementation as a cross-project design split:

- Apple ingestion boundary: likely `todu-fit-ios` or another Apple-native client
- shared reporting/storage boundary: `todu-fit` shared model plus sync
- cross-platform consumption: CLI/web use normalized synced data after Apple-native ingestion

### Suggested implementation order

1. Confirm the reporting outcomes that matter most, such as ring trends, workout summaries, heart-rate analysis, or sleep/workout correlations.
2. Define a minimal normalized schema in `todu-fit` for imported Apple fitness data or derived report facts.
3. Build a small Apple-native spike that reads `HKActivitySummary`, `HKWorkout`, and a few core quantity samples.
4. Sync normalized records into the existing `todu-fit` data layer.
5. Add report generation in CLI/web once the imported model is stable.
6. Consider XML import only as a fallback or bootstrap path.

### Best first scope

The highest-value first slice appears to be:

- daily `HKActivitySummary` import
- workout import via `HKWorkout`
- selected supporting samples such as heart rate, active energy, and distance

That would cover the majority of useful personal reporting without needing to ingest every HealthKit type on day one.

## Proposed shared schema direction

If `todu-fit` later imports Apple data, the shared Automerge documents should stay provider-neutral. In other words, do not model `HKWorkout` or `HKActivitySummary` directly as first-class shared entities. Instead, map provider-specific data into canonical fitness/reporting entities and keep provenance alongside them.

### Design principles

- shared docs describe domain concepts, not Apple APIs
- ingestion adapters translate provider-specific records into shared entities
- provenance is preserved so records can be traced back to the original source
- provider-specific extras stay out of the core schema unless they are needed for cross-platform reporting

### Suggested canonical entities

#### ActivityDaySummary

A normalized daily summary for ring-like or aggregate daily activity.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Unique record ID |
| date | Date | Yes | Calendar day represented by the summary |
| active_energy_burned | Float | No | Total active energy burned for the day |
| active_energy_goal | Float | No | Goal for active energy burned |
| exercise_time_minutes | Float | No | Total exercise time |
| exercise_time_goal_minutes | Float | No | Goal for exercise time |
| stand_hours | Integer | No | Number of stand hours completed |
| stand_hours_goal | Integer | No | Stand goal |
| move_time_minutes | Float | No | Move time if available from source |
| move_time_goal_minutes | Float | No | Move time goal if available |
| source | DataSourceRef | Yes | Provenance for this summary |
| captured_at | DateTime | Yes | When `todu-fit` imported or derived the record |
| updated_at | DateTime | Yes | Last normalization/update time |

This would allow Apple ring-style summaries today while still leaving room for future Android or manual-import equivalents.

#### Workout

A normalized workout/session record.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Unique record ID |
| source_workout_id | String | No | Upstream provider record ID |
| workout_type | String | Yes | Canonical type such as `run`, `walk`, `cycle`, `strength`, `yoga`, `other` |
| started_at | DateTime | Yes | Workout start timestamp |
| ended_at | DateTime | Yes | Workout end timestamp |
| duration_seconds | Integer | No | Duration |
| total_distance_meters | Float | No | Total distance |
| total_active_energy_kcal | Float | No | Total active energy burned |
| total_steps | Integer | No | Total steps if available |
| source | DataSourceRef | Yes | Provenance for this workout |
| metadata | Map<String, String> | No | Small provider-neutral annotations |
| captured_at | DateTime | Yes | Import time |
| updated_at | DateTime | Yes | Last normalization/update time |

This should be the main cross-platform unit for reports like training volume, frequency, streaks, and personal trends.

#### WorkoutSegment

Optional sub-structure for interval or multisport details within a workout.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Unique segment ID |
| workout_id | UUID | Yes | Parent workout |
| segment_type | String | Yes | Canonical type such as `run`, `bike`, `rest`, `interval`, `other` |
| started_at | DateTime | Yes | Segment start |
| ended_at | DateTime | Yes | Segment end |
| distance_meters | Float | No | Segment distance |
| active_energy_kcal | Float | No | Segment energy |
| metadata | Map<String, String> | No | Optional annotations |

This maps well from Apple’s workout activities while remaining generic enough for Android or manual imports.

#### MetricSample

A normalized time-series or point-in-time metric sample.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Unique sample ID |
| metric_type | String | Yes | Canonical metric such as `heart_rate`, `step_count`, `active_energy`, `distance`, `sleep_duration` |
| value | Float | Yes | Numeric value |
| unit | String | Yes | Canonical unit such as `bpm`, `count`, `kcal`, `m`, `min` |
| started_at | DateTime | Yes | Sample start |
| ended_at | DateTime | No | Sample end if ranged |
| workout_id | UUID | No | Optional associated workout |
| source | DataSourceRef | Yes | Provenance for this sample |
| captured_at | DateTime | Yes | Import time |

This is the most flexible layer for custom reports and derived analytics.

#### DataSourceRef

Shared provenance structure attached to imported records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| platform | String | Yes | `apple`, `android`, `manual_import`, etc. |
| provider | String | Yes | `healthkit`, `health_connect`, `xml_import`, etc. |
| device_id | String | No | Optional stable device identifier if available |
| app_id | String | No | Source app/bundle identifier if available |
| source_record_id | String | No | Upstream record identifier |
| imported_by | String | No | User/client that performed the import |
| import_batch_id | String | No | Batch identifier for imports or sync runs |
| payload_version | String | No | Version of the normalization contract |

### What should not go in the shared schema

Avoid Apple-specific shared entities or field names such as:

- `hk_workout`
- `hk_activity_summary`
- `hk_workout_route`
- `hk_quantity_type_identifier`

Those details should stay in the ingestion layer or, if needed, in a provider-specific metadata bag.

### Handling provider-specific extras

Some source fields will not map cleanly across Apple and Android. Prefer a layered approach:

1. put the cross-platform subset in the canonical shared entity
2. store provider-specific extras in a small `source_metadata` map only when needed
3. if full-fidelity import/debugging becomes important, store raw provider records in a separate import/archive document rather than the main reporting docs

That keeps the primary Automerge documents stable and portable.

### Possible Automerge document layout

A future reporting/import feature could use separate maps similar to the current dish/meal documents:

- `activity_summaries.automerge`
- `workouts.automerge`
- `metric_samples.automerge`

Each document would be a map of UUID to canonical entity object.

If raw import preservation is needed later, add a clearly separate document such as:

- `fitness_import_records.automerge`

That separation keeps cross-platform reporting clean while still allowing reprocessing or audit trails.

### Example normalization mapping

Example Apple mappings:

- `HKActivitySummary` -> `ActivityDaySummary`
- `HKWorkout` -> `Workout`
- `HKWorkoutActivity` -> `WorkoutSegment`
- heart rate / steps / energy samples -> `MetricSample`
- `HKWorkoutRoute` -> optional route-specific structure or deferred non-core feature

Example future Android mappings:

- Health Connect aggregate daily data -> `ActivityDaySummary`
- exercise sessions -> `Workout`
- exercise laps/segments -> `WorkoutSegment`
- heart rate / steps / calories -> `MetricSample`

### Recommendation

For `todu-fit`, the safest path is:

- keep HealthKit-specific logic in `todu-fit-ios` or another Apple-native ingestion client
- define a small canonical shared schema in `todu-fit`
- attach explicit provenance to every imported record
- avoid treating provider-native object names as shared data model concepts

## Sources

- Apple Developer: HealthKit framework overview
  - https://developer.apple.com/documentation/healthkit
- Apple Developer: Workouts and activity rings
  - https://developer.apple.com/documentation/healthkit/workouts-and-activity-rings
- Apple Developer: Authorizing access to health data
  - https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- Apple Developer: Protecting user privacy
  - https://developer.apple.com/documentation/healthkit/protecting-user-privacy
- Apple Developer: Reading data from HealthKit
  - https://developer.apple.com/documentation/healthkit/reading-data-from-healthkit
- Apple Developer: `HKWorkout`
  - https://developer.apple.com/documentation/healthkit/hkworkout
- Apple Developer: `HKActivitySummary`
  - https://developer.apple.com/documentation/healthkit/hkactivitysummary
- Apple Developer: `HKWorkoutRoute`
  - https://developer.apple.com/documentation/healthkit/hkworkoutroute
- Apple Support: Share your data in Health on iPhone
  - https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios
