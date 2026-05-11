use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use clap::{Args, Subcommand, ValueEnum};
use uuid::Uuid;

use crate::sync::SyncHydrationRepository;
use todu_fit_core::{HydrationUnit, WaterEntry};

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
pub enum WaterUnitArg {
    Ml,
    Oz,
}

impl From<WaterUnitArg> for HydrationUnit {
    fn from(value: WaterUnitArg) -> Self {
        match value {
            WaterUnitArg::Ml => HydrationUnit::Ml,
            WaterUnitArg::Oz => HydrationUnit::Oz,
        }
    }
}

#[derive(Clone, ValueEnum, Default)]
pub enum OutputFormat {
    #[default]
    Text,
    Json,
}

#[derive(Args)]
pub struct WaterCommand {
    #[command(subcommand)]
    pub command: WaterSubcommand,
}

#[derive(Subcommand)]
pub enum WaterSubcommand {
    /// Add a water entry
    Add {
        /// Amount to add
        amount: f64,

        /// Input unit for the amount
        #[arg(long, short, value_enum, default_value = "oz")]
        unit: WaterUnitArg,

        /// Timestamp for the entry (RFC3339). Defaults to now.
        #[arg(long)]
        at: Option<String>,
    },

    /// Show today's water total and goal progress
    Today {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// List recent water entries
    Recent {
        /// Number of entries to show
        #[arg(long, short, default_value_t = 10)]
        limit: usize,

        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Show water history over a date range
    History {
        /// Start date (YYYY-MM-DD), defaults to 7 days ago
        #[arg(long)]
        from: Option<String>,

        /// End date (YYYY-MM-DD), defaults to today
        #[arg(long)]
        to: Option<String>,

        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Show current hydration settings
    Settings {
        /// Output format
        #[arg(long, short, value_enum, default_value = "text")]
        format: OutputFormat,
    },

    /// Update hydration settings
    Set {
        /// New daily goal
        #[arg(long)]
        goal: Option<f64>,

        /// Unit for --goal and --presets values
        #[arg(long, short, value_enum)]
        unit: Option<WaterUnitArg>,

        /// Preferred display unit
        #[arg(long = "display-unit", value_enum)]
        display_unit: Option<WaterUnitArg>,

        /// Comma-separated quick-add preset values in the selected unit
        #[arg(long, value_delimiter = ',')]
        presets: Vec<f64>,
    },

    /// Delete a water entry
    Delete {
        /// Water entry ID
        id: String,
    },
}

impl WaterCommand {
    pub fn run(&self, repo: &SyncHydrationRepository) -> Result<(), Box<dyn std::error::Error>> {
        match &self.command {
            WaterSubcommand::Add { amount, unit, at } => self.add(repo, *amount, *unit, at),
            WaterSubcommand::Today { format } => self.today(repo, format),
            WaterSubcommand::Recent { limit, format } => self.recent(repo, *limit, format),
            WaterSubcommand::History { from, to, format } => self.history(repo, from, to, format),
            WaterSubcommand::Settings { format } => self.show_settings(repo, format),
            WaterSubcommand::Set {
                goal,
                unit,
                display_unit,
                presets,
            } => self.update_settings(repo, *goal, *unit, *display_unit, presets),
            WaterSubcommand::Delete { id } => self.delete(repo, id),
        }
    }

    fn add(
        &self,
        repo: &SyncHydrationRepository,
        amount: f64,
        unit: WaterUnitArg,
        at: &Option<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let consumed_at = match at {
            Some(value) => DateTime::parse_from_rfc3339(value)
                .map_err(|_| format!("Invalid timestamp '{}'. Use RFC3339.", value))?
                .with_timezone(&Utc),
            None => Utc::now(),
        };

        let entry = WaterEntry::from_amount(amount, unit.into(), consumed_at)?;
        let created = repo.create_entry(&entry)?;
        let settings = repo.get_settings()?;

        println!("Added water entry:");
        println!("  ID: {}", created.id);
        println!(
            "  Amount: {}",
            format_amount(created.amount_ml, settings.preferred_unit)
        );
        println!("  Time: {}", format_timestamp_local(created.consumed_at));
        Ok(())
    }

    fn today(
        &self,
        repo: &SyncHydrationRepository,
        format: &OutputFormat,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let today = Local::now().date_naive();
        let settings = repo.get_settings()?;
        let mut entries = repo.list_entries_for_date(today)?;
        entries.sort_by_key(|entry| entry.consumed_at);

        let total_ml = repo.daily_total_ml(today)?;
        let progress = repo.goal_progress(today)?;
        let streak = repo.streak_days(today)?;
        let average_ml = repo.average_daily_ml(today, 7)?;

        match format {
            OutputFormat::Json => {
                let output = serde_json::json!({
                    "date": today,
                    "total_ml": total_ml,
                    "goal_ml": settings.daily_goal_ml,
                    "progress": progress,
                    "streak_days": streak,
                    "average_daily_ml_7d": average_ml,
                    "entries": entries,
                    "settings": settings,
                });
                println!("{}", serde_json::to_string_pretty(&output)?);
            }
            OutputFormat::Text => {
                println!("Water Today - {}", today);
                println!("{}", "=".repeat(32));
                println!(
                    "{} / {} ({})",
                    format_amount(total_ml, settings.preferred_unit),
                    format_amount(settings.daily_goal_ml, settings.preferred_unit),
                    format_percent(progress)
                );
                println!("Streak: {} day(s)", streak);
                println!(
                    "7-day average: {}",
                    format_amount(average_ml.round() as i32, settings.preferred_unit)
                );

                if entries.is_empty() {
                    println!("\nNo water entries logged today.");
                } else {
                    println!("\nEntries:");
                    for entry in &entries {
                        println!(
                            "  {}  {}  {}",
                            format_timestamp_local(entry.consumed_at),
                            entry.id,
                            format_amount(entry.amount_ml, settings.preferred_unit)
                        );
                    }
                }
            }
        }

        Ok(())
    }

    fn recent(
        &self,
        repo: &SyncHydrationRepository,
        limit: usize,
        format: &OutputFormat,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let settings = repo.get_settings()?;
        let mut entries = repo.list_entries()?;
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.consumed_at));
        entries.truncate(limit);

        if entries.is_empty() {
            println!("No water entries found");
            return Ok(());
        }

        match format {
            OutputFormat::Json => {
                println!("{}", serde_json::to_string_pretty(&entries)?);
            }
            OutputFormat::Text => {
                println!("Recent Water Entries");
                println!("{}", "=".repeat(32));
                for entry in &entries {
                    println!(
                        "{}  {}  {}",
                        format_timestamp_local(entry.consumed_at),
                        entry.id,
                        format_amount(entry.amount_ml, settings.preferred_unit)
                    );
                }
            }
        }

        Ok(())
    }

    fn history(
        &self,
        repo: &SyncHydrationRepository,
        from: &Option<String>,
        to: &Option<String>,
        format: &OutputFormat,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let today = Local::now().date_naive();
        let to_date = parse_date_or_default(to.as_deref(), today)?;
        let from_date = parse_date_or_default(from.as_deref(), to_date - Duration::days(7))?;

        if from_date > to_date {
            return Err("--from must be on or before --to".into());
        }

        let settings = repo.get_settings()?;
        let mut entries = repo.list_entries()?;
        entries.retain(|entry| {
            let date = entry.consumed_at.date_naive();
            date >= from_date && date <= to_date
        });
        entries.sort_by_key(|entry| entry.consumed_at);

        match format {
            OutputFormat::Json => {
                let mut days = Vec::new();
                let mut day = from_date;
                while day <= to_date {
                    let total_ml = repo.daily_total_ml(day)?;
                    days.push(serde_json::json!({
                        "date": day,
                        "total_ml": total_ml,
                        "goal_progress": todu_fit_core::goal_progress(&entries, day, settings.daily_goal_ml),
                    }));
                    day += Duration::days(1);
                }

                let output = serde_json::json!({
                    "from": from_date,
                    "to": to_date,
                    "entries": entries,
                    "days": days,
                    "settings": settings,
                });
                println!("{}", serde_json::to_string_pretty(&output)?);
            }
            OutputFormat::Text => {
                println!("Water History: {} to {}", from_date, to_date);
                println!("{}", "=".repeat(40));

                let mut day = from_date;
                while day <= to_date {
                    let day_entries: Vec<&WaterEntry> = entries
                        .iter()
                        .filter(|entry| entry.consumed_at.date_naive() == day)
                        .collect();
                    let total_ml = repo.daily_total_ml(day)?;
                    let progress = total_ml as f64 / settings.daily_goal_ml as f64;
                    println!(
                        "{}  {} / {} ({})",
                        day,
                        format_amount(total_ml, settings.preferred_unit),
                        format_amount(settings.daily_goal_ml, settings.preferred_unit),
                        format_percent(progress)
                    );
                    for entry in day_entries {
                        println!(
                            "  {}  {}",
                            format_timestamp_local(entry.consumed_at),
                            format_amount(entry.amount_ml, settings.preferred_unit)
                        );
                    }
                    day += Duration::days(1);
                }
            }
        }

        Ok(())
    }

    fn show_settings(
        &self,
        repo: &SyncHydrationRepository,
        format: &OutputFormat,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let settings = repo.get_settings()?;

        match format {
            OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&settings)?),
            OutputFormat::Text => {
                println!("Water Settings");
                println!("{}", "=".repeat(24));
                println!("Preferred unit: {}", format_unit(settings.preferred_unit));
                println!(
                    "Daily goal: {}",
                    format_amount(settings.daily_goal_ml, settings.preferred_unit)
                );
                let presets = settings
                    .quick_add_presets_ml
                    .iter()
                    .map(|preset| format_amount(*preset, settings.preferred_unit))
                    .collect::<Vec<_>>()
                    .join(", ");
                println!("Quick-add presets: {}", presets);
            }
        }

