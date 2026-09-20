use a2_build_info::BUILD_ID;
use a2_supervisor::{
    BootId, MonotonicClock, ProcessDriver, ReadinessRequirement, ReadyEvidence, RestartPolicy,
    Supervisor, WorkerId, WorkerRole, WorkerSpec,
};
use std::convert::Infallible;

struct ZeroClock;

impl MonotonicClock for ZeroClock {
    fn now_ms(&self) -> u64 {
        0
    }
}

#[derive(Default)]
struct RecordingDriver;

impl ProcessDriver for RecordingDriver {
    type Handle = u64;
    type Error = Infallible;

    fn spawn(
        &mut self,
        worker: WorkerId,
        role: WorkerRole,
        boot_id: BootId,
        generation: u64,
    ) -> Result<Self::Handle, Self::Error> {
        println!(
            "spawn worker={} role={role:?} boot={} generation={generation}",
            worker.0, boot_id.0
        );
        Ok(u64::from(worker.0) * 100 + generation)
    }

    fn request_shutdown(&mut self, handle: Self::Handle) -> Result<(), Self::Error> {
        println!("shutdown handle={handle}");
        Ok(())
    }

    fn force_terminate(&mut self, handle: Self::Handle) -> Result<(), Self::Error> {
        println!("terminate handle={handle}");
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("build_id={BUILD_ID}");
    let audio = WorkerId(1);
    let boot_id = BootId(1);
    let policy = RestartPolicy {
        startup_timeout_ms: 5_000,
        heartbeat_timeout_ms: 1_000,
        shutdown_grace_ms: 2_000,
        restart_window_ms: 60_000,
        restart_base_delay_ms: 100,
        restart_max_delay_ms: 5_000,
        max_restart_attempts: 3,
        terminate_retry_base_delay_ms: 100,
        terminate_retry_max_delay_ms: 1_000,
        max_force_terminate_attempts: 3,
    };
    let mut supervisor = Supervisor::new(
        ZeroClock,
        RecordingDriver,
        boot_id,
        policy,
        [WorkerSpec {
            id: audio,
            role: WorkerRole::AudioEngine,
            readiness: ReadinessRequirement::DeviceVerified,
        }],
    )
    .map_err(|error| format!("invalid supervisor configuration: {error:?}"))?;
    supervisor.start();
    supervisor.worker_ready(
        audio,
        boot_id,
        1,
        ReadyEvidence::DeviceVerified { capture_epoch: 1 },
    );
    println!("readiness={:?}", supervisor.readiness());
    supervisor.shutdown();
    supervisor.worker_exited(audio, boot_id, 1);
    println!("readiness={:?}", supervisor.readiness());
    Ok(())
}
