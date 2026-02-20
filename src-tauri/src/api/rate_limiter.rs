// src-tauri/src/api/rate_limiter.rs

use tokio::sync::{mpsc, oneshot, Mutex};
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::collections::HashMap;
use reqwest::{Client, Method, Response, header};
use tracing::{info, warn, error, debug};
use crate::core::error::AppError;
use rand::Rng;

/// Represents a pending API request
pub struct ApiRequest {
    pub method: Method,
    pub url: String,
    pub body: Option<serde_json::Value>,
    pub auth_token: String,
    pub is_bearer: bool,
    pub response_tx: oneshot::Sender<Result<reqwest::Response, AppError>>,
}

/// Information about a rate limit bucket
#[derive(Clone, Debug)]
pub struct BucketInfo {
    pub remaining: u32,
    pub reset_at: Instant,
    pub limit: u32,
    pub consecutive_429s: u32,
}

impl Default for BucketInfo {
    fn default() -> Self {
        Self {
            remaining: 1,
            reset_at: Instant::now(),
            limit: 1,
            consecutive_429s: 0,
        }
    }
}

pub struct RateLimiterActor {
    inbox: mpsc::Receiver<ApiRequest>,
    client: Client,
    buckets: Arc<Mutex<HashMap<String, BucketInfo>>>,
    global_reset_at: Arc<Mutex<Instant>>,
}

impl RateLimiterActor {
    pub fn new(inbox: mpsc::Receiver<ApiRequest>) -> Self {
        Self {
            inbox,
            client: Client::new(),
            buckets: Arc::new(Mutex::new(HashMap::new())),
            global_reset_at: Arc::new(Mutex::new(Instant::now())),
        }
    }

    fn get_route(url: &str) -> String {
        let parsed_url = match url::Url::parse(url) {
            Ok(u) => u,
            Err(_) => return "default".to_string(),
        };
        let path = parsed_url.path();
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        
        if let Some(pos) = segments.iter().position(|&s| s == "channels") {
            if let Some(id) = segments.get(pos + 1) {
                return format!("channels/{}", id);
            }
        }
        if let Some(pos) = segments.iter().position(|&s| s == "guilds") {
            if let Some(id) = segments.get(pos + 1) {
                return format!("guilds/{}", id);
            }
        }
        if segments.contains(&"relationships") {
            return "relationships".to_string();
        }
        
        "default".to_string()
    }

    pub async fn run(&mut self) {
        info!("[LIM] RateLimiterActor operational.");
        while let Some(request) = self.inbox.recv().await {
            let route = Self::get_route(&request.url);
            
            loop {
                let now = Instant::now();
                
                // 1. Global Throttle
                {
                    let global = self.global_reset_at.lock().await;
                    if now < *global {
                        let wait = *global - now;
                        debug!("[LIM] Global throttle. Sleep {:?}", wait);
                        tokio::time::sleep(wait).await;
                        continue;
                    }
                }

                // 2. Bucket Throttle
                {
                    let mut buckets = self.buckets.lock().await;
                    let bucket = buckets.entry(route.clone()).or_default();
                    
                    if now >= bucket.reset_at {
                        bucket.remaining = bucket.limit;
                    }

                    if bucket.remaining == 0 {
                        let wait = bucket.reset_at.saturating_duration_since(now);
                        if wait.is_zero() {
                            bucket.remaining = bucket.limit; 
                        } else {
                            warn!("[LIM] Bucket '{}' empty. Waiting {:?}...", route, wait);
                            drop(buckets);
                            let jitter = rand::thread_rng().gen_range(50..150);
                            tokio::time::sleep(wait + Duration::from_millis(jitter)).await; // Add small jitter buffer
                            continue;
                        }
                    }
                    bucket.remaining = bucket.remaining.saturating_sub(1);
                }

                // 3. Execution with Smart Jitter
                let mut req_builder = self.client.request(request.method.clone(), &request.url);
                if request.is_bearer {
                    req_builder = req_builder.bearer_auth(&request.auth_token);
                } else {
                    req_builder = req_builder.header(header::AUTHORIZATION, &request.auth_token);
                }
                if let Some(body) = request.body.clone() {
                    req_builder = req_builder.json(&body);
                }

                if request.method == Method::DELETE || request.method == Method::POST || request.method == Method::PATCH {
                    let jitter = rand::thread_rng().gen_range(50..150); // 50ms to 200ms extra
                    tokio::time::sleep(Duration::from_millis(jitter)).await;
                }

                match req_builder.send().await {
                    Ok(response) => {
                        let status = response.status();
                        let is_429 = status.as_u16() == 429;
                        self.update_limits(&route, &response, is_429).await;

                        if is_429 {
                            warn!("[LIM] Rate limit (429) hit for {}. Recalibrating...", request.url);
                            continue; 
                        }

                        let _ = request.response_tx.send(Ok(response));
                        break; 
                    }
                    Err(e) => {
                        error!("[LIM] Transport error for {}: {}", request.url, e);
                        let _ = request.response_tx.send(Err(AppError::from(e)));
                        break;
                    }
                }
            }
        }
    }

