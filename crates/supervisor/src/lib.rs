//! Deterministic native-worker lifecycle policy.
//!
//! This crate deliberately owns policy, not OS process creation or IPC. A
//! platform adapter supplies monotonic time and lifecycle handles. All calls
//! occur outside the real-time audio callback.

use std::collections::VecDeque;
use std::fmt::Debug;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorkerId(pub u16);

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BootId(pub u128);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkerRole {
    AudioEngine,
    Sequencer,
    Media,
    ClientGateway,
    Replay,
    ReceiverAdapter,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadinessRequirement {
    Basic,
    DeviceVerified,
    LedgerChecked,
    FreshMediaSessions,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadyEvidence {
    Basic,
    DeviceVerified { capture_epoch: u64 },
    LedgerChecked,
    FreshMediaSessions,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkerSpec {
    pub id: WorkerId,
    pub role: WorkerRole,
    pub readiness: ReadinessRequirement,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestartPolicy {
    pub startup_timeout_ms: u64,
    pub heartbeat_timeout_ms: u64,
    pub shutdown_grace_ms: u64,
    pub restart_window_ms: u64,
    pub restart_base_delay_ms: u64,
    pub restart_max_delay_ms: u64,
    pub max_restart_attempts: usize,
    pub terminate_retry_base_delay_ms: u64,
    pub terminate_retry_max_delay_ms: u64,
    pub max_force_terminate_attempts: u32,
}

impl RestartPolicy {
    fn validate(self) -> Result<Self, ConfigError> {
        if self.startup_timeout_ms == 0
            || self.heartbeat_timeout_ms == 0
            || self.shutdown_grace_ms == 0
            || self.restart_window_ms == 0
            || self.restart_base_delay_ms == 0
            || self.restart_max_delay_ms < self.restart_base_delay_ms
            || self.terminate_retry_base_delay_ms == 0
            || self.terminate_retry_max_delay_ms < self.terminate_retry_base_delay_ms
            || self.max_force_terminate_attempts == 0
        {
            return Err(ConfigError::InvalidPolicy);
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConfigError {
    InvalidBootId,
    NoWorkers,
    DuplicateWorkerId(WorkerId),
    DuplicateSingletonRole(WorkerRole),
    InvalidPolicy,
    InvalidReadiness { role: WorkerRole },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkerHealth {
    Stopped,
    Starting,
    Healthy,
    Unresponsive,
    TerminationStuck,
    Restarting,
    Quarantined,
    Stopping,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureReason {
    SpawnFailed,
    StartupTimedOut,
    UnexpectedExit,
    HeartbeatTimedOut,
    ShutdownTimedOut,
    GenerationExhausted,
    ForceTerminationStuck,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkerSnapshot {
    pub id: WorkerId,
    pub role: WorkerRole,
    pub boot_id: BootId,
    pub generation: Option<u64>,
    pub health: WorkerHealth,
    pub capture_epoch: Option<u64>,
    pub restart_attempts_in_window: usize,
    pub last_failure: Option<FailureReason>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NodeReadiness {
    Stopped,
    WorkersStarting,
    WorkersReady,
    Degraded,
    ShuttingDown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventDisposition {
    Accepted,
    DeadlineExpired,
    IgnoredStale,
    EvidenceRejected,
    UnknownWorker,
}

pub trait MonotonicClock {
    fn now_ms(&self) -> u64;
}

pub trait ProcessDriver {
    type Handle: Copy + Debug + Eq;
    type Error: Debug;

    fn spawn(
        &mut self,
        worker: WorkerId,
        role: WorkerRole,
        boot_id: BootId,
        generation: u64,
    ) -> Result<Self::Handle, Self::Error>;
    fn request_shutdown(&mut self, handle: Self::Handle) -> Result<(), Self::Error>;
    /// Forcibly terminates `handle` and returns `Ok` only after process death is
    /// confirmed. Returning `Err` means the handle may still be live and the
    /// supervisor will retain it without restarting or reporting it stopped.
    fn force_terminate(&mut self, handle: Self::Handle) -> Result<(), Self::Error>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RuntimeState<H> {
    Stopped,
    Starting {
        handle: H,
        generation: u64,
        deadline_ms: u64,
    },
    Terminating {
        handle: H,
        generation: u64,
        reason: FailureReason,
        retry_at_ms: u64,
        force_attempts: u32,
    },
    Ready {
        handle: H,
        generation: u64,
        capture_epoch: Option<u64>,
        heartbeat_deadline_ms: u64,
        last_heartbeat_sequence: u64,
    },
    Unresponsive {
        handle: H,
        generation: u64,
        capture_epoch: Option<u64>,
        retry_at_ms: u64,
        force_attempts: u32,
    },
    TerminationStuck {
        handle: H,
        generation: u64,
        reason: FailureReason,
        capture_epoch: Option<u64>,
    },
    Restarting {
        generation: u64,
        retry_at_ms: u64,
    },
    Quarantined {
        generation: u64,
    },
    Stopping {
        handle: H,
        generation: u64,
        deadline_ms: u64,
        force_attempts: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TerminationContext<H> {
    handle: H,
    generation: u64,
    reason: FailureReason,
    capture_epoch: Option<u64>,
}

#[derive(Debug)]
struct WorkerSlot<H> {
    spec: WorkerSpec,
    next_generation: u64,
    restart_attempts: VecDeque<u64>,
    last_capture_epoch: Option<u64>,
    last_failure: Option<FailureReason>,
    state: RuntimeState<H>,
}

#[derive(Debug)]
pub struct Supervisor<C, D>
where
    C: MonotonicClock,
    D: ProcessDriver,
{
    clock: C,
    driver: D,
    boot_id: BootId,
    policy: RestartPolicy,
    workers: Vec<WorkerSlot<D::Handle>>,
    shutting_down: bool,
}

impl<C, D> Supervisor<C, D>
where
    C: MonotonicClock,
    D: ProcessDriver,
{
    pub fn new(
        clock: C,
        driver: D,
        boot_id: BootId,
        policy: RestartPolicy,
        specs: impl IntoIterator<Item = WorkerSpec>,
    ) -> Result<Self, ConfigError> {
        if boot_id.0 == 0 {
            return Err(ConfigError::InvalidBootId);
        }
        let policy = policy.validate()?;
        let mut workers = Vec::new();
        for spec in specs {
            if workers
                .iter()
                .any(|slot: &WorkerSlot<D::Handle>| slot.spec.id == spec.id)
            {
                return Err(ConfigError::DuplicateWorkerId(spec.id));
            }
            if !valid_readiness(spec.role, spec.readiness) {
                return Err(ConfigError::InvalidReadiness { role: spec.role });
            }
            if is_singleton(spec.role)
                && workers
                    .iter()
                    .any(|slot: &WorkerSlot<D::Handle>| slot.spec.role == spec.role)
            {
                return Err(ConfigError::DuplicateSingletonRole(spec.role));
            }
            workers.push(WorkerSlot {
                spec,
                next_generation: 1,
                restart_attempts: VecDeque::with_capacity(policy.max_restart_attempts),
                last_capture_epoch: None,
                last_failure: None,
                state: RuntimeState::Stopped,
            });
        }
        if workers.is_empty() {
            return Err(ConfigError::NoWorkers);
        }
        Ok(Self {
            clock,
            driver,
            boot_id,
            policy,
            workers,
            shutting_down: false,
        })
    }

    pub fn start(&mut self) {
        if self.shutting_down {
            return;
        }
        let now = self.clock.now_ms();
        for index in 0..self.workers.len() {
            if matches!(self.workers[index].state, RuntimeState::Stopped) {
                self.spawn_worker(index, now);
            }
        }
    }

    pub fn tick(&mut self) {
        let now = self.clock.now_ms();
        for index in 0..self.workers.len() {
            match self.workers[index].state {
                RuntimeState::Starting {
                    handle,
                    generation,
                    deadline_ms,
                } if now >= deadline_ms => {
                    self.workers[index].last_failure = Some(FailureReason::StartupTimedOut);
                    if self.driver.force_terminate(handle).is_ok() {
                        self.record_failure(index, now, generation, FailureReason::StartupTimedOut);
                    } else {
                        self.retain_after_failed_termination(
                            index,
                            now,
                            TerminationContext {
                                handle,
                                generation,
                                reason: FailureReason::StartupTimedOut,
                                capture_epoch: None,
                            },
                            1,
                        );
                    }
                }
                RuntimeState::Terminating {
                    handle,
                    generation,
                    reason,
                    retry_at_ms,
                    force_attempts,
                } if now >= retry_at_ms => {
                    if self.driver.force_terminate(handle).is_ok() {
                        self.record_failure(index, now, generation, reason);
                    } else {
                        self.retain_after_failed_termination(
                            index,
                            now,
                            TerminationContext {
                                handle,
                                generation,
                                reason,
                                capture_epoch: None,
                            },
                            force_attempts.saturating_add(1),
                        );
                    }
                }
                RuntimeState::Ready {
                    handle,
                    generation,
                    capture_epoch,
                    heartbeat_deadline_ms,
                    ..
                } if now >= heartbeat_deadline_ms => {
                    self.workers[index].last_failure = Some(FailureReason::HeartbeatTimedOut);
                    if self.driver.force_terminate(handle).is_ok() {
                        self.record_failure(
                            index,
                            now,
                            generation,
                            FailureReason::HeartbeatTimedOut,
                        );
                    } else {
                        self.retain_after_failed_termination(
                            index,
                            now,
                            TerminationContext {
                                handle,
                                generation,
                                reason: FailureReason::HeartbeatTimedOut,
                                capture_epoch,
                            },
                            1,
                        );
                    }
                }
                RuntimeState::Unresponsive {
                    handle,
                    generation,
                    retry_at_ms,
                    force_attempts,
                    capture_epoch,
                    ..
                } if now >= retry_at_ms => {
                    if self.driver.force_terminate(handle).is_ok() {
                        self.record_failure(
                            index,
                            now,
                            generation,
                            FailureReason::HeartbeatTimedOut,
                        );
                    } else {
                        self.retain_after_failed_termination(
                            index,
                            now,
                            TerminationContext {
                                handle,
                                generation,
                                reason: FailureReason::HeartbeatTimedOut,
                                capture_epoch,
                            },
                            force_attempts.saturating_add(1),
                        );
                    }
                }
                RuntimeState::Restarting { retry_at_ms, .. }
                    if !self.shutting_down && now >= retry_at_ms =>
                {
                    self.spawn_worker(index, now);
                }
                RuntimeState::Stopping {
                    handle,
                    generation,
                    deadline_ms,
                    force_attempts,
                } if now >= deadline_ms => {
                    if self.driver.force_terminate(handle).is_ok() {
                        self.workers[index].state = RuntimeState::Stopped;
                    } else {
                        let attempts = force_attempts.saturating_add(1);
                        if attempts >= self.policy.max_force_terminate_attempts {
                            self.workers[index].last_failure =
                                Some(FailureReason::ForceTerminationStuck);
                            self.workers[index].state = RuntimeState::TerminationStuck {
                                handle,
                                generation,
                                reason: FailureReason::ShutdownTimedOut,
                                capture_epoch: None,
                            };
                        } else {
                            self.workers[index].state = RuntimeState::Stopping {
                                handle,
                                generation,
                                deadline_ms: now
                                    .saturating_add(self.termination_retry_delay(attempts)),
                                force_attempts: attempts,
                            };
                        }
                    }
                }
                _ => {}
            }
        }
    }

    pub fn worker_ready(
        &mut self,
        worker: WorkerId,
        boot_id: BootId,
        generation: u64,
        evidence: ReadyEvidence,
    ) -> EventDisposition {
        let Some(index) = self.index_of(worker) else {
            return EventDisposition::UnknownWorker;
        };
        if boot_id != self.boot_id {
            return EventDisposition::IgnoredStale;
        }
        let RuntimeState::Starting {
            handle,
            generation: current,
            ..
        } = self.workers[index].state
        else {
            return EventDisposition::IgnoredStale;
        };
        if generation != current {
            return EventDisposition::IgnoredStale;
        }
        if !evidence_satisfies(
            self.workers[index].spec.readiness,
            evidence,
            self.workers[index].last_capture_epoch,
        ) {
            return EventDisposition::EvidenceRejected;
        }
        let capture_epoch = match evidence {
            ReadyEvidence::DeviceVerified { capture_epoch } => Some(capture_epoch),
            _ => None,
        };
        if capture_epoch.is_some() {
            self.workers[index].last_capture_epoch = capture_epoch;
        }
        self.workers[index].state = RuntimeState::Ready {
            handle,
            generation,
            capture_epoch,
            heartbeat_deadline_ms: self
                .clock
                .now_ms()
                .saturating_add(self.policy.heartbeat_timeout_ms),
            last_heartbeat_sequence: 0,
        };
        EventDisposition::Accepted
    }

    pub fn worker_heartbeat(
        &mut self,
        worker: WorkerId,
        boot_id: BootId,
        generation: u64,
        sequence: u64,
    ) -> EventDisposition {
        let Some(index) = self.index_of(worker) else {
            return EventDisposition::UnknownWorker;
        };
        if boot_id != self.boot_id {
            return EventDisposition::IgnoredStale;
        }
        let RuntimeState::Ready {
            handle,
            generation: current,
            capture_epoch,
            heartbeat_deadline_ms,
            last_heartbeat_sequence,
        } = self.workers[index].state
        else {
            return EventDisposition::IgnoredStale;
        };
        if generation != current {
            return EventDisposition::IgnoredStale;
        }
        let now = self.clock.now_ms();
        if now >= heartbeat_deadline_ms {
            self.workers[index].last_failure = Some(FailureReason::HeartbeatTimedOut);
            if self.driver.force_terminate(handle).is_ok() {
                self.record_failure(index, now, generation, FailureReason::HeartbeatTimedOut);
            } else {
                self.retain_after_failed_termination(
                    index,
                    now,
                    TerminationContext {
                        handle,
                        generation,
                        reason: FailureReason::HeartbeatTimedOut,
                        capture_epoch,
                    },
                    1,
                );
            }
            return EventDisposition::DeadlineExpired;
        }
        if sequence <= last_heartbeat_sequence {
            return EventDisposition::IgnoredStale;
        }
        if let RuntimeState::Ready {
            heartbeat_deadline_ms,
            last_heartbeat_sequence,
            ..
        } = &mut self.workers[index].state
        {
            *heartbeat_deadline_ms = now.saturating_add(self.policy.heartbeat_timeout_ms);
            *last_heartbeat_sequence = sequence;
        }
        EventDisposition::Accepted
    }

    pub fn worker_exited(
        &mut self,
        worker: WorkerId,
        boot_id: BootId,
        generation: u64,
    ) -> EventDisposition {
        let Some(index) = self.index_of(worker) else {
            return EventDisposition::UnknownWorker;
        };
        if boot_id != self.boot_id {
            return EventDisposition::IgnoredStale;
        }
        match self.workers[index].state {
            RuntimeState::Starting {
                generation: current,
                ..
            }
            | RuntimeState::Ready {
                generation: current,
                ..
            } if current == generation && !self.shutting_down => {
                let now = self.clock.now_ms();
                self.record_failure(index, now, generation, FailureReason::UnexpectedExit);
            }
            RuntimeState::Terminating {
                generation: current,
                reason,
                ..
            } if current == generation && !self.shutting_down => {
                let now = self.clock.now_ms();
                self.record_failure(index, now, generation, reason);
            }
            RuntimeState::Unresponsive {
                generation: current,
                ..
            } if current == generation && !self.shutting_down => {
                let now = self.clock.now_ms();
                self.record_failure(index, now, generation, FailureReason::HeartbeatTimedOut);
            }
            RuntimeState::TerminationStuck {
                generation: current,
                reason,
                ..
            } if current == generation && !self.shutting_down => {
                let now = self.clock.now_ms();
                self.record_failure(index, now, generation, reason);
            }
            RuntimeState::Stopping {
                generation: current,
                ..
            }
            | RuntimeState::TerminationStuck {
                generation: current,
                ..
            } if current == generation && self.shutting_down => {
                self.workers[index].state = RuntimeState::Stopped;
            }
            _ => return EventDisposition::IgnoredStale,
        }
        EventDisposition::Accepted
    }

    /// Requests graceful shutdown in reverse configuration order.
    ///
    /// A worker that has not exited by the grace deadline is forcibly
    /// terminated by [`Self::tick`].
    pub fn shutdown(&mut self) {
        if self.shutting_down {
            return;
        }
        self.shutting_down = true;
        let deadline_ms = self
            .clock
            .now_ms()
            .saturating_add(self.policy.shutdown_grace_ms);
        for slot in self.workers.iter_mut().rev() {
            match slot.state {
                RuntimeState::Starting {
                    handle, generation, ..
                }
                | RuntimeState::Terminating {
                    handle, generation, ..
                }
                | RuntimeState::Ready {
                    handle, generation, ..
                }
                | RuntimeState::Unresponsive {
                    handle, generation, ..
                } => {
                    let _ = self.driver.request_shutdown(handle);
                    slot.state = RuntimeState::Stopping {
                        handle,
                        generation,
                        deadline_ms,
                        force_attempts: 0,
                    };
                }
                RuntimeState::Restarting { .. } | RuntimeState::Quarantined { .. } => {
                    slot.state = RuntimeState::Stopped;
                }
                RuntimeState::Stopped
                | RuntimeState::Stopping { .. }
                | RuntimeState::TerminationStuck { .. } => {}
            }
        }
    }

    /// Releases a quarantined worker after an explicit operator or policy action.
    pub fn release_quarantine(&mut self, worker: WorkerId, boot_id: BootId) -> EventDisposition {
        let Some(index) = self.index_of(worker) else {
            return EventDisposition::UnknownWorker;
        };
        if boot_id != self.boot_id {
            return EventDisposition::IgnoredStale;
        }
        if !matches!(self.workers[index].state, RuntimeState::Quarantined { .. }) {
            return EventDisposition::IgnoredStale;
        }
        self.workers[index].restart_attempts.clear();
        self.workers[index].last_failure = None;
        self.workers[index].state = RuntimeState::Stopped;
        if !self.shutting_down {
            let now = self.clock.now_ms();
            self.spawn_worker(index, now);
        }
        EventDisposition::Accepted
    }

    #[must_use]
    pub fn snapshot(&self, worker: WorkerId) -> Option<WorkerSnapshot> {
        let slot = &self.workers[self.index_of(worker)?];
        let (generation, health, capture_epoch) = match slot.state {
            RuntimeState::Stopped => (None, WorkerHealth::Stopped, None),
            RuntimeState::Starting { generation, .. } => {
                (Some(generation), WorkerHealth::Starting, None)
            }
            RuntimeState::Terminating { generation, .. } => {
                (Some(generation), WorkerHealth::Unresponsive, None)
            }
            RuntimeState::Ready {
                generation,
                capture_epoch,
                ..
            } => (Some(generation), WorkerHealth::Healthy, capture_epoch),
            RuntimeState::Unresponsive {
                generation,
                capture_epoch,
                ..
            } => (Some(generation), WorkerHealth::Unresponsive, capture_epoch),
            RuntimeState::TerminationStuck {
                generation,
                capture_epoch,
                ..
            } => (
                Some(generation),
                WorkerHealth::TerminationStuck,
                capture_epoch,
            ),
            RuntimeState::Restarting { generation, .. } => {
                (Some(generation), WorkerHealth::Restarting, None)
            }
            RuntimeState::Quarantined { generation } => {
                (Some(generation), WorkerHealth::Quarantined, None)
            }
            RuntimeState::Stopping { generation, .. } => {
                (Some(generation), WorkerHealth::Stopping, None)
            }
        };
        Some(WorkerSnapshot {
            id: slot.spec.id,
            role: slot.spec.role,
            boot_id: self.boot_id,
            generation,
            health,
            capture_epoch,
            restart_attempts_in_window: slot.restart_attempts.len(),
            last_failure: slot.last_failure,
        })
    }

    #[must_use]
    pub fn readiness(&self) -> NodeReadiness {
        if self.shutting_down {
            return if self
                .workers
                .iter()
                .all(|slot| matches!(slot.state, RuntimeState::Stopped))
            {
                NodeReadiness::Stopped
            } else {
                NodeReadiness::ShuttingDown
            };
        }
        if self
            .workers
            .iter()
            .all(|slot| matches!(slot.state, RuntimeState::Stopped))
        {
            NodeReadiness::Stopped
        } else if self
            .workers
            .iter()
            .all(|slot| matches!(slot.state, RuntimeState::Ready { .. }))
        {
            NodeReadiness::WorkersReady
        } else if self.workers.iter().any(|slot| {
            matches!(
                slot.state,
                RuntimeState::Restarting { .. }
                    | RuntimeState::Quarantined { .. }
                    | RuntimeState::Unresponsive { .. }
                    | RuntimeState::Terminating { .. }
                    | RuntimeState::TerminationStuck { .. }
            )
        }) {
            NodeReadiness::Degraded
        } else {
            NodeReadiness::WorkersStarting
        }
    }

    #[must_use]
    pub fn driver(&self) -> &D {
        &self.driver
    }

    fn index_of(&self, worker: WorkerId) -> Option<usize> {
        self.workers.iter().position(|slot| slot.spec.id == worker)
    }

    fn spawn_worker(&mut self, index: usize, now: u64) {
        let slot = &mut self.workers[index];
        let generation = slot.next_generation;
        let Some(next_generation) = generation.checked_add(1) else {
            slot.last_failure = Some(FailureReason::GenerationExhausted);
            slot.state = RuntimeState::Quarantined { generation };
            return;
        };
        slot.next_generation = next_generation;
        match self
            .driver
            .spawn(slot.spec.id, slot.spec.role, self.boot_id, generation)
        {
            Ok(handle) => {
                slot.state = RuntimeState::Starting {
                    handle,
                    generation,
                    deadline_ms: now.saturating_add(self.policy.startup_timeout_ms),
                };
            }
            Err(_) => self.record_failure(index, now, generation, FailureReason::SpawnFailed),
        }
    }

    fn retain_after_failed_termination(
        &mut self,
        index: usize,
        now: u64,
        context: TerminationContext<D::Handle>,
        force_attempts: u32,
    ) {
        let TerminationContext {
            handle,
            generation,
            reason,
            capture_epoch,
        } = context;
        if force_attempts >= self.policy.max_force_terminate_attempts {
            self.workers[index].last_failure = Some(FailureReason::ForceTerminationStuck);
            self.workers[index].state = RuntimeState::TerminationStuck {
                handle,
                generation,
                reason,
                capture_epoch,
            };
            return;
        }
        let retry_at_ms = now.saturating_add(self.termination_retry_delay(force_attempts));
        self.workers[index].state = if reason == FailureReason::HeartbeatTimedOut {
            RuntimeState::Unresponsive {
                handle,
                generation,
                capture_epoch,
                retry_at_ms,
                force_attempts,
            }
        } else {
            RuntimeState::Terminating {
                handle,
                generation,
                reason,
                retry_at_ms,
                force_attempts,
            }
        };
    }

    fn termination_retry_delay(&self, force_attempts: u32) -> u64 {
        let exponent = force_attempts.saturating_sub(1).min(63);
        self.policy
            .terminate_retry_base_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.policy.terminate_retry_max_delay_ms)
    }

    fn record_failure(
        &mut self,
        index: usize,
        now: u64,
        failed_generation: u64,
        reason: FailureReason,
    ) {
        let slot = &mut self.workers[index];
        while slot
            .restart_attempts
            .front()
            .is_some_and(|attempt| now.saturating_sub(*attempt) > self.policy.restart_window_ms)
        {
            slot.restart_attempts.pop_front();
        }
        slot.last_failure = Some(reason);
        if slot.restart_attempts.len() >= self.policy.max_restart_attempts {
            slot.state = RuntimeState::Quarantined {
                generation: failed_generation,
            };
            return;
        }
        slot.restart_attempts.push_back(now);
        let exponent = u32::try_from(slot.restart_attempts.len().saturating_sub(1))
            .unwrap_or(u32::MAX)
            .min(63);
        let delay = self
            .policy
            .restart_base_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.policy.restart_max_delay_ms);
        slot.state = RuntimeState::Restarting {
            generation: failed_generation,
            retry_at_ms: now.saturating_add(delay),
        };
    }
}

fn valid_readiness(role: WorkerRole, readiness: ReadinessRequirement) -> bool {
    matches!(
        (role, readiness),
        (
            WorkerRole::AudioEngine,
            ReadinessRequirement::DeviceVerified
        ) | (WorkerRole::Sequencer, ReadinessRequirement::LedgerChecked)
            | (WorkerRole::Media, ReadinessRequirement::FreshMediaSessions)
            | (
                WorkerRole::ClientGateway | WorkerRole::Replay | WorkerRole::ReceiverAdapter,
                ReadinessRequirement::Basic
            )
    )
}

fn is_singleton(role: WorkerRole) -> bool {
    matches!(
        role,
        WorkerRole::AudioEngine
            | WorkerRole::Sequencer
            | WorkerRole::ClientGateway
            | WorkerRole::Replay
    )
}

fn evidence_satisfies(
    requirement: ReadinessRequirement,
    evidence: ReadyEvidence,
    last_capture_epoch: Option<u64>,
) -> bool {
    match (requirement, evidence) {
        (ReadinessRequirement::Basic, ReadyEvidence::Basic)
        | (ReadinessRequirement::LedgerChecked, ReadyEvidence::LedgerChecked)
        | (ReadinessRequirement::FreshMediaSessions, ReadyEvidence::FreshMediaSessions) => true,
        (ReadinessRequirement::DeviceVerified, ReadyEvidence::DeviceVerified { capture_epoch }) => {
            capture_epoch > last_capture_epoch.unwrap_or(0)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    #[derive(Clone, Debug)]
    struct FakeClock(Rc<Cell<u64>>);

    impl FakeClock {
        fn new() -> Self {
            Self(Rc::new(Cell::new(0)))
        }

        fn advance(&self, amount_ms: u64) {
            self.0.set(self.0.get().saturating_add(amount_ms));
        }
    }

    impl MonotonicClock for FakeClock {
        fn now_ms(&self) -> u64 {
            self.0.get()
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum Call {
        Spawn(WorkerId, BootId, u64),
        Shutdown(u64),
        Kill(u64),
    }

    #[derive(Debug, Default)]
    struct FakeDriver {
        calls: Vec<Call>,
        fail_next_spawn: bool,
        force_failures_remaining: usize,
    }

    impl ProcessDriver for FakeDriver {
        type Handle = u64;
        type Error = ();

        fn spawn(
            &mut self,
            worker: WorkerId,
            _role: WorkerRole,
            boot_id: BootId,
            generation: u64,
        ) -> Result<Self::Handle, Self::Error> {
            self.calls.push(Call::Spawn(worker, boot_id, generation));
            if self.fail_next_spawn {
                self.fail_next_spawn = false;
                Err(())
            } else {
                Ok(u64::from(worker.0) * 100 + generation)
            }
        }

        fn request_shutdown(&mut self, handle: Self::Handle) -> Result<(), Self::Error> {
            self.calls.push(Call::Shutdown(handle));
            Ok(())
        }

        fn force_terminate(&mut self, handle: Self::Handle) -> Result<(), Self::Error> {
            self.calls.push(Call::Kill(handle));
            if self.force_failures_remaining > 0 {
                self.force_failures_remaining -= 1;
                Err(())
            } else {
                Ok(())
            }
        }
    }

    const BOOT: BootId = BootId(42);
    const STALE_BOOT: BootId = BootId(41);
    const AUDIO: WorkerId = WorkerId(1);
    const MEDIA: WorkerId = WorkerId(2);

    fn policy() -> RestartPolicy {
        RestartPolicy {
            startup_timeout_ms: 100,
            heartbeat_timeout_ms: 30,
            shutdown_grace_ms: 50,
            restart_window_ms: 1_000,
            restart_base_delay_ms: 10,
            restart_max_delay_ms: 40,
            max_restart_attempts: 2,
            terminate_retry_base_delay_ms: 10,
            terminate_retry_max_delay_ms: 40,
            max_force_terminate_attempts: 2,
        }
    }

    fn specs() -> [WorkerSpec; 2] {
        [
            WorkerSpec {
                id: AUDIO,
                role: WorkerRole::AudioEngine,
                readiness: ReadinessRequirement::DeviceVerified,
            },
            WorkerSpec {
                id: MEDIA,
                role: WorkerRole::Media,
                readiness: ReadinessRequirement::FreshMediaSessions,
            },
        ]
    }

    fn supervisor() -> (FakeClock, Supervisor<FakeClock, FakeDriver>) {
        let clock = FakeClock::new();
        let supervisor = Supervisor::new(
            clock.clone(),
            FakeDriver::default(),
            BOOT,
            policy(),
            specs(),
        )
        .unwrap();
        (clock, supervisor)
    }

    fn kill_count(supervisor: &Supervisor<FakeClock, FakeDriver>, handle: u64) -> usize {
        supervisor
            .driver()
            .calls
            .iter()
            .filter(|call| **call == Call::Kill(handle))
            .count()
    }

    #[test]
    fn startup_requires_role_specific_readiness_evidence() {
        let (_clock, mut supervisor) = supervisor();
        supervisor.start();
        assert_eq!(supervisor.readiness(), NodeReadiness::WorkersStarting);
        assert_eq!(
            supervisor.worker_ready(AUDIO, BOOT, 1, ReadyEvidence::Basic),
            EventDisposition::EvidenceRejected
        );
        assert_eq!(
            supervisor.worker_ready(
                AUDIO,
                BOOT,
                1,
                ReadyEvidence::DeviceVerified { capture_epoch: 7 }
            ),
            EventDisposition::Accepted
        );
        assert_eq!(
            supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions),
            EventDisposition::Accepted
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::WorkersReady);
        assert_eq!(supervisor.snapshot(AUDIO).unwrap().capture_epoch, Some(7));
    }

    #[test]
    fn restart_advances_generation_and_fences_stale_events() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        assert_eq!(
            supervisor.worker_exited(MEDIA, BOOT, 1),
            EventDisposition::Accepted
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::Degraded);
        clock.advance(10);
        supervisor.tick();
        assert_eq!(supervisor.snapshot(MEDIA).unwrap().generation, Some(2));
        assert_eq!(
            supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions),
            EventDisposition::IgnoredStale
        );
        assert_eq!(
            supervisor.worker_ready(MEDIA, BOOT, 2, ReadyEvidence::FreshMediaSessions),
            EventDisposition::Accepted
        );
    }

    #[test]
    fn heartbeats_are_boot_generation_and_sequence_fenced() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions);

        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, STALE_BOOT, 1, 1),
            EventDisposition::IgnoredStale
        );
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 2, 1),
            EventDisposition::IgnoredStale
        );
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 1),
            EventDisposition::Accepted
        );
        clock.advance(10);
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 1),
            EventDisposition::IgnoredStale
        );
        clock.advance(20);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Restarting
        );
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().last_failure,
            Some(FailureReason::HeartbeatTimedOut)
        );
    }

    #[test]
    fn accepted_heartbeat_extends_the_bounded_health_deadline() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions);
        clock.advance(20);
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 1),
            EventDisposition::Accepted
        );
        clock.advance(29);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Healthy
        );
        clock.advance(1);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Restarting
        );
    }

    #[test]
    fn heartbeat_at_exact_deadline_is_rejected_and_times_out_worker() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions);
        clock.advance(30);
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 1),
            EventDisposition::DeadlineExpired
        );
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Restarting
        );
    }

    #[test]
    fn late_heartbeat_before_tick_cannot_revive_worker() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions);
        clock.advance(31);
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 1),
            EventDisposition::DeadlineExpired
        );
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().last_failure,
            Some(FailureReason::HeartbeatTimedOut)
        );
    }

    #[test]
    fn failed_heartbeat_timeout_kill_retains_the_live_generation() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: 1,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[1]]).unwrap();
        supervisor.start();
        supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions);
        clock.advance(30);
        supervisor.tick();
        let unresponsive = supervisor.snapshot(MEDIA).unwrap();
        assert_eq!(unresponsive.health, WorkerHealth::Unresponsive);
        assert_eq!(unresponsive.boot_id, BOOT);
        assert_eq!(unresponsive.generation, Some(1));
        assert_eq!(
            supervisor
                .driver()
                .calls
                .iter()
                .filter(|call| matches!(call, Call::Spawn(MEDIA, _, _)))
                .count(),
            1
        );
        assert_eq!(
            supervisor.worker_heartbeat(MEDIA, BOOT, 1, 2),
            EventDisposition::IgnoredStale
        );

        clock.advance(10);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Restarting
        );
    }

    #[test]
    fn cross_boot_readiness_and_exit_events_are_ignored() {
        let (_clock, mut supervisor) = supervisor();
        supervisor.start();
        assert_eq!(
            supervisor.worker_ready(MEDIA, STALE_BOOT, 1, ReadyEvidence::FreshMediaSessions),
            EventDisposition::IgnoredStale
        );
        assert_eq!(
            supervisor.worker_ready(MEDIA, BOOT, 1, ReadyEvidence::FreshMediaSessions),
            EventDisposition::Accepted
        );
        assert_eq!(
            supervisor.worker_exited(MEDIA, STALE_BOOT, 1),
            EventDisposition::IgnoredStale
        );
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Healthy
        );
        assert!(
            supervisor
                .driver()
                .calls
                .contains(&Call::Spawn(MEDIA, BOOT, 1))
        );
    }

    #[test]
    fn duplicate_exit_does_not_consume_restart_budget() {
        let (_clock, mut supervisor) = supervisor();
        supervisor.start();
        assert_eq!(
            supervisor.worker_exited(MEDIA, BOOT, 1),
            EventDisposition::Accepted
        );
        assert_eq!(
            supervisor.worker_exited(MEDIA, BOOT, 1),
            EventDisposition::IgnoredStale
        );
        let snapshot = supervisor.snapshot(MEDIA).unwrap();
        assert_eq!(snapshot.restart_attempts_in_window, 1);
        assert_eq!(snapshot.last_failure, Some(FailureReason::UnexpectedExit));
    }

    #[test]
    fn audio_restart_rejects_capture_epoch_replay_within_a_boot() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(
            AUDIO,
            BOOT,
            1,
            ReadyEvidence::DeviceVerified { capture_epoch: 7 },
        );
        supervisor.worker_exited(AUDIO, BOOT, 1);
        clock.advance(10);
        supervisor.tick();

        assert_eq!(
            supervisor.worker_ready(
                AUDIO,
                BOOT,
                2,
                ReadyEvidence::DeviceVerified { capture_epoch: 7 }
            ),
            EventDisposition::EvidenceRejected
        );
        assert_eq!(
            supervisor.worker_ready(
                AUDIO,
                BOOT,
                2,
                ReadyEvidence::DeviceVerified { capture_epoch: 8 }
            ),
            EventDisposition::Accepted
        );
        assert_eq!(supervisor.snapshot(AUDIO).unwrap().capture_epoch, Some(8));

        supervisor.worker_exited(AUDIO, BOOT, 2);
        clock.advance(20);
        supervisor.tick();
        assert_eq!(
            supervisor.worker_ready(
                AUDIO,
                BOOT,
                3,
                ReadyEvidence::DeviceVerified { capture_epoch: 7 }
            ),
            EventDisposition::EvidenceRejected
        );
        assert_eq!(
            supervisor.worker_ready(
                AUDIO,
                BOOT,
                3,
                ReadyEvidence::DeviceVerified { capture_epoch: 9 }
            ),
            EventDisposition::Accepted
        );
    }

    #[test]
    fn repeated_failure_quarantines_only_the_failed_worker() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_ready(
            AUDIO,
            BOOT,
            1,
            ReadyEvidence::DeviceVerified { capture_epoch: 1 },
        );
        supervisor.worker_exited(MEDIA, BOOT, 1);
        clock.advance(10);
        supervisor.tick();
        supervisor.worker_heartbeat(AUDIO, BOOT, 1, 1);
        supervisor.worker_exited(MEDIA, BOOT, 2);
        clock.advance(20);
        supervisor.tick();
        supervisor.worker_exited(MEDIA, BOOT, 3);

        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Quarantined
        );
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Healthy
        );
    }

    #[test]
    fn restart_budget_recovers_after_the_window() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.worker_exited(MEDIA, BOOT, 1);
        clock.advance(10);
        supervisor.tick();
        clock.advance(1_001);
        supervisor.worker_exited(MEDIA, BOOT, 2);
        assert_eq!(
            supervisor.snapshot(MEDIA).unwrap().health,
            WorkerHealth::Restarting
        );
        assert_eq!(
            supervisor
                .snapshot(MEDIA)
                .unwrap()
                .restart_attempts_in_window,
            1
        );
    }

    #[test]
    fn startup_timeout_kills_and_restarts_with_backoff() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        clock.advance(100);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Restarting
        );
        assert!(supervisor.driver().calls.contains(&Call::Kill(101)));
        clock.advance(10);
        supervisor.tick();
        assert_eq!(supervisor.snapshot(AUDIO).unwrap().generation, Some(2));
    }

    #[test]
    fn failed_startup_timeout_kill_retains_handle_until_death_is_confirmed() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: 1,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[0]]).unwrap();
        supervisor.start();
        clock.advance(100);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Unresponsive
        );
        assert_eq!(supervisor.snapshot(AUDIO).unwrap().generation, Some(1));
        assert_eq!(supervisor.readiness(), NodeReadiness::Degraded);
        assert_eq!(
            supervisor
                .driver()
                .calls
                .iter()
                .filter(|call| matches!(call, Call::Spawn(AUDIO, _, _)))
                .count(),
            1
        );

        clock.advance(10);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Restarting
        );
    }

    #[test]
    fn force_termination_retries_use_capped_exponential_delays() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: 3,
            ..FakeDriver::default()
        };
        let mut retry_policy = policy();
        retry_policy.max_force_terminate_attempts = 4;
        retry_policy.terminate_retry_max_delay_ms = 20;
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, retry_policy, [specs()[0]]).unwrap();
        supervisor.start();
        clock.advance(100);
        supervisor.tick();
        clock.advance(9);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 1);
        clock.advance(1);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 2);
        clock.advance(19);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 2);
        clock.advance(1);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 3);
        clock.advance(19);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 3);
        clock.advance(1);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 4);
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Restarting
        );
    }

    #[test]
    fn exhausted_termination_budget_retains_handle_and_circuit_breaks() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: usize::MAX,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[0]]).unwrap();
        supervisor.start();
        clock.advance(100);
        supervisor.tick();
        clock.advance(10);
        supervisor.tick();
        let stuck = supervisor.snapshot(AUDIO).unwrap();
        assert_eq!(stuck.health, WorkerHealth::TerminationStuck);
        assert_eq!(stuck.generation, Some(1));
        assert_eq!(
            stuck.last_failure,
            Some(FailureReason::ForceTerminationStuck)
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::Degraded);
        assert_eq!(kill_count(&supervisor, 101), 2);

        clock.advance(10_000);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 2);
        assert_eq!(
            supervisor
                .driver()
                .calls
                .iter()
                .filter(|call| matches!(call, Call::Spawn(AUDIO, _, _)))
                .count(),
            1
        );
    }

    #[test]
    fn spawn_failure_consumes_budget_and_retries_with_a_new_generation() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            fail_next_spawn: true,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[0]]).unwrap();
        supervisor.start();
        let failed = supervisor.snapshot(AUDIO).unwrap();
        assert_eq!(failed.health, WorkerHealth::Restarting);
        assert_eq!(failed.generation, Some(1));
        assert_eq!(failed.last_failure, Some(FailureReason::SpawnFailed));

        clock.advance(10);
        supervisor.tick();
        assert_eq!(supervisor.snapshot(AUDIO).unwrap().generation, Some(2));
        assert!(
            supervisor
                .driver()
                .calls
                .contains(&Call::Spawn(AUDIO, BOOT, 2))
        );
    }

    #[test]
    fn shutdown_is_reverse_order_and_forces_stragglers_after_deadline() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        supervisor.shutdown();
        assert_eq!(
            &supervisor.driver().calls[2..],
            &[Call::Shutdown(201), Call::Shutdown(101)]
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::ShuttingDown);

        assert_eq!(
            supervisor.worker_exited(MEDIA, BOOT, 1),
            EventDisposition::Accepted
        );
        clock.advance(50);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Stopped
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::Stopped);
        assert!(supervisor.driver().calls.contains(&Call::Kill(101)));
        assert!(!supervisor.driver().calls.contains(&Call::Kill(201)));
    }

    #[test]
    fn failed_shutdown_kill_never_reports_stopped_before_confirmed_death() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: 1,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[0]]).unwrap();
        supervisor.start();
        supervisor.shutdown();
        clock.advance(50);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Stopping
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::ShuttingDown);

        clock.advance(10);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::Stopped
        );
    }

    #[test]
    fn shutdown_stays_in_progress_after_termination_circuit_breaks() {
        let clock = FakeClock::new();
        let driver = FakeDriver {
            force_failures_remaining: usize::MAX,
            ..FakeDriver::default()
        };
        let mut supervisor =
            Supervisor::new(clock.clone(), driver, BOOT, policy(), [specs()[0]]).unwrap();
        supervisor.start();
        supervisor.shutdown();
        clock.advance(50);
        supervisor.tick();
        clock.advance(10);
        supervisor.tick();
        assert_eq!(
            supervisor.snapshot(AUDIO).unwrap().health,
            WorkerHealth::TerminationStuck
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::ShuttingDown);
        assert_eq!(kill_count(&supervisor, 101), 2);
        clock.advance(10_000);
        supervisor.tick();
        assert_eq!(kill_count(&supervisor, 101), 2);

        assert_eq!(
            supervisor.worker_exited(AUDIO, BOOT, 1),
            EventDisposition::Accepted
        );
        assert_eq!(supervisor.readiness(), NodeReadiness::Stopped);
    }

    #[test]
    fn quarantine_requires_explicit_release() {
        let (clock, mut supervisor) = supervisor();
        supervisor.start();
        for generation in 1..=3 {
            supervisor.worker_exited(MEDIA, BOOT, generation);
            if generation < 3 {
                clock.advance(10 * generation);
                supervisor.tick();
            }
        }
        assert_eq!(
            supervisor.release_quarantine(MEDIA, BOOT),
            EventDisposition::Accepted
        );
        assert_eq!(supervisor.snapshot(MEDIA).unwrap().generation, Some(4));
        assert_eq!(
            supervisor
                .snapshot(MEDIA)
                .unwrap()
                .restart_attempts_in_window,
            0
        );
    }

    #[test]
    fn rejects_invalid_topology_and_policy() {
        let clock = FakeClock::new();
        let duplicate = [specs()[0], specs()[0]];
        assert_eq!(
            Supervisor::new(
                clock.clone(),
                FakeDriver::default(),
                BOOT,
                policy(),
                duplicate
            )
            .unwrap_err(),
            ConfigError::DuplicateWorkerId(AUDIO)
        );
        let duplicate_audio = [
            specs()[0],
            WorkerSpec {
                id: WorkerId(9),
                ..specs()[0]
            },
        ];
        assert_eq!(
            Supervisor::new(
                clock.clone(),
                FakeDriver::default(),
                BOOT,
                policy(),
                duplicate_audio
            )
            .unwrap_err(),
            ConfigError::DuplicateSingletonRole(WorkerRole::AudioEngine)
        );
        for (role, readiness) in [
            (WorkerRole::Sequencer, ReadinessRequirement::LedgerChecked),
            (WorkerRole::ClientGateway, ReadinessRequirement::Basic),
            (WorkerRole::Replay, ReadinessRequirement::Basic),
        ] {
            let duplicate_role = [
                WorkerSpec {
                    id: WorkerId(20),
                    role,
                    readiness,
                },
                WorkerSpec {
                    id: WorkerId(21),
                    role,
                    readiness,
                },
            ];
            assert_eq!(
                Supervisor::new(
                    clock.clone(),
                    FakeDriver::default(),
                    BOOT,
                    policy(),
                    duplicate_role
                )
                .unwrap_err(),
                ConfigError::DuplicateSingletonRole(role)
            );
        }
        let media_shards = [
            specs()[1],
            WorkerSpec {
                id: WorkerId(9),
                ..specs()[1]
            },
        ];
        assert!(
            Supervisor::new(
                clock.clone(),
                FakeDriver::default(),
                BOOT,
                policy(),
                media_shards
            )
            .is_ok()
        );
        let receiver_shards = [
            WorkerSpec {
                id: WorkerId(30),
                role: WorkerRole::ReceiverAdapter,
                readiness: ReadinessRequirement::Basic,
            },
            WorkerSpec {
                id: WorkerId(31),
                role: WorkerRole::ReceiverAdapter,
                readiness: ReadinessRequirement::Basic,
            },
        ];
        assert!(
            Supervisor::new(
                clock.clone(),
                FakeDriver::default(),
                BOOT,
                policy(),
                receiver_shards
            )
            .is_ok()
        );
        assert_eq!(
            Supervisor::new(
                clock.clone(),
                FakeDriver::default(),
                BootId(0),
                policy(),
                specs()
            )
            .unwrap_err(),
            ConfigError::InvalidBootId
        );
        let mut invalid = policy();
        invalid.shutdown_grace_ms = 0;
        assert_eq!(
            Supervisor::new(clock, FakeDriver::default(), BOOT, invalid, specs()).unwrap_err(),
            ConfigError::InvalidPolicy
        );
        let mut invalid_termination_budget = policy();
        invalid_termination_budget.max_force_terminate_attempts = 0;
        assert_eq!(
            Supervisor::new(
                FakeClock::new(),
                FakeDriver::default(),
                BOOT,
                invalid_termination_budget,
                specs()
            )
            .unwrap_err(),
            ConfigError::InvalidPolicy
        );
    }

    #[test]
    fn generation_exhaustion_quarantines_without_spawning() {
        let (_clock, mut supervisor) = supervisor();
        supervisor.workers[0].next_generation = u64::MAX;
        supervisor.start();
        let snapshot = supervisor.snapshot(AUDIO).unwrap();
        assert_eq!(snapshot.health, WorkerHealth::Quarantined);
        assert_eq!(
            snapshot.last_failure,
            Some(FailureReason::GenerationExhausted)
        );
        assert!(
            supervisor
                .driver()
                .calls
                .iter()
                .all(|call| { !matches!(call, Call::Spawn(worker, _, _) if *worker == AUDIO) })
        );
    }
}
