//! Skill Engine for EncoreHub.
//!
//! Skills are directories containing a SKILL.md file with YAML frontmatter.
//! The engine loads skills, matches user input against triggers, and exposes
//! skill tools for invocation.

mod parser;
mod registry;

pub use parser::parse_skill_md;
pub use registry::SkillRegistry;

use encorehub_core::Skill as CoreSkill;
use encorehub_core::SkillTool;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A loaded skill ready for execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub enabled: bool,
    pub builtin: bool,
    pub triggers: Vec<String>,
    pub tools: Vec<SkillTool>,
    pub install_path: PathBuf,
}

impl Skill {
    pub fn to_core(&self) -> CoreSkill {
        CoreSkill {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            version: self.version.clone(),
            author: self.author.clone(),
            enabled: self.enabled,
            builtin: self.builtin,
            triggers: self.triggers.clone(),
            tools: self.tools.clone(),
            install_path: self.install_path.to_string_lossy().to_string(),
        }
    }
}

/// Check if a user message matches any of this skill's triggers.
pub fn matches_trigger(skill: &Skill, user_input: &str) -> bool {
    let lower = user_input.to_lowercase();
    skill
        .triggers
        .iter()
        .any(|t| lower.contains(&t.to_lowercase()))
}

/// Find the best matching skill for a user message.
pub fn find_matching_skill<'a>(skills: &'a [Skill], input: &str) -> Option<&'a Skill> {
    skills
        .iter()
        .filter(|s| s.enabled)
        .find(|s| matches_trigger(s, input))
}
