//! On-disk format for the optional per-input recording: 48 kbps mono Opus packets in
//! one-minute segment files, one directory per input.
//!
//! A segment is `PSEG1` header + `[u16 length][packet]…`. Each packet is 20 ms. The file name is
//! `<start utc ms>-<first capture frame>.pseg`, so a directory listing is the index: ordering,
//! retention and gaps (a new segment starts after any capture discontinuity) need no database.
//! Readers tolerate a truncated tail because the newest segment is still being written.

use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

pub const SAMPLE_RATE_HZ: u32 = 48_000;
/// 20 ms at 48 kHz.
pub const PACKET_SAMPLES: usize = 960;
pub const PACKET_MS: u64 = 20;
/// One minute per segment.
pub const SEGMENT_PACKETS: u32 = 3_000;
pub const SEGMENT_MS: u64 = SEGMENT_PACKETS as u64 * PACKET_MS;
/// The longest window recording will ever keep.
pub const MAX_RETENTION_MINUTES: u32 = 60;
pub const MAX_PACKET_BYTES: usize = 1_275;

const MAGIC: [u8; 8] = *b"PSEG1\0\0\0";
const HEADER_BYTES: usize = 8 + 4 + 4 + 4 + 8 + 8;
/// Flush about once a second so the open segment is readable and a crash loses little.
const FLUSH_EVERY_PACKETS: u32 = 50;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SegmentHeader {
    pub channel: u32,
    pub first_frame: u64,
    pub start_utc_ms: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Segment {
    pub header: SegmentHeader,
    pub packets: Vec<Vec<u8>>,
}

pub fn channel_directory(root: &Path, channel: usize) -> PathBuf {
    root.join(format!("ch{channel:03}"))
}

pub struct SegmentWriter {
    file: BufWriter<File>,
    path: PathBuf,
    header: SegmentHeader,
    packets: u32,
}

impl SegmentWriter {
    pub fn create(root: &Path, header: SegmentHeader) -> io::Result<Self> {
        let directory = channel_directory(root, header.channel as usize);
        fs::create_dir_all(&directory)?;
        let name = format!("{:013}-{}.pseg", header.start_utc_ms, header.first_frame);
        let path = directory.join(name);
        let mut file = BufWriter::new(File::create(&path)?);
        file.write_all(&MAGIC)?;
        file.write_all(&header.channel.to_le_bytes())?;
        file.write_all(&SAMPLE_RATE_HZ.to_le_bytes())?;
        file.write_all(&(PACKET_SAMPLES as u32).to_le_bytes())?;
        file.write_all(&header.first_frame.to_le_bytes())?;
        file.write_all(&header.start_utc_ms.to_le_bytes())?;
        file.flush()?;
        Ok(Self {
            file,
            path,
            header,
            packets: 0,
        })
    }

    pub fn write_packet(&mut self, packet: &[u8]) -> io::Result<()> {
        debug_assert!(packet.len() <= MAX_PACKET_BYTES);
        self.file.write_all(&(packet.len() as u16).to_le_bytes())?;
        self.file.write_all(packet)?;
        self.packets += 1;
        if self.packets.is_multiple_of(FLUSH_EVERY_PACKETS) {
            self.file.flush()?;
        }
        Ok(())
    }

    pub fn is_full(&self) -> bool {
        self.packets >= SEGMENT_PACKETS
    }

    /// Flushes and renames the file to carry its packet count (`<start>-<frame>-<packets>.pseg`),
    /// so a finished segment's length is known from the directory listing alone. A segment
    /// still being written, or left by a crash, has no count.
    pub fn finish(mut self) -> io::Result<()> {
        self.file.flush()?;
        if self.packets == 0 {
            return Ok(());
        }
        let name = format!(
            "{:013}-{}-{}.pseg",
            self.header.start_utc_ms, self.header.first_frame, self.packets
        );
        drop(self.file);
        fs::rename(&self.path, self.path.with_file_name(name))
    }
}

pub fn read_segment(path: &Path) -> io::Result<Segment> {
    let invalid = |detail: &str| io::Error::new(io::ErrorKind::InvalidData, detail.to_owned());
    let mut bytes = Vec::new();
    File::open(path)?.read_to_end(&mut bytes)?;
    if bytes.len() < HEADER_BYTES || bytes[..8] != MAGIC {
        return Err(invalid("not a recording segment"));
    }
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let u64_at = |at: usize| u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap());
    if u32_at(12) != SAMPLE_RATE_HZ || u32_at(16) != PACKET_SAMPLES as u32 {
        return Err(invalid("unsupported segment format"));
    }
    let header = SegmentHeader {
        channel: u32_at(8),
        first_frame: u64_at(20),
        start_utc_ms: u64_at(28),
    };
    let mut packets = Vec::new();
    let mut at = HEADER_BYTES;
    while at + 2 <= bytes.len() {
        let length = u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize;
        if length == 0 || length > MAX_PACKET_BYTES || at + 2 + length > bytes.len() {
            break; // truncated tail of a segment still being written
        }
        packets.push(bytes[at + 2..at + 2 + length].to_vec());
        at += 2 + length;
    }
    Ok(Segment { header, packets })
}

