use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Conversion factor from ounces to milliliters.
pub const ML_PER_OUNCE: f64 = 29.5735;

/// Preferred display/input unit for hydration.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HydrationUnit {
    Ml,
    Oz,
}

/// Per-user hydration settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HydrationSettings {
    pub daily_goal_ml: i32,
    pub preferred_unit: HydrationUnit,
    pub quick_add_presets_ml: Vec<i32>,
}

impl HydrationSettings {
    pub fn new(daily_goal_ml: i32, preferred_unit: HydrationUnit) -> Self {
        let mut settings = Self {
            daily_goal_ml,
            preferred_unit,
            quick_add_presets_ml: default_quick_add_presets_ml(),
        };
        settings.normalize_presets();
        settings
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.daily_goal_ml <= 0 {
            return Err("Daily goal must be positive".to_string());
        }
        if self.quick_add_presets_ml.is_empty() {
            return Err("Quick-add presets cannot be empty".to_string());
        }
        if self.quick_add_presets_ml.iter().any(|preset| *preset <= 0) {
            return Err("Quick-add presets must be positive".to_string());
        }
        Ok(())
    }

    pub fn normalize_presets(&mut self) {
        self.quick_add_presets_ml.sort_unstable();
        self.quick_add_presets_ml.dedup();
    }
}

impl Default for HydrationSettings {
    fn default() -> Self {
        Self::new(ml_from_oz(80.0), HydrationUnit::Oz)
    }
}