        Ok(())
    }

    fn update_settings(
        &self,
        repo: &SyncHydrationRepository,
        goal: Option<f64>,
        unit: Option<WaterUnitArg>,
        display_unit: Option<WaterUnitArg>,
        presets: &[f64],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut settings = repo.get_settings()?;
        let numeric_unit = unit
            .map(HydrationUnit::from)
            .unwrap_or(settings.preferred_unit);

        if let Some(goal_value) = goal {
            settings.daily_goal_ml = match numeric_unit {
                HydrationUnit::Ml => goal_value.round() as i32,
                HydrationUnit::Oz => todu_fit_core::ml_from_oz(goal_value),
            };
        }

        if !presets.is_empty() {
            settings.quick_add_presets_ml = presets
                .iter()
                .map(|preset| match numeric_unit {
                    HydrationUnit::Ml => preset.round() as i32,
                    HydrationUnit::Oz => todu_fit_core::ml_from_oz(*preset),
                })
                .collect();
            settings.normalize_presets();
        }

        if let Some(display) = display_unit {
            settings.preferred_unit = display.into();
        }

        let saved = repo.save_settings(&settings)?;
        println!("Updated water settings:");
        println!("  Preferred unit: {}", format_unit(saved.preferred_unit));
        println!(
            "  Daily goal: {}",
            format_amount(saved.daily_goal_ml, saved.preferred_unit)
        );
        println!(
            "  Quick-add presets: {}",
            saved
                .quick_add_presets_ml
                .iter()
                .map(|preset| format_amount(*preset, saved.preferred_unit))
                .collect::<Vec<_>>()
                .join(", ")
        );
        Ok(())
    }

    fn delete(
        &self,
        repo: &SyncHydrationRepository,
        id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let entry_id =
            Uuid::parse_str(id).map_err(|_| format!("Invalid water entry UUID: {}", id))?;
        repo.delete_entry(entry_id)?;
        println!("Deleted water entry {}", entry_id);
        Ok(())
    }
}