/// The packet count in a finished segment's file name, if it has one.
pub fn packets_in_name(path: &Path) -> Option<u32> {
    path.file_name()?
        .to_str()?
        .strip_suffix(".pseg")?
        .splitn(3, '-')
        .nth(2)?
        .parse()
        .ok()
}

/// Segment files in one input's directory as `(start utc ms, path)`, oldest first.
pub fn list_segments(directory: &Path) -> Vec<(u64, PathBuf)> {
    let mut segments: Vec<(u64, PathBuf)> = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let start = name
                .strip_suffix(".pseg")?
                .split('-')
                .next()?
                .parse()
                .ok()?;
            Some((start, entry.path()))
        })
        .collect();
    segments.sort_unstable();
    segments
}

/// Deletes segments that ended before `cutoff_utc_ms`. Returns how many were removed.
pub fn sweep(directory: &Path, cutoff_utc_ms: u64) -> usize {
    list_segments(directory)
        .into_iter()
        .filter(|(start, _)| start.saturating_add(SEGMENT_MS) < cutoff_utc_ms)
        .filter(|(_, path)| fs::remove_file(path).is_ok())
        .count()
}

/// Deletes every recording under `root`, leaving the directory itself.
pub fn purge(root: &Path) -> io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        if entry.file_type()?.is_dir() && name.to_string_lossy().starts_with("ch") {
            fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("pulse-recording-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn round_trips_packets_and_survives_a_truncated_tail() {
        let root = scratch("roundtrip");
        let header = SegmentHeader {
            channel: 3,
            first_frame: 960,
            start_utc_ms: 1_700_000_000_000,
        };
        let mut writer = SegmentWriter::create(&root, header).unwrap();
        writer.write_packet(&[1, 2, 3]).unwrap();
        writer.write_packet(&[4, 5]).unwrap();
        writer.finish().unwrap();
        let (start, path) = list_segments(&channel_directory(&root, 3)).remove(0);
        assert_eq!(start, 1_700_000_000_000);
        assert_eq!(packets_in_name(&path), Some(2));
        let segment = read_segment(&path).unwrap();
        assert_eq!(segment.header, header);
        assert_eq!(segment.packets, vec![vec![1, 2, 3], vec![4, 5]]);

        let mut bytes = fs::read(&path).unwrap();
        bytes.extend_from_slice(&[9, 0, 7]); // claims 9 bytes, has 1
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_segment(&path).unwrap().packets.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sweep_removes_only_segments_that_ended_before_the_cutoff() {
        let root = scratch("sweep");
        for start in [1_000_000_u64, 1_000_000 + SEGMENT_MS * 2] {
            let header = SegmentHeader {
                channel: 0,
                first_frame: 0,
                start_utc_ms: start,
            };
            SegmentWriter::create(&root, header)
                .unwrap()
                .finish()
                .unwrap();
        }
        let directory = channel_directory(&root, 0);
        assert_eq!(sweep(&directory, 1_000_000 + SEGMENT_MS + 1), 1);
        assert_eq!(list_segments(&directory).len(), 1);
        purge(&root).unwrap();
        assert!(list_segments(&directory).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
