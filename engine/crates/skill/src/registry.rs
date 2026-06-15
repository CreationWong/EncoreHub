//! Skill registry — loads and manages skills from disk.

use crate::{parser::parse_skill_md, Skill};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub struct SkillRegistry {
    skills: HashMap<String, Skill>,
    skills_dir: PathBuf,
}

impl SkillRegistry {
    /// Create a new registry and load all skills from the given directory.
    pub fn load(skills_dir: impl AsRef<Path>) -> Self {
        let skills_dir = skills_dir.as_ref().to_path_buf();
        let mut registry = Self {
            skills: HashMap::new(),
            skills_dir,
        };
        registry.reload();
        registry
    }

    /// Reload all skills from disk.
    pub fn reload(&mut self) {
        self.skills.clear();
        if !self.skills_dir.exists() {
            return;
        }

        if let Ok(entries) = std::fs::read_dir(&self.skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(skill) = parse_skill_md(&path) {
                        tracing::info!("Loaded skill: {} ({})", skill.name, path.display());
                        self.skills.insert(skill.id.clone(), skill);
                    }
                }
            }
        }
    }

    pub fn list(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }

    pub fn list_enabled(&self) -> Vec<&Skill> {
        self.skills.values().filter(|s| s.enabled).collect()
    }

    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn toggle(&mut self, id: &str, enabled: bool) -> bool {
        if let Some(skill) = self.skills.get_mut(id) {
            skill.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Find all skills whose triggers match the user input.
    pub fn find_matches(&self, input: &str) -> Vec<&Skill> {
        self.skills
            .values()
            .filter(|s| s.enabled && crate::matches_trigger(s, input))
            .collect()
    }
}