fn parse_date_or_default(
    value: Option<&str>,
    default: NaiveDate,
) -> Result<NaiveDate, Box<dyn std::error::Error>> {
    match value {
        Some(date) => Ok(NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| format!("Invalid date format '{}'. Use YYYY-MM-DD.", date))?),
        None => Ok(default),
    }
}

fn format_timestamp_local(timestamp: DateTime<Utc>) -> String {
    timestamp
        .with_timezone(&Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

fn format_percent(progress: f64) -> String {
    format!("{}%", (progress * 100.0).round() as i32)
}

fn format_amount(amount_ml: i32, unit: HydrationUnit) -> String {
    match unit {
        HydrationUnit::Ml => format!("{} mL", amount_ml),
        HydrationUnit::Oz => {
            let ounces = todu_fit_core::oz_from_ml(amount_ml);
            let rounded = (ounces * 10.0).round() / 10.0;
            if rounded.fract() == 0.0 {
                format!("{:.0} oz", rounded)
            } else {
                format!("{:.1} oz", rounded)
            }
        }
    }
}

fn format_unit(unit: HydrationUnit) -> &'static str {
    match unit {
        HydrationUnit::Ml => "mL",
        HydrationUnit::Oz => "oz",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn test_format_amount_ounces() {
        assert_eq!(format_amount(237, HydrationUnit::Oz), "8 oz");
        assert_eq!(format_amount(355, HydrationUnit::Oz), "12 oz");
    }

    #[test]
    fn test_format_amount_ml() {
        assert_eq!(format_amount(500, HydrationUnit::Ml), "500 mL");
    }

    #[test]
    fn test_parse_date_or_default() {
        let default = NaiveDate::from_ymd_opt(2026, 4, 9).unwrap();
        assert_eq!(parse_date_or_default(None, default).unwrap(), default);
        assert_eq!(
            parse_date_or_default(Some("2026-04-01"), default).unwrap(),
            NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()
        );
    }

    #[test]
    fn test_water_subcommand_parsing() {
        #[derive(Parser)]
        struct TestCli {
            #[command(subcommand)]
            command: WaterSubcommand,
        }

        let cli = TestCli::parse_from(["fit", "add", "16", "--unit", "oz"]);
        match cli.command {
            WaterSubcommand::Add { amount, unit, .. } => {
                assert_eq!(amount, 16.0);
                assert_eq!(unit, WaterUnitArg::Oz);
            }
            _ => panic!("expected add command"),
        }
    }
}
