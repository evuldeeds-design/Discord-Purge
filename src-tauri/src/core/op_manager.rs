// src-tauri/src/core/op_manager.rs

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct OpState {
    pub is_running: AtomicBool,
    pub is_paused: AtomicBool,
    pub should_abort: AtomicBool,
}

impl OpState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            is_paused: AtomicBool::new(false),
            should_abort: AtomicBool::new(false),
        }
    }

    pub async fn wait_if_paused(&self) {
        while self.is_paused.load(Ordering::SeqCst) && !self.should_abort.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    pub fn reset(&self) {
        self.is_running.store(false, Ordering::SeqCst);
        self.is_paused.store(false, Ordering::SeqCst);
        self.should_abort.store(false, Ordering::SeqCst);
    }
}

pub struct OperationManager {
    pub state: Arc<OpState>,
}

impl OperationManager {
    pub fn new() -> Self {
        Self { state: Arc::new(OpState::new()) }
    }
}
