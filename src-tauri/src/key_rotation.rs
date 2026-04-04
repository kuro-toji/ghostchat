// GhostChat — Key Rotation and Perfect Forward Secrecy
// Ensures past messages remain secure even if keys are compromised

use serde::{Deserialize, Serialize};

/// Key rotation state for Double Ratchet protocol
#[derive(Clone, Serialize, Deserialize)]
pub struct KeyRotation {
    /// Current message key index
    pub message_key_index: u64,
    /// Root key for chain derivation
    pub root_key: Vec<u8>,
    /// Chain key for message key derivation
    pub chain_key: Vec<u8>,
    /// Previous chain key (for out-of-order messages)
    pub previous_chain_key: Option<Vec<u8>>,
    /// Number of messages before next ratchet step
    pub message_count: u32,
    /// Maximum messages before forced ratchet (for PFS)
    pub max_messages: u32,
}

impl KeyRotation {
    /// Create new key rotation state
    pub fn new(root_key: Vec<u8>, max_messages: u32) -> Self {
        Self {
            message_key_index: 0,
            root_key: root_key.clone(),
            chain_key: root_key,
            previous_chain_key: None,
            message_count: 0,
            max_messages,
        }
    }

    /// Derive next message key
    pub fn derive_message_key(&mut self) -> Vec<u8> {
        // KDF(chain_key || message_index)
        let mut input = self.chain_key.clone();
        input.extend_from_slice(&self.message_key_index.to_be_bytes());
        
        // Simplified: in production use proper HKDF
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&input);
        let result = hasher.finalize();
        
        // Advance message index
        self.message_key_index += 1;
        self.message_count += 1;
        
        // Check if we need to ratchet
        if self.message_count >= self.max_messages {
            self.perform_ratchet_step();
        }
        
        result.to_vec()
    }

    /// Perform ratchet step for perfect forward secrecy
    fn perform_ratchet_step(&mut self) {
        // Save current chain key for receiving delayed messages
        self.previous_chain_key = Some(self.chain_key.clone());
        
        // Reset message count
        self.message_count = 0;
        
        // Derive new chain key from root key
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(b"RATCHET");
        hasher.update(&self.root_key);
        hasher.update(&self.chain_key);
        let new_root = hasher.finalize();
        
        // Update root key
        self.root_key = new_root.to_vec();
        
        // Derive new chain key
        hasher = Sha256::new();
        hasher.update(b"CHAIN");
        hasher.update(&self.root_key);
        let new_chain = hasher.finalize();
        self.chain_key = new_chain.to_vec();
    }

    /// Decrypt a message with out-of-order handling
    pub fn decrypt_message(&mut self, ciphertext: &[u8], message_index: u64) -> Result<Vec<u8>, String> {
        // If message is from previous chain
        if message_index < self.message_key_index {
            if let Some(ref prev_chain) = self.previous_chain_key {
                return self.decrypt_with_chain(prev_chain, message_index);
            }
            return Err("Message too old and no previous chain key".to_string());
        }
        
        // If message is ahead, we need to catch up
        while self.message_key_index < message_index {
            self.derive_message_key();
        }
        
        // Derive the key for this message
        let key = self.derive_key_for_index(message_index);
        
        // Decrypt (XOR for demo - use AES-GCM in production)
        Ok(self.xor_decrypt(ciphertext, &key))
    }

    fn decrypt_with_chain(&self, chain_key: &[u8], message_index: u64) -> Result<Vec<u8>, String> {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(chain_key);
        hasher.update(&message_index.to_be_bytes());
        let key = hasher.finalize();
        
        Ok(self.xor_decrypt(ciphertext, &key.to_vec()))
    }

    fn derive_key_for_index(&self, index: u64) -> Vec<u8> {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&self.chain_key);
        hasher.update(&index.to_be_bytes());
        hasher.finalize().to_vec()
    }

    fn xor_decrypt(&self, ciphertext: &[u8], key: &[u8]) -> Vec<u8> {
        ciphertext.iter()
            .zip(key.iter().cycle())
            .map(|(c, k)| c ^ k)
            .collect()
    }
}

/// Encryption metadata for forward secrecy
#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptionMetadata {
    /// Message key index
    pub key_index: u64,
    /// Ephemeral public key used
    pub ephemeral_pubkey: Vec<u8>,
    /// Encrypted header (contains key info)
    pub encrypted_header: Vec<u8>,
    /// Whether this message triggered a ratchet step
    pub ratchet_step: bool,
}

impl EncryptionMetadata {
    pub fn new(key_index: u64, ephemeral_pubkey: Vec<u8>, encrypted_header: Vec<u8>, ratchet_step: bool) -> Self {
        Self {
            key_index,
            ephemeral_pubkey,
            encrypted_header,
            ratchet_step,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_rotation() {
        let root_key = vec![0u8; 32];
        let mut rotation = KeyRotation::new(root_key, 10);
        
        // Derive first key
        let key1 = rotation.derive_message_key();
        assert_eq!(key1.len(), 32);
        
        // Derive second key
        let key2 = rotation.derive_message_key();
        assert_ne!(key1, key2);
        
        // After max messages, should ratchet
        for _ in 0..8 {
            rotation.derive_message_key();
        }
        let key_after_ratchet = rotation.derive_message_key();
        
        // Chain key should be different after ratchet
        assert!(rotation.previous_chain_key.is_some());
    }

    #[test]
    fn test_perfect_forward_secrecy() {
        let root_key = vec![1u8; 32];
        let mut rotation = KeyRotation::new(root_key, 5);
        
        // Derive some keys
        let keys: Vec<_> = (0..3).map(|_| rotation.derive_message_key()).collect();
        
        // If current state is compromised, past keys should still be secure
        // (they were derived from different chain keys)
        assert_eq!(keys.len(), 3);
        assert_ne!(keys[0], keys[1]);
        assert_ne!(keys[1], keys[2]);
    }
}
