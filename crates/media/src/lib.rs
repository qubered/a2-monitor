//! Deterministic 48 kHz capture-frame projections for RTP and RTCP metadata.
//!
//! This crate contains clock arithmetic only. Callers provide identities, RTP bases, and clock
//! anchors. It does not generate randomness, access clocks, perform networking, or implement
//! WebRTC sessions.

use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const RTP_CLOCK_RATE_HZ: u32 = 48_000;
const NTP_FRACTION_SCALE: u128 = 1_u128 << 32;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CaptureEpochId(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ReplayEpochId(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct MediaSessionEpochId(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct MediaWorkerGeneration(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NodeBootId(pub [u8; 16]);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MediaSource {
    Live(CaptureEpochId),
    Replay(ReplayEpochId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MediaSessionContext {
    pub node_boot_id: NodeBootId,
    pub media_session_epoch: MediaSessionEpochId,
    pub media_worker_generation: MediaWorkerGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MediaClockConfig {
    pub context: MediaSessionContext,
    pub source: MediaSource,
    pub source_frame_base: u64,
    pub rtp_timestamp_base: u32,
    pub ssrc: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourcePacket {
    pub source: MediaSource,
    pub first_frame_index: u64,
    pub frame_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RtpProjection {
    pub timestamp: u32,
    pub end_timestamp_exclusive: u32,
    pub represented_frames: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NtpTimestamp {
    pub era: i32,
    pub seconds: u32,
    pub fraction: u32,
}

impl NtpTimestamp {
    pub const fn wire_value(self) -> u64 {
        (self.seconds as u64) << 32 | self.fraction as u64
    }

    const fn from_wire(era: i32, wire: u64) -> Self {
        Self {
            era,
            seconds: (wire >> 32) as u32,
            fraction: wire as u32,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameNtpAnchor {
    pub context: MediaSessionContext,
    pub source: MediaSource,
    pub source_frame_index: u64,
    pub monotonic_ns: u64,
    pub ntp: NtpTimestamp,
    pub generation: u64,
    pub measurement_uncertainty_ns: u64,
    pub rate_error_ppb: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RtcpSenderReportProjection {
    pub rtp_timestamp: u32,
    pub ntp: NtpTimestamp,
    pub anchor_generation: u64,
    pub anchor_monotonic_ns: u64,
    pub uncertainty_ns: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionBoundary {
    CaptureEpochChanged,
    ReplayEpochChanged,
    LiveReplayChanged,
    MediaSessionChanged,
    MediaWorkerRestarted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectionError {
    ZeroIdentity,
    EmptyPacket,
    FrameBeforeBase,
    FrameIntervalOverflow,
    FrameBeforeAnchor,
    NtpEraOverflow,
    UncertaintyOverflow,
    ReusedSsrc,
    InvalidGapLimit,
    NonMonotonicPacket,
    GapTooLarge { observed: u64, maximum: u32 },
    AmbiguousRtpDistance { frames: u64 },
    FreshSessionRequired(SessionBoundary),
}

impl Display for ProjectionError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "cannot project media time: {self:?}")
    }
}

impl Error for ProjectionError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MediaClock {
    config: MediaClockConfig,
}

impl MediaClock {
    pub fn new(config: MediaClockConfig) -> Result<Self, ProjectionError> {
        if config.context.media_session_epoch.0 == 0
            || config.context.media_worker_generation.0 == 0
            || config.context.node_boot_id.0 == [0; 16]
            || config.ssrc == 0
            || match config.source {
                MediaSource::Live(epoch) => epoch.0 == 0,
                MediaSource::Replay(epoch) => epoch.0 == 0,
            }
        {
            return Err(ProjectionError::ZeroIdentity);
        }
        Ok(Self { config })
    }

    pub fn config(self) -> MediaClockConfig {
        self.config
    }

    /// Applies `base + (frame - frame_base) mod 2^32` at the fixed 48 kHz RTP rate.
    pub fn project_packet(
        &self,
        context: MediaSessionContext,
        packet: SourcePacket,
    ) -> Result<RtpProjection, ProjectionError> {
        self.validate_session(context, packet.source)?;
        if packet.frame_count == 0 {
            return Err(ProjectionError::EmptyPacket);
        }
        if packet.first_frame_index < self.config.source_frame_base {
            return Err(ProjectionError::FrameBeforeBase);
        }
        packet
            .first_frame_index
            .checked_add(u64::from(packet.frame_count - 1))
            .ok_or(ProjectionError::FrameIntervalOverflow)?;
        let frame_delta = packet.first_frame_index - self.config.source_frame_base;
        let timestamp = self
            .config
            .rtp_timestamp_base
            .wrapping_add(frame_delta as u32);
        Ok(RtpProjection {
            timestamp,
            end_timestamp_exclusive: timestamp.wrapping_add(packet.frame_count),
            represented_frames: packet.frame_count,
        })
    }

    /// Pairs frame-derived RTP and NTP values for the same source-frame instant.
    /// The anchor influences only NTP; replacing it cannot alter the RTP slope or timestamp.
    pub fn project_sender_report(
        &self,
        context: MediaSessionContext,
        packet: SourcePacket,
        anchor: FrameNtpAnchor,
    ) -> Result<RtcpSenderReportProjection, ProjectionError> {
        let rtp = self.project_packet(context, packet)?;
        if anchor.generation == 0 {
            return Err(ProjectionError::ZeroIdentity);
        }
        self.validate_session(anchor.context, anchor.source)?;
        if anchor.source_frame_index < self.config.source_frame_base {
            return Err(ProjectionError::FrameBeforeBase);
        }
        let elapsed_frames = packet
            .first_frame_index
            .checked_sub(anchor.source_frame_index)
            .ok_or(ProjectionError::FrameBeforeAnchor)?;
        let ntp_delta = u128::from(elapsed_frames)
            .checked_mul(NTP_FRACTION_SCALE)
            .expect("u64 frames times 2^32 fits in u128")
            / u128::from(RTP_CLOCK_RATE_HZ);
        let sum = u128::from(anchor.ntp.wire_value()) + ntp_delta;
        let era_increment =
            i32::try_from(sum >> 64).map_err(|_| ProjectionError::NtpEraOverflow)?;
        let era = anchor
            .ntp
            .era
            .checked_add(era_increment)
            .ok_or(ProjectionError::NtpEraOverflow)?;
        let elapsed_ns = u128::from(elapsed_frames)
            .checked_mul(1_000_000_000)
            .expect("u64 frames times one second fits in u128")
            / u128::from(RTP_CLOCK_RATE_HZ);
        let drift_uncertainty = elapsed_ns
            .checked_mul(u128::from(anchor.rate_error_ppb))
            .expect("bounded products fit in u128")
            .div_ceil(1_000_000_000);
        let uncertainty_ns = u128::from(anchor.measurement_uncertainty_ns)
            .checked_add(drift_uncertainty)
            .and_then(|value| u64::try_from(value).ok())
            .ok_or(ProjectionError::UncertaintyOverflow)?;
        Ok(RtcpSenderReportProjection {
            rtp_timestamp: rtp.timestamp,
            ntp: NtpTimestamp::from_wire(era, sum as u64),
            anchor_generation: anchor.generation,
            anchor_monotonic_ns: anchor.monotonic_ns,
            uncertainty_ns,
        })
    }

    /// Validates that a source or worker transition rotates media-session and SSRC identity.
    pub fn validate_successor(&self, successor: MediaClockConfig) -> Result<(), ProjectionError> {
        Self::new(successor)?;
        let boundary = if successor.context.node_boot_id != self.config.context.node_boot_id
            || successor.context.media_worker_generation
                != self.config.context.media_worker_generation
        {
            SessionBoundary::MediaWorkerRestarted
        } else if successor.source != self.config.source {
            match (self.config.source, successor.source) {
                (MediaSource::Live(_), MediaSource::Live(_)) => {
                    SessionBoundary::CaptureEpochChanged
                }
                (MediaSource::Replay(_), MediaSource::Replay(_)) => {
                    SessionBoundary::ReplayEpochChanged
                }
                _ => SessionBoundary::LiveReplayChanged,
            }
        } else if successor.context.media_session_epoch != self.config.context.media_session_epoch {
            SessionBoundary::MediaSessionChanged
        } else {
            return Ok(());
        };
        if successor.context.media_session_epoch == self.config.context.media_session_epoch {
            return Err(ProjectionError::FreshSessionRequired(boundary));
        }
        if successor.ssrc == self.config.ssrc {
            return Err(ProjectionError::ReusedSsrc);
        }
        Ok(())
    }

    /// Validates an adjacent source interval without inferring order from wrapped RTP values.
    pub fn validate_continuity(
        &self,
        context: MediaSessionContext,
        previous: SourcePacket,
        next: SourcePacket,
        maximum_gap_frames: u32,
    ) -> Result<u32, ProjectionError> {
        if maximum_gap_frames >= (1_u32 << 31) {
            return Err(ProjectionError::InvalidGapLimit);
        }
        self.project_packet(context, previous)?;
        self.project_packet(context, next)?;
        let previous_end = previous
            .first_frame_index
            .checked_add(u64::from(previous.frame_count))
            .ok_or(ProjectionError::FrameIntervalOverflow)?;
        let gap = next
            .first_frame_index
            .checked_sub(previous_end)
            .ok_or(ProjectionError::NonMonotonicPacket)?;
        if gap > u64::from(maximum_gap_frames) {
            return Err(ProjectionError::GapTooLarge {
                observed: gap,
                maximum: maximum_gap_frames,
            });
        }
        let start_distance = u64::from(previous.frame_count) + gap;
        if start_distance >= (1_u64 << 31) {
            return Err(ProjectionError::AmbiguousRtpDistance {
                frames: start_distance,
            });
        }
        Ok(gap as u32)
    }

    fn validate_session(
        &self,
        context: MediaSessionContext,
        source: MediaSource,
    ) -> Result<(), ProjectionError> {
        if context.node_boot_id.0 == [0; 16]
            || context.media_worker_generation.0 == 0
            || context.media_session_epoch.0 == 0
            || match source {
                MediaSource::Live(epoch) => epoch.0 == 0,
                MediaSource::Replay(epoch) => epoch.0 == 0,
            }
        {
            return Err(ProjectionError::ZeroIdentity);
        }
        if context.node_boot_id != self.config.context.node_boot_id {
            return Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaWorkerRestarted,
            ));
        }
        if context.media_worker_generation != self.config.context.media_worker_generation {
            return Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaWorkerRestarted,
            ));
        }
        if context.media_session_epoch != self.config.context.media_session_epoch {
            return Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaSessionChanged,
            ));
        }
        if source != self.config.source {
            let boundary = match (self.config.source, source) {
                (MediaSource::Live(_), MediaSource::Live(_)) => {
                    SessionBoundary::CaptureEpochChanged
                }
                (MediaSource::Replay(_), MediaSource::Replay(_)) => {
                    SessionBoundary::ReplayEpochChanged
                }
                _ => SessionBoundary::LiveReplayChanged,
            };
            return Err(ProjectionError::FreshSessionRequired(boundary));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPTURE: CaptureEpochId = CaptureEpochId(7);
    const MEDIA: MediaSessionEpochId = MediaSessionEpochId(11);
    const WORKER: MediaWorkerGeneration = MediaWorkerGeneration(3);
    const BOOT: NodeBootId = NodeBootId(*b"node-boot-id-001");
    const CONTEXT: MediaSessionContext = MediaSessionContext {
        node_boot_id: BOOT,
        media_session_epoch: MEDIA,
        media_worker_generation: WORKER,
    };

    fn live_clock(frame_base: u64, rtp_base: u32) -> MediaClock {
        MediaClock::new(MediaClockConfig {
            context: CONTEXT,
            source: MediaSource::Live(CAPTURE),
            source_frame_base: frame_base,
            rtp_timestamp_base: rtp_base,
            ssrc: 99,
        })
        .unwrap()
    }

    fn packet(source: MediaSource, first_frame_index: u64) -> SourcePacket {
        SourcePacket {
            source,
            first_frame_index,
            frame_count: 480,
        }
    }

    fn anchor(
        source_frame_index: u64,
        seconds: u32,
        generation: u64,
        measurement_uncertainty_ns: u64,
        rate_error_ppb: u32,
    ) -> FrameNtpAnchor {
        FrameNtpAnchor {
            context: CONTEXT,
            source: MediaSource::Live(CAPTURE),
            source_frame_index,
            monotonic_ns: source_frame_index * 1_000_000_000 / u64::from(RTP_CLOCK_RATE_HZ),
            ntp: NtpTimestamp {
                era: 0,
                seconds,
                fraction: 0,
            },
            generation,
            measurement_uncertainty_ns,
            rate_error_ppb,
        }
    }

    #[test]
    fn maps_48k_frames_and_wraps_rtp_modulo_2_to_32() {
        let clock = live_clock(1_000, u32::MAX - 99);
        assert_eq!(
            clock
                .project_packet(CONTEXT, packet(MediaSource::Live(CAPTURE), 1_150))
                .unwrap(),
            RtpProjection {
                timestamp: 50,
                end_timestamp_exclusive: 530,
                represented_frames: 480,
            }
        );
        assert_eq!(RTP_CLOCK_RATE_HZ, 48_000);
    }

    #[test]
    fn preserves_source_gaps_instead_of_using_arrival_order() {
        let clock = live_clock(10_000, 20);
        let first = clock
            .project_packet(CONTEXT, packet(MediaSource::Live(CAPTURE), 10_000))
            .unwrap();
        let after_gap = clock
            .project_packet(CONTEXT, packet(MediaSource::Live(CAPTURE), 11_440))
            .unwrap();
        assert_eq!(after_gap.timestamp.wrapping_sub(first.timestamp), 1_440);
        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 10_000),
                packet(MediaSource::Live(CAPTURE), 11_440),
                960,
            ),
            Ok(960)
        );
        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 10_000),
                packet(MediaSource::Live(CAPTURE), 11_440),
                959,
            ),
            Err(ProjectionError::GapTooLarge {
                observed: 960,
                maximum: 959,
            })
        );
        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 10_000),
                packet(MediaSource::Live(CAPTURE), 11_440),
                1_u32 << 31,
            ),
            Err(ProjectionError::InvalidGapLimit)
        );
    }

    #[test]
    fn continuity_rejects_half_range_start_distance_including_packet_span() {
        let clock = live_clock(0, 0);
        let previous = SourcePacket {
            source: MediaSource::Live(CAPTURE),
            first_frame_index: 0,
            frame_count: (1_u32 << 31) - 1,
        };
        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                previous,
                packet(MediaSource::Live(CAPTURE), (1_u64 << 31) - 1),
                0,
            ),
            Ok(0)
        );

        let half_range_packet = SourcePacket {
            frame_count: 1_u32 << 31,
            ..previous
        };
        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                half_range_packet,
                packet(MediaSource::Live(CAPTURE), 1_u64 << 31),
                0,
            ),
            Err(ProjectionError::AmbiguousRtpDistance {
                frames: 1_u64 << 31,
            })
        );

        assert_eq!(
            clock.validate_continuity(
                CONTEXT,
                previous,
                packet(MediaSource::Live(CAPTURE), 1_u64 << 31),
                1,
            ),
            Err(ProjectionError::AmbiguousRtpDistance {
                frames: 1_u64 << 31,
            })
        );
    }

    #[test]
    fn rejects_pre_base_and_overflowing_frame_intervals() {
        let clock = live_clock(100, 0);
        assert_eq!(
            clock.project_packet(CONTEXT, packet(MediaSource::Live(CAPTURE), 99)),
            Err(ProjectionError::FrameBeforeBase)
        );
        assert!(
            clock
                .project_packet(
                    CONTEXT,
                    SourcePacket {
                        source: MediaSource::Live(CAPTURE),
                        first_frame_index: u64::MAX,
                        frame_count: 1,
                    },
                )
                .is_ok()
        );
        assert_eq!(
            clock.project_packet(
                CONTEXT,
                SourcePacket {
                    source: MediaSource::Live(CAPTURE),
                    first_frame_index: u64::MAX - 100,
                    frame_count: 480,
                },
            ),
            Err(ProjectionError::FrameIntervalOverflow)
        );
    }

    #[test]
    fn rtcp_uses_monotonic_ntp_anchor_without_changing_rtp_slope() {
        let clock = live_clock(1_000, 500);
        let source = packet(MediaSource::Live(CAPTURE), 49_000);
        let first = clock
            .project_sender_report(CONTEXT, source, anchor(1_000, 100, 1, 250, 100))
            .unwrap();
        assert_eq!(first.rtp_timestamp, 48_500);
        assert_eq!(first.ntp.wire_value(), 101_u64 << 32);
        assert_eq!(first.anchor_generation, 1);
        assert_eq!(first.uncertainty_ns, 350);

        let adjusted = clock
            .project_sender_report(CONTEXT, source, anchor(25_000, 200, 2, 500, 0))
            .unwrap();
        assert_eq!(adjusted.rtp_timestamp, first.rtp_timestamp);
        assert_eq!(adjusted.ntp.wire_value(), (200_u64 << 32) + (1_u64 << 31));
        assert_eq!(adjusted.anchor_generation, 2);
    }

    #[test]
    fn rejects_source_frame_before_anchor() {
        let clock = live_clock(0, 0);
        assert_eq!(
            clock.project_sender_report(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 0),
                anchor(1, 0, 1, 0, 0),
            ),
            Err(ProjectionError::FrameBeforeAnchor)
        );
    }

    #[test]
    fn rtcp_carries_ntp_era_across_the_2036_wire_rollover() {
        let clock = live_clock(0, 0);
        let projection = clock
            .project_sender_report(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 48_000),
                FrameNtpAnchor {
                    ntp: NtpTimestamp {
                        era: 0,
                        seconds: u32::MAX,
                        fraction: 0,
                    },
                    ..anchor(0, 0, 7, 1_000, 0)
                },
            )
            .unwrap();
        assert_eq!(projection.ntp.era, 1);
        assert_eq!(projection.ntp.seconds, 0);
        assert_eq!(projection.ntp.fraction, 0);
        assert_eq!(projection.ntp.wire_value(), 0);

        let frames_per_era = (1_u64 << 32) * u64::from(RTP_CLOCK_RATE_HZ);
        let multi_era = clock
            .project_sender_report(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), frames_per_era * 2),
                anchor(0, 0, 8, 0, 0),
            )
            .unwrap();
        assert_eq!(multi_era.ntp.era, 2);
        assert_eq!(multi_era.ntp.wire_value(), 0);
    }

    #[test]
    fn capture_epoch_change_requires_a_fresh_session() {
        let clock = live_clock(0, 0);
        assert_eq!(
            clock.project_packet(CONTEXT, packet(MediaSource::Live(CaptureEpochId(8)), 0),),
            Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::CaptureEpochChanged
            ))
        );
    }

    #[test]
    fn media_worker_restart_and_session_change_require_fresh_sessions() {
        let clock = live_clock(0, 0);
        assert_eq!(
            clock.project_packet(
                MediaSessionContext {
                    node_boot_id: BOOT,
                    media_session_epoch: MEDIA,
                    media_worker_generation: MediaWorkerGeneration(4),
                },
                packet(MediaSource::Live(CAPTURE), 0),
            ),
            Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaWorkerRestarted
            ))
        );
        assert_eq!(
            clock.project_packet(
                MediaSessionContext {
                    node_boot_id: BOOT,
                    media_session_epoch: MediaSessionEpochId(12),
                    media_worker_generation: WORKER,
                },
                packet(MediaSource::Live(CAPTURE), 0),
            ),
            Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::MediaSessionChanged
            ))
        );
    }

    #[test]
    fn source_and_worker_transitions_rotate_session_and_ssrc() {
        let clock = live_clock(0, 0);
        let mut rotated = clock.config();
        rotated.context.media_session_epoch = MediaSessionEpochId(12);
        assert_eq!(
            clock.validate_successor(rotated),
            Err(ProjectionError::ReusedSsrc)
        );
        rotated.ssrc = 100;
        assert_eq!(clock.validate_successor(rotated), Ok(()));

        let mut successor = clock.config();
        successor.source = MediaSource::Live(CaptureEpochId(8));
        assert_eq!(
            clock.validate_successor(successor),
            Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::CaptureEpochChanged
            ))
        );
        successor.context.media_session_epoch = MediaSessionEpochId(12);
        assert_eq!(
            clock.validate_successor(successor),
            Err(ProjectionError::ReusedSsrc)
        );
        successor.ssrc = 101;
        assert_eq!(clock.validate_successor(successor), Ok(()));

        let mut restarted = clock.config();
        restarted.context.node_boot_id = NodeBootId(*b"node-boot-id-002");
        restarted.context.media_worker_generation = MediaWorkerGeneration(1);
        restarted.context.media_session_epoch = MediaSessionEpochId(13);
        restarted.ssrc = 102;
        assert_eq!(clock.validate_successor(restarted), Ok(()));
    }

    #[test]
    fn replay_has_a_distinct_typed_identity_and_cannot_reuse_live_session() {
        let live = live_clock(0, 0);
        assert_eq!(
            live.project_packet(CONTEXT, packet(MediaSource::Replay(ReplayEpochId(7)), 0),),
            Err(ProjectionError::FreshSessionRequired(
                SessionBoundary::LiveReplayChanged
            ))
        );

        let replay = MediaClock::new(MediaClockConfig {
            context: MediaSessionContext {
                node_boot_id: BOOT,
                media_session_epoch: MediaSessionEpochId(12),
                media_worker_generation: WORKER,
            },
            source: MediaSource::Replay(ReplayEpochId(7)),
            source_frame_base: 96_000,
            rtp_timestamp_base: 900,
            ssrc: 100,
        })
        .unwrap();
        assert_eq!(
            replay
                .project_packet(
                    replay.config().context,
                    packet(MediaSource::Replay(ReplayEpochId(7)), 96_480),
                )
                .unwrap()
                .timestamp,
            1_380
        );
    }

    #[test]
    fn zero_identities_are_rejected() {
        let mut config = live_clock(0, 0).config();
        config.context.media_session_epoch = MediaSessionEpochId(0);
        assert_eq!(MediaClock::new(config), Err(ProjectionError::ZeroIdentity));

        let mut bad_context = CONTEXT;
        bad_context.node_boot_id = NodeBootId([0; 16]);
        assert_eq!(
            live_clock(0, 0).project_packet(bad_context, packet(MediaSource::Live(CAPTURE), 0),),
            Err(ProjectionError::ZeroIdentity)
        );

        let clock = live_clock(0, 0);
        assert_eq!(
            clock.project_sender_report(
                CONTEXT,
                packet(MediaSource::Live(CAPTURE), 0),
                FrameNtpAnchor {
                    generation: 0,
                    ..anchor(0, 0, 1, 0, 0)
                },
            ),
            Err(ProjectionError::ZeroIdentity)
        );
    }
}
