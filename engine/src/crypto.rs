//! Master-password encryption for stored secrets (Sprint 6).
//!
//! Threat model: this protects secrets **at rest** — an attacker who obtains
//! the SQLite file (theft, stray backup, cloud sync) cannot read API keys
//! without the master password. It does NOT defend against a compromised
//! running process (the master key and decrypted keys necessarily live in
//! memory while unlocked) nor against renderer XSS in an unlocked session.
//!
//! Scheme:
//! - Argon2id derives a 32-byte master key from the password + a random salt.
//!   The salt is stored; the password and derived key are NEVER persisted.
//! - AES-256-GCM (authenticated) encrypts each secret under the master key with
//!   a fresh random 96-bit nonce stored alongside the ciphertext.
//! - A fixed verifier plaintext is encrypted at setup; on unlock we decrypt it
//!   to confirm the candidate password derived the right key (GCM auth tag
//!   fails on a wrong key).
//!
//! Nothing in this module logs key material or passwords.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Known plaintext encrypted at setup time; decrypting it under a candidate
/// key validates the master password. The value itself is not secret.
const VERIFIER_PLAINTEXT: &[u8] = b"encorehub-verifier-v1";

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Errors surfaced by the crypto layer. Messages are deliberately generic and
/// never echo key material or the password.
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("incorrect password")]
    WrongPassword,
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed")]
    Decrypt,
    #[error("key derivation failed")]
    Derivation,
    #[error("malformed ciphertext")]
    Malformed,
}

/// A derived 32-byte master key held only in memory. Zeroized on drop so it
/// does not linger in freed memory after the session locks.
#[derive(Clone, ZeroizeOnDrop)]
pub struct MasterKey([u8; KEY_LEN]);

impl MasterKey {
    fn cipher(&self) -> Aes256Gcm {
        let key = Key::<Aes256Gcm>::from_slice(&self.0);
        Aes256Gcm::new(key)
    }

    /// Encrypt `plaintext`, returning `(ciphertext, nonce)`. A fresh random
    /// nonce is generated per call — never reuse a nonce under the same key.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher()
            .encrypt(nonce, plaintext)
            .map_err(|_| CryptoError::Encrypt)?;
        Ok((ciphertext, nonce_bytes.to_vec()))
    }

    /// Decrypt `ciphertext` produced by [`encrypt`]. A wrong key or tampered
    /// ciphertext fails the GCM auth tag and yields `Decrypt`.
    pub fn decrypt(&self, ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if nonce.len() != NONCE_LEN {
            return Err(CryptoError::Malformed);
        }
        let nonce = Nonce::from_slice(nonce);
        self.cipher()
            .decrypt(nonce, ciphertext)
            .map_err(|_| CryptoError::Decrypt)
    }
}

/// Generate a random 16-byte Argon2 salt.
pub fn generate_salt() -> Vec<u8> {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt.to_vec()
}

/// Derive a master key from `password` + `salt` using Argon2id. The password
/// argument is taken by value and zeroized before returning so callers don't
/// keep a second copy alive.
pub fn derive_key(mut password: String, salt: &[u8]) -> Result<MasterKey, CryptoError> {
    let result = derive_key_inner(password.as_bytes(), salt);
    password.zeroize();
    result
}

fn derive_key_inner(password: &[u8], salt: &[u8]) -> Result<MasterKey, CryptoError> {
    // Argon2id with reasonable interactive parameters (19 MiB, 2 passes).
    let params =
        Params::new(19 * 1024, 2, 1, Some(KEY_LEN)).map_err(|_| CryptoError::Derivation)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(password, salt, &mut key)
        .map_err(|_| CryptoError::Derivation)?;
    let master = MasterKey(key);
    key.zeroize();
    Ok(master)
}

/// Encrypt the verifier plaintext under `key`, returning `(ciphertext, nonce)`
/// to persist in `crypto_meta`.
pub fn make_verifier(key: &MasterKey) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    key.encrypt(VERIFIER_PLAINTEXT)
}

/// Check that `key` (derived from a candidate password) matches the stored
/// verifier. Returns `WrongPassword` on mismatch.
pub fn verify(
    key: &MasterKey,
    verifier_ciphertext: &[u8],
    verifier_nonce: &[u8],
) -> Result<(), CryptoError> {
    match key.decrypt(verifier_ciphertext, verifier_nonce) {
        Ok(pt) if pt == VERIFIER_PLAINTEXT => Ok(()),
        _ => Err(CryptoError::WrongPassword),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_for(pw: &str, salt: &[u8]) -> MasterKey {
        derive_key(pw.to_string(), salt).unwrap()
    }

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let salt = generate_salt();
        let key = key_for("hunter2", &salt);
        let secret = b"sk-test-1234567890";
        let (ct, nonce) = key.encrypt(secret).unwrap();
        assert_ne!(
            &ct[..],
            &secret[..],
            "ciphertext must differ from plaintext"
        );
        let pt = key.decrypt(&ct, &nonce).unwrap();
        assert_eq!(pt, secret);
    }

    #[test]
    fn fresh_nonce_per_encrypt() {
        let salt = generate_salt();
        let key = key_for("pw", &salt);
        let (_, n1) = key.encrypt(b"a").unwrap();
        let (_, n2) = key.encrypt(b"a").unwrap();
        assert_ne!(n1, n2, "each encryption must use a fresh nonce");
    }

    #[test]
    fn wrong_password_fails_verifier() {
        let salt = generate_salt();
        let right = key_for("correct horse", &salt);
        let (vct, vnonce) = make_verifier(&right).unwrap();
        // Right password verifies.
        verify(&right, &vct, &vnonce).unwrap();
        // Wrong password (same salt) derives a different key → rejected.
        let wrong = key_for("battery staple", &salt);
        assert!(matches!(
            verify(&wrong, &vct, &vnonce),
            Err(CryptoError::WrongPassword)
        ));
    }

    #[test]
    fn wrong_key_cannot_decrypt_secret() {
        let salt = generate_salt();
        let k1 = key_for("pw1", &salt);
        let k2 = key_for("pw2", &salt);
        let (ct, nonce) = k1.encrypt(b"sk-secret").unwrap();
        assert!(matches!(k2.decrypt(&ct, &nonce), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let salt = generate_salt();
        let key = key_for("pw", &salt);
        let (mut ct, nonce) = key.encrypt(b"sk-secret").unwrap();
        ct[0] ^= 0xff; // flip a bit
        assert!(matches!(
            key.decrypt(&ct, &nonce),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn malformed_nonce_rejected() {
        let salt = generate_salt();
        let key = key_for("pw", &salt);
        let (ct, _) = key.encrypt(b"x").unwrap();
        assert!(matches!(
            key.decrypt(&ct, &[0u8; 4]),
            Err(CryptoError::Malformed)
        ));
    }

    #[test]
    fn same_password_and_salt_derive_same_key() {
        let salt = generate_salt();
        let (ct, nonce) = key_for("pw", &salt).encrypt(b"data").unwrap();
        // A freshly derived key from the same password+salt decrypts it.
        let pt = key_for("pw", &salt).decrypt(&ct, &nonce).unwrap();
        assert_eq!(pt, b"data");
    }
}
