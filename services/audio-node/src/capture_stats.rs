//! Capture health that `pulse-device-capture` reports to its media worker.
//!
//! The capture's stdout is the PCM pipe, so counters travel as one JSON line
//! on stderr instead; the worker picks these lines out of the stream and
//! passes every other line through as log output. Only the capture's writer
//! thread writes them, never the audio callback.

use serde_json::{Value, json};

/// One stderr line saying how many device callbacks the capture queue has
/// dropped since capture started (it was full when the callback arrived).
pub fn stats_line(dropped_callbacks: u64) -> String {
    json!({ "type": "capture-stats", "droppedCallbacks": dropped_callbacks }).to_string()
}

/// The dropped-callback count from a stats line, or `None` for any other line.
pub fn parse_stats_line(line: &str) -> Option<u64> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let record = value.as_object()?;
    if record.len() != 2 || record.get("type")?.as_str()? != "capture-stats" {
        return None;
    }
    record.get("droppedCallbacks")?.as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_ignores_ordinary_log_lines() {
        assert_eq!(parse_stats_line(&stats_line(7)), Some(7));
        assert_eq!(
            parse_stats_line("pulse-device-capture: input buffer Fixed(128)"),
            None
        );
        assert_eq!(parse_stats_line(r#"{"type":"capture-stats"}"#), None);
        assert_eq!(
            parse_stats_line(r#"{"type":"capture-stats","droppedCallbacks":1,"x":2}"#),
            None
        );
    }
}