/// A single water-consumption entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WaterEntry {
    pub id: Uuid,
    pub consumed_at: DateTime<Utc>,
    pub amount_ml: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl WaterEntry {
    pub fn new(amount_ml: i32, consumed_at: DateTime<Utc>) -> Result<Self, String> {
        validate_amount_ml(amount_ml)?;
        let now = Utc::now();
        Ok(Self {
            id: Uuid::new_v4(),
            consumed_at,
            amount_ml,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn from_amount(
        amount: f64,
        unit: HydrationUnit,
        consumed_at: DateTime<Utc>,
    ) -> Result<Self, String> {
        let amount_ml = match unit {
            HydrationUnit::Ml => amount.round() as i32,
            HydrationUnit::Oz => ml_from_oz(amount),
        };
        Self::new(amount_ml, consumed_at)
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_amount_ml(self.amount_ml)
    }
}

pub fn default_quick_add_presets_ml() -> Vec<i32> {
    vec![
        ml_from_oz(8.0),
        ml_from_oz(12.0),
        ml_from_oz(16.0),
        ml_from_oz(24.0),
    ]
}

pub fn ml_from_oz(oz: f64) -> i32 {
    (oz * ML_PER_OUNCE).round() as i32
}

pub fn oz_from_ml(ml: i32) -> f64 {
    ml as f64 / ML_PER_OUNCE
}

pub fn entries_for_date(entries: &[WaterEntry], date: NaiveDate) -> Vec<&WaterEntry> {
    entries
        .iter()
        .filter(|entry| entry.consumed_at.date_naive() == date)
        .collect()
}

pub fn daily_total_ml(entries: &[WaterEntry], date: NaiveDate) -> i32 {
    entries_for_date(entries, date)
        .into_iter()
        .map(|entry| entry.amount_ml)
        .sum()
}

pub fn goal_progress(entries: &[WaterEntry], date: NaiveDate, goal_ml: i32) -> f64 {
    if goal_ml <= 0 {
        return 0.0;
    }
    daily_total_ml(entries, date) as f64 / goal_ml as f64
}

pub fn streak_days(entries: &[WaterEntry], through_date: NaiveDate, goal_ml: i32) -> usize {
    if goal_ml <= 0 {
        return 0;
    }

    let mut streak = 0;
    let mut date = through_date;
    loop {
        if daily_total_ml(entries, date) < goal_ml {
            break;
        }
        streak += 1;
        match date.checked_sub_signed(Duration::days(1)) {
            Some(previous) => date = previous,
            None => break,
        }
    }
    streak
}

pub fn average_daily_ml(entries: &[WaterEntry], end_date: NaiveDate, days: usize) -> f64 {
    if days == 0 {
        return 0.0;
    }

    let start_date = end_date - Duration::days(days as i64 - 1);
    let mut total = 0;
    for offset in 0..days {
        let date = start_date + Duration::days(offset as i64);
        total += daily_total_ml(entries, date);
    }

    total as f64 / days as f64
}

fn validate_amount_ml(amount_ml: i32) -> Result<(), String> {
    if amount_ml <= 0 {
        Err("Water amount must be positive".to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_hydration_settings_default() {
        let settings = HydrationSettings::default();
        assert_eq!(settings.preferred_unit, HydrationUnit::Oz);
        assert!(settings.daily_goal_ml > 0);
        assert!(!settings.quick_add_presets_ml.is_empty());
    }

    #[test]
    fn test_hydration_settings_validate() {
        let settings = HydrationSettings::new(2000, HydrationUnit::Ml);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn test_hydration_settings_rejects_invalid_values() {
        let settings = HydrationSettings {
            daily_goal_ml: 0,
            preferred_unit: HydrationUnit::Ml,
            quick_add_presets_ml: vec![500],
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn test_water_entry_new() {
        let consumed_at = DateTime::parse_from_rfc3339("2026-04-08T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let entry = WaterEntry::new(500, consumed_at).unwrap();
        assert_eq!(entry.amount_ml, 500);
        assert_eq!(entry.consumed_at, consumed_at);
    }

    #[test]
    fn test_water_entry_from_ounces() {
        let consumed_at = Utc::now();
        let entry = WaterEntry::from_amount(16.0, HydrationUnit::Oz, consumed_at).unwrap();
        assert_eq!(entry.amount_ml, ml_from_oz(16.0));
    }

    #[test]
    fn test_reject_non_positive_water_entry() {
        let consumed_at = Utc::now();
        assert!(WaterEntry::new(0, consumed_at).is_err());
    }

    #[test]
    fn test_unit_conversions() {
        assert_eq!(ml_from_oz(16.0), 473);
        assert!((oz_from_ml(473) - 16.0).abs() < 0.05);
    }

    #[test]
    fn test_daily_total_goal_progress_streak_and_average() {
        let base = DateTime::parse_from_rfc3339("2026-04-08T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let day1 = base.date_naive() - Duration::days(2);
        let day2 = base.date_naive() - Duration::days(1);
        let day3 = base.date_naive();

        let entries = vec![
            WaterEntry::new(
                1000,
                Utc.from_utc_datetime(&day1.and_hms_opt(9, 0, 0).unwrap()),
            )
            .unwrap(),
            WaterEntry::new(
                1000,
                Utc.from_utc_datetime(&day2.and_hms_opt(9, 0, 0).unwrap()),
            )
            .unwrap(),
            WaterEntry::new(
                500,
                Utc.from_utc_datetime(&day2.and_hms_opt(12, 0, 0).unwrap()),
            )
            .unwrap(),
            WaterEntry::new(
                1000,
                Utc.from_utc_datetime(&day3.and_hms_opt(8, 0, 0).unwrap()),
            )
            .unwrap(),
        ];

        assert_eq!(daily_total_ml(&entries, day2), 1500);
        assert!((goal_progress(&entries, day2, 1500) - 1.0).abs() < f64::EPSILON);
        assert_eq!(streak_days(&entries, day3, 1000), 3);
        assert!((average_daily_ml(&entries, day3, 3) - 1166.666).abs() < 1.0);
    }

    #[test]
    fn test_json_roundtrip() {
        let consumed_at = DateTime::parse_from_rfc3339("2026-04-08T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let entry = WaterEntry::new(500, consumed_at).unwrap();
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: WaterEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, entry);
    }
}
