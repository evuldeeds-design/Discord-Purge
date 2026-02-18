// src-tauri/src/api/rate_limiter.rs

use tokio::sync::{mpsc, oneshot, Mutex};
use std::sync::Arc;
use std::time::Duration;
use reqwest::{Client, Method, Response};
use tracing::{info, warn, error};
use crate::core::error::AppError;

/// Represents a pending API request
pub struct ApiRequest {
    pub method: Method,
    pub url: String,
    pub body: Option<serde_json::Value>,
    pub auth_token: String,
    pub response_tx: oneshot::Sender<Result<reqwest::Response, AppError>>,
}

/// Information about the current rate limit window
#[derive(Clone, Default, Debug)]
pub struct RateLimitInfo {
    pub remaining: u32,
    pub reset_after: Duration,
    pub limit: u32,
}

/// The actor's state
pub struct RateLimiterActor {
    /// A queue for incoming requests
    inbox: mpsc::Receiver<ApiRequest>,
    /// The HTTP client
    client: Client,
    /// Information about the current rate limit window
    rate_limit_info: Arc<Mutex<RateLimitInfo>>,
}

impl RateLimiterActor {
    pub fn new(inbox: mpsc::Receiver<ApiRequest>) -> Self {
        Self {
            inbox,
            client: Client::new(),
            rate_limit_info: Arc::new(Mutex::new(RateLimitInfo {
                remaining: 1, // Start with 1 so we can make the first request
                reset_after: Duration::from_secs(0),
                limit: 1,
            })),
        }
    }

    pub async fn run(&mut self) {
        info!("RateLimiterActor starting...");
        while let Some(request) = self.inbox.recv().await {
            let mut info = self.rate_limit_info.lock().await;
            
            // Check if we need to wait
            if info.remaining == 0 {
                let wait_time = info.reset_after;
                if wait_time > Duration::from_secs(0) {
                    warn!("Rate limit reached. Waiting for {:?} before next request...", wait_time);
                    tokio::time::sleep(wait_time).await;
                    // Reset remaining so we can proceed after sleep
                    // The actual headers will update this after the request.
                    info.remaining = 1; 
                }
            }
            drop(info); // Release the lock before making the network call

            // Execute the request
            let mut req_builder = self.client.request(request.method.clone(), &request.url)
                .bearer_auth(&request.auth_token);

            if let Some(body) = request.body {
                req_builder = req_builder.json(&body);
            }

            match req_builder.send().await {
                Ok(response) => {
                    self.update_rate_limit_info(&response).await;

                    if response.status() == 429 {
                        warn!("Hit 429 Too Many Requests on {}", request.url);
                        // In case of 429, we should ideally retry, but for now we'll just send the error back
                        // or wait and retry if we want to be more sophisticated.
                        // For the MVP, let's just send the response back and let the caller handle it.
                    }

                    let _ = request.response_tx.send(Ok(response));
                }
                Err(e) => {
                    error!("Request error for {}: {}", request.url, e);
                    let _ = request.response_tx.send(Err(AppError::from(e)));
                }
            }
        }
        info!("RateLimiterActor shutting down.");
    }

    async fn update_rate_limit_info(&self, response: &Response) {
        let headers = response.headers();
        let mut info = self.rate_limit_info.lock().await;

        if let Some(remaining) = headers.get("X-RateLimit-Remaining")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u32>().ok()) {
            info.remaining = remaining;
        }

        if let Some(reset_after) = headers.get("X-RateLimit-Reset-After")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<f32>().ok()) {
            info.reset_after = Duration::from_secs_f32(reset_after);
        }

        if let Some(limit) = headers.get("X-RateLimit-Limit")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u32>().ok()) {
            info.limit = limit;
        }

        // info!("Updated rate limit info: {:?}", *info);
    }
}

/// A handle to send requests to the RateLimiterActor
#[derive(Clone)]
pub struct ApiHandle {
    tx: mpsc::Sender<ApiRequest>,
}

impl ApiHandle {
    pub fn new(tx: mpsc::Sender<ApiRequest>) -> Self {
        Self { tx }
    }

    pub async fn send_request(
        &self,
        method: Method,
        url: &str,
        body: Option<serde_json::Value>,
        auth_token: &str,
    ) -> Result<reqwest::Response, AppError> {
        let (response_tx, response_rx) = oneshot::channel();
        
        let api_request = ApiRequest {
            method,
            url: url.to_string(),
            body,
            auth_token: auth_token.to_string(),
            response_tx,
        };

        self.tx.send(api_request).await.map_err(|_| AppError {
            user_message: "Internal error: Failed to communicate with rate limiter.".to_string(),
            error_code: "rate_limiter_channel_failure".to_string(),
            technical_details: None,
        })?;

        response_rx.await?
    }
}
