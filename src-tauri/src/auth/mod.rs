// src-tauri/src/auth/mod.rs

use tauri::{AppHandle, Window, Emitter};
use tokio::{sync::oneshot, io::{AsyncReadExt, AsyncWriteExt}};
use url::Url;
use std::{collections::HashMap, net::TcpListener, sync::Arc, sync::Mutex as StdMutex};
use oauth2::{
    basic::BasicClient,
    AuthUrl, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, TokenUrl,
    TokenResponse, HttpResponse, StandardErrorResponse
};
use keyring::Entry;
use serde::{Serialize, Deserialize};
use tauri_plugin_opener::OpenerExt;

// Placeholder for client ID and secret - these will need to be configured
const DISCORD_CLIENT_ID: &str = "_CLIENT_ID_";
const DISCORD_CLIENT_SECRET: &str = "_CLIENT_SECRET_";
const DISCORD_REDIRECT_PATH: &str = "/auth/callback";

// Scopes required for the application, URL-encoded
const DISCORD_SCOPES: &str = "identify+guilds+email"; // Minimal scopes for initial login


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordUser {
    pub id: String,
    pub username: String,
    pub avatar: Option<String>,
    pub email: Option<String>,
}

#[tauri::command]
pub async fn start_oauth_flow(app_handle: AppHandle, window: Window) -> Result<DiscordUser, String> {
    // 1. Setup the OAuth2 client
    let client = BasicClient::new(
        ClientId::new(DISCORD_CLIENT_ID.to_string()),
        Some(ClientSecret::new(DISCORD_CLIENT_SECRET.to_string())),
        AuthUrl::new("https://discord.com/oauth2/authorize".to_string())
            .map_err(|e| format!("Invalid AuthUrl: {}", e))?,
        Some(TokenUrl::new("https://discord.com/api/oauth2/token".to_string())
            .map_err(|e| format!("Invalid TokenUrl: {}", e))?),
    );


    // 2. Generate PKCE challenge and verifier
    let (pkce_code_challenge, pkce_code_verifier) = PkceCodeChallenge::new_random_sha256();

    // 3. Generate a random state to prevent CSRF
    let csrf_state = CsrfToken::new_random();
    
    // 4. Start a temporary local server to listen for the Discord callback
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind to local port: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();

    let redirect_url = RedirectUrl::new(format!("http://127.0.0.1:{}{}", port, DISCORD_REDIRECT_PATH))
        .map_err(|e| format!("Invalid RedirectUrl: {}", e))?;

    let client = client.set_redirect_uri(redirect_url.clone());

    let (authorize_url, _) = client
        .authorize_url(|| csrf_state.clone()) // Pass closure for CSRF token
        .add_scope(oauth2::Scope::new("identify".to_string()))
        .add_scope(oauth2::Scope::new("guilds".to_string()))
        .add_scope(oauth2::Scope::new("email".to_string()))
        .set_pkce_challenge(pkce_code_challenge)
        .url();

    // Store csrf_state and pkce_code_verifier to validate later (e.g., in global state or memory)
    // For simplicity in this example, we'll pass them to the http server handler directly.
    let csrf_state_str = Arc::new(StdMutex::new(csrf_state.secret().to_string()));
    let pkce_code_verifier_str = Arc::new(StdMutex::new(pkce_code_verifier.secret().to_string()));


    let (tx_code, rx_code) = oneshot::channel(); // Channel to receive auth code from web server
    let (tx_error, rx_error) = oneshot::channel(); // Channel to propagate errors from web server
    
    let server_handle = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener)
            .map_err(|e| format!("Failed to convert TcpListener: {}", e))?;
        
        let (mut stream, _) = listener.accept().await.map_err(|e| format!("Failed to accept connection: {}", e))?;
        
        let mut buffer = [0; 2048];
        let n = stream.read(&mut buffer).await.map_err(|e| format!("Failed to read from stream: {}", e))?;
        let request = String::from_utf8_lossy(&buffer[..n]);

        let request_uri = request.split_whitespace().nth(1).ok_or_else(|| "Malformed request URI".to_string())?;
        let query_params: HashMap<String, String> = Url::parse(&format!("http://localhost{}", request_uri))
            .map_err(|e| format!("Failed to parse request URI: {}", e))?
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();

        let code = query_params.get("code").ok_or_else(|| "Authorization code not found".to_string())?.to_string();
        let received_state = query_params.get("state").ok_or_else(|| "State not found".to_string())?.to_string();

        let expected_csrf_state = csrf_state_str.lock().unwrap().clone();
        if received_state != expected_csrf_state {
            let _ = tx_error.send("CSRF state mismatch".to_string());
            return Err("CSRF state mismatch".to_string());
        }

        // Send a minimal HTTP response to the browser to close the tab
        let response_body = "Authentication successful!";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream.write_all(response.as_bytes()).await.map_err(|e| format!("Failed to write response: {}", e))?;
        stream.flush().await.map_err(|e| format!("Failed to flush stream: {}", e))?;

        let _ = tx_code.send((code, pkce_code_verifier_str.lock().unwrap().clone()));
        Ok(())
    });

    // 5. Open the URL in the user's default browser
    window.emit("auth_started", ()) // Emit event to frontend that auth flow has started.
        .map_err(|e| format!("Failed to emit auth_started event: {}", e))?;

    app_handle.opener().open_url(authorize_url.to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let (auth_code, pkce_code_verifier): (String, String) = tokio::select! {
        code_result = rx_code => code_result.map_err(|e| format!("Failed to receive auth code: {}", e))?,
        error_result = rx_error => {
            return Err(error_result.map_err(|e| format!("Error from auth server: {}", e))?);
        }
    };
    
    // Ensure the server handling task doesn't just get dropped
    let _ = server_handle.await.map_err(|e| format!("Auth server task failed: {}", e))?;


    // 6. Exchange the authorization code for an Access Token and Refresh Token
    let token_response = client
        .exchange_code(oauth2::AuthorizationCode::new(auth_code))
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_code_verifier))
        .request_async(|request| async move {
            let client = reqwest::Client::new();
            let mut request_builder = client
                .request(request.method, request.url.as_str())
                .body(request.body);
            for (name, value) in request.headers {
                request_builder = request_builder.header(name, value);
            }
            let response = request_builder.send().await.map_err(|e| {
                oauth2::StandardErrorResponse::new(
                    oauth2::basic::BasicErrorResponseType::InvalidRequest,
                    Some(format!("Network error: {}", e)),
                    None,
                )
            })?;

            let status_code = response.status();
            let headers = response.headers().clone();
            let body = response.bytes().await.map_err(|e| {
                oauth2::StandardErrorResponse::new(
                    oauth2::basic::BasicErrorResponseType::InvalidRequest,
                    Some(format!("Error reading response body: {}", e)),
                    None,
                )
            })?.to_vec();

            Ok::<oauth2::HttpResponse, oauth2::StandardErrorResponse<oauth2::basic::BasicErrorResponseType>>(
                oauth2::HttpResponse {
                    status_code,
                    headers,
                    body,
                }
            )
        })
        .await
        .map_err(|e| format!("Failed to exchange code for tokens: {}", e))?;

    let access_token = token_response.access_token().secret().to_string();
    let refresh_token = token_response.refresh_token().map(|t: &oauth2::RefreshToken| t.secret().to_string());

    // 7. Securely store tokens using keyring
    let entry = Entry::new("discord_privacy_util", "discord_user")
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    entry.set_password(&format!("ACCESS_TOKEN={}\nREFRESH_TOKEN={}", access_token, refresh_token.unwrap_or_default()))
        .map_err(|e| format!("Failed to store tokens in keyring: {}", e))?;

    // 8. Fetch user profile from Discord
    let user_profile: DiscordUser = reqwest::Client::new()
        .get("https://discord.com/api/users/@me")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user profile: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse user profile: {}", e))?;

    // 9. Emit a success event to the frontend
    window.emit("auth_success", user_profile.clone()).unwrap();

    Ok(user_profile)
}
