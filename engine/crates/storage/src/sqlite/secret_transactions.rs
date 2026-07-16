use super::{now_ms, Database, Result};
use encorehub_core::{CryptoMeta, EngineError, SecretRow};
use rusqlite::{params, OptionalExtension, Transaction};
use std::collections::HashSet;

#[derive(Clone, Copy)]
enum Transition<'a> {
    Enable(&'a CryptoMeta),
    Rotate(&'a CryptoMeta),
    Disable,
}

impl<'a> Transition<'a> {
    fn source_is_encrypted(self) -> bool {
        !matches!(self, Self::Enable(_))
    }

    fn target_is_encrypted(self) -> bool {
        !matches!(self, Self::Disable)
    }

    fn meta(self) -> Option<&'a CryptoMeta> {
        match self {
            Self::Enable(meta) | Self::Rotate(meta) => Some(meta),
            Self::Disable => None,
        }
    }
}

impl Database {
    /// Atomically replace plaintext rows with encrypted rows and enable the
    /// supplied crypto metadata. All encryption must finish before this call.
    pub fn enable_secret_encryption(&self, secrets: &[SecretRow], meta: &CryptoMeta) -> Result<()> {
        self.apply_secret_transition(secrets, Transition::Enable(meta))
    }

    /// Atomically replace every encrypted row and its password verifier. All
    /// decrypt/re-encrypt work must finish before this call.
    pub fn rotate_secret_encryption(&self, secrets: &[SecretRow], meta: &CryptoMeta) -> Result<()> {
        self.apply_secret_transition(secrets, Transition::Rotate(meta))
    }

    /// Atomically replace encrypted rows with plaintext rows and remove the
    /// crypto metadata. All decryption must finish before this call.
    pub fn disable_secret_encryption(&self, secrets: &[SecretRow]) -> Result<()> {
        self.apply_secret_transition(secrets, Transition::Disable)
    }

    fn apply_secret_transition(
        &self,
        secrets: &[SecretRow],
        transition: Transition<'_>,
    ) -> Result<()> {
        validate_target_rows(secrets, transition.target_is_encrypted())?;
        if transition.meta().is_some_and(|meta| !meta.enabled) {
            return Err(invalid_transition("target crypto metadata must be enabled"));
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        validate_current_state(&tx, secrets, transition)?;

        for secret in secrets {
            write_secret(&tx, secret)?;
        }
        match transition.meta() {
            Some(meta) => write_crypto_meta(&tx, meta)?,
            None => {
                tx.execute("DELETE FROM crypto_meta WHERE id = 1", [])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

fn validate_target_rows(secrets: &[SecretRow], encrypted: bool) -> Result<()> {
    let mut provider_ids = HashSet::with_capacity(secrets.len());
    for secret in secrets {
        if !provider_ids.insert(secret.provider_id.as_str()) {
            return Err(invalid_transition("duplicate provider id"));
        }
        let valid_shape = if encrypted {
            secret.plaintext.is_none() && secret.ciphertext.is_some() && secret.nonce.is_some()
        } else {
            secret.plaintext.is_some() && secret.ciphertext.is_none() && secret.nonce.is_none()
        };
        if !valid_shape {
            return Err(invalid_transition("secret row has the wrong target shape"));
        }
    }
    Ok(())
}

fn validate_current_state(
    tx: &Transaction<'_>,
    secrets: &[SecretRow],
    transition: Transition<'_>,
) -> Result<()> {
    let enabled = tx
        .query_row("SELECT enabled FROM crypto_meta WHERE id = 1", [], |row| {
            row.get::<_, i64>(0)
        })
        .optional()?
        .is_some_and(|value| value != 0);
    if enabled != transition.source_is_encrypted() {
        return Err(invalid_transition("source encryption mode changed"));
    }

    let invalid_source_rows: i64 = if transition.source_is_encrypted() {
        tx.query_row(
            "SELECT COUNT(*) FROM secrets
             WHERE plaintext IS NOT NULL OR ciphertext IS NULL OR nonce IS NULL",
            [],
            |row| row.get(0),
        )?
    } else {
        tx.query_row(
            "SELECT COUNT(*) FROM secrets
             WHERE plaintext IS NULL OR ciphertext IS NOT NULL OR nonce IS NOT NULL",
            [],
            |row| row.get(0),
        )?
    };
    if invalid_source_rows != 0 {
        return Err(invalid_transition("source secret rows are inconsistent"));
    }

    let mut statement = tx.prepare("SELECT provider_id FROM secrets")?;
    let current_ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<HashSet<_>, _>>()?;
    drop(statement);
    let target_ids = secrets
        .iter()
        .map(|secret| secret.provider_id.clone())
        .collect::<HashSet<_>>();
    let ids_match = match transition {
        Transition::Enable(_) => current_ids.is_subset(&target_ids),
        Transition::Rotate(_) | Transition::Disable => current_ids == target_ids,
    };
    if !ids_match {
        return Err(invalid_transition("secret provider set changed"));
    }
    Ok(())
}

fn write_secret(tx: &Transaction<'_>, secret: &SecretRow) -> Result<()> {
    tx.execute(
        "INSERT OR REPLACE INTO secrets
         (provider_id, plaintext, ciphertext, nonce, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            secret.provider_id,
            secret.plaintext,
            secret.ciphertext,
            secret.nonce,
            now_ms(),
        ],
    )?;
    Ok(())
}

fn write_crypto_meta(tx: &Transaction<'_>, meta: &CryptoMeta) -> Result<()> {
    tx.execute(
        "INSERT OR REPLACE INTO crypto_meta
         (id, enabled, salt, verifier_ciphertext, verifier_nonce, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)",
        params![
            meta.enabled as i64,
            meta.salt,
            meta.verifier_ciphertext,
            meta.verifier_nonce,
            now_ms(),
        ],
    )?;
    Ok(())
}

fn invalid_transition(message: &str) -> EngineError {
    EngineError::InvalidArgument(format!("invalid secret encryption transition: {message}"))
}
