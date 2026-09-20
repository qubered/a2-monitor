//! Bounded decoded worker-control dispatch into the lifecycle supervisor.
//!
//! This is an in-process composition boundary. It deliberately does not own a
//! socket, authenticate a peer, or select the eventual production codec.

use a2_ipc::{
    CONTROL_PROTOCOL_VERSION, CanonicalJsonCodec, CodecError, ControlBody, ControlCodec,
    ControlMessage, ProtobufCodec, ReadinessEvidence as IpcEvidence, WorkerRole as IpcRole,
};
use a2_supervisor::{
    BootId, EventDisposition, MonotonicClock, ProcessDriver, ReadyEvidence, Supervisor, WorkerId,
    WorkerRole,
};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CandidateCodec {
    CanonicalJson,
    Protobuf,
}

/// Identity assigned to one already-established worker connection.
///
/// The caller obtains this tuple from its trusted spawn/connection registry;
/// constructing it from the decoded message would defeat the peer fence. This
/// comparison is not peer authentication.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundWorkerIdentity {
    pub boot_id: BootId,
    pub worker_id: WorkerId,
    pub role: WorkerRole,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DispatchError {
    Codec(CodecError),
    UnsupportedProtocol(u32),
    NotWorkerControl,
    PeerIdentityMismatch {
        expected: BoundWorkerIdentity,
        claimed: BoundWorkerIdentity,
    },
    UnknownWorker(WorkerId),
    RoleMismatch {
        worker: WorkerId,
        configured: WorkerRole,
        claimed: WorkerRole,
    },
}

impl Display for DispatchError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Codec(error) => write!(formatter, "worker control decode failed: {error}"),
            Self::UnsupportedProtocol(version) => {
                write!(
                    formatter,
                    "worker control protocol version {version} is unsupported"
                )
            }
            Self::NotWorkerControl => write!(formatter, "message is not worker control"),
            Self::PeerIdentityMismatch { expected, claimed } => write!(
                formatter,
                "worker-control peer identity mismatch (expected worker {} generation {}, claimed worker {} generation {})",
                expected.worker_id.0, expected.generation, claimed.worker_id.0, claimed.generation
            ),
            Self::UnknownWorker(worker) => {
                write!(formatter, "worker {} is not configured", worker.0)
            }
            Self::RoleMismatch {
                worker,
                configured,
                claimed,
            } => write!(
                formatter,
                "worker {} claimed role {} but is configured as {}",
                worker.0,
                claimed.contract_id(),
                configured.contract_id()
            ),
        }
    }
}

impl Error for DispatchError {}

