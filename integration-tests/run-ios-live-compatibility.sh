#!/bin/bash
# Local-only UI test; the disposable fixture host must already be listening.
set -euo pipefail
if [[ -n "${CI:-}" ]]; then
  echo 'This simulator/desktop test is local-only.' >&2
  exit 1
fi
: "${FIT_TEST_SIMULATOR:?Set FIT_TEST_SIMULATOR to the disposable simulator UUID}"
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
ios_dir="${FIT_IOS_CHECKOUT:-$(dirname "$repo_dir")/todu-fit-ios}"
result_log="${FIT_LIVE_TEST_LOG:-$(mktemp /tmp/fit-live-test.XXXXXX)}"
curl --fail --silent --max-time 5 http://127.0.0.1:18768/ > /dev/null
xcodebuild -project "$ios_dir/Todufit.xcodeproj" \
  -scheme TodufitLiveCoreCompatibility -configuration Debug \
  -destination "platform=iOS Simulator,id=$FIT_TEST_SIMULATOR" \
  -derivedDataPath "${FIT_IOS_BUILD_DIR:-/tmp/fit-ios-compat-build}" \
  -only-testing:TodufitUITests/LiveCoreCompatibilityUITests/testLivePlansLogsWater \
  test CODE_SIGNING_ALLOWED=NO > "$result_log" 2>&1 || {
    tail -60 "$result_log"
    exit 1
  }
# Xcode can report success for an empty selection. Require the actual method.
grep -Eq "Test Case .*LiveCoreCompatibilityUITests testLivePlansLogsWater.* passed" "$result_log"
grep -q 'PASS iOS -> daemon: meal plan, food log, water' "$result_log"
grep -q 'PASS desktop -> iOS: meal plan, food log with portions, water after relaunch' "$result_log"
printf 'Live round trip passed. Log: %s\n' "$result_log"
