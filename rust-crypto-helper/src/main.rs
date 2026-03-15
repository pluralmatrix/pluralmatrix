use anyhow::{Context, Result};
use matrix_sdk_crypto::OlmMachine;
use matrix_sdk_sqlite::SqliteCryptoStore;
use ruma::{OwnedDeviceId, UserId};
use serde::Serialize;
use serde_json::json;
use std::env;
use std::path::Path;

#[derive(Serialize)]
struct BootstrapOutput {
    upload_keys: serde_json::Value,
    upload_signatures: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        anyhow::bail!("Usage: {} <user_id> <device_id> <store_path>", args[0]);
    }

    let user_id = UserId::parse(&args[1]).context("Invalid user ID")?;
    let device_id: OwnedDeviceId = args[2].clone().into();
    let store_path = Path::new(&args[3]);

    // Create the store directory if it doesn't exist
    if !store_path.exists() {
        std::fs::create_dir_all(store_path).context("Failed to create store directory")?;
    }

    let store = SqliteCryptoStore::open(store_path, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to open sqlite store: {}", e))?;

    let machine = OlmMachine::with_store(&user_id, &device_id, store, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to initialize OlmMachine: {}", e))?;

    // bootstrap_cross_signing returns CrossSigningBootstrapRequests
    let bootstrap_reqs = machine
        .bootstrap_cross_signing(false)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to bootstrap cross-signing: {}", e))?;

    let output = BootstrapOutput {
        upload_keys: json!({
            "master_key": bootstrap_reqs.upload_signing_keys_req.master_key,
            "self_signing_key": bootstrap_reqs.upload_signing_keys_req.self_signing_key,
            "user_signing_key": bootstrap_reqs.upload_signing_keys_req.user_signing_key,
        }),
        upload_signatures: json!({
            "signed_keys": bootstrap_reqs.upload_signatures_req.signed_keys
        }),
    };

    println!("{}", serde_json::to_string(&output)?);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_bootstrap_logic() -> Result<()> {
        let dir = tempdir()?;
        let user_id = UserId::parse("@test:localhost")?;
        let device_id = OwnedDeviceId::from("TEST_DEVICE".to_string());

        let store = SqliteCryptoStore::open(dir.path(), None).await?;
        let machine = OlmMachine::with_store(&user_id, &device_id, store, None)
            .await
            .unwrap();

        let bootstrap_reqs = machine.bootstrap_cross_signing(true).await.unwrap();

        let upload_keys = json!({
            "master_key": bootstrap_reqs.upload_signing_keys_req.master_key,
            "self_signing_key": bootstrap_reqs.upload_signing_keys_req.self_signing_key,
            "user_signing_key": bootstrap_reqs.upload_signing_keys_req.user_signing_key,
        });

        assert!(upload_keys.get("master_key").is_some());
        assert!(upload_keys.get("self_signing_key").is_some());

        Ok(())
    }
}
