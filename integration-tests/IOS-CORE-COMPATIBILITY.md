# iOS and Rust Core document compatibility

This local test exchanges actual Automerge files between Swift's production
Codable models and Rust Core's production readers/writers. It covers meal-plan
references, food-log snapshots and portions, water entries/settings/timezone,
and shopping. It is a document-format round trip, not a full UI/WebSocket test.

The initial dish workflow was separately exercised through iOS Simulator,
the packaged desktop, the local sync server, and CLI commands using disposable
data. No private phone data is needed. Do not change the managed dev server.

## Repeat the document round trip

Use the sibling `todu-fit-ios` checkout with the matching compatibility branch.
Choose a disposable simulator and substitute its ID for `SIMULATOR_ID` below.

1. Create an empty temporary fixture directory and run the loopback-only host:

   ```sh
   mkdir -p /tmp/fit-core-fixtures
   node integration-tests/ios-fixture-host.cjs /tmp/fit-core-fixtures
   ```

2. In another terminal, export synthetic iOS-written documents:

   ```sh
   xcodebuild -project ../todu-fit-ios/Todufit.xcodeproj \
     -scheme TodufitCoreCompatibility \
     -destination 'platform=iOS Simulator,id=SIMULATOR_ID' \
     -only-testing:TodufitTests/CoreCompatibilityFixtureTests/testExportCompatibilityFixtures \
     test CODE_SIGNING_ALLOWED=NO
   ```

   The committed `ios-0.7.2-*` input fixtures were produced this way. To test a
   changed iOS writer, review and replace those input fixtures with the new
   exports before the next step. Do not replace the `*-return` fixtures yet.

3. Read and edit those documents using Rust Core, exporting the results:

   ```sh
   FIT_IOS_FIXTURE_OUTPUT=/tmp/fit-core-fixtures \
     cargo test -p todu-fit-core --test ios_document_compatibility
   ```

4. Have iOS read the Core edits, verify references/metadata, make new edits,
   and export the resulting `*-return.automerge` documents:

   ```sh
   xcodebuild -project ../todu-fit-ios/Todufit.xcodeproj \
     -scheme TodufitCoreCompatibility \
     -destination 'platform=iOS Simulator,id=SIMULATOR_ID' \
     -only-testing:TodufitTests/CoreCompatibilityFixtureTests/testReadCoreEdits \
     test CODE_SIGNING_ALLOWED=NO
   ```

5. Review and copy the three returned files into `todu-fit-core/tests/fixtures/`
   with the `ios-0.7.2-` prefix. Re-run the Core test to check the iOS re-edits,
   and check the CLI/daemon path:

   ```sh
   cargo test -p todu-fit-core --test ios_document_compatibility
   cargo test -p todu-fit-cli --test ios_compatibility
   ```

Stop the fixture host with Ctrl-C. The host only reads/writes the selected
fixture directory and listens on `127.0.0.1:18767`. The Swift exchange tests
are opt-in through `TodufitCoreCompatibility`; normal iOS unit runs skip them.
No CI workflow was added or changed.

## Scope of the fixes

Existing record-key spelling is retained, including uppercase iOS UUIDs.
References retain their exact target keys. New Core records can reference
existing iOS records without lowercasing their keys. Food-log snapshot URLs,
timestamps, nutrients, and portions survive edits. iOS preserves the shared
hydration timezone and uses it for phone/watch daily totals.

This does not standardize all newly generated UUIDs to uppercase, migrate
legacy fallback document IDs, or certify every legacy/private document.

## Live simulator/desktop verification (2026-11-06)

The local `LiveCoreCompatibilityUITests/testLivePlansLogsWater` test passed
through the running sync server, a disposable daemon store, the packaged desktop,
and the dedicated iOS simulator. It checked:

- iOS meal-plan title and food-log note edits arriving in the daemon, with exactly
  one plan and one log (no duplicate records).
- An iOS water addition increasing the daemon total by exactly 250 mL.
- Desktop meal-plan and food-log edits arriving in iOS after terminating and
  reopening the app.
- Desktop food-log portions of 0.75 appearing as 225 calories in iOS.
- A desktop water addition increasing the iOS total by another 500 mL.

The local run log, received state, and fixture-host scripts are retained under
`apps/desktop/test-results/ios-compatibility/` (ignored test artifacts). The host
uses the synthetic November 6 fixtures and a newly generated test root; it does
not use phone data or restart the managed sync server.

The matching iOS branch includes the opt-in `TodufitLiveCoreCompatibility`
scheme. Build the current CLI (`cargo build -p todu-fit-cli`) and packaged desktop
(`npm run package` in `apps/desktop`), with dependencies installed in `web` and
`apps/desktop`. Start the host while the local sync server is already running:

```sh
node integration-tests/ios-live-host.cjs
```

It creates its own temporary store and root, and opens the packaged desktop.
The default executable is the macOS ARM64 package; `FIT_DESKTOP_BINARY` can
override its path. The host only listens on `127.0.0.1:18768`.

In another terminal, run:

```sh
FIT_TEST_SIMULATOR=YOUR_DISPOSABLE_SIMULATOR_UUID \
  bash integration-tests/run-ios-live-compatibility.sh
```

The wrapper selects the full test method and requires its passed result plus
both directional assertions. A zero-test success, skipped test, or crash does
not count as passing. It refuses to run in CI; the test class skips outside its
explicit local scheme. The fixture date must match the day displayed in the
simulator and desktop for this live UI scenario.