    async fn update_limits(&self, route: &str, response: &Response, is_429: bool) {
        let headers = response.headers();
        let now = Instant::now();
        
        let mut buckets = self.buckets.lock().await;
        let bucket = buckets.entry(route.to_string()).or_default();

        if is_429 {
            bucket.consecutive_429s += 1;
        } else {
            bucket.consecutive_429s = 0;
        }

        if let Some(rem) = headers.get("X-RateLimit-Remaining").and_then(|h| h.to_str().ok()).and_then(|s| s.parse::<u32>().ok()) {
            bucket.remaining = rem;
        }
        if let Some(reset) = headers.get("X-RateLimit-Reset-After").and_then(|h| h.to_str().ok()).and_then(|s| s.parse::<f32>().ok()) {
            bucket.reset_at = now + Duration::from_secs_f32(reset);
        }
        if let Some(lim) = headers.get("X-RateLimit-Limit").and_then(|h| h.to_str().ok()).and_then(|s| s.parse::<u32>().ok()) {
            bucket.limit = lim;
        }

        if is_429 {
            let retry_after = headers.get("Retry-After")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<f32>().ok())
                .unwrap_or(1.0);
            
            let mut wait = Duration::from_secs_f32(retry_after);
            
            // Exponential Backoff for consecutive 429s
            if bucket.consecutive_429s > 0 {
                let backoff_factor = 2u64.pow(bucket.consecutive_429s.min(5)); // Max 5 retries
                wait += Duration::from_secs(backoff_factor);
                warn!("[LIM] Exponential Backoff for '{}': waiting {:?} ({} consecutive 429s)", route, wait, bucket.consecutive_429s);
            }

            if headers.get("X-RateLimit-Global").and_then(|h| h.to_str().ok()) == Some("true") {
                let mut g = self.global_reset_at.lock().await;
                *g = now + wait;
            } else {
                bucket.remaining = 0;
                bucket.reset_at = now + wait;
            }
        }
    }
}

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
        is_bearer: bool,
    ) -> Result<reqwest::Response, AppError> {
        let (response_tx, response_rx) = oneshot::channel();
        
        let api_request = ApiRequest {
            method,
            url: url.to_string(),
            body,
            auth_token: auth_token.to_string(),
            is_bearer,
            response_tx,
        };

        self.tx.send(api_request).await.map_err(|_| AppError {
            user_message: "Rate limiter connection failure.".to_string(),
            error_code: "limiter_offline".to_string(),
            technical_details: None,
        })?;

        response_rx.await.map_err(|_| AppError {
            user_message: "Rate limiter communication timeout.".to_string(),
            error_code: "limiter_timeout".to_string(),
            technical_details: None,
        })?
    }
}