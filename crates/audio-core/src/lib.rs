//! Bounded, dependency-light primitives used by the real-time audio engine.

mod pcm_ring;

pub use pcm_ring::{
    Consumer, PopError, Producer, PushError, RingConfig, RingConfigError, RingMetrics, SpscPcmRing,
};
