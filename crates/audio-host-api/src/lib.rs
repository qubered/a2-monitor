//! Project-owned audio-device and capture-stream boundary.
//!
//! Platform adapter types (including CPAL types) must not cross this crate.

use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const IDENTIFIER_BYTES: usize = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostId(pub [u8; IDENTIFIER_BYTES]);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeviceId(pub [u8; IDENTIFIER_BYTES]);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureEpochId(pub u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SampleFormat {
    F32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StreamConfig {
    pub device_id: DeviceId,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub frames_per_block: u16,
    pub sample_format: SampleFormat,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SupportedStreamConfig {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub frames_per_block: u16,
    pub sample_format: SampleFormat,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceInfo {
    pub id: DeviceId,
    pub name: String,
    pub input_configs: Vec<SupportedStreamConfig>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DiscontinuityFlags(u8);

impl DiscontinuityFlags {
    pub const NONE: Self = Self(0);
    pub const SOURCE_XRUN: Self = Self(1 << 0);
    pub const CLOCK_RESET: Self = Self(1 << 1);
    pub const DEVICE_INVALIDATED: Self = Self(1 << 2);

    #[must_use]
    pub const fn bits(self) -> u8 {
        self.0
    }

    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureTiming {
    pub monotonic_capture_ns: Option<u64>,
    pub uncertainty_ns: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureBlockMetadata {
    pub capture_epoch: CaptureEpochId,
    pub first_frame_index: u64,
    pub frame_count: u16,
    pub channel_count: u16,
    pub sequence: u64,
    pub timing: CaptureTiming,
    pub discontinuity: DiscontinuityFlags,
    pub cumulative_source_xruns: u64,
}

#[derive(Debug)]
pub struct CaptureBlock<'a> {
    pub metadata: CaptureBlockMetadata,
    pub interleaved_samples: &'a [f32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CallbackControl {
    Continue,
    Stop,
}

/// Receives capture blocks on the host's real-time callback thread.
///
/// Implementations must not allocate, lock, block, perform I/O, or log from
/// `process`. The callback receives borrowed storage that is valid only for the
/// duration of the call.
pub trait CaptureCallback: Send + 'static {
    fn process(&mut self, block: CaptureBlock<'_>) -> CallbackControl;
}

pub trait InputStream: Send {
    fn start(&mut self) -> Result<(), HostError>;
    fn stop(&mut self) -> Result<(), HostError>;
    fn capture_epoch(&self) -> CaptureEpochId;
}

pub trait AudioHost: Send + Sync {
    fn id(&self) -> HostId;
    fn devices(&self) -> Result<Vec<DeviceInfo>, HostError>;
    fn open_input(
        &self,
        requested: StreamConfig,
        callback: Box<dyn CaptureCallback>,
    ) -> Result<Box<dyn InputStream>, HostError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostErrorKind {
    DeviceNotFound,
    UnsupportedConfiguration,
    AlreadyRunning,
    NotRunning,
    DeviceInvalidated,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostError {
    pub kind: HostErrorKind,
    pub detail: &'static str,
}

impl HostError {
    #[must_use]
    pub const fn new(kind: HostErrorKind, detail: &'static str) -> Self {
        Self { kind, detail }
    }
}

impl Display for HostError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {:?}", self.detail, self.kind)
    }
}

impl Error for HostError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discontinuity_flags_are_explicit() {
        assert!(DiscontinuityFlags::SOURCE_XRUN.contains(DiscontinuityFlags::SOURCE_XRUN));
        assert!(!DiscontinuityFlags::NONE.contains(DiscontinuityFlags::CLOCK_RESET));
        assert_eq!(DiscontinuityFlags::DEVICE_INVALIDATED.bits(), 4);
    }
}