impl From<CodecError> for DispatchError {
    fn from(error: CodecError) -> Self {
        Self::Codec(error)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkerControlAdapter {
    json: CanonicalJsonCodec,
    protobuf: ProtobufCodec,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DispatchOutcome {
    pub request_id: u64,
    pub disposition: EventDisposition,
}

impl WorkerControlAdapter {
    pub fn new(maximum_payload_bytes: usize) -> Result<Self, CodecError> {
        Ok(Self {
            json: CanonicalJsonCodec::new(maximum_payload_bytes)?,
            protobuf: ProtobufCodec::new(maximum_payload_bytes)?,
        })
    }

    pub fn decode_and_dispatch<C, D>(
        &self,
        codec: CandidateCodec,
        payload: &[u8],
        expected_peer: BoundWorkerIdentity,
        supervisor: &mut Supervisor<C, D>,
    ) -> Result<EventDisposition, DispatchError>
    where
        C: MonotonicClock,
        D: ProcessDriver,
    {
        self.decode_and_dispatch_outcome(codec, payload, expected_peer, supervisor)
            .map(|outcome| outcome.disposition)
    }

    pub fn decode_and_dispatch_outcome<C, D>(
        &self,
        codec: CandidateCodec,
        payload: &[u8],
        expected_peer: BoundWorkerIdentity,
        supervisor: &mut Supervisor<C, D>,
    ) -> Result<DispatchOutcome, DispatchError>
    where
        C: MonotonicClock,
        D: ProcessDriver,
    {
        let message = match codec {
            CandidateCodec::CanonicalJson => self.json.decode(payload)?,
            CandidateCodec::Protobuf => self.protobuf.decode(payload)?,
        };
        let request_id = message.request_id;
        dispatch_decoded(message, expected_peer, supervisor).map(|disposition| DispatchOutcome {
            request_id,
            disposition,
        })
    }
}

fn dispatch_decoded<C, D>(
    message: ControlMessage,
    expected_peer: BoundWorkerIdentity,
    supervisor: &mut Supervisor<C, D>,
) -> Result<EventDisposition, DispatchError>
where
    C: MonotonicClock,
    D: ProcessDriver,
{
    if message.protocol_version != CONTROL_PROTOCOL_VERSION {
        return Err(DispatchError::UnsupportedProtocol(message.protocol_version));
    }

    let (identity, event) = match message.body {
        ControlBody::WorkerReady { worker, evidence } => {
            let evidence = map_evidence(evidence);
            (worker, WorkerEvent::Ready(evidence))
        }
        ControlBody::WorkerHeartbeat { worker, sequence } => {
            (worker, WorkerEvent::Heartbeat(sequence))
        }
        ControlBody::HealthProbe { .. } => return Err(DispatchError::NotWorkerControl),
    };

    let claimed_peer = BoundWorkerIdentity {
        boot_id: BootId(identity.boot_id),
        worker_id: WorkerId(identity.worker_id),
        role: map_role(identity.role),
        generation: identity.generation,
    };
    if claimed_peer != expected_peer {
        return Err(DispatchError::PeerIdentityMismatch {
            expected: expected_peer,
            claimed: claimed_peer,
        });
    }

    let worker_id = claimed_peer.worker_id;
    let claimed_role = claimed_peer.role;
    let Some(snapshot) = supervisor.snapshot(worker_id) else {
        return Err(DispatchError::UnknownWorker(worker_id));
    };
    if snapshot.role != claimed_role {
        return Err(DispatchError::RoleMismatch {
            worker: worker_id,
            configured: snapshot.role,
            claimed: claimed_role,
        });
    }

    Ok(match event {
        WorkerEvent::Ready(evidence) => supervisor.worker_ready(
            worker_id,
            claimed_peer.boot_id,
            claimed_peer.generation,
            evidence,
        ),
        WorkerEvent::Heartbeat(sequence) => supervisor.worker_heartbeat(
            worker_id,
            claimed_peer.boot_id,
            claimed_peer.generation,
            sequence,
        ),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkerEvent {
    Ready(ReadyEvidence),
    Heartbeat(u64),
}

const fn map_role(role: IpcRole) -> WorkerRole {
    match role {
        IpcRole::AudioEngine => WorkerRole::AudioEngine,
        IpcRole::Sequencer => WorkerRole::Sequencer,
        IpcRole::Media => WorkerRole::Media,
        IpcRole::ClientGateway => WorkerRole::ClientGateway,
        IpcRole::Replay => WorkerRole::Replay,
        IpcRole::ReceiverAdapter => WorkerRole::ReceiverAdapter,
    }
}

const fn map_evidence(evidence: IpcEvidence) -> ReadyEvidence {
    match evidence {
        IpcEvidence::Basic => ReadyEvidence::Basic,
        IpcEvidence::DeviceVerified { capture_epoch } => {
            ReadyEvidence::DeviceVerified { capture_epoch }
        }
        IpcEvidence::LedgerChecked => ReadyEvidence::LedgerChecked,
        IpcEvidence::FreshMediaSessions => ReadyEvidence::FreshMediaSessions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use a2_ipc::{MessageKind, WorkerIdentity};
    use a2_supervisor::{ProcessDriver, RestartPolicy, WorkerHealth, WorkerSpec};
    use std::cell::Cell;
    use std::rc::Rc;

    const BOOT: u128 = 0x0102_0304_0506_0708_1112_1314_1516_1718;
    const WORKER: WorkerId = WorkerId(7);

    #[derive(Clone, Debug)]
    struct Clock(Rc<Cell<u64>>);

    impl MonotonicClock for Clock {
        fn now_ms(&self) -> u64 {
            self.0.get()
        }
    }

    #[derive(Debug, Default)]
    struct Driver {
        force_terminations: usize,
    }

    impl ProcessDriver for Driver {
        type Handle = u64;
        type Error = ();

        fn spawn(
            &mut self,
            worker: WorkerId,
            _role: WorkerRole,
            _boot_id: BootId,
            generation: u64,
        ) -> Result<Self::Handle, Self::Error> {
            Ok((u64::from(worker.0) << 32) | generation)
        }

        fn request_shutdown(&mut self, _handle: Self::Handle) -> Result<(), Self::Error> {
            Ok(())
        }

        fn force_terminate(&mut self, _handle: Self::Handle) -> Result<(), Self::Error> {
            self.force_terminations += 1;
            Ok(())
        }
    }

    fn policy() -> RestartPolicy {
        RestartPolicy {
            startup_timeout_ms: 20,
            heartbeat_timeout_ms: 30,
            shutdown_grace_ms: 10,
            restart_window_ms: 1_000,
            restart_base_delay_ms: 5,
            restart_max_delay_ms: 20,
            max_restart_attempts: 3,
            terminate_retry_base_delay_ms: 2,
            terminate_retry_max_delay_ms: 8,
            max_force_terminate_attempts: 3,
        }
    }

    fn configured_supervisor(role: WorkerRole) -> (Clock, Supervisor<Clock, Driver>) {
        let clock = Clock(Rc::new(Cell::new(0)));
        let mut supervisor = Supervisor::new(
            clock.clone(),
            Driver::default(),
            BootId(BOOT),
            policy(),
            [WorkerSpec {
                id: WORKER,
                role,
                readiness: role.readiness_requirement(),
            }],
        )
        .unwrap();
        supervisor.start();
        (clock, supervisor)
    }

    fn ready(role: IpcRole, boot_id: u128, generation: u64) -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerReady,
            request_id: 1,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerReady {
                worker: WorkerIdentity {
                    boot_id,
                    worker_id: WORKER.0,
                    role,
                    generation,
                },
                evidence: match role {
                    IpcRole::AudioEngine => IpcEvidence::DeviceVerified { capture_epoch: 9 },
                    IpcRole::Sequencer => IpcEvidence::LedgerChecked,
                    IpcRole::Media => IpcEvidence::FreshMediaSessions,
                    IpcRole::ClientGateway | IpcRole::Replay | IpcRole::ReceiverAdapter => {
                        IpcEvidence::Basic
                    }
                },
            },
        }
    }

    fn heartbeat(role: IpcRole, boot_id: u128, generation: u64, sequence: u64) -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerHeartbeat,
            request_id: 2,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerHeartbeat {
                worker: WorkerIdentity {
                    boot_id,
                    worker_id: WORKER.0,
                    role,
                    generation,
                },
                sequence,
            },
        }
    }

    fn encode(codec: CandidateCodec, message: &ControlMessage) -> Vec<u8> {
        match codec {
            CandidateCodec::CanonicalJson => CanonicalJsonCodec::new(512).unwrap().encode(message),
            CandidateCodec::Protobuf => ProtobufCodec::new(512).unwrap().encode(message),
        }
        .unwrap()
    }

    fn bound(role: WorkerRole, boot_id: u128, generation: u64) -> BoundWorkerIdentity {
        BoundWorkerIdentity {
            boot_id: BootId(boot_id),
            worker_id: WORKER,
            role,
            generation,
        }
    }

    #[test]
    fn both_candidate_bytes_dispatch_ready_and_heartbeat() {
        for codec in [CandidateCodec::CanonicalJson, CandidateCodec::Protobuf] {
            let (_clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
            let adapter = WorkerControlAdapter::new(512).unwrap();
            assert_eq!(
                adapter.decode_and_dispatch(
                    codec,
                    &encode(codec, &ready(IpcRole::Media, BOOT, 1)),
                    bound(WorkerRole::Media, BOOT, 1),
                    &mut supervisor,
                ),
                Ok(EventDisposition::Accepted)
            );
            assert_eq!(
                adapter.decode_and_dispatch(
                    codec,
                    &encode(codec, &heartbeat(IpcRole::Media, BOOT, 1, 17)),
                    bound(WorkerRole::Media, BOOT, 1),
                    &mut supervisor,
                ),
                Ok(EventDisposition::Accepted)
            );
            assert_eq!(
                supervisor.snapshot(WORKER).unwrap().health,
                WorkerHealth::Healthy
            );
        }
    }

    #[test]
    fn stale_boot_and_generation_are_fenced_after_decode() {
        let (_clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
        let adapter = WorkerControlAdapter::new(512).unwrap();
        for (message, expected_peer) in [
            (
                ready(IpcRole::Media, BOOT + 1, 1),
                bound(WorkerRole::Media, BOOT + 1, 1),
            ),
            (
                ready(IpcRole::Media, BOOT, 2),
                bound(WorkerRole::Media, BOOT, 2),
            ),
        ] {
            assert_eq!(
                adapter.decode_and_dispatch(
                    CandidateCodec::Protobuf,
                    &encode(CandidateCodec::Protobuf, &message),
                    expected_peer,
                    &mut supervisor,
                ),
                Ok(EventDisposition::IgnoredStale)
            );
        }
        assert_eq!(
            supervisor.snapshot(WORKER).unwrap().health,
            WorkerHealth::Starting
        );
    }

    #[test]
    fn role_mismatch_and_health_probe_do_not_mutate_worker() {
        let (_clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
        let adapter = WorkerControlAdapter::new(512).unwrap();
        let before = supervisor.snapshot(WORKER).unwrap();
        let mismatched = ready(IpcRole::Replay, BOOT, 1);
        assert_eq!(
            adapter.decode_and_dispatch(
                CandidateCodec::CanonicalJson,
                &encode(CandidateCodec::CanonicalJson, &mismatched),
                bound(WorkerRole::Replay, BOOT, 1),
                &mut supervisor,
            ),
            Err(DispatchError::RoleMismatch {
                worker: WORKER,
                configured: WorkerRole::Media,
                claimed: WorkerRole::Replay,
            })
        );

        let probe = ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::HealthProbe,
            request_id: 3,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::HealthProbe { deadline_ms: 10 },
        };
        assert_eq!(
            adapter.decode_and_dispatch(
                CandidateCodec::CanonicalJson,
                &encode(CandidateCodec::CanonicalJson, &probe),
                bound(WorkerRole::Media, BOOT, 1),
                &mut supervisor,
            ),
            Err(DispatchError::NotWorkerControl)
        );
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);
    }

    #[test]
    fn connection_bound_identity_mismatch_does_not_mutate_worker() {
        let (_clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
        let adapter = WorkerControlAdapter::new(512).unwrap();
        let before = supervisor.snapshot(WORKER).unwrap();
        let payload = encode(CandidateCodec::Protobuf, &ready(IpcRole::Media, BOOT, 1));

        for expected_peer in [
            bound(WorkerRole::Media, BOOT + 1, 1),
            BoundWorkerIdentity {
                worker_id: WorkerId(WORKER.0 + 1),
                ..bound(WorkerRole::Media, BOOT, 1)
            },
            bound(WorkerRole::Replay, BOOT, 1),
            bound(WorkerRole::Media, BOOT, 2),
        ] {
            assert!(matches!(
                adapter.decode_and_dispatch(
                    CandidateCodec::Protobuf,
                    &payload,
                    expected_peer,
                    &mut supervisor,
                ),
                Err(DispatchError::PeerIdentityMismatch { .. })
            ));
            assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);
        }
    }

    #[test]
    fn exact_startup_and_heartbeat_deadlines_are_dispatched() {
        let (clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
        let adapter = WorkerControlAdapter::new(512).unwrap();
        clock.0.set(20);
        assert_eq!(
            adapter.decode_and_dispatch(
                CandidateCodec::Protobuf,
                &encode(CandidateCodec::Protobuf, &ready(IpcRole::Media, BOOT, 1),),
                bound(WorkerRole::Media, BOOT, 1),
                &mut supervisor,
            ),
            Ok(EventDisposition::DeadlineExpired)
        );
        assert_eq!(supervisor.driver().force_terminations, 1);

        let (clock, mut supervisor) = configured_supervisor(WorkerRole::Media);
        assert_eq!(
            adapter.decode_and_dispatch(
                CandidateCodec::CanonicalJson,
                &encode(
                    CandidateCodec::CanonicalJson,
                    &ready(IpcRole::Media, BOOT, 1),
                ),
                bound(WorkerRole::Media, BOOT, 1),
                &mut supervisor,
            ),
            Ok(EventDisposition::Accepted)
        );
        clock.0.set(30);
        assert_eq!(
            adapter.decode_and_dispatch(
                CandidateCodec::CanonicalJson,
                &encode(
                    CandidateCodec::CanonicalJson,
                    &heartbeat(IpcRole::Media, BOOT, 1, 1),
                ),
                bound(WorkerRole::Media, BOOT, 1),
                &mut supervisor,
            ),
            Ok(EventDisposition::DeadlineExpired)
        );
        assert_eq!(supervisor.driver().force_terminations, 1);
    }
}
