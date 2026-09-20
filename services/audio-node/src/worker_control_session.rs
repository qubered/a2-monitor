//! Bounded framed composition for one worker-control connection.
//!
//! The transport owner supplies the codec and peer identity from a trusted
//! spawn/connection registry. This module reconstructs frames and dispatches
//! them; it does not open a transport, authenticate a peer, or confirm process
//! death when a stream closes.

use crate::worker_control::{
    BoundWorkerIdentity, CandidateCodec, DispatchError, WorkerControlAdapter,
};
use a2_ipc::{CodecError, FrameDecoder, FrameError};
use a2_supervisor::{EventDisposition, MonotonicClock, ProcessDriver, Supervisor};

pub const WORKER_CONTROL_MAX_PAYLOAD_BYTES: u32 = 512;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionCloseReason {
    Framing(FrameError),
    Dispatch(DispatchError),
    SupervisorRejected {
        request_id: u64,
        disposition: EventDisposition,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionStep {
    NeedMore {
        consumed: usize,
    },
    Dispatched {
        consumed: usize,
        request_id: u64,
        disposition: EventDisposition,
    },
    CloseRequired {
        reason: SessionCloseReason,
    },
    AlreadyClosed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionEnd {
    CleanEof,
    CloseRequired(SessionCloseReason),
}

/// One fixed-codec, fixed-identity, one-frame-per-call worker-control session.
///
/// Any framing, semantic, identity, routing, or supervisor-policy rejection is
/// terminal. After `CloseRequired`, the transport owner must discard all
/// buffered bytes and close the connection rather than attempting to
/// resynchronize. EOF is not evidence that the worker process exited.
#[derive(Debug)]
pub struct FramedWorkerControlSession {
    decoder: FrameDecoder,
    adapter: WorkerControlAdapter,
    codec: CandidateCodec,
    peer: BoundWorkerIdentity,
    close_reason: Option<SessionCloseReason>,
}

impl FramedWorkerControlSession {
    pub fn new(codec: CandidateCodec, peer: BoundWorkerIdentity) -> Result<Self, CodecError> {
        let decoder = FrameDecoder::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES)
            .expect("the fixed worker-control frame maximum is nonzero");
        Ok(Self {
            decoder,
            adapter: WorkerControlAdapter::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES as usize)?,
            codec,
            peer,
            close_reason: None,
        })
    }

    /// Processes at most one frame and never retains a queue of outcomes.
    pub fn receive<C, D>(&mut self, bytes: &[u8], supervisor: &mut Supervisor<C, D>) -> SessionStep
    where
        C: MonotonicClock,
        D: ProcessDriver,
    {
        if self.close_reason.is_some() {
            return SessionStep::AlreadyClosed;
        }

        let pushed = match self.decoder.push(bytes) {
            Ok(pushed) => pushed,
            Err(error) => return self.close(SessionCloseReason::Framing(error)),
        };
        let Some(payload) = pushed.frame else {
            return SessionStep::NeedMore {
                consumed: pushed.consumed,
            };
        };

        match self
            .adapter
            .decode_and_dispatch_outcome(self.codec, &payload, self.peer, supervisor)
        {
            Ok(outcome) if outcome.disposition == EventDisposition::Accepted => {
                SessionStep::Dispatched {
                    consumed: pushed.consumed,
                    request_id: outcome.request_id,
                    disposition: EventDisposition::Accepted,
                }
            }
            Ok(outcome) => self.close(SessionCloseReason::SupervisorRejected {
                request_id: outcome.request_id,
                disposition: outcome.disposition,
            }),
            Err(error) => self.close(SessionCloseReason::Dispatch(error)),
        }
    }

    /// Ends a session, accepting EOF only at a complete frame boundary.
    pub fn finish(self) -> SessionEnd {
        if let Some(reason) = self.close_reason {
            return SessionEnd::CloseRequired(reason);
        }
        match self.decoder.finish_stream() {
            Ok(()) => SessionEnd::CleanEof,
            Err(error) => SessionEnd::CloseRequired(SessionCloseReason::Framing(error)),
        }
    }

    fn close(&mut self, reason: SessionCloseReason) -> SessionStep {
        self.close_reason = Some(reason.clone());
        SessionStep::CloseRequired { reason }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker_control::BoundWorkerIdentity;
    use a2_ipc::{
        CONTROL_PROTOCOL_VERSION, CanonicalJsonCodec, ControlBody, ControlCodec, ControlMessage,
        FrameEncoder, MessageKind, ProtobufCodec, ReadinessEvidence, WorkerIdentity,
        WorkerRole as IpcRole,
    };
    use a2_supervisor::{
        BootId, ProcessDriver, RestartPolicy, WorkerHealth, WorkerId, WorkerRole, WorkerSpec,
    };
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

    fn configured_supervisor() -> (Clock, Supervisor<Clock, Driver>) {
        let clock = Clock(Rc::new(Cell::new(0)));
        let mut supervisor = Supervisor::new(
            clock.clone(),
            Driver::default(),
            BootId(BOOT),
            policy(),
            [WorkerSpec {
                id: WORKER,
                role: WorkerRole::Media,
                readiness: WorkerRole::Media.readiness_requirement(),
            }],
        )
        .unwrap();
        supervisor.start();
        (clock, supervisor)
    }

    fn bound() -> BoundWorkerIdentity {
        BoundWorkerIdentity {
            boot_id: BootId(BOOT),
            worker_id: WORKER,
            role: WorkerRole::Media,
            generation: 1,
        }
    }

    fn ready(request_id: u64) -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerReady,
            request_id,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerReady {
                worker: WorkerIdentity {
                    boot_id: BOOT,
                    worker_id: WORKER.0,
                    role: IpcRole::Media,
                    generation: 1,
                },
                evidence: ReadinessEvidence::FreshMediaSessions,
            },
        }
    }

    fn heartbeat(request_id: u64, sequence: u64) -> ControlMessage {
        ControlMessage {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            message_kind: MessageKind::WorkerHeartbeat,
            request_id,
            authority_epoch: None,
            capture_epoch: None,
            body: ControlBody::WorkerHeartbeat {
                worker: WorkerIdentity {
                    boot_id: BOOT,
                    worker_id: WORKER.0,
                    role: IpcRole::Media,
                    generation: 1,
                },
                sequence,
            },
        }
    }

    fn payload(codec: CandidateCodec, message: &ControlMessage) -> Vec<u8> {
        match codec {
            CandidateCodec::CanonicalJson => {
                CanonicalJsonCodec::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES as usize)
                    .unwrap()
                    .encode(message)
            }
            CandidateCodec::Protobuf => {
                ProtobufCodec::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES as usize)
                    .unwrap()
                    .encode(message)
            }
        }
        .unwrap()
    }

    fn frame(codec: CandidateCodec, message: &ControlMessage) -> Vec<u8> {
        FrameEncoder::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES)
            .unwrap()
            .encode(&payload(codec, message))
            .unwrap()
    }

    #[test]
    fn both_pinned_codecs_reconstruct_fragmented_ready_and_coalesced_heartbeat() {
        for codec in [CandidateCodec::CanonicalJson, CandidateCodec::Protobuf] {
            let (_clock, mut supervisor) = configured_supervisor();
            let mut session = FramedWorkerControlSession::new(codec, bound()).unwrap();
            let ready_frame = frame(codec, &ready(0));

            for (index, byte) in ready_frame.iter().enumerate() {
                let step = session.receive(std::slice::from_ref(byte), &mut supervisor);
                if index + 1 == ready_frame.len() {
                    assert_eq!(
                        step,
                        SessionStep::Dispatched {
                            consumed: 1,
                            request_id: 0,
                            disposition: EventDisposition::Accepted,
                        }
                    );
                } else {
                    assert_eq!(step, SessionStep::NeedMore { consumed: 1 });
                }
            }

            let heartbeat_frame = frame(codec, &heartbeat(0, 1));
            let mut coalesced = heartbeat_frame.clone();
            coalesced.extend(frame(codec, &heartbeat(u64::MAX, 2)));
            assert_eq!(
                session.receive(&coalesced, &mut supervisor),
                SessionStep::Dispatched {
                    consumed: heartbeat_frame.len(),
                    request_id: 0,
                    disposition: EventDisposition::Accepted,
                }
            );
            assert_eq!(
                session.receive(&coalesced[heartbeat_frame.len()..], &mut supervisor),
                SessionStep::Dispatched {
                    consumed: coalesced.len() - heartbeat_frame.len(),
                    request_id: u64::MAX,
                    disposition: EventDisposition::Accepted,
                }
            );
            assert_eq!(
                supervisor.snapshot(WORKER).unwrap().health,
                WorkerHealth::Healthy
            );
            assert_eq!(session.finish(), SessionEnd::CleanEof);
        }
    }

    #[test]
    fn oversize_header_is_terminal_and_never_resynchronizes() {
        let (_clock, mut supervisor) = configured_supervisor();
        let before = supervisor.snapshot(WORKER).unwrap();
        let mut session =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        let mut hostile = (WORKER_CONTROL_MAX_PAYLOAD_BYTES + 1)
            .to_be_bytes()
            .to_vec();
        hostile.extend(frame(CandidateCodec::Protobuf, &ready(1)));

        assert_eq!(
            session.receive(&hostile, &mut supervisor),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::Framing(FrameError::PayloadTooLarge {
                    declared: u64::from(WORKER_CONTROL_MAX_PAYLOAD_BYTES + 1),
                    maximum: WORKER_CONTROL_MAX_PAYLOAD_BYTES,
                }),
            }
        );
        assert_eq!(
            session.receive(&hostile[4..], &mut supervisor),
            SessionStep::AlreadyClosed
        );
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);
    }

    #[test]
    fn malformed_frame_with_valid_suffix_is_terminal() {
        let (_clock, mut supervisor) = configured_supervisor();
        let before = supervisor.snapshot(WORKER).unwrap();
        let mut session =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        let malformed = FrameEncoder::new(WORKER_CONTROL_MAX_PAYLOAD_BYTES)
            .unwrap()
            .encode(&[])
            .unwrap();
        let mut bytes = malformed.clone();
        bytes.extend(frame(CandidateCodec::Protobuf, &ready(1)));

        assert!(matches!(
            session.receive(&bytes, &mut supervisor),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::Dispatch(DispatchError::Codec(_))
            }
        ));
        assert_eq!(
            session.receive(&bytes[malformed.len()..], &mut supervisor),
            SessionStep::AlreadyClosed
        );
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);
    }

    #[test]
    fn codec_and_identity_errors_are_terminal_without_mutation() {
        let (_clock, mut supervisor) = configured_supervisor();
        let before = supervisor.snapshot(WORKER).unwrap();
        let mut wrong_codec =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert!(matches!(
            wrong_codec.receive(
                &frame(CandidateCodec::CanonicalJson, &ready(1)),
                &mut supervisor,
            ),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::Dispatch(DispatchError::Codec(_))
            }
        ));
        assert_eq!(
            wrong_codec.receive(&frame(CandidateCodec::Protobuf, &ready(2)), &mut supervisor,),
            SessionStep::AlreadyClosed
        );
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);

        let mut wrong_peer = FramedWorkerControlSession::new(
            CandidateCodec::Protobuf,
            BoundWorkerIdentity {
                generation: 2,
                ..bound()
            },
        )
        .unwrap();
        assert!(matches!(
            wrong_peer.receive(&frame(CandidateCodec::Protobuf, &ready(2)), &mut supervisor,),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::Dispatch(DispatchError::PeerIdentityMismatch { .. })
            }
        ));
        assert_eq!(
            wrong_peer.receive(&frame(CandidateCodec::Protobuf, &ready(3)), &mut supervisor,),
            SessionStep::AlreadyClosed
        );
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before);
    }

    #[test]
    fn stale_heartbeat_disposition_is_correlated_and_terminal() {
        let (_clock, mut supervisor) = configured_supervisor();
        let mut session =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert!(matches!(
            session.receive(&frame(CandidateCodec::Protobuf, &ready(1)), &mut supervisor,),
            SessionStep::Dispatched { .. }
        ));
        assert!(matches!(
            session.receive(
                &frame(CandidateCodec::Protobuf, &heartbeat(2, 1)),
                &mut supervisor,
            ),
            SessionStep::Dispatched { .. }
        ));
        assert_eq!(
            session.receive(
                &frame(CandidateCodec::Protobuf, &heartbeat(3, 1)),
                &mut supervisor,
            ),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::SupervisorRejected {
                    request_id: 3,
                    disposition: EventDisposition::IgnoredStale,
                },
            }
        );
    }

    #[test]
    fn policy_rejection_is_preserved_and_closes_the_session() {
        let (clock, mut supervisor) = configured_supervisor();
        let mut session =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        clock.0.set(20);
        assert_eq!(
            session.receive(&frame(CandidateCodec::Protobuf, &ready(1)), &mut supervisor,),
            SessionStep::CloseRequired {
                reason: SessionCloseReason::SupervisorRejected {
                    request_id: 1,
                    disposition: EventDisposition::DeadlineExpired,
                },
            }
        );
        assert_eq!(supervisor.driver().force_terminations, 1);
        assert_eq!(
            session.receive(
                &frame(CandidateCodec::Protobuf, &heartbeat(2, 1)),
                &mut supervisor,
            ),
            SessionStep::AlreadyClosed
        );
    }

    #[test]
    fn eof_distinguishes_complete_header_payload_and_prior_failure() {
        let (_clock, mut supervisor) = configured_supervisor();
        let mut clean = FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert_eq!(
            clean.receive(&frame(CandidateCodec::Protobuf, &ready(1)), &mut supervisor,),
            SessionStep::Dispatched {
                consumed: frame(CandidateCodec::Protobuf, &ready(1)).len(),
                request_id: 1,
                disposition: EventDisposition::Accepted,
            }
        );
        let before_eof = supervisor.snapshot(WORKER).unwrap();
        assert_eq!(supervisor.driver().force_terminations, 0);
        assert_eq!(clean.finish(), SessionEnd::CleanEof);
        assert_eq!(supervisor.snapshot(WORKER).unwrap(), before_eof);
        assert_eq!(supervisor.driver().force_terminations, 0);

        let (_clock, mut supervisor) = configured_supervisor();
        let mut header =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert_eq!(
            header.receive(&[0, 0], &mut supervisor),
            SessionStep::NeedMore { consumed: 2 }
        );
        assert_eq!(
            header.finish(),
            SessionEnd::CloseRequired(SessionCloseReason::Framing(FrameError::TruncatedFrame))
        );

        let mut payload =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert_eq!(
            payload.receive(&[0, 0, 0, 2, 1], &mut supervisor),
            SessionStep::NeedMore { consumed: 5 }
        );
        assert_eq!(
            payload.finish(),
            SessionEnd::CloseRequired(SessionCloseReason::Framing(FrameError::TruncatedFrame))
        );

        let mut failed =
            FramedWorkerControlSession::new(CandidateCodec::Protobuf, bound()).unwrap();
        assert!(matches!(
            failed.receive(&[0, 0, 0, 0], &mut supervisor),
            SessionStep::CloseRequired { .. }
        ));
        assert!(matches!(
            failed.finish(),
            SessionEnd::CloseRequired(SessionCloseReason::Dispatch(_))
        ));
    }

    #[test]
    fn every_current_worker_message_fits_the_fixed_class_limit() {
        let roles = [
            (
                IpcRole::AudioEngine,
                ReadinessEvidence::DeviceVerified {
                    capture_epoch: u64::MAX,
                },
            ),
            (IpcRole::Sequencer, ReadinessEvidence::LedgerChecked),
            (IpcRole::Media, ReadinessEvidence::FreshMediaSessions),
            (IpcRole::ClientGateway, ReadinessEvidence::Basic),
            (IpcRole::Replay, ReadinessEvidence::Basic),
            (IpcRole::ReceiverAdapter, ReadinessEvidence::Basic),
        ];
        for codec in [CandidateCodec::CanonicalJson, CandidateCodec::Protobuf] {
            for (role, evidence) in roles {
                let message = ControlMessage {
                    protocol_version: CONTROL_PROTOCOL_VERSION,
                    message_kind: MessageKind::WorkerReady,
                    request_id: u64::MAX,
                    authority_epoch: None,
                    capture_epoch: None,
                    body: ControlBody::WorkerReady {
                        worker: WorkerIdentity {
                            boot_id: u128::MAX,
                            worker_id: u16::MAX,
                            role,
                            generation: u64::MAX,
                        },
                        evidence,
                    },
                };
                assert!(
                    payload(codec, &message).len() <= WORKER_CONTROL_MAX_PAYLOAD_BYTES as usize
                );
            }
            let message = ControlMessage {
                protocol_version: CONTROL_PROTOCOL_VERSION,
                message_kind: MessageKind::WorkerHeartbeat,
                request_id: u64::MAX,
                authority_epoch: None,
                capture_epoch: None,
                body: ControlBody::WorkerHeartbeat {
                    worker: WorkerIdentity {
                        boot_id: u128::MAX,
                        worker_id: u16::MAX,
                        role: IpcRole::Media,
                        generation: u64::MAX,
                    },
                    sequence: u64::MAX,
                },
            };
            assert!(payload(codec, &message).len() <= WORKER_CONTROL_MAX_PAYLOAD_BYTES as usize);
        }
    }
}
